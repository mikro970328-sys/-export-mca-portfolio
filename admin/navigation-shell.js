(() => {
  if (window.__navigationShellInstalled) return;
  window.__navigationShellInstalled = true;

  const byId = id => document.getElementById(id);
  const DESKTOP_QUERY = '(min-width:901px)';
  const COLLAPSE_KEY = 'export_mca_sidebar_collapsed';
  const GROUP_STATE_KEY = 'export_mca_nav_groups';
  let searchGroupState = null;

  const EMBEDDED_SECTIONS = [
    { id:'warehouseSection', label:'Recepciones (WR)', src:'/admin/warehouse.html?embedded=1&v=20260926-figma1' },
    { id:'suppliersSection', label:'Proveedores', src:'/admin/suppliers.html?embedded=1' },
    { id:'productsSection', label:'Productos', src:'/admin/products.html?embedded=1' },
    { id:'purchasesSection', label:'Compras', src:'/admin/purchases.html?embedded=1&v=20260925-figma1' },
    { id:'salesSection', label:'Ventas', src:'/admin/sales.html?embedded=1&v=20260904-flowclarity1' },
    { id:'invoicesSection', label:'Facturación', src:'/admin/invoices.html?embedded=1' },
    { id:'payablesSection', label:'Cuentas por pagar', src:'/admin/payables.html?embedded=1' },
    { id:'costsSection', label:'Costos y rentabilidad', src:'/admin/costs.html?embedded=1' },
    { id:'reportsSection', label:'Reportes', src:'/admin/reports.html?embedded=1', permission:'reports.read' },
    { id:'inventorySection', label:'Existencias', src:'/admin/inventory.html?embedded=1&v=20260904-flowclarity1' },
    { id:'loadsSection', label:'Cargues', src:'/admin/loads.html?embedded=1' }
  ];

  const NAV_GROUPS = [
    { key:'home', label:'Inicio', sections:['dashboardSection','tasksSection'] },
    { key:'commercial', label:'Comercial', sections:['salesSection','clientsSection','publicationsSection'] },
    { key:'purchases', label:'Compras', sections:['purchasesSection','suppliersSection'] },
    { key:'warehouse', label:'Almacén', sections:['warehouseSection','inventorySection','productsSection'] },
    { key:'logistics', label:'Logística', sections:['loadsSection','containersSection','registerContainerSection'] },
    { key:'finance', label:'Finanzas', sections:['invoicesSection','payablesSection','costsSection','reportsSection'] },
    { key:'administration', label:'Administración', sections:['workersSection','adminsSection','accountSection'] }
  ];

  const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
  const canEmbedded = config => !config?.permission || window.ExportMcaAccessControl?.can?.(config.permission) !== false;
  const embeddedById = id => EMBEDDED_SECTIONS.find(item => item.id === id && canEmbedded(item)) || null;

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
    if (!config || !canEmbedded(config)) return false;
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

  function createEmbeddedButton(config, staging) {
    if (!canEmbedded(config)) return null;
    let button = document.querySelector(`[data-section="${config.id}"]`);
    if (button) return button;
    button = document.createElement('button');
    button.type = 'button';
    button.dataset.section = config.id;
    button.dataset.navLabel = config.label;
    button.innerHTML = `<span class="nav-icon" aria-hidden="true"></span><span class="nav-label">${config.label}</span>`;
    button.setAttribute('aria-label', config.label);
    button.title = config.label;
    button.onclick = event => { event.preventDefault(); openEmbeddedSection(config); };
    staging?.appendChild(button);
    return button;
  }

  function ensureTasksButton() {
    if (document.querySelector('[data-section="tasksSection"]')) return;
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.section = 'tasksSection';
    button.dataset.navLabel = 'Mis tareas';
    button.innerHTML = '<span class="nav-icon" aria-hidden="true"></span><span class="nav-label">Mis tareas</span>';
    button.setAttribute('aria-label', 'Mis tareas');
    button.title = 'Mis tareas';
    button.classList.toggle('hidden', !window.ExportMcaAccessControl?.can?.('tasks.read'));
    button.onclick = event => { event.preventDefault(); window.showSection?.('tasksSection'); };
    nav.appendChild(button);
  }

  function ensureEmbeddedSections() {
    const staging = document.querySelector('.sidebar-nav');
    const main = document.querySelector('.main-shell main');
    for (const config of EMBEDDED_SECTIONS) {
      if (!canEmbedded(config)) continue;
      createEmbeddedButton(config, staging);
      if (main && !byId(config.id)) {
        const section = document.createElement('section');
        section.id = config.id;
        section.className = 'app-section hidden';
        section.innerHTML = `<iframe class="embedded-workspace-frame" src="${config.src}" title="${config.label}"></iframe>`;
        main.appendChild(section);
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
    group.innerHTML = `<button class="nav-group-btn" type="button" data-nav-label="${config.label}" aria-expanded="false"><span class="nav-icon" aria-hidden="true"></span><span class="nav-label">${config.label}</span><span class="nav-chevron" aria-hidden="true"></span></button><div class="submenu"></div>`;
    return group;
  }

  function buildNavigationHierarchy() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    const sectionButtons = new Map();
    nav.querySelectorAll('[data-section]').forEach(button => sectionButtons.set(button.dataset.section, button));

    const fragment = document.createDocumentFragment();
    for (const config of NAV_GROUPS) {
      if (config.key === 'home') {
        config.sections.forEach(sectionId => {
          const button = sectionButtons.get(sectionId);
          if (!button) return;
          button.classList.add('nav-item');
          fragment.appendChild(button);
        });
        continue;
      }
      const group = makeNavGroup(config);
      const submenu = group.querySelector('.submenu');
      config.sections.forEach(sectionId => {
        const button = normalizeSubmenuButton(sectionButtons.get(sectionId));
        if (button) submenu.appendChild(button);
      });
      fragment.appendChild(group);
    }

    nav.replaceChildren(fragment);
    window.ExportMcaIcons?.hydrate?.(nav);
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
    filterNavigation();
  }

  function normalizeSearch(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
  }

  function filterNavigation() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    const query = normalizeSearch(byId('navigationSearch')?.value);
    const groups = [...nav.querySelectorAll('.nav-group')];
    if (query && !searchGroupState) searchGroupState = new Map(groups.map(group => [group, group.classList.contains('open')]));
    let matches = 0;
    nav.querySelectorAll('[data-section]').forEach(button => {
      const group = button.closest('.nav-group');
      const allowed = !button.hidden && !button.disabled && !button.classList.contains('hidden') && !group?.classList.contains('hidden') && window.ExportMcaAccessControl?.sectionAllowed?.(button.dataset.section) !== false;
      const label = `${button.dataset.navLabel || button.textContent} ${group?.querySelector('.nav-group-btn')?.dataset.navLabel || ''}`;
      const match = allowed && query.split(/\s+/).every(term => normalizeSearch(label).includes(term));
      // Search owns only this class; permission visibility remains with AccessControl.
      button.classList.toggle('nav-search-miss', Boolean(query) && !match);
      if (match) matches++;
    });
    groups.forEach(group => {
      const hasMatch = [...group.querySelectorAll('[data-section]')].some(button => !button.classList.contains('hidden') && !button.classList.contains('nav-search-miss'));
      group.classList.toggle('nav-search-miss', Boolean(query) && !hasMatch);
      if (query && hasMatch) setGroupOpen(group, true, false);
      else if (!query && searchGroupState?.has(group)) setGroupOpen(group, searchGroupState.get(group), false);
    });
    if (!query) {
      searchGroupState = null;
      syncActiveGroup(true);
    }
    const status = byId('navigationSearchStatus');
    if (status) {
      status.hidden = !query;
      status.textContent = query ? (matches ? `${matches} sección(es) disponible(s)` : 'No hay secciones disponibles con ese nombre.') : '';
    }
    const clear = byId('navigationSearchClear');
    if (clear) clear.hidden = !query;
  }

  function clearNavigationSearch() {
    const input = byId('navigationSearch');
    if (input) input.value = '';
    filterNavigation();
  }

  function setDesktopCollapsed(collapsed, persist = true) {
    if (!isDesktop()) {
      document.body.classList.remove('sidebar-collapsed');
      return;
    }
    const next = Boolean(collapsed);
    if (next) clearNavigationSearch();
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
    const activeButton = document.querySelector('.sidebar-nav [data-section].active');
    document.querySelectorAll('.sidebar-nav [data-section]').forEach(button => {
      if (button === activeButton) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const context = byId('pageContext');
    if (context) context.textContent = NAV_GROUPS.find(group => group.sections.includes(activeButton?.dataset.section))?.label || 'Centro de operaciones';
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
    if (event.key !== 'Escape') return;
    if (event.target === byId('navigationSearch') && event.target.value) {
      event.preventDefault();
      clearNavigationSearch();
      return;
    }
    closeMobileMenu();
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
    ensureTasksButton();
    ensureEmbeddedSections();
    buildNavigationHierarchy();
    installAccessibleLabels();
    initializeGroups();
    initializeDesktopState();
    restoreSavedEmbeddedSection();
    byId('navigationSearch')?.addEventListener('input', filterNavigation);
    byId('navigationSearch')?.addEventListener('focus', filterNavigation);
    byId('navigationSearchClear')?.addEventListener('click', () => {
      clearNavigationSearch();
      byId('navigationSearch')?.focus();
    });
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('pageshow', () => {
      closeMobileMenu();
      initializeGroups();
      initializeDesktopState();
    });
    window.addEventListener('export-mca:section-changed', event => {
      if (event.detail?.source !== 'startup') clearNavigationSearch();
      syncActiveGroup(true);
      // Initial route restoration is not a user navigation. Keep an already
      // opened menu while startup selects the permitted section behind it.
      if (event.detail?.source !== 'startup') closeMobileMenu();
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
      openReports: () => openEmbeddedById('reportsSection'),
      openInventory: () => openEmbeddedById('inventorySection'),
      openLoads: () => openEmbeddedById('loadsSection'),
      owner: 'navigation-shell.js'
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})();
