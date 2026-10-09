## Extension

Chrome Manifest V3 extension in `extension/`. Talks to the Flask server at `http://localhost:5050` (not 5000, which macOS AirPlay uses).

### How it works
- **Tracking** (`background.js`): counts time only while a limited site is the active tab in the focused Chrome window. The session start time and today's totals live in `chrome.storage.local`, so nothing is lost when Chrome stops the MV3 service worker. A 30-second `chrome.alarms` checkpoint saves progress; gaps over 2 minutes (sleep, Chrome closed) aren't counted. Usage resets at local midnight.
- **Settings** (`options.html`, `settings.js`): opens automatically on first install only. Users pick from 7 default sites, add custom domains and set `dailyLimitMinutes` (default 60). Stored as `settings` in `chrome.storage.local` and re-read on every check, so changes apply immediately.
- **Blocking**: once today's total reaches the limit, the background asks `GET /status`. Only `unlocked === true` allows the site; anything else (locked, error, timeout, server down) blocks it (fail closed). The tab is redirected to `blocked.html?from=<original URL>`.
- **Blocked page** (`blocked.html`, `blocked.js`): shows `phone_url` from `/status`, polls `/status` every 3 s, and returns to the original URL with `location.replace()` as soon as the server reports unlocked. The `from` URL must be http(s), so it can't point back at an extension page (no redirect loop). If the server is down it says to run `python3 server/app.py` and stays blocked.
- **Emergency unlock**: password field on the blocked page → `POST /emergency {"password"}`. Shows the server's error and `remaining_today`; on success returns to the original site. The password is never stored or logged; the field is cleared on submit.

### Testing helpers (service worker console)
- `showUsage()`, `resetUsage()`
- `setTestLimit(60)` → 60-second limit without changing the user's saved minutes; `clearTestLimit()` to go back.
- `extension/mock_server.py` is a standard-library stand-in for `/status` (used in early steps). Use the real server for integration tests.
- Lightweight real server without Ollama/Gemma (skips the warm-up in `__main__`):
  `.venv/bin/python -c "import sys; sys.path.insert(0, 'server'); from app import app; app.run(host='127.0.0.1', port=5050)"`
  Needs a `.venv` with `flask ollama pillow pillow-heif`. Listens on 127.0.0.1 only, so the phone link won't open from a phone in this mode.

### Blocked page + emergency unlock: test results (real Flask routes)
| Test | Result |
|---|---|
| A. Server locked | Redirected to blocked page with full original URL; phone link shown; polls every 3 s; stays blocked |
| B. Server unlocked | Blocked page noticed within one poll (~2 s) and returned automatically |
| C. Server unreachable | Stays blocked; shows "Start the Proof of Grass server…"; emergency shows a clear error |
| D. Wrong password | "Wrong password", "Emergency unlocks left today: 2"; stays blocked; wrong guesses don't use up unlocks |
| E. Correct password | Automated with a throwaway password on an isolated copy of the server data: success message, remaining count, returned to site. Manual Chrome test with the real password also passed |
| F. Return to original | Exact URL restored (incl. query string); background then allows it while unlocked and re-blocks when the unlock expires |
| Extra | 3rd emergency attempt → "No emergency unlocks left today"; bad `from=` values (`javascript:`, `chrome://`, the blocked page itself) are rejected |

### Problems found and fixes
- `showUsage()` once appeared to hang; couldn't reproduce. Found and fixed a related race: `resetUsage()` cleared storage outside the update queue, so a checkpoint could undo the reset.
- Over-limit blocking only happens at the next event or 30 s checkpoint (Chrome's minimum alarm period), so a site can stay open up to ~30 s past the limit.
- `/emergency` with an empty password returns HTTP 400 `{"error": "Missing password"}` with no `ok` field; the page checks for an empty field before sending.
- If no emergency password has been set on the server, every attempt returns "Wrong password". Set it with `python3 server/set_password.py`.
- B/F couldn't use the real data without spending real emergency unlocks (no Gemma for the phone flow), so they were run against the real `server/app.py` code with `store.py`'s data paths pointed at a temp folder and a 15-second unlock. Nothing in `server/` was changed.
