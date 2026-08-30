(() => {
  if (window.__navigationShellInstalled) return;
  window.__navigationShellInstalled = true;

  const byId = id => document.getElementById(id);
  const DESKTOP_QUERY = '(min-width:901px)';
  const COLLAPSE_KEY = 'export_mca_sidebar_collapsed';
  const GROUP_STATE_KEY = 'export_mca_nav_groups';

  const EMBEDDED_SECTIONS = [
    { id:'warehouseSection', label:'Almacén', icon:'▥', src:'/admin/warehouse.html?embedded=1' },
    { id:'suppliersSection', label:'Proveedores', icon:'◫', src:'/admin/suppliers.html?embedded=1' },
    { id:'productsSection', label:'Productos', icon:'◩', src:'/admin/products.html?embedded=1' },
    { id:'purchasesSection', label:'Compras', icon:'▤', src:'/admin/purchases.html?embedded=1' },
    { id:'salesSection', label:'Ventas', icon:'▧', src:'/admin/sales.html?embedded=1' },
    { id:'invoicesSection', label:'Facturación', icon:'▨', src:'/admin/invoices.html?embedded=1' },
    { id:'payablesSection', label:'Cuentas por pagar', icon:'▩', src:'/admin/payables.html?embedded=1' },
    { id:'costsSection', label:'Costos y rentabilidad', icon:'◇', src:'/admin/costs.html?embedded=1' },
    { id:'inventorySection', label:'Inventario', icon:'▦', src:'/admin/inventory.html?embedded=1' },
    { id:'loadsSection', label:'Cargues', icon:'⇄', src:'/admin/loads.html?embedded=1' }
  ];

  const NAV_GROUPS = [
    {
      key:'home',
      label:'Inicio',
      icon:'⌂',
      sections:['dashboardSection','notificationsSection']
    },
    {
      key:'commercial',
      label:'Comercial',
      icon:'▧',
      sections:['clientsSection','salesSection','invoicesSection','publicationsSection']
    },
    {
      key:'operations',
      label:'Operaciones',
      icon:'▣',
      sections:['purchasesSection','warehouseSection','inventorySection','loadsSection','containersSection','newOperationsSection','registerContainerSection']
    },
    {
      key:'finance',
      label:'Finanzas',
      icon:'◇',
      sections:['payablesSection','costsSection']
    },
    {
      key:'administration',
      label:'Administración',
      icon:'◉',
      sections:['suppliersSection','productsSection','workersSection']
    }
  ];

  const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
  const embeddedById = id => EMBEDDED_SECTIONS.find(item => item.id === id) || null;

  function readBoolean(key, fallback = false) {
    const value = localStorage.getItem(key);
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
  }

  function readGroupState() {
    try {
      const value = JSON.parse(localStorage.getItem(GROUP_STATE_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch { return {}; }
  }

  function groupKey(group, index) {
    return group.dataset.navGroup || `group-${index}`;
  }

  function saveGroupState(group, open) {
    const groups = [...document.querySelectorAll('.nav-group')];
    const state = readGroupState();
    state[groupKey(group, groups.indexOf(group))] = Boolean(open);
    localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(state));
  }

  function setGroupOpen(group, open, persist = true) {
    if (!group) return;
    group.classList.toggle('open', Boolean(open));
    group.querySelector('.nav-group-btn')?.setAttribute('aria-expanded', String(Boolean(open)));
    if (persist) saveGroupState(group, Boolean(open));
  }

  function openEmbeddedSection(config) {
    if (!config) return false;
    const id = config.id;
    if (typeof window.showSection === 'function') window.showSection(id);
    else {
      document.querySelectorAll('.app-section').forEach(section => section.classList.toggle('hidden', section.id !== id));
      document.querySelectorAll('[data-section]').forEach(button => button.classList.toggle('active', button.dataset.section === id));
      localStorage.setItem('export_mca_current_section', id);
      window.scrollTo({ top:0 });
    }
    const title = byId('pageTitle');
    if (title) title.textContent = config.label;
    syncActiveGroup(true);
    closeMobileMenu();
    window.dispatchEvent(new CustomEvent('export-mca:section-changed', { detail:{ id } }));
    return true;
  }

  function openEmbeddedById(id) {
    return openEmbeddedSection(embeddedById(id));
  }

  function applyWarehouseCatalogBoundary(frame) {
    try {
      const doc = frame?.contentDocument;
      if (!doc?.body) return;
      const apply = () => {
        const productTab = doc.querySelector('.tab[data-tab="products"]');
        if (productTab) {
          productTab.style.display = 'none';
          productTab.setAttribute('aria-hidden', 'true');
          productTab.tabIndex = -1;
        }
        doc.getElementById('productsPane')?.classList.add('hidden');
        doc.getElementById('quickProductModal')?.classList.add('hidden');
        doc.querySelectorAll('.product-picker button').forEach(button => {
          button.style.display = 'none';
          button.disabled = true;
          button.setAttribute('aria-hidden', 'true');
        });
        doc.querySelectorAll('.muted').forEach(node => {
          if (node.textContent?.includes('Recepciones físicas, productos y ubicaciones.')) node.textContent = 'Recepciones físicas y ubicaciones de almacén.';
          if (node.textContent?.includes('Selecciona un producto existente o créalo aquí')) node.textContent = 'Selecciona un producto existente del catálogo maestro. Los productos se administran en Administración → Productos.';
        });
      };
      apply();
      frame.__warehouseCatalogObserver?.disconnect?.();
      const Observer = frame.contentWindow?.MutationObserver || MutationObserver;
      frame.__warehouseCatalogObserver = new Observer(apply);
      frame.__warehouseCatalogObserver.observe(doc.body, { childList:true, subtree:true });
    } catch (error) {
      console.warn('[navigation-shell] warehouse catalog boundary', error);
    }
  }

  function createEmbeddedButton(config, staging) {
    let button = document.querySelector(`[data-section="${config.id}"]`);
    if (button) return button;
    button = document.createElement('button');
    button.type = 'button';
    button.dataset.section = config.id;
    button.dataset.navLabel = config.label;
    button.innerHTML = `<span class="nav-icon" aria-hidden="true">${config.icon}</span><span class="nav-label">${config.label}</span>`;
    button.setAttribute('aria-label', config.label);
    button.title = config.label;
    button.onclick = event => { event.preventDefault(); openEmbeddedSection(config); };
    staging?.appendChild(button);
    return button;
  }

  function ensureEmbeddedSections() {
    const staging = document.querySelector('.nav-group[data-nav-group="operations"] .submenu') || document.querySelector('.sidebar-nav');
    const main = document.querySelector('.main-shell main');
    for (const config of EMBEDDED_SECTIONS) {
      createEmbeddedButton(config, staging);
      if (main && !byId(config.id)) {
        const section = document.createElement('section');
        section.id = config.id;
        section.className = 'app-section hidden';
        section.innerHTML = `<iframe src="${config.src}" title="${config.label}" style="width:100%;height:calc(100vh - 120px);min-height:760px;border:0;border-radius:14px;background:#f4f7fb"></iframe>`;
        main.appendChild(section);
        const frame = section.querySelector('iframe');
        if (config.id === 'warehouseSection' && frame) frame.addEventListener('load', () => applyWarehouseCatalogBoundary(frame));
      }
    }
  }

  function normalizeSubmenuButton(button) {
    if (!button) return null;
    button.classList.remove('nav-item');
    const label = button.dataset.navLabel || button.querySelector('.nav-label')?.textContent?.trim() || '';
    if (label) {
      button.dataset.navLabel = label;
      button.setAttribute('aria-label', label);
      button.title = label;
    }
    return button;
  }

  function makeNavGroup(config) {
    const group = document.createElement('div');
    group.className = 'nav-group';
    group.dataset.navGroup = config.key;
    group.innerHTML = `<button class="nav-group-btn" type="button" data-nav-label="${config.label}" aria-expanded="false"><span class="nav-icon" aria-hidden="true">${config.icon}</span><span class="nav-label">${config.label}</span><span class="nav-chevron" aria-hidden="true">⌃</span></button><div class="submenu"></div>`;
    return group;
  }

  function buildNavigationHierarchy() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    const legacyAdmin = byId('adminNav');
    const adminButton = legacyAdmin?.querySelector('[data-section="adminsSection"]') || null;
    const sectionButtons = new Map();
    nav.querySelectorAll('[data-section]').forEach(button => sectionButtons.set(button.dataset.section, button));

    const fragment = document.createDocumentFragment();
    for (const config of NAV_GROUPS) {
      const group = makeNavGroup(config);
      const submenu = group.querySelector('.submenu');
      config.sections.forEach(sectionId => {
        const button = normalizeSubmenuButton(sectionButtons.get(sectionId));
        if (button) submenu.appendChild(button);
      });

      if (config.key === 'administration' && adminButton && legacyAdmin && !legacyAdmin.classList.contains('hidden')) {
        submenu.appendChild(normalizeSubmenuButton(adminButton));
      }

      fragment.appendChild(group);
    }

    nav.replaceChildren(fragment);

    if (legacyAdmin) {
      legacyAdmin.classList.remove('nav-group', 'open');
      legacyAdmin.classList.add('nav-role-proxy');
      legacyAdmin.removeAttribute('data-nav-group');
      nav.appendChild(legacyAdmin);
    }
  }

  function initializeGroups() {
    const state = readGroupState();
    document.querySelectorAll('.nav-group').forEach((group, index) => {
      const saved = state[groupKey(group, index)];
      const isActive = Boolean(group.querySelector('.submenu [data-section].active'));
      const defaultOpen = group.dataset.navGroup === 'home' || isActive;
      setGroupOpen(group, typeof saved === 'boolean' ? saved : defaultOpen, false);
    });
    syncActiveGroup(true);
  }

  function setDesktopCollapsed(collapsed, persist = true) {
    if (!isDesktop()) {
      document.body.classList.remove('sidebar-collapsed');
      return;
    }
    const next = Boolean(collapsed);
    document.body.classList.toggle('sidebar-collapsed', next);
    const toggle = byId('sidebarToggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(next));
      toggle.setAttribute('aria-label', next ? 'Expandir menú lateral' : 'Contraer menú lateral');
      toggle.title = next ? 'Expandir menú lateral' : 'Contraer menú lateral';
    }
    if (persist) localStorage.setItem(COLLAPSE_KEY, String(next));
    window.dispatchEvent(new CustomEvent('export-mca:navigation-shell-changed', { detail:{ desktopCollapsed:next } }));
  }

  function initializeDesktopState() {
    setDesktopCollapsed(readBoolean(COLLAPSE_KEY, false), false);
  }

  function openMobileMenu() {
    if (isDesktop()) return;
    byId('sidebar')?.classList.add('mobile-open');
    byId('mobileOverlay')?.classList.add('show');
    document.body.classList.add('mobile-nav-open');
    byId('mobileMenuBtn')?.setAttribute('aria-expanded', 'true');
    byId('mobileMenuBtn')?.setAttribute('aria-label', 'Cerrar menú lateral');
    byId('sidebarToggle')?.setAttribute('aria-label', 'Cerrar menú lateral');
  }

  function closeMobileMenu() {
    byId('sidebar')?.classList.remove('mobile-open');
    byId('mobileOverlay')?.classList.remove('show');
    document.body.classList.remove('mobile-nav-open');
    byId('mobileMenuBtn')?.setAttribute('aria-expanded', 'false');
    if (!isDesktop()) {
      byId('mobileMenuBtn')?.setAttribute('aria-label', 'Abrir menú lateral');
      byId('sidebarToggle')?.setAttribute('aria-label', 'Cerrar menú lateral');
    }
  }

  function toggleShell() {
    if (isDesktop()) return setDesktopCollapsed(!document.body.classList.contains('sidebar-collapsed'));
    const sidebar = byId('sidebar');
    if (sidebar?.classList.contains('mobile-open')) closeMobileMenu();
    else openMobileMenu();
  }

  function toggleGroup(button) {
    const group = button?.closest('.nav-group');
    if (!group) return;
    if (isDesktop() && document.body.classList.contains('sidebar-collapsed')) {
      setDesktopCollapsed(false);
      setGroupOpen(group, true);
      return;
    }
    setGroupOpen(group, !group.classList.contains('open'));
  }

  function syncActiveGroup(openActive = false) {
    document.querySelectorAll('.nav-group').forEach(group => {
      const active = Boolean(group.querySelector('.submenu [data-section].active'));
      group.classList.toggle('has-active-section', active);
      if (active && openActive && !group.classList.contains('open')) setGroupOpen(group, true, false);
    });
  }

  function installAccessibleLabels() {
    const sidebar = byId('sidebar');
    if (!sidebar) return;
    sidebar.querySelectorAll('[data-nav-label]').forEach(control => {
      const label = control.dataset.navLabel;
      if (!label) return;
      if (!control.getAttribute('aria-label')) control.setAttribute('aria-label', label);
      control.title = label;
    });
    byId('mobileMenuBtn')?.setAttribute('aria-label', 'Abrir menú lateral');
    byId('mobileMenuBtn')?.setAttribute('aria-expanded', 'false');
  }

  function handleClick(event) {
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;
    const shellToggle = element.closest('#sidebarToggle,#mobileMenuBtn');
    if (shellToggle) { event.preventDefault(); toggleShell(); return; }
    const groupButton = element.closest('.nav-group-btn');
    if (groupButton) { event.preventDefault(); toggleGroup(groupButton); return; }
    if (element === byId('mobileOverlay')) { event.preventDefault(); closeMobileMenu(); }
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') closeMobileMenu();
  }

  function handleViewportChange() {
    closeMobileMenu();
    initializeDesktopState();
    initializeGroups();
  }

  function restoreSavedEmbeddedSection() {
    const saved = localStorage.getItem('export_mca_current_section');
    const config = embeddedById(saved);
    if (config) openEmbeddedSection(config);
  }

  function mount() {
    const sidebar = byId('sidebar');
    if (!sidebar) return;
    ensureEmbeddedSections();
    buildNavigationHierarchy();
    installAccessibleLabels();
    initializeGroups();
    initializeDesktopState();
    restoreSavedEmbeddedSection();
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('pageshow', () => {
      closeMobileMenu();
      initializeGroups();
      initializeDesktopState();
    });
    window.addEventListener('export-mca:section-changed', () => {
      syncActiveGroup(true);
      closeMobileMenu();
    });
    window.NavigationShell = Object.freeze({
      collapse: () => setDesktopCollapsed(true),
      expand: () => setDesktopCollapsed(false),
      toggle: toggleShell,
      closeMobile: closeMobileMenu,
      openWarehouse: () => openEmbeddedById('warehouseSection'),
      openSuppliers: () => openEmbeddedById('suppliersSection'),
      openProducts: () => openEmbeddedById('productsSection'),
      openPurchases: () => openEmbeddedById('purchasesSection'),
      openSales: () => openEmbeddedById('salesSection'),
      openInvoices: () => openEmbeddedById('invoicesSection'),
      openPayables: () => openEmbeddedById('payablesSection'),
      openCosts: () => openEmbeddedById('costsSection'),
      openInventory: () => openEmbeddedById('inventorySection'),
      openLoads: () => openEmbeddedById('loadsSection'),
      owner: 'navigation-shell.js'
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})();
