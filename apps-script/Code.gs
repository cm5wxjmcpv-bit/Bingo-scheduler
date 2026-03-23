const SHEETS = {
  USERS: 'Users',
  ADMINS: 'Admins',
  TEMPLATES: 'Templates',
  EVENTS: 'Events',
  ASSIGNMENTS: 'Assignments',
  AUDIT_LOG: 'AuditLog',
  SETTINGS: 'Settings'
};

const SHEET_HEADERS = {
  Users: ['userId', 'firstName', 'lastName', 'firstNameNormalized', 'lastNameNormalized', 'phoneRaw', 'phoneNormalized', 'identityKey', 'createdAt', 'lastLoginAt', 'active'],
  Admins: ['adminId', 'displayName', 'username', 'email', 'password', 'active', 'createdAt', 'updatedAt', 'notes'],
  Templates: ['templateId', 'templateName', 'dayOfWeek', 'startTime', 'endTime', 'description', 'rolesJson', 'createdAt', 'updatedAt', 'active'],
  Events: ['eventId', 'eventName', 'eventDate', 'startTime', 'endTime', 'templateId', 'templateNameSnapshot', 'rolesSnapshotJson', 'status', 'createdAt', 'updatedAt', 'notes'],
  Assignments: ['assignmentId', 'eventId', 'userId', 'roleSlotId', 'roleName', 'assignedAt', 'status', 'removedAt', 'removedBy'],
  AuditLog: ['logId', 'timestamp', 'actorType', 'actorId', 'actionType', 'targetType', 'targetId', 'detailsJson'],
  Settings: ['key', 'value', 'updatedAt']
};

const PUBLIC_ACTIONS = {
  createOrFindUser,
  getUserAssignments,
  getActiveEvents,
  getEventAvailableRoles,
  assignUserToRole,
  removeUserAssignment,
  changeUserAssignment,
  getUserProfile
};

const ADMIN_ACTIONS = {
  adminLogin,
  getAdminDashboardData,
  createTemplate,
  updateTemplate,
  deactivateTemplate,
  createEvent,
  updateEvent,
  archiveEvent,
  getEventAssignments,
  adminRemoveAssignment,
  adminReassignAssignment,
  createAdmin,
  updateAdmin,
  deactivateAdmin
};

function doGet(e) {
  return respond({ ok: true, data: { status: 'Bingo Scheduler API running', now: nowIso() } });
}

function doPost(e) {
  try {
    ensureSheets_();
    const req = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : '{}');
    const action = req.action;
    const payload = req.payload || {};

    if (PUBLIC_ACTIONS[action]) {
      return respond({ ok: true, data: PUBLIC_ACTIONS[action](payload) });
    }
    if (ADMIN_ACTIONS[action]) {
      return respond({ ok: true, data: ADMIN_ACTIONS[action](payload) });
    }

    return respond({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return respond({ ok: false, error: err.message || 'Server error' });
  }
}

function respond(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function createOrFindUser(payload) {
  const firstName = required_(payload.firstName, 'First name is required');
  const lastName = required_(payload.lastName, 'Last name is required');
  const phoneRaw = required_(payload.phoneRaw, 'Phone is required');

  const firstNameNormalized = normalizeName_(firstName);
  const lastNameNormalized = normalizeName_(lastName);
  const phoneNormalized = normalizePhone_(phoneRaw);
  if (!phoneNormalized) throw new Error('Phone must contain digits');

  const identityKey = makeIdentityKey_(firstNameNormalized, lastNameNormalized, phoneNormalized);
  const usersSheet = getSheet_(SHEETS.USERS);
  const users = readRows_(usersSheet);
  const existing = users.find((u) => u.identityKey === identityKey && truthy_(u.active));

  if (existing) {
    updateRow_(usersSheet, 'userId', existing.userId, { lastLoginAt: nowIso() });
    writeAudit_('user', existing.userId, 'user_login', 'user', existing.userId, { identityKey: identityKey });
    return sanitizeUser_(Object.assign({}, existing, { lastLoginAt: nowIso() }));
  }

  const user = {
    userId: generateId_('usr'),
    firstName: tidyNameDisplay_(firstName),
    lastName: tidyNameDisplay_(lastName),
    firstNameNormalized: firstNameNormalized,
    lastNameNormalized: lastNameNormalized,
    phoneRaw: phoneRaw,
    phoneNormalized: phoneNormalized,
    identityKey: identityKey,
    createdAt: nowIso(),
    lastLoginAt: nowIso(),
    active: true
  };
  appendRow_(usersSheet, user);
  writeAudit_('user', user.userId, 'user_created', 'user', user.userId, { identityKey: identityKey });
  return sanitizeUser_(user);
}

function getUserProfile(payload) {
  const user = requireUser_(payload.userId);
  return sanitizeUser_(user);
}

function getUserAssignments(payload) {
  const userId = required_(payload.userId, 'userId required');
  const user = requireUser_(userId);
  const eventsById = indexBy_(readRows_(getSheet_(SHEETS.EVENTS)), 'eventId');

  const assignments = readRows_(getSheet_(SHEETS.ASSIGNMENTS))
    .filter((row) => row.userId === user.userId && row.status === 'active')
    .map((row) => {
      const eventRow = eventsById[row.eventId];
      if (!eventRow || eventRow.status !== 'active') return null;
      return {
        assignmentId: row.assignmentId,
        eventId: row.eventId,
        eventName: eventRow.eventName,
        eventDate: eventRow.eventDate,
        startTime: eventRow.startTime,
        endTime: eventRow.endTime,
        roleName: row.roleName
      };
    })
    .filter(Boolean)
    .sort(sortByEventDate_);

  return { assignments: assignments };
}

function getActiveEvents(payload) {
  const userId = required_(payload.userId, 'userId required');
  requireUser_(userId);

  const events = readRows_(getSheet_(SHEETS.EVENTS))
    .filter((eventRow) => eventRow.status === 'active')
    .sort(sortByEventDate_)
    .map((eventRow) => {
      const roles = parseJson_(eventRow.rolesSnapshotJson, []);
      const activeAssignments = getActiveAssignmentsForEvent_(eventRow.eventId);
      return {
        eventId: eventRow.eventId,
        eventName: eventRow.eventName,
        eventDate: eventRow.eventDate,
        startTime: eventRow.startTime,
        endTime: eventRow.endTime,
        totalSlots: roles.length,
        filledSlots: activeAssignments.length
      };
    });

  return { events: events };
}

function getEventAvailableRoles(payload) {
  const eventId = required_(payload.eventId, 'eventId required');
  const userId = required_(payload.userId, 'userId required');
  requireUser_(userId);

  const eventRow = requireEvent_(eventId);
  if (eventRow.status !== 'active') throw new Error('Event is archived');

  const roles = parseJson_(eventRow.rolesSnapshotJson, []);
  const activeAssignments = getActiveAssignmentsForEvent_(eventId);
  const takenSlotIds = activeAssignments.map((a) => a.roleSlotId);
  const currentAssignment = activeAssignments.find((a) => a.userId === userId) || null;

  const availableRoles = roles.filter((role) => takenSlotIds.indexOf(role.roleSlotId) === -1 || (currentAssignment && currentAssignment.roleSlotId === role.roleSlotId));

  return {
    event: publicEvent_(eventRow),
    availableRoles: availableRoles,
    currentAssignment: currentAssignment ? {
      assignmentId: currentAssignment.assignmentId,
      roleSlotId: currentAssignment.roleSlotId,
      roleName: currentAssignment.roleName
    } : null
  };
}

function assignUserToRole(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const userId = required_(payload.userId, 'userId required');
    const eventId = required_(payload.eventId, 'eventId required');
    const roleSlotId = required_(payload.roleSlotId, 'roleSlotId required');
    requireUser_(userId);

    const eventRow = requireEvent_(eventId);
    if (eventRow.status !== 'active') throw new Error('Archived events cannot accept signups');

    const activeAssignments = getActiveAssignmentsForEvent_(eventId);
    if (activeAssignments.some((a) => a.userId === userId)) {
      throw new Error('User already has an assignment for this event');
    }
    if (activeAssignments.some((a) => a.roleSlotId === roleSlotId)) {
      throw new Error('Role slot is already filled');
    }

    const roles = parseJson_(eventRow.rolesSnapshotJson, []);
    const role = roles.find((r) => r.roleSlotId === roleSlotId);
    if (!role) throw new Error('Role slot not found');

    const assignment = {
      assignmentId: generateId_('asn'),
      eventId: eventId,
      userId: userId,
      roleSlotId: role.roleSlotId,
      roleName: role.roleName,
      assignedAt: nowIso(),
      status: 'active',
      removedAt: '',
      removedBy: ''
    };

    appendRow_(getSheet_(SHEETS.ASSIGNMENTS), assignment);
    writeAudit_('user', userId, 'assignment_created', 'assignment', assignment.assignmentId, assignment);
    return { assignmentId: assignment.assignmentId };
  } finally {
    lock.releaseLock();
  }
}

function removeUserAssignment(payload) {
  return removeAssignmentCore_(payload.userId, payload.assignmentId, 'user', payload.userId);
}

function changeUserAssignment(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const userId = required_(payload.userId, 'userId required');
    const eventId = required_(payload.eventId, 'eventId required');
    const fromAssignmentId = required_(payload.fromAssignmentId, 'fromAssignmentId required');
    const toRoleSlotId = required_(payload.toRoleSlotId, 'toRoleSlotId required');

    const assignmentRow = requireAssignment_(fromAssignmentId);
    if (assignmentRow.userId !== userId || assignmentRow.eventId !== eventId || assignmentRow.status !== 'active') {
      throw new Error('Assignment not valid for change');
    }

    const eventRow = requireEvent_(eventId);
    if (eventRow.status !== 'active') throw new Error('Event is archived');

    const activeAssignments = getActiveAssignmentsForEvent_(eventId);
    if (activeAssignments.some((a) => a.roleSlotId === toRoleSlotId)) throw new Error('New role slot is already filled');

    removeAssignmentCore_(userId, fromAssignmentId, 'user', userId);
    return assignUserToRole({ userId: userId, eventId: eventId, roleSlotId: toRoleSlotId });
  } finally {
    lock.releaseLock();
  }
}

function adminLogin(payload) {
  const username = normalizeName_(required_(payload.username, 'username required'));
  const password = required_(payload.password, 'password required');
  const admin = readRows_(getSheet_(SHEETS.ADMINS)).find((row) => normalizeName_(row.username) === username && row.password === password && truthy_(row.active));
  if (!admin) throw new Error('Invalid login');
  writeAudit_('admin', admin.adminId, 'admin_login', 'admin', admin.adminId, {});
  return { admin: sanitizeAdmin_(admin) };
}

function getAdminDashboardData(payload) {
  const admin = requireActiveAdmin_(payload.adminId);
  const templates = readRows_(getSheet_(SHEETS.TEMPLATES));
  const events = readRows_(getSheet_(SHEETS.EVENTS)).sort(sortByStatusThenDate_).map(adminEventSummary_);
  const admins = readRows_(getSheet_(SHEETS.ADMINS)).map(sanitizeAdmin_);
  return { admin: sanitizeAdmin_(admin), templates: templates, events: events, admins: admins };
}

function createTemplate(payload) {
  requireActiveAdmin_(payload.adminId);
  const roles = cleanRoles_(payload.roles);
  if (!roles.length) throw new Error('At least one role slot is required');

  const row = {
    templateId: generateId_('tpl'),
    templateName: required_(payload.templateName, 'templateName required'),
    dayOfWeek: payload.dayOfWeek || '',
    startTime: payload.startTime || '',
    endTime: payload.endTime || '',
    description: payload.description || '',
    rolesJson: JSON.stringify(roles),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    active: true
  };

  appendRow_(getSheet_(SHEETS.TEMPLATES), row);
  writeAudit_('admin', payload.adminId, 'template_created', 'template', row.templateId, row);
  return { templateId: row.templateId };
}

function updateTemplate(payload) {
  requireActiveAdmin_(payload.adminId);
  const templateId = required_(payload.templateId, 'templateId required');
  const existing = requireTemplate_(templateId);
  const roles = cleanRoles_(payload.roles || parseJson_(existing.rolesJson, []));
  if (!roles.length) throw new Error('At least one role slot is required');

  updateRow_(getSheet_(SHEETS.TEMPLATES), 'templateId', templateId, {
    templateName: payload.templateName || existing.templateName,
    dayOfWeek: payload.dayOfWeek || existing.dayOfWeek,
    startTime: payload.startTime || existing.startTime,
    endTime: payload.endTime || existing.endTime,
    description: payload.description || existing.description,
    rolesJson: JSON.stringify(roles),
    updatedAt: nowIso()
  });

  writeAudit_('admin', payload.adminId, 'template_updated', 'template', templateId, {});
  return { templateId: templateId };
}

function deactivateTemplate(payload) {
  requireActiveAdmin_(payload.adminId);
  const templateId = required_(payload.templateId, 'templateId required');
  updateRow_(getSheet_(SHEETS.TEMPLATES), 'templateId', templateId, { active: false, updatedAt: nowIso() });
  writeAudit_('admin', payload.adminId, 'template_deactivated', 'template', templateId, {});
  return { templateId: templateId };
}

function createEvent(payload) {
  requireActiveAdmin_(payload.adminId);
  const eventName = required_(payload.eventName, 'eventName required');
  const eventDate = required_(payload.eventDate, 'eventDate required');
  const startTime = required_(payload.startTime, 'startTime required');
  const endTime = required_(payload.endTime, 'endTime required');

  let roles = cleanRoles_(payload.roles || []);
  let templateNameSnapshot = '';
  if (payload.templateId) {
    const template = requireTemplate_(payload.templateId);
    templateNameSnapshot = template.templateName;
    if (!roles.length) roles = parseJson_(template.rolesJson, []);
  }
  if (!roles.length) throw new Error('At least one role slot is required');

  const eventRow = {
    eventId: generateId_('evt'),
    eventName: eventName,
    eventDate: eventDate,
    startTime: startTime,
    endTime: endTime,
    templateId: payload.templateId || '',
    templateNameSnapshot: templateNameSnapshot,
    rolesSnapshotJson: JSON.stringify(roles),
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    notes: payload.notes || ''
  };

  appendRow_(getSheet_(SHEETS.EVENTS), eventRow);
  writeAudit_('admin', payload.adminId, 'event_created', 'event', eventRow.eventId, eventRow);
  return { eventId: eventRow.eventId };
}

function updateEvent(payload) {
  requireActiveAdmin_(payload.adminId);
  const eventId = required_(payload.eventId, 'eventId required');
  const eventRow = requireEvent_(eventId);
  const roles = cleanRoles_(payload.roles || parseJson_(eventRow.rolesSnapshotJson, []));
  if (!roles.length) throw new Error('At least one role slot is required');

  let templateNameSnapshot = eventRow.templateNameSnapshot || '';
  if (payload.templateId) {
    templateNameSnapshot = requireTemplate_(payload.templateId).templateName;
  }

  updateRow_(getSheet_(SHEETS.EVENTS), 'eventId', eventId, {
    eventName: payload.eventName || eventRow.eventName,
    eventDate: payload.eventDate || eventRow.eventDate,
    startTime: payload.startTime || eventRow.startTime,
    endTime: payload.endTime || eventRow.endTime,
    templateId: payload.templateId || '',
    templateNameSnapshot: templateNameSnapshot,
    rolesSnapshotJson: JSON.stringify(roles),
    updatedAt: nowIso(),
    notes: payload.notes !== undefined ? payload.notes : eventRow.notes
  });
  writeAudit_('admin', payload.adminId, 'event_updated', 'event', eventId, {});
  return { eventId: eventId };
}

function archiveEvent(payload) {
  requireActiveAdmin_(payload.adminId);
  const eventId = required_(payload.eventId, 'eventId required');
  updateRow_(getSheet_(SHEETS.EVENTS), 'eventId', eventId, { status: 'archived', updatedAt: nowIso() });
  writeAudit_('admin', payload.adminId, 'event_archived', 'event', eventId, {});
  return { eventId: eventId };
}

function getEventAssignments(payload) {
  requireActiveAdmin_(payload.adminId);
  const event = requireEvent_(payload.eventId);
  const usersById = indexBy_(readRows_(getSheet_(SHEETS.USERS)), 'userId');
  const assignments = getActiveAssignmentsForEvent_(event.eventId).map((a) => {
    const user = usersById[a.userId] || {};
    return {
      assignmentId: a.assignmentId,
      roleSlotId: a.roleSlotId,
      roleName: a.roleName,
      userId: a.userId,
      userDisplay: ((user.firstName || '') + ' ' + (user.lastName || '')).trim(),
      phoneRaw: user.phoneRaw || ''
    };
  });
  return { event: adminEventSummary_(event), assignments: assignments };
}

function adminRemoveAssignment(payload) {
  requireActiveAdmin_(payload.adminId);
  return removeAssignmentCore_(payload.adminId, payload.assignmentId, 'admin', payload.adminId);
}

function adminReassignAssignment(payload) {
  requireActiveAdmin_(payload.adminId);
  const current = requireAssignment_(payload.assignmentId);
  if (current.status !== 'active') throw new Error('Assignment already removed');
  removeAssignmentCore_(payload.adminId, payload.assignmentId, 'admin', payload.adminId);
  return assignUserToRole({ userId: current.userId, eventId: current.eventId, roleSlotId: payload.toRoleSlotId });
}

function createAdmin(payload) {
  requireActiveAdmin_(payload.requesterAdminId);
  const username = normalizeName_(required_(payload.username, 'username required'));
  const email = required_(payload.email, 'email required');
  const password = required_(payload.password, 'password required');

  const admins = readRows_(getSheet_(SHEETS.ADMINS));
  if (admins.some((a) => normalizeName_(a.username) === username)) throw new Error('Username already exists');

  const row = {
    adminId: generateId_('adm'),
    displayName: required_(payload.displayName, 'displayName required'),
    username: username,
    email: email,
    password: password,
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    notes: payload.notes || ''
  };

  appendRow_(getSheet_(SHEETS.ADMINS), row);
  writeAudit_('admin', payload.requesterAdminId, 'admin_created', 'admin', row.adminId, {});
  return { adminId: row.adminId };
}

function updateAdmin(payload) {
  requireActiveAdmin_(payload.requesterAdminId);
  const adminId = required_(payload.adminId, 'adminId required');
  const current = requireAdmin_(adminId);
  const username = normalizeName_(payload.username || current.username);

  const admins = readRows_(getSheet_(SHEETS.ADMINS));
  if (admins.some((a) => a.adminId !== adminId && normalizeName_(a.username) === username)) {
    throw new Error('Username already exists');
  }

  const updates = {
    displayName: payload.displayName || current.displayName,
    username: username,
    email: payload.email || current.email,
    notes: payload.notes !== undefined ? payload.notes : current.notes,
    updatedAt: nowIso()
  };

  if (payload.password) {
    updates.password = payload.password;
  }

  updateRow_(getSheet_(SHEETS.ADMINS), 'adminId', adminId, updates);
  writeAudit_('admin', payload.requesterAdminId, 'admin_updated', 'admin', adminId, {});
  return { adminId: adminId };
}

function deactivateAdmin(payload) {
  requireActiveAdmin_(payload.requesterAdminId);
  const adminId = required_(payload.adminId, 'adminId required');
  updateRow_(getSheet_(SHEETS.ADMINS), 'adminId', adminId, { active: false, updatedAt: nowIso() });
  writeAudit_('admin', payload.requesterAdminId, 'admin_deactivated', 'admin', adminId, {});
  return { adminId: adminId };
}

function removeAssignmentCore_(actorId, assignmentId, actorType, removedBy) {
  const assignment = requireAssignment_(assignmentId);
  if (assignment.status !== 'active') throw new Error('Assignment is already removed');
  updateRow_(getSheet_(SHEETS.ASSIGNMENTS), 'assignmentId', assignmentId, {
    status: 'removed',
    removedAt: nowIso(),
    removedBy: removedBy || ''
  });
  writeAudit_(actorType, actorId, 'assignment_removed', 'assignment', assignmentId, {});
  return { assignmentId: assignmentId };
}

function publicEvent_(eventRow) {
  return {
    eventId: eventRow.eventId,
    eventName: eventRow.eventName,
    eventDate: eventRow.eventDate,
    startTime: eventRow.startTime,
    endTime: eventRow.endTime
  };
}

function sanitizeUser_(row) {
  return {
    userId: row.userId,
    firstName: row.firstName,
    lastName: row.lastName,
    phoneRaw: row.phoneRaw,
    identityKey: row.identityKey,
    active: truthy_(row.active)
  };
}

function sanitizeAdmin_(row) {
  return {
    adminId: row.adminId,
    displayName: row.displayName,
    username: row.username,
    email: row.email,
    active: truthy_(row.active),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    notes: row.notes || ''
  };
}

function adminEventSummary_(eventRow) {
  const roles = parseJson_(eventRow.rolesSnapshotJson, []);
  const assignments = getActiveAssignmentsForEvent_(eventRow.eventId);
  return {
    eventId: eventRow.eventId,
    eventName: eventRow.eventName,
    eventDate: eventRow.eventDate,
    startTime: eventRow.startTime,
    endTime: eventRow.endTime,
    templateId: eventRow.templateId || '',
    templateNameSnapshot: eventRow.templateNameSnapshot || '',
    rolesSnapshotJson: eventRow.rolesSnapshotJson,
    status: eventRow.status,
    filledSlots: assignments.length,
    totalSlots: roles.length
  };
}

function cleanRoles_(roles) {
  return (roles || []).map((role, idx) => ({
    roleSlotId: role.roleSlotId || generateId_('slot' + idx),
    roleName: required_(role.roleName, 'roleName is required')
  }));
}

function getActiveAssignmentsForEvent_(eventId) {
  return readRows_(getSheet_(SHEETS.ASSIGNMENTS)).filter((row) => row.eventId === eventId && row.status === 'active');
}

function requireUser_(userId) {
  const row = readRows_(getSheet_(SHEETS.USERS)).find((u) => u.userId === userId && truthy_(u.active));
  if (!row) throw new Error('User not found');
  return row;
}

function requireAdmin_(adminId) {
  const row = readRows_(getSheet_(SHEETS.ADMINS)).find((a) => a.adminId === adminId);
  if (!row) throw new Error('Admin not found');
  return row;
}

function requireActiveAdmin_(adminId) {
  const row = requireAdmin_(required_(adminId, 'adminId required'));
  if (!truthy_(row.active)) throw new Error('Admin is inactive');
  return row;
}

function requireTemplate_(templateId) {
  const row = readRows_(getSheet_(SHEETS.TEMPLATES)).find((t) => t.templateId === templateId);
  if (!row) throw new Error('Template not found');
  return row;
}

function requireEvent_(eventId) {
  const row = readRows_(getSheet_(SHEETS.EVENTS)).find((e) => e.eventId === eventId);
  if (!row) throw new Error('Event not found');
  return row;
}

function requireAssignment_(assignmentId) {
  const row = readRows_(getSheet_(SHEETS.ASSIGNMENTS)).find((a) => a.assignmentId === assignmentId);
  if (!row) throw new Error('Assignment not found');
  return row;
}

function ensureSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_HEADERS).forEach((name) => {
    const existing = ss.getSheetByName(name);
    if (!existing) {
      const sheet = ss.insertSheet(name);
      sheet.appendRow(SHEET_HEADERS[name]);
    } else if (existing.getLastRow() === 0) {
      existing.appendRow(SHEET_HEADERS[name]);
    }
  });
}

function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Missing sheet: ' + name);
  return sheet;
}

function readRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map((row) => {
    const obj = {};
    headers.forEach((header, i) => obj[String(header)] = row[i]);
    return obj;
  });
}

function appendRow_(sheet, obj) {
  const headers = getHeaders_(sheet);
  sheet.appendRow(headers.map((header) => valueForCell_(obj[header])));
}

function updateRow_(sheet, keyColumn, keyValue, updates) {
  const headers = getHeaders_(sheet);
  const keyIndex = headers.indexOf(keyColumn);
  if (keyIndex === -1) throw new Error('Missing key column ' + keyColumn);

  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][keyIndex]) === String(keyValue)) {
      headers.forEach((header, c) => {
        if (Object.prototype.hasOwnProperty.call(updates, header)) {
          values[r][c] = valueForCell_(updates[header]);
        }
      });
      sheet.getRange(1, 1, values.length, headers.length).setValues(values);
      return;
    }
  }
  throw new Error('Row not found for ' + keyColumn + '=' + keyValue);
}

function getHeaders_(sheet) {
  if (sheet.getLastRow() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h));
}

function writeAudit_(actorType, actorId, actionType, targetType, targetId, details) {
  appendRow_(getSheet_(SHEETS.AUDIT_LOG), {
    logId: generateId_('log'),
    timestamp: nowIso(),
    actorType: actorType,
    actorId: actorId || '',
    actionType: actionType,
    targetType: targetType,
    targetId: targetId || '',
    detailsJson: JSON.stringify(details || {})
  });
}

function normalizeName_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function tidyNameDisplay_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizePhone_(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function makeIdentityKey_(firstNormalized, lastNormalized, phoneNormalized) {
  return firstNormalized + '|' + lastNormalized + '|' + phoneNormalized;
}

function nowIso() {
  return new Date().toISOString();
}

function generateId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function required_(value, message) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error(message || 'Missing required value');
  }
  return value;
}

function truthy_(value) {
  if (value === true) return true;
  if (typeof value === 'string') return value.toLowerCase() !== 'false' && value !== '';
  return Boolean(value);
}

function parseJson_(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (err) {
    return fallback;
  }
}

function indexBy_(rows, key) {
  const out = {};
  rows.forEach((row) => out[row[key]] = row);
  return out;
}

function valueForCell_(value) {
  if (value === undefined || value === null) return '';
  return value;
}

function sortByEventDate_(a, b) {
  const aKey = String(a.eventDate || '') + 'T' + String(a.startTime || '00:00');
  const bKey = String(b.eventDate || '') + 'T' + String(b.startTime || '00:00');
  return aKey.localeCompare(bKey);
}

function sortByStatusThenDate_(a, b) {
  if (a.status === b.status) return sortByEventDate_(a, b);
  if (a.status === 'active') return -1;
  if (b.status === 'active') return 1;
  return sortByEventDate_(a, b);
}
