Bingo Scheduler fetch timeout fix

Problem fixed:
- The current frontend aborts Apps Script requests after 15 seconds.
- Your screenshot shows "Fetch is aborted."
- The assignment is saving in Google Sheets, but the browser gives up before Apps Script responds.
- That is why a refresh shows the role was actually selected.

Replace these GitHub files:
- js/config.js
- js/api.js

No Apps Script / Code.gs replacement is required for this specific fix.
No Google Sheet changes are required.

What changed:
- requestTimeoutMs increased from 15000 to 60000.
- api.js now shows a useful timeout message instead of the browser's raw "Fetch is aborted" message.

After replacing:
1. Commit/push to GitHub.
2. Hard refresh the user site.
3. Sign in.
4. Try selecting a role.
5. If it still times out after 60 seconds, the next step is a backend-only optimization in Code.gs to stop returning the full dashboard after every signup.
