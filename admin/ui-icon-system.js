(() => {
  'use strict';

  if (window.ExportMcaIcons) return;

  const paths = Object.freeze({
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    tasks: '<path d="M9 5h6"/><path d="M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1Z"/><path d="M7 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="m8 13 2 2 5-5"/>',
    commercial: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/>',
    clients: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    sales: '<path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 3 6-7"/><path d="M16 7h4v4"/>',
    invoices: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    publications: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9M13 13h4M13 17h4"/>',
    operations: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/><path d="M10 6.5h2a5.5 5.5 0 0 1 5.5 5.5v2M14 17.5h-2A5.5 5.5 0 0 1 6.5 12v-2"/><path d="m15 12 2.5 2.5L20 12M9 12 6.5 9.5 4 12"/>',
    purchases: '<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M3 4h2l2.4 11.2A2 2 0 0 0 9.35 17H18a2 2 0 0 0 1.9-1.37L22 9H7"/>',
    warehouse: '<path d="m3 10 9-6 9 6v10H3V10Z"/><path d="M7 20v-7h10v7M7 16h10"/>',
    inventory: '<rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/>',
    loads: '<path d="M3 6h11v11H3Z"/><path d="M14 10h4l3 3v4h-7Z"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
    tracking: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    containerAdd: '<path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/><path d="M18 11v6M15 14h6"/>',
    container: '<path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/>',
    finance: '<path d="M4 6h15a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12"/><path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z"/>',
    payables: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M15 15h4M9 14l-2 2 2 2"/>',
    costs: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2"/>',
    reports: '<path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 17v-4M12 17V8M17 17v-7"/>',
    suppliers: '<path d="M3 21V10l6 4v-4l6 4V5h6v16H3Z"/><path d="M17 9h2M17 13h2M7 18h2M12 18h2"/>',
    products: '<path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10M8 5l8 4"/>',
    files: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    workers: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 11h5M19.5 8.5v5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 8.92 4a1.65 1.65 0 0 0 1-1.51V2h4v.09A1.65 1.65 0 0 0 15 3.6a1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 8c.12.38.35.72.66.97.31.25.7.39 1.1.39H21v4h-.09c-.4 0-.79.14-1.1.39-.31.25-.54.59-.66.97Z"/>',
    admin: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><circle cx="12" cy="10" r="2.5"/><path d="M8.5 16a4 4 0 0 1 7 0"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>'
  });

  const labelIcons = Object.freeze({
    'Inicio': 'home',
    'Mis tareas': 'tasks',
    'Centro de alertas': 'bell',
    'Notificaciones': 'bell',
    'Comercial': 'commercial',
    'Clientes': 'clients',
    'Ventas': 'sales',
    'Facturación': 'invoices',
    'Publicaciones comerciales': 'publications',
    'Operaciones': 'operations',
    'Compras': 'purchases',
    'Almacén': 'warehouse',
    'Inventario': 'inventory',
    'Cargues': 'loads',
    'Tracking': 'tracking',
    'Registrar contenedor': 'containerAdd',
    'Expedientes de exportación': 'files',
    'Expedientes': 'files',
    'Finanzas': 'finance',
    'Cuentas por pagar': 'payables',
    'Costos y rentabilidad': 'costs',
    'Reportes': 'reports',
    'Administración': 'settings',
    'Proveedores': 'suppliers',
    'Productos': 'products',
    'Trabajadores': 'workers',
    'Mi cuenta': 'account',
    'Administradores': 'admin',
    'Usuarios y acceso': 'admin',
    'Cambiar contraseña': 'key',
    'Cerrar sesión': 'logout'
  });

  function svg(name, className = 'ui-icon-svg') {
    const body = paths[name];
    if (!body) return '';
    return `<svg class="${className}" data-ui-icon="${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  function matchesWithin(root, selector) {
    const elements = [];
    if (root instanceof Element && root.matches(selector)) elements.push(root);
    root.querySelectorAll?.(selector).forEach(element => elements.push(element));
    return elements;
  }

  function hasIcon(element, name) {
    return Boolean(element?.querySelector(`svg[data-ui-icon="${name}"]`));
  }

  function replaceControlIcon(control, name) {
    const icon = control?.querySelector('.nav-icon');
    if (!icon) return;
    if (!name) {
      icon.replaceChildren();
      icon.dataset.iconMissing = 'true';
      return;
    }
    delete icon.dataset.iconMissing;
    if (hasIcon(icon, name) && icon.childElementCount === 1 && !icon.textContent.trim()) return;
    icon.innerHTML = svg(name);
    icon.dataset.iconName = name;
  }

  function hydrateNavigation(root = document) {
    matchesWithin(root, '[data-nav-label]').forEach(control => {
      replaceControlIcon(control, labelIcons[control.dataset.navLabel]);
    });

    matchesWithin(root, '.nav-chevron').forEach(chevron => {
      if (hasIcon(chevron, 'chevron')) return;
      chevron.innerHTML = svg('chevron');
      chevron.dataset.iconName = 'chevron';
    });
  }

  function hydrateMenuButtons(root = document) {
    ['sidebarToggle', 'mobileMenuBtn'].forEach(id => {
      const button = root.id === id ? root : root.getElementById?.(id) || document.getElementById(id);
      if (!button || hasIcon(button, 'menu')) return;
      button.innerHTML = svg('menu');
      button.dataset.iconName = 'menu';
    });
  }

  function hydrateBell(root = document) {
    const ids = ['operationalAlertBell', 'notificationInboxBell'];
    const badges = new Set(['operationalAlertBadge', 'notificationInboxBadge']);
    const buttons = ids
      .map(id => root.id === id ? root : root.querySelector?.(`#${id}`) || document.getElementById(id))
      .filter((button, index, values) => button && values.indexOf(button) === index);
    buttons.forEach(button => {
      if (hasIcon(button, 'bell')) return;
      [...button.childNodes].forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) node.remove();
        else if (node.nodeType === Node.ELEMENT_NODE && !badges.has(node.id)) node.remove();
      });
      button.insertAdjacentHTML('afterbegin', svg('bell'));
      button.dataset.iconName = 'bell';
    });
  }

  function hydrate(root = document) {
    hydrateNavigation(root);
    hydrateMenuButtons(root);
    hydrateBell(root);
  }

  function mount() {
    hydrate(document);
  }

  window.ExportMcaIcons = Object.freeze({
    svg,
    hydrate,
    owner: 'ui-icon-system.js'
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
