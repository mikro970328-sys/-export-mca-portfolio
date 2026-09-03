'use strict';

const $ = id => document.getElementById(id);
let token = localStorage.getItem('export_mca_token') || '';
let currentUser = null;
let clients = [];
let shipments = [];
let admins = [];
let sessionTransitionPromise = null;
let logoutPromise = null;

try {
  currentUser = JSON.parse(localStorage.getItem('export_mca_user') || 'null');
} catch {
  currentUser = null;
}

window.$ = $;
window.clients = clients;
window.shipments = shipments;
window.admins = admins;

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function localPushCleanup(method) {
  try {
    if (typeof window.NotificationInbox?.[method] === 'function') {
      await window.NotificationInbox[method]();
      return;
    }
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager?.getSubscription?.();
    await subscription?.unsubscribe?.();
    registration.active?.postMessage?.({ type:'EXPORT_MCA_BADGE_CLEAR' });
  } catch {}
}

function clearStoredSession() {
  token = '';
  currentUser = null;
  localStorage.removeItem('export_mca_token');
  localStorage.removeItem('export_mca_user');
}

function transitionExpiredSession(reason = 'expired') {
  if (sessionTransitionPromise) return sessionTransitionPromise;
  clearStoredSession();
  window.dispatchEvent(new CustomEvent('export-mca:auth-invalid', { detail:{ reason } }));
  sessionTransitionPromise = Promise.race([localPushCleanup('deactivatePushForInvalidSession'), wait(1200)])
    .finally(() => location.reload());
  return sessionTransitionPromise;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type':'application/json',
      ...(token ? { Authorization:`Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error((data.error || 'Error') + (data.details ? ` · ${data.details}` : ''));
    error.code = data.code || data.reason_code || null;
    error.status = response.status;
    if (response.status === 401) {
      error.authTransition = true;
      transitionExpiredSession(data.error || 'expired');
    }
    throw error;
  }
  return data;
}

function note(id, text, ok = false) {
  const target = $(id);
  if (!target) return;
  target.textContent = text || '';
  target.className = `msg ${ok ? 'ok' : 'bad'}`;
}

const titles = {
  dashboardSection:'Inicio',
  clientsSection:'Clientes',
  registerContainerSection:'Registrar contenedor',
  containersSection:'Tracking',
  publicationsSection:'Publicaciones comerciales',
  notificationsSection:'Notificaciones',
  workersSection:'Trabajadores',
  adminsSection:'Usuarios y acceso',
  accountSection:'Mi cuenta'
};
window.titles = titles;

function showSection(id) {
  document.querySelectorAll('.app-section').forEach(section => {
    section.classList.toggle('hidden', section.id !== id);
  });
  document.querySelectorAll('[data-section]').forEach(button => {
    button.classList.toggle('active', button.dataset.section === id);
  });
  const pageTitle = $('pageTitle');
  const navigationLabel = [...document.querySelectorAll('[data-section]')]
    .find(button => button.dataset.section === id)?.dataset.navLabel;
  if (pageTitle) pageTitle.textContent = titles[id] || navigationLabel || 'EXPORT MCA';
  if (id === 'notificationsSection' && typeof window.loadNotifications === 'function') {
    window.loadNotifications();
  }
  localStorage.setItem('export_mca_current_section', id);
  window.scrollTo({ top:0 });
  return true;
}

function closeModal() {
  $('modal')?.classList.add('hidden');
  const body = $('modalBody');
  if (body) body.innerHTML = '';
}

function openModal(title, html) {
  const modal = $('modal');
  const heading = $('modalTitle');
  const body = $('modalBody');
  if (!modal || !heading || !body) return false;
  heading.textContent = title || '';
  body.innerHTML = html || '';
  modal.classList.remove('hidden');
  return true;
}

function logoutNow() {
  if (logoutPromise) return logoutPromise;
  window.dispatchEvent(new CustomEvent('export-mca:session-ending', { detail:{ reason:'logout' } }));
  logoutPromise = Promise.race([localPushCleanup('deactivatePushForLogout'), wait(2000)])
    .finally(() => {
      clearStoredSession();
      location.reload();
    });
  return logoutPromise;
}

function bindAdminShell() {
  $('password')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') $('login')?.click();
  });
  document.querySelectorAll('[data-section]').forEach(button => {
    button.addEventListener('click', () => showSection(button.dataset.section));
  });
  $('closeModal')?.addEventListener('click', closeModal);
  $('modal')?.addEventListener('click', event => {
    if (event.target === $('modal')) closeModal();
  });
  $('logout')?.addEventListener('click', logoutNow);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

bindAdminShell();

window.addEventListener?.('storage', event => {
  if (event.key === 'export_mca_token' && !event.newValue && token) transitionExpiredSession('other_tab_logout');
});

window.ExportMcaAdminShellRuntime = Object.freeze({
  owner:'admin-shell-runtime.js',
  showSection,
  openModal,
  closeModal,
  logout:logoutNow,
  transitionExpiredSession
});
