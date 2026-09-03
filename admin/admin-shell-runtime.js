'use strict';

const $ = id => document.getElementById(id);
let token = localStorage.getItem('export_mca_token') || '';
let currentUser = null;
let clients = [];
let shipments = [];
let admins = [];

try {
  currentUser = JSON.parse(localStorage.getItem('export_mca_user') || 'null');
} catch {
  currentUser = null;
}

window.$ = $;
window.clients = clients;
window.shipments = shipments;
window.admins = admins;

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
  localStorage.removeItem('export_mca_token');
  localStorage.removeItem('export_mca_user');
  location.reload();
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

window.ExportMcaAdminShellRuntime = Object.freeze({
  owner:'admin-shell-runtime.js',
  showSection,
  openModal,
  closeModal,
  logout:logoutNow
});
