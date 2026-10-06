// Background service worker for Proof of Grass.
// Step 1: only confirms the extension loads.

chrome.runtime.onInstalled.addListener((details) => {
  console.log("Proof of Grass installed:", details.reason);
});
