import { api } from './api.js';
import { CONFIG } from './config.js';
import { clearStorage, escapeHtml, formatDateTime, loadStorage, setMessage } from './utils.js';

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

let state = { events: [], assignments: [], selectedEvent: null };

document.getElementById('logout-btn')?.addEventListener('click', () => {
  clearStorage(CONFIG.storageKeys.userSession);
  window.location.href = './index.html';
});

document.getElementById('refresh-btn')?.addEventListener('click', refreshAll);

async function refreshAll() {
  try {
    const [assignmentsData, eventsData] = await Promise.all([
      api.getUserAssignments(session.userId),
      api.getActiveEvents(session.userId)
    ]);
    state.assignments = assignmentsData.assignments;
    state.events = eventsData.events;
    renderAssignments();
    renderEvents();
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
    return;
  }
  eventsListEl.innerHTML = state.events.map((eventData) => `
    <button type="button" class="event-card selectable-event ${state.selectedEvent?.event?.eventId === eventData.eventId ? 'is-selected' : ''}" data-event-id="${eventData.eventId}">
      <strong>${escapeHtml(eventData.eventName)}</strong>
      <div class="event-meta">${formatDateTime(eventData.eventDate, eventData.startTime, eventData.endTime)}</div>
      <div class="small muted">${eventData.filledSlots}/${eventData.totalSlots} filled</div>
    </button>
  `).join('');

  eventsListEl.querySelectorAll('[data-event-id]').forEach((button) => {
    button.addEventListener('click', () => openEventDetails(button.dataset.eventId));
  });
}

async function openEventDetails(eventId) {
  try {
    const data = await api.getEventAvailableRoles(eventId, session.userId);
    state.selectedEvent = data;
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
            <button class="tiny" data-signup-slot="${role.roleSlotId}">Sign Up</button>
          </div>
        </div>
      `).join('')
      : '<p class="muted">No open roles.</p>';

    eventRolesEl.querySelectorAll('[data-signup-slot]').forEach((button) => {
      button.addEventListener('click', () => assignOrChangeRole(eventId, button.dataset.signupSlot));
    });
  } catch (error) {
    setMessage(detailMessageEl, error.message || 'Failed to load event', 'error');
  }
}

async function assignOrChangeRole(eventId, roleSlotId) {
  try {
    setMessage(detailMessageEl, 'Saving...', 'info');
    if (state.selectedEvent?.currentAssignment) {
      await api.changeUserAssignment({
        userId: session.userId,
        eventId,
        fromAssignmentId: state.selectedEvent.currentAssignment.assignmentId,
        toRoleSlotId: roleSlotId
      });
    } else {
      await api.assignUserToRole({ userId: session.userId, eventId, roleSlotId });
    }
    setMessage(detailMessageEl, 'Saved.', 'success');
    await refreshAll();
    await openEventDetails(eventId);
  } catch (error) {
    setMessage(detailMessageEl, error.message || 'Unable to save', 'error');
  }
}

async function removeAssignment(assignmentId) {
  try {
    await api.removeUserAssignment({ userId: session.userId, assignmentId });
    await refreshAll();
    if (state.selectedEvent) {
      await openEventDetails(state.selectedEvent.event.eventId);
    }
  } catch (error) {
    setMessage(detailMessageEl, error.message || 'Failed to remove', 'error');
  }
}

refreshAll();
