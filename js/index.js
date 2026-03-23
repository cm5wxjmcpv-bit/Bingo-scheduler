import { api } from './api.js';
import { CONFIG } from './config.js';
import { makeIdentityKey, normalizeName, normalizePhone, saveStorage, setMessage } from './utils.js';

const form = document.getElementById('entry-form');
const messageEl = document.getElementById('entry-message');

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const firstName = form.firstName.value;
  const lastName = form.lastName.value;
  const phone = form.phone.value;

  if (!normalizeName(firstName) || !normalizeName(lastName) || !normalizePhone(phone)) {
    setMessage(messageEl, 'Please fill in all fields with valid values.', 'error');
    return;
  }

  try {
    setMessage(messageEl, 'Signing in...', 'info');
    const data = await api.createOrFindUser({ firstName, lastName, phoneRaw: phone });
    saveStorage(CONFIG.storageKeys.userSession, {
      userId: data.userId,
      identityKey: makeIdentityKey(firstName, lastName, phone),
      firstName: data.firstName,
      lastName: data.lastName
    });
    setMessage(messageEl, 'Success. Redirecting...', 'success');
    window.location.href = './events.html';
  } catch (error) {
    setMessage(messageEl, error.message || 'Unable to sign in.', 'error');
  }
});
