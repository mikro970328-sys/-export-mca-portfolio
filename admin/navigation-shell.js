(() => {
  if (window.__navigationShellInstalled) return;
  window.__navigationShellInstalled = true;

  const byId = id => document.getElementById(id);
  const DESKTOP_QUERY = '(min-width:901px)';
  const COLLAPSE_KEY = 'export_mca_sidebar_collapsed';
  const GROUP_STATE_KEY = 'export_mca_nav_groups';
  const EMBEDDED_OPERATIONS = [
    { id:'warehouseSection', label:'Almacén', icon:'▥', src:'/admin/warehouse.html?embedded=1' },
    { id:'suppliersSection', label:'Proveedores', icon:'◫', src:'/admin/suppliers.html?embedded=1' },
    { id:'purchasesSection', label:'Compras', icon:'▤', src:'/admin/purchases.html?embedded=1' },
    { id:'salesSection', label:'Ventas', icon:'▧', src:'/admin/sales.html?embedded=1' },
    { id:'invoicesSection', label:'Facturación', icon:'▨', src:'/admin/invoices.html?embedded=1' },
    { id:'payablesSection', label:'Cuentas por pagar', icon:'▩', src:'/admin/payables.html?embedded=1' },
    { id:'inventorySection', label:'Inventario', icon:'▦', src:'/admin/inventory.html?embedded=1' },
    { id:'loadsSection', label:'Cargues', icon:'⇄', src:'/admin/loads.html?embedded=1' }
  ];

  const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
  const embeddedById = id => EMBEDDED_OPERATIONS.find(item => item.id === id) || null;

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
    syncActiveGroup();
    closeMobileMenu();
    window.dispatchEvent(new CustomEvent('export-mca:section-changed', { detail:{ id } }));
    return true;
  }

  function openEmbeddedById(id) {
    return openEmbeddedSection(embeddedById(id));
  }

  function ensureEmbeddedOperations() {
    const operations = document.querySelector('.nav-group[data-nav-group="operations"] .submenu');
    const main = document.querySelector('.main-shell main');
    for (const config of EMBEDDED_OPERATIONS) {
      if (operations && !operations.querySelector(`[data-section="${config.id}"]`)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.section = config.id;
        button.dataset.navLabel = config.label;
        button.innerHTML = `<span class="nav-icon" aria-hidden="true">${config.icon}</span><span class="nav-label">${config.label}</span>`;
        button.setAttribute('aria-label', config.label);
        button.title = config.label;
        button.onclick = event => { event.preventDefault(); openEmbeddedSection(config); };
        operations.appendChild(button);
      }
      if (main && !byId(config.id)) {
        const section = document.createElement('section');
        section.id = config.id;
        section.className = 'app-section hidden';
        section.innerHTML = `<iframe src="${config.src}" title="${config.label}" style="width:100%;height:calc(100vh - 120px);min-height:760px;border:0;border-radius:14px;background:#f4f7fb"></iframe>`;
        main.appendChild(section);
      }
    }
    const saved = localStorage.getItem('export_mca_current_section');
    const config = embeddedById(saved);
    if (config) openEmbeddedSection(config);
  }

  function initializeGroups() {
    const state = readGroupState();
    document.querySelectorAll('.nav-group').forEach((group, index) => {
      const saved = state[groupKey(group, index)];
      setGroupOpen(group, typeof saved === 'boolean' ? saved : isDesktop(), false);
    });
    syncActiveGroup();
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

  function syncActiveGroup() {
    document.querySelectorAll('.nav-group').forEach(group => {
      group.classList.toggle('has-active-section', Boolean(group.querySelector('.submenu [data-section].active')));
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

  function mount() {
    const sidebar = byId('sidebar');
    if (!sidebar) return;
    ensureEmbeddedOperations();
    installAccessibleLabels();
    initializeGroups();
    initializeDesktopState();
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('pageshow', () => {
      closeMobileMenu();
      initializeGroups();
      initializeDesktopState();
    });
    window.addEventListener('export-mca:section-changed', () => {
      syncActiveGroup();
      closeMobileMenu();
    });
    window.NavigationShell = Object.freeze({
      collapse: () => setDesktopCollapsed(true),
      expand: () => setDesktopCollapsed(false),
      toggle: toggleShell,
      closeMobile: closeMobileMenu,
      openWarehouse: () => openEmbeddedById('warehouseSection'),
      openSuppliers: () => openEmbeddedById('suppliersSection'),
      openPurchases: () => openEmbeddedById('purchasesSection'),
      openSales: () => openEmbeddedById('salesSection'),
      openInvoices: () => openEmbeddedById('invoicesSection'),
      openPayables: () => openEmbeddedById('payablesSection'),
      openInventory: () => openEmbeddedById('inventorySection'),
      openLoads: () => openEmbeddedById('loadsSection'),
      owner: 'navigation-shell.js'
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})();