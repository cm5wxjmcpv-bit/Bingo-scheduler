import { api } from './api.js';
import { CONFIG } from './config.js';
import { clearStorage, escapeHtml, formatDateTime, loadStorage, saveStorage, setMessage } from './utils.js';

const loginCard = document.getElementById('admin-login-card');
const dashboard = document.getElementById('admin-dashboard');
const loginMessage = document.getElementById('admin-login-message');
const adminMessage = document.getElementById('admin-message');
const templateMessage = document.getElementById('template-message');
const eventMessage = document.getElementById('event-message');
const assignmentMessage = document.getElementById('assignment-message');

let session = loadStorage(CONFIG.storageKeys.adminSession);
let dashboardData = { templates: [], events: [], admins: [], users: [] };
let templateRoles = [];
let eventRoles = [];

function normalizeTimeForInput(value) {
  if (!value) return '';
  const normalized = String(value).trim();

  const hhmm24 = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (hhmm24) {
    return `${hhmm24[1].padStart(2, '0')}:${hhmm24[2]}`;
  }

  const hhmm12 = normalized.match(/^(1[0-2]|0?[1-9]):([0-5]\d)(?::([0-5]\d))?\s*([AaPp][Mm])$/);
  if (hhmm12) {
    let hours = Number(hhmm12[1]);
    const minutes = hhmm12[2];
    const meridiem = hhmm12[4].toUpperCase();
    if (meridiem === 'AM' && hours === 12) hours = 0;
    if (meridiem === 'PM' && hours !== 12) hours += 12;
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  return '';
}

function normalizeDateForInput(value) {
  if (!value) return '';
  const normalized = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;

  const isoDatePrefix = normalized.match(/^(\d{4}-\d{2}-\d{2})[T\s].*$/);
  if (isoDatePrefix) return isoDatePrefix[1];

  const mdy = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const year = Number(mdy[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function normalizeTimeForStorage(value) {
  return normalizeTimeForInput(value);
}

if (session?.adminId) showDashboard();

const loginForm = document.getElementById('admin-login-form');
loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api.adminLogin({ username: document.getElementById('admin-username').value, password: document.getElementById('admin-password').value });
    session = { adminId: data.admin.adminId, username: data.admin.username };
    saveStorage(CONFIG.storageKeys.adminSession, session);
    await showDashboard();
  } catch (error) {
    setMessage(loginMessage, error.message || 'Login failed', 'error');
  }
});

document.getElementById('admin-logout')?.addEventListener('click', () => {
  clearStorage(CONFIG.storageKeys.adminSession);
  window.location.reload();
});
document.getElementById('admin-refresh')?.addEventListener('click', loadDashboardData);

async function showDashboard() {
  loginCard.classList.add('hidden');
  dashboard.classList.remove('hidden');
  await loadDashboardData();
}

async function loadDashboardData() {
  try {
    const data = await api.getAdminDashboardData(session.adminId);
    dashboardData = data;
    renderTemplates();
    renderEvents();
    renderAdmins();
    renderUsers();
    renderTemplateOptions();
    renderAssignmentEventOptions();
    await loadAssignmentsForSelectedEvent();
  } catch (error) {
    setMessage(adminMessage, error.message || 'Could not load dashboard', 'error');
  }
}

function renderTemplateOptions() {
  const select = document.getElementById('event-template');
  select.innerHTML = '<option value="">Custom roles</option>' + dashboardData.templates.filter((t) => t.active).map((t) => `<option value="${t.templateId}">${escapeHtml(t.templateName)}</option>`).join('');
}

function renderAssignmentEventOptions() {
  const select = document.getElementById('assignment-event-select');
  select.innerHTML = dashboardData.events.map((e) => `<option value="${e.eventId}">${escapeHtml(e.eventName)} (${e.eventDate})</option>`).join('');
}

document.getElementById('assignment-event-select')?.addEventListener('change', loadAssignmentsForSelectedEvent);

async function loadAssignmentsForSelectedEvent() {
  const eventId = document.getElementById('assignment-event-select').value;
  if (!eventId) {
    document.getElementById('assignments-list').innerHTML = '<p class="muted">Select an event.</p>';
    return;
  }

  const data = await api.getEventAssignments({ adminId: session.adminId, eventId });
  const list = document.getElementById('assignments-list');
  if (!data.assignments.length) {
    list.innerHTML = '<p class="muted">No active assignments.</p>';
    return;
  }

  list.innerHTML = data.assignments.map((a) => `
    <div class="event-card">
      <strong>${escapeHtml(a.roleName)}</strong>
      <div class="event-meta">${escapeHtml(a.userDisplay || 'Unknown User')}</div>
      <div class="small muted">${escapeHtml(a.phoneRaw || 'No phone')}</div>
      <div class="actions">
        <button class="tiny danger" data-admin-remove="${a.assignmentId}">Remove</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-admin-remove]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api.adminRemoveAssignment({ adminId: session.adminId, assignmentId: button.dataset.adminRemove });
      setMessage(assignmentMessage, 'Assignment removed', 'success');
      await loadAssignmentsForSelectedEvent();
      await loadDashboardData();
    });
  });
}

function roleChip(roleName, index, onRemove) {
  return `<span class="chip">${escapeHtml(roleName)} <button data-index="${index}" class="secondary tiny" type="button">x</button></span>`;
}

function bindRoleChipRemovals(containerId, roleArray, renderFn) {
  document.querySelectorAll(`#${containerId} [data-index]`).forEach((button) => {
    button.addEventListener('click', () => {
      roleArray.splice(Number(button.dataset.index), 1);
      renderFn();
    });
  });
}

function renderTemplateRoles() {
  const container = document.getElementById('template-role-chips');
  container.innerHTML = templateRoles.map((r, i) => roleChip(r.roleName, i)).join('');
  bindRoleChipRemovals('template-role-chips', templateRoles, renderTemplateRoles);
}

function renderEventRoles() {
  const container = document.getElementById('event-role-chips');
  container.innerHTML = eventRoles.map((r, i) => roleChip(r.roleName, i)).join('');
  bindRoleChipRemovals('event-role-chips', eventRoles, renderEventRoles);
}

document.getElementById('add-template-role')?.addEventListener('click', () => {
  const input = document.getElementById('template-role-input');
  if (!input.value.trim()) return;
  templateRoles.push({ roleSlotId: crypto.randomUUID(), roleName: input.value.trim() });
  input.value = '';
  renderTemplateRoles();
});

document.getElementById('add-event-role')?.addEventListener('click', () => {
  const input = document.getElementById('event-role-input');
  if (!input.value.trim()) return;
  eventRoles.push({ roleSlotId: crypto.randomUUID(), roleName: input.value.trim() });
  input.value = '';
  renderEventRoles();
});

document.getElementById('event-template')?.addEventListener('change', (event) => {
  const template = dashboardData.templates.find((t) => t.templateId === event.target.value);
  if (!template) return;
  document.getElementById('event-start').value = normalizeTimeForInput(template.startTime);
  document.getElementById('event-end').value = normalizeTimeForInput(template.endTime);
  eventRoles = JSON.parse(template.rolesJson || '[]');
  renderEventRoles();
});

const templateForm = document.getElementById('template-form');
templateForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const id = document.getElementById('template-id').value;
    const payload = {
      adminId: session.adminId,
      templateId: id || undefined,
      templateName: document.getElementById('template-name').value,
      dayOfWeek: document.getElementById('template-day').value,
      startTime: normalizeTimeForStorage(document.getElementById('template-start').value),
      endTime: normalizeTimeForStorage(document.getElementById('template-end').value),
      description: document.getElementById('template-description').value,
      roles: templateRoles
    };
    if (id) await api.updateTemplate(payload);
    else await api.createTemplate(payload);
    setMessage(templateMessage, 'Template saved', 'success');
    resetTemplateForm();
    await loadDashboardData();
  } catch (error) {
    setMessage(templateMessage, error.message || 'Save failed', 'error');
  }
});

document.getElementById('template-reset')?.addEventListener('click', resetTemplateForm);
function resetTemplateForm() {
  templateForm.reset();
  document.getElementById('template-id').value = '';
  templateRoles = [];
  renderTemplateRoles();
}

const eventForm = document.getElementById('event-form');
eventForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const id = document.getElementById('event-id').value;
    const payload = {
      adminId: session.adminId,
      eventId: id || undefined,
      eventName: document.getElementById('event-name').value,
      eventDate: normalizeDateForInput(document.getElementById('event-date').value),
      startTime: normalizeTimeForStorage(document.getElementById('event-start').value),
      endTime: normalizeTimeForStorage(document.getElementById('event-end').value),
      templateId: document.getElementById('event-template').value || '',
      roles: eventRoles
    };
    if (id) await api.updateEvent(payload);
    else await api.createEvent(payload);
    setMessage(eventMessage, 'Event saved', 'success');
    resetEventForm();
    await loadDashboardData();
  } catch (error) {
    setMessage(eventMessage, error.message || 'Save failed', 'error');
  }
});

document.getElementById('event-reset')?.addEventListener('click', resetEventForm);
function resetEventForm() {
  eventForm.reset();
  document.getElementById('event-id').value = '';
  eventRoles = [];
  renderEventRoles();
}

const adminForm = document.getElementById('admin-form');
adminForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const id = document.getElementById('managed-admin-id').value;
    const payload = {
      requesterAdminId: session.adminId,
      adminId: id || undefined,
      displayName: document.getElementById('managed-admin-display').value,
      username: document.getElementById('managed-admin-username').value,
      email: document.getElementById('managed-admin-email').value,
      password: document.getElementById('managed-admin-password').value,
      notes: document.getElementById('managed-admin-notes').value
    };
    if (id) await api.updateAdmin(payload);
    else await api.createAdmin(payload);
    setMessage(adminMessage, 'Admin saved', 'success');
    resetAdminForm();
    await loadDashboardData();
  } catch (error) {
    setMessage(adminMessage, error.message || 'Admin save failed', 'error');
  }
});

document.getElementById('admin-reset')?.addEventListener('click', resetAdminForm);
function resetAdminForm() {
  adminForm.reset();
  document.getElementById('managed-admin-id').value = '';
}

function renderTemplates() {
  const list = document.getElementById('templates-list');
  if (!dashboardData.templates.length) {
    list.innerHTML = '<p class="muted">No templates.</p>';
    return;
  }

  list.innerHTML = dashboardData.templates.map((template) => {
    const roles = JSON.parse(template.rolesJson || '[]');
    return `
      <div class="event-card">
        <strong>${escapeHtml(template.templateName)}</strong>
        <div class="event-meta">${escapeHtml(template.dayOfWeek || '')} ${escapeHtml(template.startTime || '')}-${escapeHtml(template.endTime || '')}</div>
        <div class="role-chips">${roles.map((r) => `<span class="chip">${escapeHtml(r.roleName)}</span>`).join('')}</div>
        <div class="actions">
          <button class="tiny secondary" data-edit-template="${template.templateId}">Edit</button>
          <button class="tiny danger" data-deactivate-template="${template.templateId}">Deactivate</button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-edit-template]').forEach((button) => {
    button.addEventListener('click', () => {
      const template = dashboardData.templates.find((item) => item.templateId === button.dataset.editTemplate);
      document.getElementById('template-id').value = template.templateId;
      document.getElementById('template-name').value = template.templateName;
      document.getElementById('template-day').value = template.dayOfWeek;
      document.getElementById('template-start').value = normalizeTimeForInput(template.startTime);
      document.getElementById('template-end').value = normalizeTimeForInput(template.endTime);
      document.getElementById('template-description').value = template.description;
      templateRoles = JSON.parse(template.rolesJson || '[]');
      renderTemplateRoles();
    });
  });

  list.querySelectorAll('[data-deactivate-template]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api.deactivateTemplate({ adminId: session.adminId, templateId: button.dataset.deactivateTemplate });
      await loadDashboardData();
    });
  });
}

function renderEvents() {
  const activeList = document.getElementById('active-events-list');
  const archivedList = document.getElementById('archived-events-list');
  const active = dashboardData.events.filter((eventData) => eventData.status === 'active');
  const archived = dashboardData.events.filter((eventData) => eventData.status !== 'active');

  const cardHtml = (eventData) => `
    <div class="event-card">
      <strong>${escapeHtml(eventData.eventName)}</strong>
      <div class="event-meta">${formatDateTime(eventData.eventDate, eventData.startTime, eventData.endTime)}</div>
      <div class="small muted">${eventData.filledSlots}/${eventData.totalSlots} filled · ${escapeHtml(eventData.status)}</div>
      <div class="actions">
        <button class="tiny secondary" data-edit-event="${eventData.eventId}">Edit</button>
        ${eventData.status === 'active' ? `<button class="tiny danger" data-archive-event="${eventData.eventId}">Archive</button>` : ''}
      </div>
    </div>
  `;

  activeList.innerHTML = active.length ? active.map(cardHtml).join('') : '<p class="muted">No active events.</p>';
  archivedList.innerHTML = archived.length ? archived.map(cardHtml).join('') : '<p class="muted">No archived events.</p>';

  document.querySelectorAll('[data-edit-event]').forEach((button) => {
    button.addEventListener('click', () => {
      const eventData = dashboardData.events.find((item) => item.eventId === button.dataset.editEvent);
      document.getElementById('event-id').value = eventData.eventId;
      document.getElementById('event-name').value = eventData.eventName;
      document.getElementById('event-date').value = normalizeDateForInput(eventData.eventDate);
      document.getElementById('event-start').value = normalizeTimeForInput(eventData.startTime);
      document.getElementById('event-end').value = normalizeTimeForInput(eventData.endTime);
      document.getElementById('event-template').value = eventData.templateId || '';
      eventRoles = JSON.parse(eventData.rolesSnapshotJson || '[]');
      renderEventRoles();
    });
  });

  document.querySelectorAll('[data-archive-event]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api.archiveEvent({ adminId: session.adminId, eventId: button.dataset.archiveEvent });
      await loadDashboardData();
    });
  });
}

function renderAdmins() {
  const list = document.getElementById('admins-list');
  list.innerHTML = dashboardData.admins.map((admin) => `
    <div class="event-card">
      <strong>${escapeHtml(admin.displayName)}</strong>
      <div class="event-meta">${escapeHtml(admin.username)} · ${escapeHtml(admin.email)}</div>
      <div class="small muted">${admin.active ? 'Active' : 'Inactive'}</div>
      <div class="actions">
        <button class="tiny secondary" data-edit-admin="${admin.adminId}">Edit</button>
        ${admin.active ? `<button class="tiny danger" data-deactivate-admin="${admin.adminId}">Deactivate</button>` : ''}
      </div>
    </div>
  `).join('') || '<p class="muted">No admins.</p>';

  list.querySelectorAll('[data-edit-admin]').forEach((button) => {
    button.addEventListener('click', () => {
      const admin = dashboardData.admins.find((item) => item.adminId === button.dataset.editAdmin);
      document.getElementById('managed-admin-id').value = admin.adminId;
      document.getElementById('managed-admin-display').value = admin.displayName;
      document.getElementById('managed-admin-username').value = admin.username;
      document.getElementById('managed-admin-email').value = admin.email;
      document.getElementById('managed-admin-password').value = '';
      document.getElementById('managed-admin-notes').value = admin.notes || '';
    });
  });

  list.querySelectorAll('[data-deactivate-admin]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api.deactivateAdmin({ requesterAdminId: session.adminId, adminId: button.dataset.deactivateAdmin });
      await loadDashboardData();
    });
  });
}


function renderUsers() {
  const list = document.getElementById('users-list');
  if (!list) return;
  list.innerHTML = dashboardData.users.map((user) => {
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown User';
    return `
      <div class="event-card">
        <strong>${escapeHtml(fullName)}</strong>
        <div class="event-meta">${escapeHtml(user.phoneRaw || '')}</div>
        <div class="small muted">${user.active ? 'Active' : 'Inactive'}</div>
      </div>
    `;
  }).join('') || '<p class="muted">No users.</p>';
}
