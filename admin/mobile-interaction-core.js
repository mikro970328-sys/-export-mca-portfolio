(() => {
  if (window.__mobileInteractionCoreInstalled) return;
  window.__mobileInteractionCoreInstalled = true;

  const byId = id => document.getElementById(id);
  const isMobile = () => window.matchMedia('(max-width:900px)').matches;
  const GROUP_STATE_KEY = 'export_mca_nav_groups';

  const style = document.createElement('style');
  style.id = 'mobileInteractionCoreStyles';
  style.textContent = `
    @media(max-width:900px){
      #mobileOverlay{display:none;pointer-events:none}
      #mobileOverlay.show{display:block;position:fixed;inset:0;background:rgba(0,0,0,.38);z-index:950;pointer-events:auto}
      #sidebar{z-index:1000}
      #mobileMenuBtn,#sidebarToggle,#logout,#operationalAlertBell,.shipment-menu-trigger,[data-section],.nav-group-btn{touch-action:manipulation}
      .modal.hidden,.alert-popover.hidden,.shipment-action-popover:not(.open){display:none!important;pointer-events:none!important}
    }
  `;
  document.head.appendChild(style);

  function closeMenu() {
    byId('sidebar')?.classList.remove('mobile-open');
    byId('mobileOverlay')?.classList.remove('show');
    document.body.classList.remove('mobile-nav-open');
  }

  function toggleMenu() {
    const sidebar = byId('sidebar');
    const overlay = byId('mobileOverlay');
    if (!sidebar || !overlay) return;
    const open = !sidebar.classList.contains('mobile-open');
    sidebar.classList.toggle('mobile-open', open);
    overlay.classList.toggle('show', open);
    document.body.classList.toggle('mobile-nav-open', open);
  }

  function logout() {
    if (typeof window.logoutNow === 'function') {
      window.logoutNow();
      return;
    }
    localStorage.removeItem('export_mca_token');
    localStorage.removeItem('export_mca_user');
    localStorage.removeItem('export_mca_current_section');
    sessionStorage.clear();
    location.replace('/admin/');
  }

  function refreshDashboardAlerts() {
    const target = byId('alerts');
    if (target) {
      target.className = 'dashboard-alert-list';
      target.innerHTML = '<div class="empty-state">Actualizando alertas operativas...</div>';
    }
    if (typeof window.loadOperationalAlerts === 'function') {
      Promise.resolve(window.loadOperationalAlerts()).catch(error => console.error('DASHBOARD_ALERT_REFRESH_ERROR', error));
    } else if (typeof window.loadNotifications === 'function') {
      Promise.resolve(window.loadNotifications()).catch(error => console.error('DASHBOARD_ALERT_REFRESH_ERROR', error));
    } else {
      setTimeout(refreshDashboardAlerts, 250);
    }
  }

  function installLoadAllAlertGuard() {
    if (window.__dashboardAlertLoadAllGuardInstalled || typeof window.loadAll !== 'function') return;
    window.__dashboardAlertLoadAllGuardInstalled = true;
    const originalLoadAll = window.loadAll;
    window.loadAll = async function (...args) {
      const result = await originalLoadAll.apply(this, args);
      queueMicrotask(refreshDashboardAlerts);
      return result;
    };
  }

  function groupKey(group, index) {
    const label = group.querySelector('.nav-group-btn')?.textContent?.trim().toLowerCase().replace(/\s+/g, '-') || `group-${index}`;
    return label;
  }

  function readGroupState() {
    try { return JSON.parse(localStorage.getItem(GROUP_STATE_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveGroupState(group, open) {
    const groups = [...document.querySelectorAll('.nav-group')];
    const index = groups.indexOf(group);
    const state = readGroupState();
    state[groupKey(group, index)] = open;
    localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(state));
  }

  function initializeGroups() {
    const state = readGroupState();
    document.querySelectorAll('.nav-group').forEach((group, index) => {
      const key = groupKey(group, index);
      const saved = state[key];
      const open = typeof saved === 'boolean' ? saved : !isMobile();
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

  document.addEventListener('click', event => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;

    const menuButton = element.closest('#mobileMenuBtn,#sidebarToggle');
    if (menuButton && isMobile()) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      toggleMenu();
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

    const target = element.closest('button,a,[role="button"]');
    if (!target) return;

    if (target.id === 'logout') {
      event.preventDefault();
      logout();
      return;
    }

    if (target.matches('[data-section]')) {
      const section = target.getAttribute('data-section');
      if (section && typeof window.showSection === 'function') {
        event.preventDefault();
        window.showSection(section);
        if (section === 'dashboardSection') queueMicrotask(refreshDashboardAlerts);
      }
      if (isMobile()) closeMenu();
    }
  }, true);

  document.addEventListener('click', event => {
    if (event.target === byId('mobileOverlay')) closeMenu();
  });

  window.addEventListener('resize', () => {
    if (!isMobile()) closeMenu();
  });

  window.addEventListener('pageshow', () => {
    closeMenu();
    initializeGroups();
    installLoadAllAlertGuard();
    queueMicrotask(refreshDashboardAlerts);
  });

  initializeGroups();
  installLoadAllAlertGuard();
})();