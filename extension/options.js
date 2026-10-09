// Options / setup page. Uses DEFAULT_SITES, normalizeDomain() and
// loadSettings() from settings.js. Nothing is stored until Save is clicked.
//
// Sites and the daily limit are stored locally. The outdoor break length
// belongs to the server (GET/POST /settings) and is never stored locally.

const SETTINGS_URL = "http://localhost:5050/settings";
const SERVER_TIMEOUT_MS = 3000;
const MIN_BREAK_MINUTES = 5;
const MAX_BREAK_MINUTES = 180;

const defaultDomains = DEFAULT_SITES.map((s) => s.domain);

const defaultSitesEl = document.getElementById("defaultSites");
const addForm = document.getElementById("addForm");
const customInput = document.getElementById("customInput");
const addError = document.getElementById("addError");
const customList = document.getElementById("customList");
const customEmpty = document.getElementById("customEmpty");
const limitInput = document.getElementById("limitInput");
const limitError = document.getElementById("limitError");
const saveButton = document.getElementById("saveButton");
const saveStatus = document.getElementById("saveStatus");
const breakInput = document.getElementById("breakInput");
const breakError = document.getElementById("breakError");
const breakCurrent = document.getElementById("breakCurrent");
const breakPending = document.getElementById("breakPending");
const breakOffline = document.getElementById("breakOffline");

let customSites = [];

// The server's break settings as last loaded or saved:
// { break_minutes, pending_break_minutes, pending_from }, or null if the
// server couldn't be reached.
let serverBreak = null;
// True once the user types in the break box. Saving only sends the break
// length if this is set, so unrelated saves can't overwrite a pending change.
let breakEdited = false;

function setStatus(text, kind) {
  saveStatus.textContent = text;
  saveStatus.className = kind || "";
}

function markUnsaved() {
  setStatus("Unsaved changes", "unsaved");
}

function renderDefaultSites(blockedSites) {
  defaultSitesEl.replaceChildren(
    ...DEFAULT_SITES.map(({ domain, label }) => {
      const wrapper = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = domain;
      box.checked = blockedSites.includes(domain);
      box.addEventListener("change", markUnsaved);
      wrapper.append(box, label);
      wrapper.title = domain;
      return wrapper;
    })
  );
}

function renderCustomSites() {
  customList.replaceChildren(
    ...customSites.map((domain) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = domain;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${domain}`);
      remove.addEventListener("click", () => {
        customSites = customSites.filter((d) => d !== domain);
        renderCustomSites();
        markUnsaved();
      });
      item.append(name, remove);
      return item;
    })
  );
  customEmpty.hidden = customSites.length > 0;
}

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addError.textContent = "";

  if (!customInput.value.trim()) {
    addError.textContent = "Enter a website to add.";
    return;
  }
  const domain = normalizeDomain(customInput.value);
  if (!domain) {
    addError.textContent = "That doesn't look like a valid domain (e.g. example.com).";
    return;
  }
  const preset = DEFAULT_SITES.find((s) => s.domain === domain);
  if (preset) {
    addError.textContent = `${domain} is already in the list above. Check "${preset.label}" instead.`;
    return;
  }
  if (customSites.includes(domain)) {
    addError.textContent = `${domain} is already added.`;
    return;
  }

  customSites.push(domain);
  customInput.value = "";
  renderCustomSites();
  markUnsaved();
});

customInput.addEventListener("input", () => {
  addError.textContent = "";
});

limitInput.addEventListener("input", () => {
  limitError.textContent = "";
  markUnsaved();
});

// Returns a whole number of minutes, or null (and shows an error) if invalid.
function readLimit() {
  const text = limitInput.value.trim();
  const minutes = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(minutes)) {
    limitError.textContent = "Enter a whole number of minutes.";
    return null;
  }
  if (minutes < MIN_LIMIT_MINUTES || minutes > MAX_LIMIT_MINUTES) {
    limitError.textContent = `Enter between ${MIN_LIMIT_MINUTES} and ${MAX_LIMIT_MINUTES} minutes.`;
    return null;
  }
  return minutes;
}

// ---------- Outdoor break length (server setting) ----------

function isBreakSettings(data) {
  return Boolean(data) && Number.isInteger(data.break_minutes);
}

// Returns the server's break settings, or null if it can't be reached.
async function fetchBreakSettings() {
  try {
    const res = await fetch(SETTINGS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    });
    const data = await res.json();
    return res.ok && isBreakSettings(data) ? data : null;
  } catch {
    return null;
  }
}

// Sends a new break length. Returns { settings } on success,
// { unreachable: true } if the server is down, or { error } otherwise.
async function postBreakSettings(minutes) {
  let res;
  let data;
  try {
    res = await fetch(SETTINGS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ break_minutes: minutes }),
      cache: "no-store",
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    });
  } catch {
    return { unreachable: true };
  }
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.ok && isBreakSettings(data)) return { settings: data };
  return { error: data?.error || `The server rejected the change (HTTP ${res.status}).` };
}

// Shows today's length and any pending change, kept on separate lines so
// it's clear which one applies today.
function renderBreak() {
  breakInput.disabled = serverBreak === null;
  breakOffline.hidden = serverBreak !== null;

  if (!serverBreak) {
    breakCurrent.textContent = "";
    breakPending.hidden = true;
    return;
  }

  breakCurrent.textContent = `Today: ${serverBreak.break_minutes} minutes.`;
  const pending = serverBreak.pending_break_minutes;
  // A pending value equal to today's length isn't a real change.
  if (Number.isInteger(pending) && pending !== serverBreak.break_minutes) {
    breakPending.textContent =
      `Changes to ${pending} minutes on ${serverBreak.pending_from}. Takes effect tomorrow.`;
    breakPending.hidden = false;
  } else {
    breakPending.hidden = true;
  }
}

// Fills the box with today's length from the server.
function showServerBreak(settings) {
  serverBreak = settings;
  breakEdited = false;
  breakInput.value = settings ? settings.break_minutes : "";
  renderBreak();
}

breakInput.addEventListener("input", () => {
  breakEdited = true;
  breakError.textContent = "";
  markUnsaved();
});

const INVALID = Symbol("invalid");

// What to send to the server on Save: a number of minutes, null if there's
// nothing to send, or INVALID (with an error shown) if the box is invalid.
function readBreakChange() {
  if (!breakEdited || !serverBreak) return null;

  const text = breakInput.value.trim();
  const minutes = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(minutes)) {
    breakError.textContent = "Enter a whole number of minutes.";
    return INVALID;
  }
  if (minutes < MIN_BREAK_MINUTES || minutes > MAX_BREAK_MINUTES) {
    breakError.textContent = `Enter between ${MIN_BREAK_MINUTES} and ${MAX_BREAK_MINUTES} minutes.`;
    return INVALID;
  }

  // Only send if it differs from what will apply tomorrow.
  const tomorrow = serverBreak.pending_break_minutes ?? serverBreak.break_minutes;
  return minutes === tomorrow ? null : minutes;
}

// ---------- Save ----------

saveButton.addEventListener("click", async () => {
  const dailyLimitMinutes = readLimit();
  const breakChange = readBreakChange();
  if (dailyLimitMinutes === null) {
    setStatus("Not saved – fix the daily limit.", "invalid");
    return;
  }
  if (breakChange === INVALID) {
    setStatus("Not saved – fix the break length.", "invalid");
    return;
  }

  const checkedDefaults = [
    ...defaultSitesEl.querySelectorAll("input:checked"),
  ].map((box) => box.value);

  const settings = {
    blockedSites: [...checkedDefaults, ...customSites],
    dailyLimitMinutes,
  };
  await chrome.storage.local.set({ settings });

  if (breakChange === null) {
    setStatus("Settings saved", "saved");
    return;
  }

  saveButton.disabled = true;
  setStatus("Saving break length…", "unsaved");
  const result = await postBreakSettings(breakChange);
  saveButton.disabled = false;

  if (result.settings) {
    showServerBreak(result.settings);
    setStatus("Settings saved", "saved");
  } else if (result.unreachable) {
    breakOffline.hidden = false;
    setStatus("Website settings saved. Break length not changed.", "invalid");
  } else {
    breakError.textContent = result.error;
    setStatus("Website settings saved. Break length not changed.", "invalid");
  }
});

async function init() {
  const settings = await loadSettings();
  renderDefaultSites(settings.blockedSites);
  customSites = settings.blockedSites.filter((d) => !defaultDomains.includes(d));
  renderCustomSites();
  limitInput.value = settings.dailyLimitMinutes;

  // Load the break length separately so a slow or missing server never
  // holds up the local settings.
  showServerBreak(await fetchBreakSettings());
}

init();
