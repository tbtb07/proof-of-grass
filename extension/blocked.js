// blocked.html: shows how to unlock, polls the server, and sends the user
// back to the site they were on once the server says they're unlocked.
// The emergency password is only ever held in the input box and the one
// POST request. It is never stored or logged.

const API_BASE_URL = "http://localhost:5050";
const STATUS_URL = `${API_BASE_URL}/status`;
const EMERGENCY_URL = `${API_BASE_URL}/emergency`;
const POLL_MS = 3000;
const STATUS_TIMEOUT_MS = 2500;
const EMERGENCY_TIMEOUT_MS = 8000;
const RETURN_DELAY_MS = 1200; // let the user read the message first

const phoneLink = document.getElementById("phoneLink");
const offlineNotice = document.getElementById("offlineNotice");
const unlockedNotice = document.getElementById("unlockedNotice");
const checkingText = document.getElementById("checkingText");
const fromText = document.getElementById("fromText");
const emergencyForm = document.getElementById("emergencyForm");
const passwordInput = document.getElementById("passwordInput");
const unlockButton = document.getElementById("unlockButton");
const emergencyMessage = document.getElementById("emergencyMessage");
const remainingText = document.getElementById("remainingText");

// ---------- Original URL ----------

// Only http(s) URLs are allowed back. That rules out javascript:, chrome://
// and extension pages (including this one), so restoring can't loop here.
function safeHttpUrl(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

const original = safeHttpUrl(new URLSearchParams(location.search).get("from"));
if (original) {
  fromText.textContent = `You were on ${original.hostname.replace(/^www\./, "")}.`;
}

let returning = false;

function returnToOriginalSite(message) {
  if (returning) return;
  returning = true;
  stopPolling();
  checkingText.textContent = "";
  offlineNotice.hidden = true;
  unlockedNotice.hidden = false;

  if (!original) {
    unlockedNotice.textContent = `${message} You can open your site again.`;
    return;
  }
  unlockedNotice.textContent = `${message} Taking you back to ${original.hostname}…`;
  // replace() so Back doesn't land on this page again.
  setTimeout(() => location.replace(original.href), RETURN_DELAY_MS);
}

// ---------- Status polling ----------

let pollTimer = null;
let polling = true;

function stopPolling() {
  polling = false;
  clearTimeout(pollTimer);
}

// Returns the parsed /status JSON, or null if the server can't be reached.
async function fetchStatus() {
  try {
    const res = await fetch(STATUS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function showStatus(status) {
  if (!status) {
    // Fail closed: stay blocked and explain how to start the server.
    phoneLink.hidden = true;
    offlineNotice.hidden = false;
    checkingText.textContent = "Can't reach the server. Retrying every 3 seconds…";
    return;
  }

  offlineNotice.hidden = true;
  checkingText.textContent = "Waiting for your outdoor break to finish…";
  const phoneUrl = safeHttpUrl(status.phone_url);
  if (phoneUrl) {
    phoneLink.href = phoneUrl.href;
    phoneLink.textContent = status.phone_url;
    phoneLink.hidden = false;
  } else {
    phoneLink.hidden = true;
  }
}

async function poll() {
  const status = await fetchStatus();
  if (!polling) return;

  showStatus(status);
  if (status && status.unlocked === true) {
    returnToOriginalSite("Unlocked!");
    return;
  }
  // Schedule the next check only after this one finishes, so slow
  // replies can't pile up.
  pollTimer = setTimeout(poll, POLL_MS);
}

// ---------- Emergency unlock ----------

function showEmergencyMessage(text, kind) {
  emergencyMessage.textContent = text;
  emergencyMessage.className = `message ${kind}`;
}

function showRemaining(value) {
  if (Number.isInteger(value)) {
    remainingText.textContent = `Emergency unlocks left today: ${value}`;
  }
}

function formatTime(iso) {
  const date = new Date(iso); // server sends local time without a zone
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

emergencyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (returning) return;

  const password = passwordInput.value;
  passwordInput.value = ""; // don't leave it sitting in the page
  if (!password) {
    showEmergencyMessage("Enter your emergency password.", "error");
    return;
  }

  unlockButton.disabled = true;
  showEmergencyMessage("Checking…", "");

  let res;
  let data;
  try {
    res = await fetch(EMERGENCY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      cache: "no-store",
      signal: AbortSignal.timeout(EMERGENCY_TIMEOUT_MS),
    });
    data = await res.json();
    if (!data || typeof data !== "object") throw new Error("bad reply");
  } catch {
    showEmergencyMessage(
      "Couldn't reach the server. Start it with python3 server/app.py.",
      "error"
    );
    unlockButton.disabled = false;
    return;
  }

  showRemaining(data.remaining_today);

  if (data.ok === true) {
    showEmergencyMessage(`Unlocked until ${formatTime(data.until)}.`, "success");
    returnToOriginalSite("Emergency unlock active.");
    return;
  }

  showEmergencyMessage(data.error || `Unlock failed (HTTP ${res.status}).`, "error");
  unlockButton.disabled = false;
  passwordInput.focus();
});

poll();
