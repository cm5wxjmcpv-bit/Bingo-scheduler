import { CONFIG } from './config.js';

async function request(action, payload = {}) {
  if (!CONFIG.apiBaseUrl || CONFIG.apiBaseUrl.includes('PASTE_YOUR')) {
    throw new Error('Set your Apps Script web app URL in js/config.js first.');
  }

  const timeoutMs = Number(CONFIG.requestTimeoutMs) || 60000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`The server took longer than ${Math.round(timeoutMs / 1000)} seconds to answer. The change may still have saved. Tap Refresh before trying again.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  createOrFindUser(input) {
    return request('createOrFindUser', input);
  },
  createOrFindUserWithData(input) {
    return request('createOrFindUserWithData', input);
  },
  getUserHomeData(userId) {
    return request('getUserHomeData', { userId });
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
  adminAssignUserToRole(input) {
    return request('adminAssignUserToRole', input);
  },
  createAdmin(input) {
    return request('createAdmin', input);
  },
  updateAdmin(input) {
    return request('updateAdmin', input);
  },
  deactivateAdmin(input) {
    return request('deactivateAdmin', input);
  },
  createUserAdmin(input) {
    return request('createUserAdmin', input);
  },
  updateUserAdmin(input) {
    return request('updateUserAdmin', input);
  },
  deactivateUserAdmin(input) {
    return request('deactivateUserAdmin', input);
  },
  reactivateUserAdmin(input) {
    return request('reactivateUserAdmin', input);
  }
};
