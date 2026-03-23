export function normalizeName(value = '') {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizePhone(value = '') {
  return (value || '').replace(/[^0-9]/g, '');
}

export function makeIdentityKey(firstName, lastName, phone) {
  return `${normalizeName(firstName)}|${normalizeName(lastName)}|${normalizePhone(phone)}`;
}

export function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(dateString, startTime, endTime) {
  return `${formatDate(dateString)} · ${startTime} - ${endTime}`;
}

export function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearStorage(key) {
  localStorage.removeItem(key);
}

export function setMessage(el, text, kind = 'info') {
  if (!el) return;
  el.textContent = text || '';
  el.className = `message ${kind}`;
}

export function escapeHtml(value = '') {
  const str = value == null ? '' : String(value);

  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
