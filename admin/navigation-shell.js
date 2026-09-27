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
    { id:'suppliersSection', label:'Proveedores', src:'/admin/suppliers.html?embedded=1&v=20260926-figma2' },
    { id:'productsSection', label:'Productos', src:'/admin/products.html?embedded=1&v=20260926-figma1' },
    { id:'purchasesSection', label:'Compras', src:'/admin/purchases.html?embedded=1&v=20260926-relations2' },
    { id:'salesSection', label:'Ventas', src:'/admin/sales.html?embedded=1&v=20260904-flowclarity1' },
    { id:'invoicesSection', label:'Facturación', src:'/admin/invoices.html?embedded=1&v=20260927-simple1' },
    { id:'payablesSection', label:'Cuentas por pagar', src:'/admin/payables.html?embedded=1&v=20260926-figma1' },
    { id:'costsSection', label:'Costos y rentabilidad', src:'/admin/costs.html?embedded=1&v=20260927-simple1' },
    { id:'reportsSection', label:'Reportes', src:'/admin/reports.html?embedded=1&v=20260926-figma1', permission:'reports.read' },
    { id:'inventorySection', label:'Existencias', src:'/admin/inventory.html?embedded=1&v=20260926-figma1' },
    { id:'loadsSection', label:'Cargues', src:'/admin/loads.html?embedded=1&v=20260926-figma1' }
  ];

  const NAV_GROUPS = [
    { key:'home', label:'Inicio', sections:['dashboardSection','tasksSection'] },
    { key:'commercial', label:'Comercial', sections:['salesSection','clientsSection','publicationsSection'] },
    { key:'purchases', label:'Compras', sections:['purchasesSection','suppliersSection'] },
    { key:'warehouse', label:'Almacén', sections:['warehouseSection','inventorySection','productsSection'] },
    { key:'logistics', label:'Logística', sections:['loadsSection','containersSection','registerContainerSection'] },
    { key:'finance', label:'Finanzas', sections:['invoicesSection','payablesSection','costsSection','reportsSection'] },
    { key:'administration', label:'Administración', sections:['workersSection','adminsSection','accountSection'] },
    { key:'help', label:'Ayuda', sections:['helpSection'] }
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
      if (config.key === 'home' || config.key === 'help') {
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
      const allowed = !button.hid