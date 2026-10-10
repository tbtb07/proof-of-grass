## Extension

Chrome Manifest V3 extension in `extension/`. Talks to the Flask server at `http://localhost:5050` (not 5000, which macOS AirPlay uses).

### How it works
- **Tracking** (`background.js`): counts time only while a limited site is the active tab in the focused Chrome window. The session start time and today's totals live in `chrome.storage.local`, so nothing is lost when Chrome stops the MV3 service worker. A 30-second `chrome.alarms` checkpoint saves progress; gaps over 2 minutes (sleep, Chrome closed) aren't counted. Usage resets at local midnight.
- **Settings** (`options.html`, `settings.js`): opens automatically on first install only. Users pick from 7 default sites, add custom domains and set `dailyLimitMinutes` (default 60). Stored as `settings` in `chrome.storage.local` and re-read on every check, so changes apply immediately.
- **Blocking**: once today's total reaches the limit, the background asks `GET /status`. Only `unlocked === true` allows the site; anything else (locked, error, timeout, server down) blocks it (fail closed). The tab is redirected to `blocked.html?from=<original URL>`.
- **Blocked page** (`blocked.html`, `blocked.js`): shows `phone_url` from `/status`, polls `/status` every 3 s, and returns to the original URL with `location.replace()` as soon as the server reports unlocked. The `from` URL must be http(s), so it can't point back at an extension page (no redirect loop). If the server is down it says to run `python3 server/app.py` and stays blocked.
- **Emergency unlock**: password field on the blocked page → `POST /emergency {"password"}`. Shows the server's error and `remaining_today`; on success returns to the original site. The password is never stored or logged; the field is cleared on submit.
- **Outdoor break length** (options page): the server owns this value; the extension never stores it. On load, `GET /settings` fills the box with `break_minutes` and shows "Today: N minutes." plus, if one exists, "Changes to N minutes on YYYY-MM-DD. Takes effect tomorrow." Save stores local settings first, then sends `POST /settings {"break_minutes"}` only if the user typed in the box and the value differs from what applies tomorrow (pending value, else today's). So saving sites or the daily limit never overwrites a pending change. Typing today's value cancels a pending change. If the server is down: the box is disabled, "Start the server to change break length." is shown, local settings still save, and the status says "Break length not changed".

- **Toolbar badge** (`background.js`, `updateBadge`): while an outdoor-break unlock is active, shows minutes left **in the unlock** (blue `#1565c0`), rounded up, counting down to 0. Otherwise shows minutes left **today** = limit − used, rounded up (4m10s → "5", 30 s → "1", none → "0"), coloured green `#2e7d32` above 5 min, orange `#f57c00` for 1–5 min, red `#c62828` at 0. Uses the same `totalSeconds` and limit (including a test limit) as the blocker, so there is no second tracker.
  - *When it updates*: as a step in the existing update queue (`sync` → `refreshUnlockStatus` → `enforceLimit` → `updateBadge` → warnings), so on every existing event: 30 s checkpoint alarm, tab/focus changes, install/reload, Chrome startup, settings or test-limit changes, `resetUsage()`, and the first update after midnight. No extra timer.
  - *Unlock state*: `isUnlocked()` saves when the unlock ends (`unlockedUntil`) in `chrome.storage.session` (survives worker restarts, cleared when Chrome closes). **Update (tb, 2026-10-10):** `refreshUnlockStatus()` now calls `isUnlocked()` on every 30 s checkpoint unconditionally, not just when over the daily limit — see the fix note below, this used to be a real gap (an outdoor break taken before hitting the limit was invisible to the badge). An unreachable server is still saved as "not unlocked".
  - `manifest.json` gained `"action": { "default_title": "Proof of Grass" }` because `chrome.action` only exists when the manifest declares an action. That key isn't a permission and doesn't add an install warning.

- **Five-minute warning** (`background.js`, `maybeWarn`): a Chrome notification "Proof of Grass — 5 Minutes Left!" when tracked time pushes remaining time from **above 5:00 to 5:00 or less** (5:30 → none, 5:01 → 5:00 fires, 4:59 after 5:00 doesn't). Runs as the last step of the existing update queue (`sync` → `enforceLimit` → `updateBadge` → `maybeWarn`), so there is no new timer; errors in it are caught so blocking and the badge are never affected. Needs the `notifications` permission.
  - *Crossing, not level*: `sync()` passes today's total before and after this update's time; both are compared against the same current limit. Changing the daily limit or turning on a test limit adds no time, so it can't trigger a warning. Jumping straight to 0 doesn't fire, and nothing fires during an active unlock (same `unlockedUntil` the badge uses).
  - *One per day*: `lastWarningDate: "YYYY-MM-DD"` in `chrome.storage.local` (survives Chrome restarts) is saved before the notification is shown; a matching date skips it. A new local date allows the next one. The fixed notification ID means even a repeat would replace, not stack.
  - *Testing*: while a test limit is on, the date is kept in `lastTestWarningDate` instead, which `setTestLimit()`/`clearTestLimit()` clear, so tests never use up the real warning. `testWarning()` previews the notification without recording anything.
  - *Icon*: the extension has no icon files yet and Chrome requires one for notifications, so a plain green circle is drawn at runtime (`OffscreenCanvas` → PNG data URL). Swap for `icons/icon128.png` once real icons are added.

- **Unlock-ending warning** (`background.js`, `maybeWarnUnlockEnding`) — **added by tb, 2026-10-10** at tb's request, alongside the badge change above: a Chrome notification "Proof of Grass — Unlock Ending Soon" when an active outdoor-break unlock has 5 minutes or less left. Reuses `notificationIconUrl()` (renamed from `warningIconUrl()`, now takes a colour) with the badge's blue.
  - *One per unlock*: dedupes on the unlock's own end time (`notifiedUnlockUntil` in `chrome.storage.session`), not a calendar date like the five-minute warning, since an unlock isn't a once-a-day thing. A later, longer unlock (different `until`) gets its own warning; the memory clears with the unlock when Chrome closes.
  - *Cadence*: runs off the same 30 s checkpoint as `refreshUnlockStatus()`, so it can lag the true 5-minute mark by up to that long, same as the badge.
  - *Testing*: `testUnlockWarning()` previews it without touching `notifiedUnlockUntil`.
  - Not yet covered by an automated test pass like the five-minute warning's 33/33 — only checked manually (`testUnlockWarning()` fires, console log confirms). Worth a proper pass before relying on it Saturday.

### Testing helpers (service worker console)
- `showUsage()`, `resetUsage()`
- `setTestLimit(60)` → 60-second limit without changing the user's saved minutes; `clearTestLimit()` to go back.
- `testWarning()` → show the 5-minute notification now (records nothing). For a real crossing test use `setTestLimit(330)` (must be above 300 s), then use a limited site for ~30–60 s.
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

### Outdoor break length: test results (real Flask routes)
Read-only check against the real server data; everything that POSTs ran against the real `server/app.py` code with temp data, so the real break length was never changed.

| Test | Result |
|---|---|
| A. Load | Real server: box shows 20, "Today: 20 minutes.", no pending line |
| B. 20 → 30 | Server returns pending 30 from tomorrow; page shows "Changes to 30 minutes on 2026-10-10. Takes effect tomorrow." while today stays 20 |
| C. Reload | Pending message still shown |
| D. Save only local settings | 0 POSTs; pending 30 kept. Typing 30 again (same as pending) also sends nothing. No break value in `chrome.storage.local` |
| E. Invalid input | 4, 181, 2.5, empty, abc, -10 rejected in the page with no request sent. Server's own 400 error is shown if it rejects a value |
| F. Server down | Down at load: box disabled + message, local settings save. Down at save: local settings saved, "Break length not changed", server value untouched |
| G. Existing options | Default sites, custom domains (normalize/duplicate check), daily limit validation and saving all unchanged |

### Toolbar badge: test results
Automated in headless Chrome. Server tests used a temporary copy of the extension pointed at port 5051 and the real `server/app.py` code with temp data and a throwaway password, so the real server on 5050 was never contacted.

| Test | Result |
|---|---|
| A. 60 min limit, 0 used | "60" green (also set right after install) |
| B. 20 min used | "40" green |
| C. 59 min used | "1" orange |
| Rounding | 4m10s left → "5"; 30 s left → "1" |
| D. Limit reached / over | "0" red |
| E. 5 min left | "5" orange; 5m01s left → "6" green |
| F. Server unlocked | Hidden, both when on a limited site and when away from one (checkpoint refresh) |
| G. Unlock expires | Badge returns ("0" red) and the site is blocked again; with a remembered unlock, expiry restored the badge with 0 server requests |
| H. Limit 60 → 90 (20 used) | "70" right after the setting was saved |
| I. New day | Yesterday's 5000 s ignored → "60" green |
| J. Server unreachable | Stays "0" red; remembered unlock = 0 |
| K. Tracking + blocking | Time still credited per site; over-limit site still redirected; badge follows. Test limit on/off updates the badge |

### Five-minute warning: test results
Automated in headless Chrome against a temp copy of the extension pointed at port 5051 (no server needed), so real server data and the real `lastWarningDate` were never touched. Time was added by setting a session start in the past and running the normal update queue. 33/33 checks passed.

| Test | Result |
|---|---|
| A. 10m30 → 10m left | No notification |
| B. 6m → 5m30 left | No notification |
| C. 5m10 → 4m50 left | Exactly one; `lastWarningDate` = today; notification present in Chrome |
| Boundaries | 5:01 → 5:00 fires; 5:31 → 5:00 fires; 5:30 → 5:01 doesn't; 5:00 → 4:59 doesn't (never above 5:00) |
| D. 3 min left | No duplicate |
| E. Tab / window switch | No duplicate, even when the switch itself crossed 5:00 again |
| F. Extension reload + startup event | `lastWarningDate` survived; no duplicate |
| G. New day (last warned yesterday) | Fires again |
| H. Limit 60 → 55 (6:39 → 1:39 left) | No warning, and none on further usage that day |
| I. `setTestLimit(300)`, 0 used | No immediate warning; 330 s test limit + 40 s use fires, stored under `lastTestWarningDate` only |
| J. Badge | Orange "5" at 4m50, green "60" after reset, red "0" at limit |
| K. Blocking | Over-limit YouTube still redirected |
| L. Permission | `getPermissionLevel()` = granted |
| M. 5:10 → 0 or over in one step | No notification |
| N. Active unlock | No notification, and today's warning not used up |

### Problems found and fixes
- `showUsage()` once appeared to hang; couldn't reproduce. Found and fixed a related race: `resetUsage()` cleared storage outside the update queue, so a checkpoint could undo the reset.
- Over-limit blocking only happens at the next event or 30 s checkpoint (Chrome's minimum alarm period), so a site can stay open up to ~30 s past the limit.
- `/emergency` with an empty password returns HTTP 400 `{"error": "Missing password"}` with no `ok` field; the page checks for an empty field before sending.
- If no emergency password has been set on the server, every attempt returns "Wrong password". Set it with `python3 server/set_password.py`.
- B/F couldn't use the real data without spending real emergency unlocks (no Gemma for the phone flow), so they were run against the real `server/app.py` code with `store.py`'s data paths pointed at a temp folder and a 15-second unlock. Nothing in `server/` was changed.
- `POST /settings` always records a pending value, even if it equals today's length. To avoid showing a meaningless "Changes to 20 minutes" when 20 already applies, the page hides a pending value that equals `break_minutes`. That is also how typing today's value cancels a pending change.
- If only "did the value change from what's displayed?" were checked, saving unrelated settings could resend today's value and wipe a pending change. Fixed by only sending when the user actually edited the box and the value differs from what applies tomorrow.
- `chrome.action` is undefined unless the manifest has an `"action"` key, so the badge needed that one manifest addition.
- The badge only sees an unlock when the extension asks `/status` (over the limit on a limited site, or at a checkpoint while over the limit elsewhere). Under the limit nothing is blocked, so it keeps showing minutes left even if an outdoor unlock is active. Usage is saved at 30 s checkpoints, so the badge can lag real time by up to 30 s. **Fixed (tb, 2026-10-10):** `refreshUnlockStatus()` now asks `/status` on every checkpoint regardless of whether the daily limit has been reached, so a break taken under the limit is picked up within 30 s too.
- Badge tests needed the server to report "unlocked" without touching the real server on 5050 (which was running). Solved by testing a temp copy of the extension with `localhost:5050` replaced by `localhost:5051` and running the real server code on 5051 with temp data.
- A warning based on "remaining ≤ 5 min" alone would fire when the limit is lowered or a short test limit is turned on. Fixed by requiring a crossing caused by tracked time, compared against one limit.
- `setTestLimit(300)` can never trigger the warning (it starts at exactly 5:00, not above). Use a test limit above 300 s, e.g. 330.
- Chrome notifications require an icon and the extension has none; a green circle is generated in code instead of adding image files.
- If the user lowers the limit below 5 minutes left, they get no warning that day. That is intentional (no false warning from a setting change).
