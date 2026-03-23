# Bingo Scheduler Setup Guide

## 1) Project Structure

```text
/
  index.html
  events.html
  admin.html
  css/styles.css
  js/config.js
  js/utils.js
  js/api.js
  js/index.js
  js/events.js
  js/admin.js
  apps-script/Code.gs
  docs/setup.md
```

## 2) Google Sheet Tabs + Exact Columns

Create one Google Sheet and add tabs exactly as below.

### Users
`userId, firstName, lastName, firstNameNormalized, lastNameNormalized, phoneRaw, phoneNormalized, identityKey, createdAt, lastLoginAt, active`

### Admins
`adminId, displayName, username, email, password, active, createdAt, updatedAt, notes`

### Templates
`templateId, templateName, dayOfWeek, startTime, endTime, description, rolesJson, createdAt, updatedAt, active`

### Events
`eventId, eventName, eventDate, startTime, endTime, templateId, templateNameSnapshot, rolesSnapshotJson, status, createdAt, updatedAt, notes`

### Assignments
`assignmentId, eventId, userId, roleSlotId, roleName, assignedAt, status, removedAt, removedBy`

### AuditLog
`logId, timestamp, actorType, actorId, actionType, targetType, targetId, detailsJson`

### Settings
`key, value, updatedAt`

> The Apps Script code auto-creates tabs/headers if missing, but explicitly creating them first is recommended.

## 3) Install Apps Script Backend

1. Open your Google Sheet.
2. Go to **Extensions → Apps Script**.
3. Replace default code with `apps-script/Code.gs` content.
4. Save.
5. In Apps Script, make sure script is bound to the same sheet used as your data store.

## 4) Seed First Admin

Add one row in `Admins` manually:
- `adminId`: e.g. `adm_seed_001`
- `displayName`: your name
- `username`: your login username (lowercase recommended)
- `email`: your email
- `password`: your chosen password (plain text for this simple version)
- `active`: `TRUE`
- `createdAt`: current ISO datetime
- `updatedAt`: current ISO datetime
- `notes`: optional

## 5) Deploy Apps Script as Web App

1. In Apps Script, click **Deploy → New deployment**.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone** (or Anyone with link).
5. Deploy and copy the web app URL.

## 6) Configure Frontend

1. In this repo, open `js/config.js`.
2. Set:

```js
apiBaseUrl: 'YOUR_WEB_APP_URL_HERE'
```

3. Commit and push changes.

## 7) Publish with GitHub Pages

1. Push repo to GitHub.
2. Open repository **Settings → Pages**.
3. Source: deploy from `main` (or current branch) root folder.
4. Save.
5. Open the generated Pages URL.

## 8) How Core Logic Works

- **User sign-in**: frontend sends first/last/phone; backend normalizes and matches `identityKey = first|last|phone`. Existing user logs in; otherwise a new user row is created.
- **User session**: browser stores a small session object, but all event/assignment data is always reloaded from Sheets/backend.
- **Role slots**: each role is one slot with unique `roleSlotId`. Duplicate labels are allowed as separate slots.
- **Assignments**: stored in `Assignments`; active rows represent current slot ownership. Removing keeps history by setting `status=removed`.
- **Event snapshots**: `rolesSnapshotJson` in Events preserves original event role slots even if templates change later.
- **Admin listing security**: backend never returns admin passwords to frontend responses.

## 9) Simple Auth Limitations (Current Version)

- Admin auth is username/password checked against sheet values (plain text).
- No JWT/session token signing.
- No MFA, lockouts, or rate limiting.
- Good for controlled first release; upgrade later to hashed passwords + stronger auth flow.

