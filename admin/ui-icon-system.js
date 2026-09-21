(() => {
  'use strict';

  if (window.ExportMcaIcons) return;

  const paths = Object.freeze({
    home: '<g class="ui-icon-tone"><path d="M4 10 12 3l8 7v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/></g><path d="m2.5 10.5 8.2-7.2a2 2 0 0 1 2.6 0l8.2 7.2M4 9.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9.5M9 21v-6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 15v6"/>',
    tasks: '<g class="ui-icon-tone"><rect x="4" y="4.5" width="16" height="17" rx="3"/></g><rect x="4" y="4.5" width="16" height="17" rx="3"/><rect x="8.5" y="2.5" width="7" height="4" rx="1.5"/><path d="m7.5 14 2.5 2.5 6-6"/>',
    commercial: '<g class="ui-icon-tone"><rect x="3" y="7" width="18" height="14" rx="3"/></g><rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12.5a22 22 0 0 0 18 0M10 12v3h4v-3"/>',
    clients: '<g class="ui-icon-tone"><circle cx="9" cy="7.5" r="3.5"/><path d="M3 20v-1a6 6 0 0 1 12 0v1Z"/></g><circle cx="9" cy="7.5" r="3.5"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5 5 0 0 1 3 4.6V20"/>',
    sales: '<g class="ui-icon-tone"><path d="M4 20V16l5-5 4 3 7-8v14Z"/></g><path d="M3 4v14a3 3 0 0 0 3 3h15M6.5 14.5l4-4 4 3L21 6M16 6h5v5"/>',
    invoices: '<g class="ui-icon-tone"><path d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-4 2-4-2-3 2V4a1 1 0 0 1 1-1Z"/></g><path d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-4 2-4-2-3 2V4a1 1 0 0 1 1-1ZM8.5 7.5h7M8.5 11.5h7M8.5 15.5h4"/>',
    publications: '<g class="ui-icon-tone"><path d="M4 9h5l11-5v14L9 13H4Z"/></g><path d="M4 9h5l11-5v14L9 13H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1ZM9 9v4M6 13l1.5 7H11l-2-7"/>',
    operations: '<g class="ui-icon-tone"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></g><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/><path d="M14 6h3a2 2 0 0 1 2 2v2M17 8l2 2 2-2M10 18H7a2 2 0 0 1-2-2v-2M3 16l2-2 2 2"/>',
    purchases: '<g class="ui-icon-tone"><path d="M6 8h15l-2.5 8H8Z"/></g><path d="M3 4h2l3 12h10.5L21 8H6M11 3v5M8.5 5.5 11 8l2.5-2.5"/><circle cx="9.5" cy="20" r="1.2"/><circle cx="18" cy="20" r="1.2"/>',
    warehouse: '<g class="ui-icon-tone"><path d="M3 9 12 3l9 6v12H3Z"/></g><path d="M3 21V9l9-6 9 6v12M2 21h20M7 21V11h10v10M7 15h10M7 18h10"/>',
    inventory: '<g class="ui-icon-tone"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></g><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/><path d="M7.5 4v2M16.5 4v2M7.5 13v2M16.5 13v2"/>',
    loads: '<g class="ui-icon-tone"><path d="M3 5h11v12H3ZM14 10h4l3 4v3h-7Z"/></g><path d="M3 17V5h11v12M3 17h2M9 17h7M20 17h1v-3l-3-4h-4M17 10v4h4"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    tracking: '<g class="ui-icon-tone"><path d="M18 8.5C18 13 12 18 12 18S6 13 6 8.5a6 6 0 1 1 12 0Z"/></g><path d="M18 8.5C18 13 12 18 12 18S6 13 6 8.5a6 6 0 1 1 12 0Z"/><circle cx="12" cy="8.5" r="2"/><path d="M6.5 17.5C4.4 18 3 18.8 3 19.5 3 20.9 7 22 12 22s9-1.1 9-2.5c0-.7-1.4-1.5-3.5-2"/>',
    containerAdd: '<g class="ui-icon-tone"><rect x="2.5" y="6" width="17" height="13" rx="2"/></g><path d="M19.5 10V8a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2H12M7 9.5v6M11 9.5v6M15 9.5v2.5M18 14v7M14.5 17.5h7"/>',
    container: '<g class="ui-icon-tone"><rect x="2.5" y="6" width="19" height="13" rx="2"/></g><rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M7 9.5v6M12 9.5v6M17 9.5v6M5 19v2M19 19v2"/>',
    finance: '<g class="ui-icon-tone"><rect x="3" y="6" width="18" height="14" rx="3"/></g><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 9V6a2 2 0 0 1 1.5-1.9L17 2v4M21 10h-5a3 3 0 0 0 0 6h5"/><circle cx="16.5" cy="13" r="0.6"/>',
    payables: '<g class="ui-icon-tone"><rect x="3" y="4.5" width="18" height="15" rx="3"/></g><path d="M12 19.5H6a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3V10M3 9.5h18M16 14h5v5M21 14l-7 7"/>',
    costs: '<g class="ui-icon-tone"><rect x="5" y="2.5" width="14" height="19" rx="3"/></g><rect x="5" y="2.5" width="14" height="19" rx="3"/><path d="M8.5 7h7M8.5 11.5h1M14.5 11.5h1M8.5 15h1M14.5 15h1M8.5 18.5h1M14.5 18.5h1"/>',
    reports: '<g class="ui-icon-tone"><path d="M6 3h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></g><path d="M6 3h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM15 3v5h5M8 17v-3M12 17v-6M16 17v-4"/>',
    suppliers: '<g class="ui-icon-tone"><path d="M3 9 12 4l9 5v12H3Z"/></g><path d="M3 21V9l9-5 9 5v12M2 21h20M7 21v-7h4v7M15 11h2M15 15h2M7 10h2M12 2v2"/>',
    products: '<g class="ui-icon-tone"><path d="M3 7 12 3l9 4v10l-9 4-9-4Z"/></g><path d="m3 7 9-4 9 4-9 4-9-4ZM3 7v10l9 4 9-4V7M12 11v10M7.5 5 16.5 9v4"/>',
    files: '<g class="ui-icon-tone"><path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></g><path d="M3 10V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v1M3 10h18l-1.5 9a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2Z"/>',
    bell: '<g class="ui-icon-tone"><path d="M6 9a6 6 0 0 1 12 0v4l3 4H3l3-4Z"/></g><path d="M6 9a6 6 0 0 1 12 0v4l2 3a1.3 1.3 0 0 1-1 2H5a1.3 1.3 0 0 1-1-2l2-3ZM10 21h4M12 1.5V3"/>',
    workers: '<g class="ui-icon-tone"><circle cx="8.5" cy="7" r="3"/><path d="M3 20v-1a5.5 5.5 0 0 1 11 0v1Z"/><rect x="15" y="11" width="7" height="9" rx="1.5"/></g><circle cx="8.5" cy="7" r="3"/><path d="M3 20v-1a5.5 5.5 0 0 1 11 0v1"/><rect x="15" y="11" width="7" height="9" rx="1.5"/><path d="M18.5 9v4M17.5 16h2"/>',
    settings: '<g class="ui-icon-tone"><path d="M9 2h6l1 3 3 1 2 5-2 3v4l-5 3-3-1-3 1-5-3v-4l-2-3 2-5 3-1Z"/></g><path d="m9.5 3-.8 2.5-2.5 1-2.3-.5-2 3.5 1.5 2v3l-1.5 2 2 3.5 2.3-.5 2.5 1 .8 2.5h5l.8-2.5 2.5-1 2.3.5 2-3.5-1.5-2v-3l1.5-2-2-3.5-2.3.5-2.5-1L14.5 3Z"/><circle cx="12" cy="13" r="3.2"/>',
    admin: '<g class="ui-icon-tone"><path d="M12 2 21 6v6c0 5-6 9-9 10-3-1-9-5-9-10V6Z"/></g><path d="m12 2 9 4v6c0 5-6 9-9 10-3-1-9-5-9-10V6Z"/><circle cx="12" cy="9" r="2.5"/><path d="M8 16a4.5 4.5 0 0 1 8 0"/>',
    account: '<g class="ui-icon-tone"><circle cx="12" cy="12" r="9"/></g><circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path d="M5.5 18a7 7 0 0 1 13 0"/>',
    key: '<g class="ui-icon-tone"><circle cx="8" cy="8" r="5"/></g><circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9 9M17 17l3-3M14.5 14.5l2-2"/><circle cx="6.5" cy="6.5" r="0.6"/>',
    logout: '<g class="ui-icon-tone"><path d="M12 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h6Z"/></g><path d="M12 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h6M10 12h11M17 8l4 4-4 4"/>',
    menu: '<path d="M4 6.5h16M4 12h12M4 17.5h16"/>',
    chevron: '<path d="m7 9.5 5 5 5-5"/>'
  });

  const tones = Object.freeze({
    home: 'orange',
    tasks: 'violet',
    commercial: 'blue',
    clients: 'blue',
    sales: 'green',
    invoices: 'blue',
    publications: 'blue',
    operations: 'teal',
    purchases: 'violet',
    warehouse: 'teal',
    inventory: 'teal',
    loads: 'teal',
    tracking: 'teal',
    containerAdd: 'teal',
    container: 'teal',
    finance: 'green',
    payables: 'rose',
    costs: 'green',
    reports: 'green',
    suppliers: 'violet',
    products: 'violet',
    files: 'blue',
    bell: 'orange',
    workers: 'violet',
    settings: 'violet',
    admin: 'violet',
    account: 'blue',
    key: 'blue',
    logout: 'rose'
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
    'Recepciones (WR)': 'warehouse',
    'Inventario': 'inventory',
    'Existencias': 'inventory',
    'Logística': 'container',
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
    const tone = tones[name] ? ` data-icon-tone="${tones[name]}"` : '';
    const classes = className === 'ui-icon-svg' ? className : `ui-icon-svg ${className}`;
    return `<svg class="${classes}" data-ui-icon="${name}"${tone} viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
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
