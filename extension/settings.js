// Shared settings code, loaded by both background.js (importScripts)
// and options.html (<script>), so they always agree.

const DEFAULT_SITES = [
  { domain: "youtube.com", label: "YouTube" },
  { domain: "twitch.tv", label: "Twitch" },
  { domain: "netflix.com", label: "Netflix" },
  { domain: "reddit.com", label: "Reddit" },
  { domain: "x.com", label: "X" },
  { domain: "instagram.com", label: "Instagram" },
  { domain: "mangadex.org", label: "MangaDex" },
];

const DEFAULT_SETTINGS = {
  blockedSites: DEFAULT_SITES.map((s) => s.domain),
  dailyLimitMinutes: 60,
};

const MIN_LIMIT_MINUTES = 1;
const MAX_LIMIT_MINUTES = 24 * 60;

// Turns "https://www.Example.com/page", "www.example.com" or "example.com/"
// into "example.com". Returns null if it isn't a valid domain.
function normalizeDomain(input) {
  let text = String(input || "").trim().toLowerCase();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = "http://" + text;

  let host;
  try {
    host = new URL(text).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, "").replace(/^www\./, "");

  // Letters, digits and hyphens per label; at least one dot; TLD not numeric.
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  const valid = new RegExp(`^(?:${label}\\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$`);
  return valid.test(host) && host.length <= 253 ? host : null;
}

// Stored settings, or the defaults if none are saved yet.
async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return {
    blockedSites: Array.isArray(settings?.blockedSites)
      ? settings.blockedSites
      : [...DEFAULT_SETTINGS.blockedSites],
    dailyLimitMinutes: Number.isInteger(settings?.dailyLimitMinutes)
      ? settings.dailyLimitMinutes
      : DEFAULT_SETTINGS.dailyLimitMinutes,
  };
}
