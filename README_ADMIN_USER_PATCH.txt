Bingo Scheduler - Admin User Management Patch

Replace these files in your GitHub repo / Apps Script project:

1) apps-script/Code.gs
   - Replace your Apps Script Code.gs with this full file.
   - Includes the prior speed patch and identityKey typo/backfill fix.
   - Adds admin user management backend actions:
     createUserAdmin
     updateUserAdmin
     deactivateUserAdmin
     reactivateUserAdmin

2) js/api.js
   - Replace js/api.js.
   - Adds API wrappers for the new admin user management actions.

3) js/admin.js
   - Replace js/admin.js.
   - Adds the user form behavior, edit buttons, remove buttons, and reactivate buttons.

4) admin.html
   - Replace admin.html.
   - Adds the User Management form inside the People tab.

No Google Sheet columns need to change.

Important behavior:
- Remove does NOT hard-delete the user row from Sheets.
- Remove marks the user inactive and removes that user's active sign-ups.
- This preserves audit/history and avoids breaking past assignment records.

After replacing files:
1. Save Apps Script.
2. Deploy -> Manage deployments -> Edit -> New version -> Deploy.
3. Push the GitHub files.
4. Refresh the website.
5. Go to Admin -> People.
