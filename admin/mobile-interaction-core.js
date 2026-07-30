(() => {
  if (window.__mobileInteractionCoreInstalled) return;
  window.__mobileInteractionCoreInstalled = true;

  const byId = id => document.getElementById(id);
  const isMobile = () => window.matchMedia('(max-width:900px)').matches;

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

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('button,a,[role="button"]') : null;
    if (!target) return;

    if (target.id === 'mobileMenuBtn' || target.id === 'sidebarToggle') {
      if (!isMobile()) return;
      event.preventDefault();
      toggleMenu();
      return;
    }

    if (target.id === 'mobileOverlay') {
      event.preventDefault();
      closeMenu();
      return;
    }

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
      }
      if (isMobile()) closeMenu();
      return;
    }

    if (target.matches('.nav-group-btn')) {
      event.preventDefault();
      target.closest('.nav-group')?.classList.toggle('open');
    }
  }, true);

  document.addEventListener('click', event => {
    if (event.target === byId('mobileOverlay')) closeMenu();
  });

  window.addEventListener('resize', () => {
    if (!isMobile()) closeMenu();
  });

  window.addEventListener('pageshow', closeMenu);
})();
