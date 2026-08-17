(() => {
  'use strict';

  if (window.ExportMcaIcons) return;

  const paths = Object.freeze({
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    operations: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 5V3h8v2M3 10h18M9 14h6"/>',
    clients: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    containerAdd: '<path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/><path d="M18 11v6M15 14h6"/>',
    tracking: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    files: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    publications: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9M13 13h4M13 17h4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    workers: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 11h5M19.5 8.5v5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 8.92 4a1.65 1.65 0 0 0 1-1.51V2h4v.09A1.65 1.65 0 0 0 15 3.6a1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 8c.12.38.35.72.66.97.31.25.7.39 1.1.39H21v4h-.09c-.4 0-.79.14-1.1.39-.31.25-.54.59-.66.97Z"/>',
    admin: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><circle cx="12" cy="10" r="2.5"/><path d="M8.5 16a4 4 0 0 1 7 0"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>'
  });

  const labelIcons = Object.freeze({
    'Inicio': 'home', 'Operaciones': 'operations', 'Clientes': 'clients',
    'Registrar contenedor': 'containerAdd', 'Tracking': 'tracking',
    'Expedientes de exportación': 'files', 'Expedientes': 'files',
    'Publicaciones comerciales': 'publications', 'Notificaciones': 'bell',
    'Centro de alertas': 'bell', 'Trabajadores': 'workers',
    'Administración': 'settings', 'Administradores': 'admin',
    'Cambiar contraseña': 'key', 'Cerrar sesión': 'logout'
  });

  function svg(name, className = 'ui-icon-svg') {
    const body = paths[name] || paths.files;
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  function ensureStyles() {
    if (document.getElementById('exportMcaIconStyles')) return;
    const style = document.createElement('style');
    style.id = 'exportMcaIconStyles';
    style.textContent = `
      .ui-icon-svg{width:19px;height:19px;display:block;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
      .nav-icon .ui-icon-svg{width:19px;height:19px}
      .nav-group-btn .nav-chevron .ui-icon-svg{width:15px;height:15px}
      .menu-btn>.ui-icon-svg{width:21px;height:21px;margin:auto}
      .alert-bell{color:var(--navy)!important}
      .alert-bell>.ui-icon-svg{width:20px;height:20px;color:var(--navy)!important;stroke:var(--navy)!important}
      body.sidebar-collapsed .sidebar-nav .nav-icon .ui-icon-svg{width:21px;height:21px}
    `;
    document.head.appendChild(style);
  }

  function replaceControlIcon(control, name) {
    if (!control || !name) return;
    const icon = control.querySelector('.nav-icon');
    if (!icon) return;
    const hasCorrectSvg = icon.dataset.iconName === name && icon.querySelector('svg.ui-icon-svg');
    if (!hasCorrectSvg) {
      icon.innerHTML = svg(name);
      icon.dataset.iconName = name;
    }
  }

  function hydrateNavigation(root = document) {
    root.querySelectorAll?.('[data-nav-label]').forEach(control => replaceControlIcon(control, labelIcons[control.dataset.navLabel]));
    root.querySelectorAll?.('.nav-chevron').forEach(chevron => {
      if (chevron.dataset.iconName === 'chevron' && chevron.querySelector('svg.ui-icon-svg')) return;
      chevron.innerHTML = svg('chevron'); chevron.dataset.iconName = 'chevron';
    });
  }

  function hydrateMenuButtons(root = document) {
    ['sidebarToggle', 'mobileMenuBtn'].forEach(id => {
      const button = root.getElementById?.(id) || document.getElementById(id);
      if (!button || (button.dataset.iconName === 'menu' && button.querySelector('svg.ui-icon-svg'))) return;
      button.innerHTML = svg('menu'); button.dataset.iconName = 'menu';
    });
  }

  function hydrateBell(root = document) {
    const button = root.getElementById?.('operationalAlertBell') || document.getElementById('operationalAlertBell');
    if (!button || (button.dataset.iconName === 'bell' && button.querySelector('svg.ui-icon-svg'))) return;
    [...button.childNodes].forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) node.remove();
      else if (node.nodeType === Node.ELEMENT_NODE && node.id !== 'operationalAlertBadge') node.remove();
    });
    button.insertAdjacentHTML('afterbegin', svg('bell')); button.dataset.iconName = 'bell';
  }

  function hydrate(root = document) { ensureStyles(); hydrateNavigation(root); hydrateMenuButtons(root); hydrateBell(root); }
  let scheduled = false;
  function scheduleHydrate() { if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; hydrate(document); }); }
  const observer = new MutationObserver(scheduleHydrate);
  function mount() { hydrate(document); observer.observe(document.body, { childList: true, subtree: true }); }
  window.ExportMcaIcons = Object.freeze({ svg, hydrate, owner: 'ui-icon-system.js' });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
