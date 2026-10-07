// Background service worker for Proof of Grass.
// Step 2: tracks daily time spent on distracting sites.
//
// The worker can be stopped by Chrome at any moment, so nothing important
// lives in memory. The current session's start time and today's totals are
// kept in chrome.storage.local, and every event recomputes the state.

const TRACKED_SITES = [
  "youtube.com",
  "reddit.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
];

const CHECKPOINT_ALARM = "checkpoint";
const CHECKPOINT_MINUTES = 0.5; // 30 seconds, the minimum Chrome allows

// If more time than this passed since the last checkpoint, alarms could not
// have been firing (computer asleep or Chrome closed), so don't count it.
const MAX_GAP_MS = 2 * 60 * 1000;

// ---------- Helpers ----------

// Returns the tracked site for a URL, e.g. "https://m.youtube.com/x" -> "youtube.com".
function trackedSiteFor(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname;
  return (
    TRACKED_SITES.find((site) => host === site || host.endsWith("." + site)) ||
    null
  );
}

// Local calendar date, e.g. "2026-10-06" (not UTC).
function dateKey(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function emptyUsage(ms) {
  return { date: dateKey(ms), totalSeconds: 0, sites: {} };
}

// Which tracked site is the user looking at right now? null if none,
// or if Chrome itself isn't the focused app.
async function getActiveTrackedSite() {
  let win;
  try {
    win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  } catch {
    return null; // no windows open
  }
  if (!win || !win.focused) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return tab ? trackedSiteFor(tab.url) : null;
}

// ---------- Core: credit elapsed time, then start/stop the session ----------

async function sync(reason) {
  const now = Date.now();
  const stored = await chrome.storage.local.get(["usage", "session"]);

  let usage = stored.usage;
  if (!usage || usage.date !== dateKey(now)) {
    if (usage) console.log(`New day: resetting usage (was ${usage.date}).`);
    usage = emptyUsage(now);
  }

  const session = stored.session;
  const activeSite = await getActiveTrackedSite();
  let nextStart = now;

  if (session) {
    // Only count time from today.
    const start = Math.max(session.start, startOfDay(now));
    const elapsedMs = now - start;

    if (elapsedMs > MAX_GAP_MS) {
      console.log(
        `Skipped ${Math.round(elapsedMs / 1000)}s on ${session.site} ` +
          `(gap too long: computer asleep or Chrome closed).`
      );
    } else if (elapsedMs > 0) {
      // Credit whole seconds; keep the leftover fraction in the session
      // so repeated checkpoints don't lose time to rounding.
      const seconds = Math.floor(elapsedMs / 1000);
      usage.sites[session.site] = (usage.sites[session.site] || 0) + seconds;
      usage.totalSeconds += seconds;
      if (session.site === activeSite) nextStart = start + seconds * 1000;
      if (seconds > 0) {
        console.log(
          `+${seconds}s ${session.site} [${reason}] ` +
            `-> today total ${usage.totalSeconds}s`
        );
      }
    }
  }

  const nextSession = activeSite ? { site: activeSite, start: nextStart } : null;

  if (session?.site !== activeSite) {
    console.log(
      activeSite
        ? `Tracking ${activeSite} [${reason}]`
        : `Stopped tracking [${reason}]`
    );
  }

  await chrome.storage.local.set({ usage, session: nextSession });
}

// Run syncs one at a time so overlapping events can't overwrite each other.
let queue = Promise.resolve();
function schedule(reason) {
  queue = queue.then(() => sync(reason)).catch((err) => console.error(err));
  return queue;
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(CHECKPOINT_ALARM);
  if (!existing) {
    await chrome.alarms.create(CHECKPOINT_ALARM, {
      periodInMinutes: CHECKPOINT_MINUTES,
    });
  }
}

// ---------- Events ----------

chrome.runtime.onInstalled.addListener((details) => {
  console.log("Proof of Grass installed:", details.reason);
  ensureAlarm();
  schedule("installed");
});

chrome.runtime.onStartup.addListener(async () => {
  // Chrome was just launched: any saved session is from the last run.
  await chrome.storage.local.remove("session");
  ensureAlarm();
  schedule("startup");
});

chrome.tabs.onActivated.addListener(() => schedule("tab switched"));

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.url) schedule("navigated");
});

chrome.tabs.onReplaced.addListener(() => schedule("tab replaced"));

chrome.windows.onFocusChanged.addListener(() => schedule("focus changed"));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECKPOINT_ALARM) schedule("checkpoint");
});

// ---------- Testing helpers (type these in the service worker console) ----------

// showUsage()  -> prints today's seconds per site
globalThis.showUsage = async () => {
  await schedule("showUsage"); // bring totals up to the current second
  const { usage, session } = await chrome.storage.local.get(["usage", "session"]);
  console.log(`Date: ${usage.date}   Total: ${usage.totalSeconds}s`);
  console.table(usage.sites);
  console.log("Current session:", session);
  return usage;
};

// resetUsage() -> clears today's numbers
globalThis.resetUsage = async () => {
  // Clear inside the queue so no sync can run between the clear and the restart.
  queue = queue
    .then(() =>
      chrome.storage.local.set({ usage: emptyUsage(Date.now()), session: null })
    )
    .catch((err) => console.error(err));
  await schedule("reset");
  console.log("Usage reset.");
};
