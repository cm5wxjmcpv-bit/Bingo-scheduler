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

  const submitButton = form.querySelector('button[type="submit"]');
  const originalButtonText = submitButton?.textContent || 'Continue';

  try {
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Loading events...';
    }
    setMessage(messageEl, 'Signing in and loading events...', 'info');

    const data = await api.createOrFindUserWithData({ firstName, lastName, phoneRaw: phone });
    saveStorage(CONFIG.storageKeys.userSession, {
      userId: data.user.userId,
      identityKey: makeIdentityKey(firstName, lastName, phone),
      firstName: data.user.firstName,
      lastName: data.user.lastName,
      prefetchedHomeData: {
        assignments: data.assignments || [],
        events: data.events || [],
        loadedAt: data.loadedAt || new Date().toISOString()
      }
    });

    setMessage(messageEl, 'Success. Opening events...', 'success');
    window.location.href = './events.html';
  } catch (error) {
    setMessage(messageEl, error.message || 'Unable to sign in.', 'error');
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
    }
  }
});
