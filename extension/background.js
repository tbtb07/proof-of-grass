// Background service worker for Proof of Grass.
// Tracks daily time spent on distracting sites and blocks them once the
// daily limit is reached, unless the server says the user is unlocked.
//
// The worker can be stopped by Chrome at any moment, so nothing important
// lives in memory. The current session's start time and today's totals are
// kept in chrome.storage.local, and every event recomputes the state.
//
// Which sites to limit and the daily limit come from the user's settings
// (options page), read fresh from storage on every sync.

importScripts("settings.js"); // DEFAULT_SETTINGS, loadSettings()

const CHECKPOINT_ALARM = "checkpoint";
const CHECKPOINT_MINUTES = 0.5; // 30 seconds, the minimum Chrome allows

// If more time than this passed since the last checkpoint, alarms could not
// have been firing (computer asleep or Chrome closed), so don't count it.
const MAX_GAP_MS = 2 * 60 * 1000;

const API_BASE_URL = "http://localhost:5050";
const STATUS_URL = `${API_BASE_URL}/status`;
const SERVER_TIMEOUT_MS = 3000;
const BLOCKED_PAGE_URL = chrome.runtime.getURL("blocked.html");

// ---------- Helpers ----------

// Returns which of `sites` a URL belongs to,
// e.g. "https://m.youtube.com/x" -> "youtube.com".
function trackedSiteFor(url, sites) {
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
    sites.find((site) => host === site || host.endsWith("." + site)) ||
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

// The daily limit in seconds. A test override (setTestLimit) wins over the
// user's dailyLimitMinutes without changing their saved settings.
function limitFor(settings, devLimitSeconds) {
  if (Number.isInteger(devLimitSeconds) && devLimitSeconds > 0) {
    return { seconds: devLimitSeconds, label: `${devLimitSeconds}s TEST LIMIT` };
  }
  const seconds = settings.dailyLimitMinutes * 60;
  return { seconds, label: `${seconds}s (${settings.dailyLimitMinutes} min)` };
}

// Which tracked site is the user looking at right now? Returns
// { site, tabId }, or null if none or if Chrome itself isn't the focused app.
async function getActiveTrackedTab(sites) {
  let win;
  try {
    win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  } catch {
    return null; // no windows open
  }
  if (!win || !win.focused) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  const site = tab ? trackedSiteFor(tab.url, sites) : null;
  return site ? { site, tabId: tab.id } : null;
}

// ---------- Core: credit elapsed time, then start/stop the session ----------

async function sync(reason) {
  const now = Date.now();
  const stored = await chrome.storage.local.get([
    "usage",
    "session",
    "devLimitSeconds",
  ]);
  const settings = await loadSettings();
  const sites = settings.blockedSites;

  let usage = stored.usage;
  if (!usage || usage.date !== dateKey(now)) {
    if (usage) console.log(`New day: resetting usage (was ${usage.date}).`);
    usage = emptyUsage(now);
  }

  const session = stored.session;
  const activeTab = await getActiveTrackedTab(sites);
  const activeSite = activeTab ? activeTab.site : null;
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
  return {
    activeTab,
    totalSeconds: usage.totalSeconds,
    sites,
    limit: limitFor(settings, stored.devLimitSeconds),
  };
}

// ---------- Daily limit: ask the server, block if locked ----------

// True only if the server clearly says unlocked. Anything else
// (locked, error, timeout, bad JSON) counts as locked: fail closed.
async function isUnlocked() {
  console.log(`Checking server status (${STATUS_URL})`);
  try {
    const res = await fetch(STATUS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.unlocked === true) {
      console.log(`Server reports unlocked (until ${data.until})`);
      return true;
    }
    console.log("Server reports locked");
    return false;
  } catch (err) {
    console.log(`Server unreachable - treating as locked (${err.message})`);
    return false;
  }
}

async function enforceLimit(result) {
  const { activeTab, totalSeconds, sites, limit } = result;
  if (!activeTab || totalSeconds < limit.seconds) return;

  console.log(
    `Daily limit reached (${totalSeconds}s / ${limit.label}) on ${activeTab.site}`
  );
  if (await isUnlocked()) return;

  // The tab may have changed while we waited for the server.
  let tab;
  try {
    tab = await chrome.tabs.get(activeTab.tabId);
  } catch {
    return; // tab was closed
  }
  if (trackedSiteFor(tab.url, sites) !== activeTab.site) return;

  // Pass the original URL along so blocked.html can send the user back
  // there once they're unlocked.
  console.log(`Redirecting ${activeTab.site} to blocked.html`);
  const blockedUrl = `${BLOCKED_PAGE_URL}?from=${encodeURIComponent(tab.url)}`;
  await chrome.tabs.update(activeTab.tabId, { url: blockedUrl });
}

// Run syncs (and the limit check after each) one at a time so overlapping
// events can't overwrite each other.
let queue = Promise.resolve();
function schedule(reason) {
  queue = queue
    .then(() => sync(reason))
    .then(enforceLimit)
    .catch((err) => console.error(err));
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

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("Proof of Grass installed:", details.reason);
  ensureAlarm();

  // Only a genuine first install sets defaults and opens the setup page.
  // Updates and reloads ("update") keep the user's settings untouched.
  if (details.reason === "install") {
    const { settings } = await chrome.storage.local.get("settings");
    if (!settings) {
      await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
      console.log("Saved default settings.");
    }
    console.log("First install: opening setup page.");
    chrome.runtime.openOptionsPage();
  }

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

// Apply new settings right away (e.g. a site was unchecked, the limit
// lowered). Only reacts to settings, not to our own usage/session writes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    console.log("Settings changed:", changes.settings.newValue);
    schedule("settings changed");
  } else if (changes.devLimitSeconds) {
    schedule("test limit changed");
  }
});

// ---------- Testing helpers (type these in the service worker console) ----------

// showUsage()  -> prints today's seconds per site
globalThis.showUsage = async () => {
  await schedule("showUsage"); // bring totals up to the current second
  const { usage, session, devLimitSeconds } = await chrome.storage.local.get([
    "usage",
    "session",
    "devLimitSeconds",
  ]);
  const settings = await loadSettings();
  const limit = limitFor(settings, devLimitSeconds);
  console.log(
    `Date: ${usage.date}   Total: ${usage.totalSeconds}s / limit ${limit.label}`
  );
  console.table(usage.sites);
  console.log("Current session:", session);
  console.log("Blocked sites:", settings.blockedSites);
  return usage;
};

// setTestLimit(60) -> use a 60-second limit for testing. Does NOT change the
// user's saved dailyLimitMinutes. Stays until clearTestLimit().
globalThis.setTestLimit = async (seconds = 60) => {
  if (!Number.isInteger(seconds) || seconds < 1) {
    console.log("setTestLimit needs a whole number of seconds, e.g. setTestLimit(60)");
    return;
  }
  await chrome.storage.local.set({ devLimitSeconds: seconds });
  console.log(`TEST LIMIT ON: ${seconds}s. Run clearTestLimit() to go back to normal.`);
};

// clearTestLimit() -> back to the user's real dailyLimitMinutes
globalThis.clearTestLimit = async () => {
  await chrome.storage.local.remove("devLimitSeconds");
  const settings = await loadSettings();
  console.log(`Test limit off. Using ${settings.dailyLimitMinutes} min from settings.`);
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
