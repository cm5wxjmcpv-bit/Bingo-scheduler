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
  createOrFindUserWithData,
  getUserHomeData,
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
  adminAssignUserToRole,
  createAdmin,
  updateAdmin,
  deactivateAdmin,
  createUserAdmin,
  updateUserAdmin,
  deactivateUserAdmin,
  reactivateUserAdmin
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

function createOrFindUserWithData(payload) {
  const user = createOrFindUser(payload);
  const homeData = buildUserHomeData_(user.userId);
  return Object.assign({ user: user }, homeData);
}

function getUserHomeData(payload) {
  const userId = required_(payload.userId, 'userId required');
  requireUser_(userId);
  return buildUserHomeData_(userId);
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
        eventDate: normalizeEventDateValue_(eventRow.eventDate),
        startTime: normalizeEventTimeValue_(eventRow.startTime),
        endTime: normalizeEventTimeValue_(eventRow.endTime),
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
  return { events: buildPublicActiveEvents_(readRows_(getSheet_(SHEETS.EVENTS)), readRows_(getSheet_(SHEETS.ASSIGNMENTS))) };
}

function getEventAvailableRoles(payload) {
  const eventId = required_(payload.eventId, 'eventId required');
  const userId = required_(payload.userId, 'userId required');
  requireUser_(userId);

  const events = readRows_(getSheet_(SHEETS.EVENTS));
  const eventRow = events.find((e) => e.eventId === eventId);
  if (!eventRow) throw new Error('Event not found');
  if (eventRow.status !== 'active') throw new Error('Event is archived');

  const activeAssignments = readRows_(getSheet_(SHEETS.ASSIGNMENTS)).filter((row) => row.eventId === eventId && row.status === 'active');
  return buildEventRoleDetail_(eventRow, activeAssignments, userId);
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

    const roles = parseEventRoles_(eventRow);
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
    return Object.assign({ assignmentId: assignment.assignmentId }, buildUserHomeData_(userId));
  } finally {
    lock.releaseLock();
  }
}

function removeUserAssignment(payload) {
  const userId = required_(payload.userId, 'userId required');
  const assignmentId = required_(payload.assignmentId, 'assignmentId required');
  removeAssignmentCore_(userId, assignmentId, 'user', userId);
  return buildUserHomeData_(userId);
}

function changeUserAssignment(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const userId = required_(payload.userId, 'userId required');
    const eventId = required_(payload.eventId, 'eventId required');
    const fromAssignmentId = required_(payload.fromAssignmentId, 'fromAssignmentId required');
    const toRoleSlotId = required_(payload.toRoleSlotId, 'toRoleSlotId required');

    requireUser_(userId);
    const assignmentRow = requireAssignment_(fromAssignmentId);
    if (assignmentRow.userId !== userId || assignmentRow.eventId !== eventId || assignmentRow.status !== 'active') {
      throw new Error('Assignment not valid for change');
    }

    const eventRow = requireEvent_(eventId);
    if (eventRow.status !== 'active') throw new Error('Event is archived');

    const roles = parseEventRoles_(eventRow);
    const destinationRole = roles.find((role) => role.roleSlotId === toRoleSlotId);
    if (!destinationRole) throw new Error('Destination role slot not found');
    if (assignmentRow.roleSlotId === toRoleSlotId) throw new Error('Assignment is already in that role slot');

    const activeAssignments = getActiveAssignmentsForEvent_(eventId);
    if (activeAssignments.some((a) => a.roleSlotId === toRoleSlotId)) throw new Error('New role slot is already filled');

    updateRow_(getSheet_(SHEETS.ASSIGNMENTS), 'assignmentId', fromAssignmentId, {
      roleSlotId: destinationRole.roleSlotId,
      roleName: destinationRole.roleName,
      assignedAt: nowIso()
    });

    writeAudit_('user', userId, 'assignment_changed', 'assignment', fromAssignmentId, {
      eventId: eventId,
      fromRoleSlotId: assignmentRow.roleSlotId,
      fromRoleName: assignmentRow.roleName,
      toRoleSlotId: destinationRole.roleSlotId,
      toRoleName: destinationRole.roleName
    });

    return Object.assign({ assignmentId: fromAssignmentId }, buildUserHomeData_(userId));
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
  const templates = readRows_(getSheet_(SHEETS.TEMPLATES)).map(normalizeTemplateSummary_);
  const events = readRows_(getSheet_(SHEETS.EVENTS)).sort(sortByStatusThenDate_).map(adminEventSummary_);
  const admins = readRows_(getSheet_(SHEETS.ADMINS)).map(sanitizeAdmin_);
  const users = readRows_(getSheet_(SHEETS.USERS)).map(sanitizeUser_);
  const activeAssignments = readRows_(getSheet_(SHEETS.ASSIGNMENTS)).filter((row) => row.status === 'active');
  return {
    admin: sanitizeAdmin_(admin),
    templates: templates,
    events: events,
    admins: admins,
    users: users,
    activeAssignments: activeAssignments
  };
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
    rolesJson: JSON.stringify(roles),
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
  const roles = cleanRoles_(payload.roles || parseEventRoles_(eventRow));
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
    rolesJson: JSON.stringify(roles),
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
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    requireActiveAdmin_(payload.adminId);
    const assignmentId = required_(payload.assignmentId, 'assignmentId required');
    const toRoleSlotId = required_(payload.toRoleSlotId, 'toRoleSlotId required');

    const current = requireAssignment_(assignmentId);
    if (current.status !== 'active') throw new Error('Assignment already removed');

    const eventRow = requireEvent_(current.eventId);
    if (eventRow.status !== 'active') throw new Error('Event is archived');

    const roles = parseEventRoles_(eventRow);
    const destinationRole = roles.find((role) => role.roleSlotId === toRoleSlotId);
    if (!destinationRole) throw new Error('Destination role slot not found in this event');
    if (current.roleSlotId === toRoleSlotId) throw new Error('Assignment is already in that role slot');

    const activeAssignments = getActiveAssignmentsForEvent_(current.eventId);
    if (activeAssignments.some((row) => row.roleSlotId === toRoleSlotId)) {
      throw new Error('Destination role slot is already filled');
    }

    const sameUserAssignments = activeAssignments.filter((row) => row.userId === current.userId);
    if (sameUserAssignments.some((row) => row.assignmentId !== current.assignmentId)) {
      throw new Error('User already has another assignment for this event');
    }

    updateRow_(getSheet_(SHEETS.ASSIGNMENTS), 'assignmentId', assignmentId, {
      roleSlotId: destinationRole.roleSlotId,
      roleName: destinationRole.roleName,
      assignedAt: nowIso()
    });

    writeAudit_('admin', payload.adminId, 'assignment_reassigned', 'assignment', assignmentId, {
      eventId: current.eventId,
      fromRoleSlotId: current.roleSlotId,
      fromRoleName: current.roleName,
      toRoleSlotId: destinationRole.roleSlotId,
      toRoleName: destinationRole.roleName,
      userId: current.userId
    });

    return { assignmentId: assignmentId };
  } finally {
    lock.releaseLock();
  }
}

function adminAssignUserToRole(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    requireActiveAdmin_(payload.adminId);
    const eventId = required_(payload.eventId, 'eventId required');
    const userId = required_(payload.userId, 'userId required');
    const roleSlotId = required_(payload.roleSlotId, 'roleSlotId required');

    const user = requireUser_(userId);
    const eventRow = requireEvent_(eventId);
    if (eventRow.status !== 'active') throw new Error('Event is archived');

    const roles = parseEventRoles_(eventRow);
    const role = roles.find((item) => item.roleSlotId === roleSlotId);
    if (!role) throw new Error('Role slot not found in this event');

    const activeAssignments = getActiveAssignmentsForEvent_(eventId);
    if (activeAssignments.some((assignment) => assignment.roleSlotId === roleSlotId)) {
      throw new Error('Role slot is already filled');
    }
    if (activeAssignments.some((assignment) => assignment.userId === userId)) {
      throw new Error('User already has a role for this event. Move their current assignment instead.');
    }

    const row = {
      assignmentId: generateId_('asg'),
      eventId: eventId,
      userId: user.userId,
      roleSlotId: role.roleSlotId,
      roleName: role.roleName,
      assignedAt: nowIso(),
      status: 'active',
      removedAt: '',
      removedBy: ''
    };

    appendRow_(getSheet_(SHEETS.ASSIGNMENTS), row);
    writeAudit_('admin', payload.adminId, 'assignment_created_by_admin', 'assignment', row.assignmentId, {
      eventId: eventId,
      userId: user.userId,
      roleSlotId: role.roleSlotId,
      roleName: role.roleName
    });

    return { assignmentId: row.assignmentId };
  } finally {
    lock.releaseLock();
  }
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


function createUserAdmin(payload) {
  requireActiveAdmin_(payload.adminId);
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
  const existing = users.find((u) => u.identityKey === identityKey);

  if (existing) {
    if (truthy_(existing.active)) throw new Error('A matching active user already exists');
    updateRow_(usersSheet, 'userId', existing.userId, {
      firstName: tidyNameDisplay_(firstName),
      lastName: tidyNameDisplay_(lastName),
      firstNameNormalized: firstNameNormalized,
      lastNameNormalized: lastNameNormalized,
      phoneRaw: phoneRaw,
      phoneNormalized: phoneNormalized,
      identityKey: identityKey,
      active: true,
      lastLoginAt: existing.lastLoginAt || ''
    });
    writeAudit_('admin', payload.adminId, 'user_reactivated', 'user', existing.userId, { identityKey: identityKey });
    return { userId: existing.userId };
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
    lastLoginAt: '',
    active: true
  };

  appendRow_(usersSheet, user);
  writeAudit_('admin', payload.adminId, 'user_created_by_admin', 'user', user.userId, { identityKey: identityKey });
  return { userId: user.userId };
}

function updateUserAdmin(payload) {
  requireActiveAdmin_(payload.adminId);
  const userId = required_(payload.userId, 'userId required');
  const current = readRows_(getSheet_(SHEETS.USERS)).find((u) => u.userId === userId);
  if (!current) throw new Error('User not found');

  const firstName = required_(payload.firstName !== undefined ? payload.firstName : current.firstName, 'First name is required');
  const lastName = required_(payload.lastName !== undefined ? payload.lastName : current.lastName, 'Last name is required');
  const phoneRaw = required_(payload.phoneRaw !== undefined ? payload.phoneRaw : current.phoneRaw, 'Phone is required');

  const firstNameNormalized = normalizeName_(firstName);
  const lastNameNormalized = normalizeName_(lastName);
  const phoneNormalized = normalizePhone_(phoneRaw);
  if (!phoneNormalized) throw new Error('Phone must contain digits');

  const identityKey = makeIdentityKey_(firstNameNormalized, lastNameNormalized, phoneNormalized);
  const users = readRows_(getSheet_(SHEETS.USERS));
  const duplicate = users.find((u) => u.userId !== userId && u.identityKey === identityKey && truthy_(u.active));
  if (duplicate) throw new Error('Another active user already has that name and phone');

  updateRow_(getSheet_(SHEETS.USERS), 'userId', userId, {
    firstName: tidyNameDisplay_(firstName),
    lastName: tidyNameDisplay_(lastName),
    firstNameNormalized: firstNameNormalized,
    lastNameNormalized: lastNameNormalized,
    phoneRaw: phoneRaw,
    phoneNormalized: phoneNormalized,
    identityKey: identityKey,
    active: payload.active === undefined ? truthy_(current.active) : truthy_(payload.active)
  });

  writeAudit_('admin', payload.adminId, 'user_updated_by_admin', 'user', userId, { identityKey: identityKey });
  return { userId: userId };
}

function deactivateUserAdmin(payload) {
  requireActiveAdmin_(payload.adminId);
  const userId = required_(payload.userId, 'userId required');
  const user = readRows_(getSheet_(SHEETS.USERS)).find((u) => u.userId === userId);
  if (!user) throw new Error('User not found');

  updateRow_(getSheet_(SHEETS.USERS), 'userId', userId, { active: false });

  const assignmentSheet = getSheet_(SHEETS.ASSIGNMENTS);
  const assignments = readRows_(assignmentSheet).filter((a) => a.userId === userId && a.status === 'active');
  assignments.forEach((assignment) => {
    updateRow_(assignmentSheet, 'assignmentId', assignment.assignmentId, {
      status: 'removed',
      removedAt: nowIso(),
      removedBy: payload.adminId
    });
  });

  writeAudit_('admin', payload.adminId, 'user_deactivated_by_admin', 'user', userId, {
    activeAssignmentsRemoved: assignments.length
  });
  return { userId: userId, activeAssignmentsRemoved: assignments.length };
}

function reactivateUserAdmin(payload) {
  requireActiveAdmin_(payload.adminId);
  const userId = required_(payload.userId, 'userId required');
  const user = readRows_(getSheet_(SHEETS.USERS)).find((u) => u.userId === userId);
  if (!user) throw new Error('User not found');

  const identityKey = user.identityKey || makeIdentityKey_(user.firstNameNormalized || normalizeName_(user.firstName), user.lastNameNormalized || normalizeName_(user.lastName), user.phoneNormalized || normalizePhone_(user.phoneRaw));
  const duplicate = readRows_(getSheet_(SHEETS.USERS)).find((u) => u.userId !== userId && u.identityKey === identityKey && truthy_(u.active));
  if (duplicate) throw new Error('Another active user already has that name and phone');

  updateRow_(getSheet_(SHEETS.USERS), 'userId', userId, { active: true, identityKey: identityKey });
  writeAudit_('admin', payload.adminId, 'user_reactivated_by_admin', 'user', userId, { identityKey: identityKey });
  return { userId: userId };
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

function buildUserHomeData_(userId) {
  const eventsRows = readRows_(getSheet_(SHEETS.EVENTS));
  const assignmentRows = readRows_(getSheet_(SHEETS.ASSIGNMENTS));
  const activeAssignments = assignmentRows.filter((row) => row.status === 'active');
  const eventsById = indexBy_(eventsRows, 'eventId');

  const assignments = activeAssignments
    .filter((row) => row.userId === userId)
    .map((row) => {
      const eventRow = eventsById[row.eventId];
      if (!eventRow || eventRow.status !== 'active') return null;
      return {
        assignmentId: row.assignmentId,
        eventId: row.eventId,
        eventName: eventRow.eventName,
        eventDate: normalizeEventDateValue_(eventRow.eventDate),
        startTime: normalizeEventTimeValue_(eventRow.startTime),
        endTime: normalizeEventTimeValue_(eventRow.endTime),
        roleSlotId: row.roleSlotId,
        roleName: row.roleName
      };
    })
    .filter(Boolean)
    .sort(sortByEventDate_);

  return {
    assignments: assignments,
    events: buildPublicActiveEvents_(eventsRows, assignmentRows),
    loadedAt: nowIso()
  };
}

function buildPublicActiveEvents_(eventsRows, assignmentRows) {
  const activeAssignments = assignmentRows.filter((row) => row.status === 'active');
  const assignmentsByEventId = groupBy_(activeAssignments, 'eventId');

  return eventsRows
    .filter((eventRow) => eventRow.status === 'active')
    .sort(sortByEventDate_)
    .map((eventRow) => {
      const roles = parseEventRoles_(eventRow);
      const eventAssignments = assignmentsByEventId[eventRow.eventId] || [];
      return {
        eventId: eventRow.eventId,
        eventName: eventRow.eventName,
        eventDate: normalizeEventDateValue_(eventRow.eventDate),
        startTime: normalizeEventTimeValue_(eventRow.startTime),
        endTime: normalizeEventTimeValue_(eventRow.endTime),
        totalSlots: roles.length,
        filledSlots: eventAssignments.length,
        roles: roles,
        activeAssignments: eventAssignments.map(publicAssignment_)
      };
    });
}

function buildEventRoleDetail_(eventRow, activeAssignments, userId) {
  const roles = parseEventRoles_(eventRow);
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

function publicAssignment_(row) {
  return {
    assignmentId: row.assignmentId,
    eventId: row.eventId,
    userId: row.userId,
    roleSlotId: row.roleSlotId,
    roleName: row.roleName,
    assignedAt: row.assignedAt
  };
}

function groupBy_(rows, key) {
  const out = {};
  rows.forEach((row) => {
    const groupKey = row[key];
    if (!out[groupKey]) out[groupKey] = [];
    out[groupKey].push(row);
  });
  return out;
}

function publicEvent_(eventRow) {
  return {
    eventId: eventRow.eventId,
    eventName: eventRow.eventName,
    eventDate: normalizeEventDateValue_(eventRow.eventDate),
    startTime: normalizeEventTimeValue_(eventRow.startTime),
    endTime: normalizeEventTimeValue_(eventRow.endTime)
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
  const roles = parseEventRoles_(eventRow);
  const assignments = getActiveAssignmentsForEvent_(eventRow.eventId);
  return {
    eventId: eventRow.eventId,
    eventName: eventRow.eventName,
    eventDate: normalizeEventDateValue_(eventRow.eventDate),
    startTime: normalizeEventTimeValue_(eventRow.startTime),
    endTime: normalizeEventTimeValue_(eventRow.endTime),
    templateId: eventRow.templateId || '',
    templateNameSnapshot: eventRow.templateNameSnapshot || '',
    rolesSnapshotJson: eventRow.rolesSnapshotJson,
    status: eventRow.status,
    filledSlots: assignments.length,
    totalSlots: roles.length
  };
}

function parseEventRoles_(eventRow) {
  return cleanRoles_(parseJson_(eventRow.rolesSnapshotJson || eventRow.rolesJson, []));
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

  repairUsersSheet_();
}

function repairUsersSheet_() {
  const sheet = getSheet_(SHEETS.USERS);
  if (sheet.getLastRow() < 1) return;

  let headers = getHeaders_(sheet);

  // Earlier/manual sheets may have been created with a typo: identitKey instead of identityKey.
  // That makes every login look like a new person because the backend cannot find identityKey.
  const typoIdentityIndex = headers.indexOf('identitKey');
  const identityIndex = headers.indexOf('identityKey');

  if (typoIdentityIndex !== -1 && identityIndex === -1) {
    sheet.getRange(1, typoIdentityIndex + 1).setValue('identityKey');
    headers = getHeaders_(sheet);
  }

  if (headers.indexOf('identityKey') === -1) {
    const newCol = headers.length + 1;
    sheet.getRange(1, newCol).setValue('identityKey');
    headers = getHeaders_(sheet);
  }

  const requiredHeaders = SHEET_HEADERS[SHEETS.USERS];
  requiredHeaders.forEach((header) => {
    if (headers.indexOf(header) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      headers = getHeaders_(sheet);
    }
  });

  if (sheet.getLastRow() < 2) return;

  const headerIndex = {};
  headers.forEach((header, index) => headerIndex[header] = index);

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  let changed = false;

  values.forEach((row) => {
    const firstName = row[headerIndex.firstName] || '';
    const lastName = row[headerIndex.lastName] || '';
    const phoneRaw = row[headerIndex.phoneRaw] || row[headerIndex.phoneNormalized] || '';

    if (headerIndex.firstNameNormalized !== undefined && !row[headerIndex.firstNameNormalized]) {
      row[headerIndex.firstNameNormalized] = normalizeName_(firstName);
      changed = true;
    }

    if (headerIndex.lastNameNormalized !== undefined && !row[headerIndex.lastNameNormalized]) {
      row[headerIndex.lastNameNormalized] = normalizeName_(lastName);
      changed = true;
    }

    if (headerIndex.phoneNormalized !== undefined && !row[headerIndex.phoneNormalized]) {
      row[headerIndex.phoneNormalized] = normalizePhone_(phoneRaw);
      changed = true;
    }

    const firstNormalized = row[headerIndex.firstNameNormalized] || normalizeName_(firstName);
    const lastNormalized = row[headerIndex.lastNameNormalized] || normalizeName_(lastName);
    const phoneNormalized = row[headerIndex.phoneNormalized] || normalizePhone_(phoneRaw);

    if (headerIndex.identityKey !== undefined && !row[headerIndex.identityKey]) {
      row[headerIndex.identityKey] = makeIdentityKey_(firstNormalized, lastNormalized, phoneNormalized);
      changed = true;
    }
  });

  if (changed) {
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
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
    headers.forEach((header, i) => obj[String(header).trim()] = row[i]);
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

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Row not found for ' + keyColumn + '=' + keyValue);

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (let r = 0; r < values.length; r++) {
    if (String(values[r][keyIndex]) === String(keyValue)) {
      headers.forEach((header, c) => {
        if (Object.prototype.hasOwnProperty.call(updates, header)) {
          values[r][c] = valueForCell_(updates[header]);
        }
      });
      sheet.getRange(r + 2, 1, 1, headers.length).setValues([values[r]]);
      return;
    }
  }
  throw new Error('Row not found for ' + keyColumn + '=' + keyValue);
}

function getHeaders_(sheet) {
  if (sheet.getLastRow() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h).trim());
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

function normalizeTemplateSummary_(templateRow) {
  return Object.assign({}, templateRow, {
    startTime: normalizeEventTimeValue_(templateRow.startTime),
    endTime: normalizeEventTimeValue_(templateRow.endTime)
  });
}

function normalizeEventDateValue_(value) {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) {
    const normalized = Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    logDateTimeNormalization_('eventDate', value, normalized);
    return normalized;
  }
  const text = String(value).trim();
  const isoDatePrefix = text.match(/^(\d{4}-\d{2}-\d{2})[T\s].*$/);
  if (isoDatePrefix) {
    const normalized = isoDatePrefix[1];
    logDateTimeNormalization_('eventDate', value, normalized);
    return normalized;
  }
  logDateTimeNormalization_('eventDate', value, text);
  return text;
}

function normalizeEventTimeValue_(value) {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) {
    const normalized = Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
    logDateTimeNormalization_('eventTime', value, normalized);
    return normalized;
  }
  const text = String(value).trim();
  const hhmm24 = text.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (hhmm24) {
    const normalized = hhmm24[1].padStart(2, '0') + ':' + hhmm24[2];
    logDateTimeNormalization_('eventTime', value, normalized);
    return normalized;
  }
  const isoTime = text.match(/T(\d{2}:\d{2})(?::\d{2}(?:\.\d{1,3})?)?Z?$/);
  if (isoTime) {
    const normalized = isoTime[1];
    logDateTimeNormalization_('eventTime', value, normalized);
    return normalized;
  }
  logDateTimeNormalization_('eventTime', value, text);
  return text;
}

function logDateTimeNormalization_(field, original, normalized) {
  const originalDisplay = original instanceof Date ? original.toISOString() : String(original);
  Logger.log('[normalize] %s original=%s normalized=%s', field, originalDisplay, normalized);
}
