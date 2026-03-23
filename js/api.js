import { CONFIG } from './config.js';

async function request(action, payload = {}) {
  if (!CONFIG.apiBaseUrl || CONFIG.apiBaseUrl.includes('PASTE_YOUR')) {
    throw new Error('Set your Apps Script web app URL in js/config.js first.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

  try {
    const response = await fetch(CONFIG.apiBaseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data.data;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  createOrFindUser(input) {
    return request('createOrFindUser', input);
  },
  getUserAssignments(userId) {
    return request('getUserAssignments', { userId });
  },
  getActiveEvents(userId) {
    return request('getActiveEvents', { userId });
  },
  getEventAvailableRoles(eventId, userId) {
    return request('getEventAvailableRoles', { eventId, userId });
  },
  assignUserToRole(input) {
    return request('assignUserToRole', input);
  },
  removeUserAssignment(input) {
    return request('removeUserAssignment', input);
  },
  changeUserAssignment(input) {
    return request('changeUserAssignment', input);
  },
  adminLogin(input) {
    return request('adminLogin', input);
  },
  getAdminDashboardData(adminId) {
    return request('getAdminDashboardData', { adminId });
  },
  createTemplate(input) {
    return request('createTemplate', input);
  },
  updateTemplate(input) {
    return request('updateTemplate', input);
  },
  deactivateTemplate(input) {
    return request('deactivateTemplate', input);
  },
  createEvent(input) {
    return request('createEvent', input);
  },
  updateEvent(input) {
    return request('updateEvent', input);
  },
  archiveEvent(input) {
    return request('archiveEvent', input);
  },
  getEventAssignments(input) {
    return request('getEventAssignments', input);
  },
  adminRemoveAssignment(input) {
    return request('adminRemoveAssignment', input);
  },
  adminReassignAssignment(input) {
    return request('adminReassignAssignment', input);
  },
  createAdmin(input) {
    return request('createAdmin', input);
  },
  updateAdmin(input) {
    return request('updateAdmin', input);
  },
  deactivateAdmin(input) {
    return request('deactivateAdmin', input);
  }
};
