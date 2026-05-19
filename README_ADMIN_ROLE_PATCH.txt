Admin role management patch

This patch builds on the previous admin user management patch.

Replace these files in your GitHub repo / Apps Script project:

apps-script/Code.gs
js/api.js
js/admin.js
admin.html

What changed:
- Adds an admin backend action: adminAssignUserToRole.
- Adds an API wrapper for adminAssignUserToRole.
- Adds an "Add Person to Role" form inside Admin > Assignment Manager.
- Shows active users who do not already have a role for the selected event.
- Shows open roles for the selected event.
- Allows admin to add a person to an open role.
- Keeps existing admin remove and move assignment features.
- Adds a confirmation before removing someone from a role.

No Google Sheet column changes are required.

Deploy steps:
1. Replace Code.gs in Apps Script.
2. Save.
3. Deploy > Manage deployments > Edit current web app > New version > Deploy.
4. Replace admin.html, js/api.js, and js/admin.js in GitHub.
5. Commit and push.
6. Hard refresh the website.

Test:
- Admin login.
- Open Assignment Manager.
- Select event.
- Add an active user to an open role.
- Remove a person from a role.
- Move a person from one role to another.
- Confirm the Users and Assignments sheets update correctly.
