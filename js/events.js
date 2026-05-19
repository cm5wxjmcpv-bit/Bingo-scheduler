import { api } from './api.js';
import { CONFIG } from './config.js';
import { clearStorage, escapeHtml, formatDateTime, loadStorage, saveStorage, setMessage } from './utils.js';

const session = loadStorage(CONFIG.storageKeys.userSession);
if (!session?.userId) {
  window.location.href = './index.html';
}

const mySignupsEl = document.getElementById('my-signups');
const eventsListEl = document.getElementById('events-list');
const eventDetailEl = document.getElementById('event-detail');
const eventTitleEl = document.getElementById('event-title');
const eventMetaEl = document.getElementById('event-meta');
const eventRolesEl = document.getElementById('event-roles');
const eventCurrentAssignmentEl = document.getElementById('event-current-assignment');
const detailMessageEl = document.getElementById('detail-message');

let state = {
  events: session.prefetchedHomeData?.events || [],
  assignments: session.prefetchedHomeData?.assignments || [],
  selectedEventId: null
};

function saveSessionHomeData(homeData) {
  const currentSession = loadStorage(CONFIG.storageKeys.userSession) || session;
  saveStorage(CONFIG.storageKeys.userSession, {
    ...currentSession,
    prefetchedHomeData: {
      assignments: homeData.assignments || [],
      events: homeData.events || [],
      loadedAt: homeData.loadedAt || new Date().toISOString()
    }
  });
}

function applyHomeData(homeData) {
  state.assignments = homeData.assignments || [];
  state.events = homeData.events || [];
  saveSessionHomeData(homeData);
  renderAssignments();
  renderEvents();
  if (state.selectedEventId) {
    openEventDetails(state.selectedEventId);
  }
}

document.getElementById('logout-btn')?.addEventListener('click', () => {
  clearStorage(CONFIG.storageKeys.userSession);
  window.location.href = './index.html';
});

document.getElementById('refresh-btn')?.addEventListener('click', refreshAll);

async function refreshAll() {
  try {
    setMessage(detailMessageEl, 'Refreshing...', 'info');
    const homeData = await api.getUserHomeData(session.userId);
    applyHomeData(homeData);
    setMessage(detailMessageEl, '', 'info');
  } catch (error) {
    setMessage(detailMessageEl, error.message || 'Failed to load data', 'error');
  }
}

function renderAssignments() {
  if (!state.assignments.length) {
    mySignupsEl.innerHTML = '<p class="muted">No current sign-ups.</p>';
    return;
  }
  mySignupsEl.innerHTML = state.assignments.map((a) => `
    <div class="event-card">
      <strong>${escapeHtml(a.eventName)}</strong>
      <div class="event-meta">${formatDateTime(a.eventDate, a.startTime, a.endTime)}</div>
      <div class="actions">
        <span class="chip">${escapeHtml(a.roleName)}</span>
        <button class="tiny danger" data-remove-assignment="${a.assignmentId}">Remove</button>
      </div>
    </div>
  `).join('');

  mySignupsEl.querySelectorAll('[data-remove-assignment]').forEach((button) => {
    button.addEventListener('click', () => removeAssignment(button.dataset.removeAssignment));
  });
}

function renderEvents() {
  if (!state.events.length) {
    eventsListEl.innerHTML = '<p class="muted">No active events.</p>';
    eventDetailEl.classList.add('hidden');
    return;
  }
  eventsListEl.innerHTML = state.events.map((eventData) => `
    <button type="button" class="event-card selectable-event ${state.selectedEventId === eventData.eventId ? 'is-selected' : ''}" data-event-id="${eventData.eventId}">
      <strong>${escapeHtml(eventData.eventName)}</strong>
      <div class="event-meta">${formatDateTime(eventData.eventDate, eventData.startTime, eventData.endTime)}</div>
      <div class="small muted">${eventData.filledSlots}/${eventData.totalSlots} filled</div>
    </button>
  `).join('');

  eventsListEl.querySelectorAll('[data-event-id]').forEach((button) => {
    button.addEventListener('click', () => openEventDetails(button.dataset.eventId));
  });
}

function getLocalEventDetail(eventId) {
  const eventData = state.events.find((eventItem) => eventItem.eventId === eventId);
  if (!eventData) return null;

  const activeAssignments = eventData.activeAssignments || [];
  const takenSlotIds = activeAssignments.map((assignment) => assignment.roleSlotId);
  const currentAssignment = activeAssignments.find((assignment) => assignment.userId === session.userId) || null;
  const roles = eventData.roles || [];
  const availableRoles = roles.filter((role) => !takenSlotIds.includes(role.roleSlotId) || currentAssignment?.roleSlotId === role.roleSlotId);

  return {
    event: eventData,
    availableRoles,
    currentAssignment
  };
}

function openEventDetails(eventId) {
  const data = getLocalEventDetail(eventId);
  if (!data) {
    setMessage(detailMessageEl, 'Event not found. Try refresh.', 'error');
    return;
  }

  state.selectedEventId = eventId;
  eventsListEl.querySelectorAll('[data-event-id]').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.eventId === eventId);
  });
  eventDetailEl.classList.remove('hidden');
  eventTitleEl.textContent = data.event.eventName;
  eventMetaEl.textContent = formatDateTime(data.event.eventDate, data.event.startTime, data.event.endTime);
  eventCurrentAssignmentEl.textContent = data.currentAssignment
    ? `Current role: ${data.currentAssignment.roleName}`
    : 'No current role selected for this event.';

  eventRolesEl.innerHTML = data.availableRoles.length
    ? data.availableRoles.map((role) => `
      <div class="event-card">
        <div class="inline" style="justify-content:space-between;">
          <span>${escapeHtml(role.roleName)}</span>
          ${data.currentAssignment?.roleSlotId === role.roleSlotId
            ? '<span class="chip">Selected</span>'
            : `<button class="tiny" data-signup-slot="${role.roleSlotId}">Sign Up</button>`}
        </div>
      </div>
    `).join('')
    : '<p class="muted">No open roles.</p>';

  eventRolesEl.querySelectorAll('[data-signup-slot]').forEach((button) => {
    button.addEventListener('click', () => assignOrChangeRole(eventId, button.dataset.signupSlot));
  });
}

async function assignOrChangeRole(eventId, roleSlotId) {
  const detail = getLocalEventDetail(eventId);
  const buttons = eventRolesEl.querySelectorAll('button');

  try {
    buttons.forEach((button) => button.disabled = true);
    setMessage(detailMessageEl, 'Saving...', 'info');

    const homeData = detail?.currentAssignment
      ? await api.changeUserAssignment({
          userId: session.userId,
          eventId,
          fromAssignmentId: detail.currentAssignment.assignmentId,
          toRoleSlotId: roleSlotId
        })
      : await api.assignUserToRole({ userId: session.userId, eventId, roleSlotId });

    applyHomeData(homeData);
    setMessage(detailMessageEl, 'Saved.', 'success');
  } catch (error) {
    buttons.forEach((button) => button.disabled = false);
    setMessage(detailMessageEl, error.message || 'Unable to save', 'error');
  }
}

async function removeAssignment(assignmentId) {
  try {
    setMessage(detailMessageEl, 'Removing...', 'info');
    const homeData = await api.removeUserAssignment({ userId: session.userId, assignmentId });
    applyHomeData(homeData);
    setMessage(detailMessageEl, 'Removed.', 'success');
  } catch (error) {
    setMessage(detailMessageEl, error.message || 'Failed to remove', 'error');
  }
}

if (state.events.length || state.assignments.length) {
  renderAssignments();
  renderEvents();
} else {
  refreshAll();
}
