(() => {
  if (window.__navigationShellInstalled) return;
  window.__navigationShellInstalled = true;

  const byId = id => document.getElementById(id);
  const DESKTOP_QUERY = '(min-width:901px)';
  const SIDEBAR_STATE_KEY = 'export_mca_sidebar_collapsed';
  const GROUP_STATE_KEY = 'export_mca_nav_groups';

  const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;

  function readCollapsedState() {
    try { return localStorage.getItem(SIDEBAR_STATE_KEY) === 'true'; }
    catch { return false; }
  }

  function saveCollapsedState(collapsed) {
    try { localStorage.setItem(SIDEBAR_STATE_KEY, String(Boolean(collapsed))); }
    catch {}
  }

  function readGroupState() {
    try { return JSON.parse(localStorage.getItem(GROUP_STATE_KEY) || '{}'); }
    catch { return {}; }
  }

  function groupKey(group, index) {
    return group.querySelector('.nav-group-btn')?.textContent?.trim().toLowerCase().replace(/\s+/g, '-') || `group-${index}`;
  }

  function saveGroupState(group, open) {
    const groups = [...document.querySelectorAll('.nav-group')];
    const index = groups.indexOf(group);
    const state = readGroupState();
    state[groupKey(group, index)] = open;
    try { localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(state)); }
    catch {}
  }

  function closeMobileMenu() {
    byId('sidebar')?.classList.remove('mobile-open');
    byId('mobileOverlay')?.classList.remove('show');
    document.body.classList.remove('mobile-nav-open');
    byId('mobileMenuBtn')?.setAttribute('aria-expanded', 'false');
  }

  function openMobileMenu() {
    byId('sidebar')?.classList.add('mobile-open');
    byId('mobileOverlay')?.classList.add('show');
    document.body.classList.add('mobile-nav-open');
    byId('mobileMenuBtn')?.setAttribute('aria-expanded', 'true');
  }

  function toggleMobileMenu() {
    const open = byId('sidebar')?.classList.contains('mobile-open');
    if (open) closeMobileMenu();
    else openMobileMenu();
  }

  function applyDesktopState(collapsed, { persist = false } = {}) {
    const appShell = byId('appShell');
    const sidebar = byId('sidebar');
    if (!appShell || !sidebar) return;

    appShell.classList.toggle('sidebar-collapsed', collapsed);
    sidebar.classList.toggle('desktop-collapsed', collapsed);
    const toggle = byId('sidebarToggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? 'Expandir menú lateral' : 'Contraer menú lateral');
      toggle.title = collapsed ? 'Expandir menú' : 'Contraer menú';
    }
    if (persist) saveCollapsedState(collapsed);
    window.dispatchEvent(new CustomEvent('export-mca:sidebar-state', { detail: { collapsed } }));
  }

  function toggleDesktopSidebar() {
    const collapsed = !byId('appShell')?.classList.contains('sidebar-collapsed');
    applyDesktopState(collapsed, { persist: true });
  }

  function initializeGroups() {
    const state = readGroupState();
    document.querySelectorAll('.nav-group').forEach((group, index) => {
      const saved = state[groupKey(group, index)];
      const open = typeof saved === 'boolean' ? saved : isDesktop();
      group.classList.toggle('open', open);
      group.querySelector('.nav-group-btn')?.setAttribute('aria-expanded', String(open));
    });
  }

  function toggleGroup(button) {
    const group = button.closest('.nav-group');
    if (!group) return;
    const open = !group.classList.contains('open');
    group.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
    saveGroupState(group, open);
  }

  function syncResponsiveState() {
    if (isDesktop()) {
      closeMobileMenu();
      applyDesktopState(readCollapsedState());
    } else {
      byId('appShell')?.classList.remove('sidebar-collapsed');
      byId('sidebar')?.classList.remove('desktop-collapsed');
      byId('sidebarToggle')?.setAttribute('aria-expanded', 'true');
      closeMobileMenu();
    }
  }

  function installAccessibility() {
    const desktopToggle = byId('sidebarToggle');
    const mobileToggle = byId('mobileMenuBtn');
    [desktopToggle, mobileToggle].forEach(button => {
      if (!button) return;
      button.setAttribute('aria-controls', 'sidebar');
      button.setAttribute('type', 'button');
    });
    mobileToggle?.setAttribute('aria-label', 'Abrir menú lateral');
  }

  document.addEventListener('click', event => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;

    const desktopToggle = element.closest('#sidebarToggle');
    if (desktopToggle) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (isDesktop()) toggleDesktopSidebar();
      else toggleMobileMenu();
      return;
    }

    const mobileToggle = element.closest('#mobileMenuBtn');
    if (mobileToggle) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      toggleMobileMenu();
      return;
    }

    const groupButton = element.closest('.nav-group-btn');
    if (groupButton) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      toggleGroup(groupButton);
      return;
    }

    if (element === byId('mobileOverlay')) {
      event.preventDefault();
      closeMobileMenu();
      return;
    }

    if (!isDesktop() && element.closest('[data-section]')) closeMobileMenu();
  }, true);

  window.addEventListener('export-mca:section-changed', () => {
    if (!isDesktop()) closeMobileMenu();
  });

  window.addEventListener('resize', syncResponsiveState);
  window.addEventListener('pageshow', () => {
    initializeGroups();
    syncResponsiveState();
  });

  installAccessibility();
  initializeGroups();
  syncResponsiveState();

  window.NavigationShell = Object.freeze({
    collapse: () => applyDesktopState(true, { persist: true }),
    expand: () => applyDesktopState(false, { persist: true }),
    toggle: () => isDesktop() ? toggleDesktopSidebar() : toggleMobileMenu(),
    isCollapsed: () => Boolean(byId('appShell')?.classList.contains('sidebar-collapsed')),
    owner: 'navigation-shell.js'
  });
})();
