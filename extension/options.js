// Options / setup page. Uses DEFAULT_SITES, normalizeDomain() and
// loadSettings() from settings.js. Nothing is stored until Save is clicked.

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

let customSites = [];

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

saveButton.addEventListener("click", async () => {
  const dailyLimitMinutes = readLimit();
  if (dailyLimitMinutes === null) {
    setStatus("Not saved – fix the daily limit.", "invalid");
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
  setStatus("Settings saved", "saved");
});

async function init() {
  const settings = await loadSettings();
  renderDefaultSites(settings.blockedSites);
  customSites = settings.blockedSites.filter((d) => !defaultDomains.includes(d));
  renderCustomSites();
  limitInput.value = settings.dailyLimitMinutes;
}

init();
