(() => {
  if (window.__mobileControlsStabilityInstalled) return;
  window.__mobileControlsStabilityInstalled = true;

  const $ = id => document.getElementById(id);
  const isMobile = () => window.matchMedia('(max-width:900px)').matches;

  const style = document.createElement('style');
  style.id = 'mobileControlsStabilityStyles';
  style.textContent = `
    @media(max-width:900px){
      body.mobile-nav-open{overflow:hidden!important;touch-action:none}
      #sidebar{z-index:6000!important;transition:transform .22s ease!important}
      #mobileOverlay{z-index:5900!important}
      #mobileOverlay.show{display:block!important}
      #operationalAlertPopover.mobile-alert-sheet{
        position:fixed!important;
        left:10px!important;
        right:10px!important;
        top:calc(74px + env(safe-area-inset-top))!important;
        bottom:auto!important;
        width:auto!important;
        max-width:none!important;
        max-height:calc(100dvh - 94px - env(safe-area-inset-top))!important;
        overflow:hidden!important;
        display:block!important;
        opacity:1!important;
        visibility:visible!important;
        transform:none!important;
        z-index:7000!important;
        background:#fff!important;
        border-radius:16px!important;
        box-shadow:0 22px 70px rgba(6,32,74,.32)!important;
      }
      #operationalAlertPopover.mobile-alert-sheet .alert-popover-list{
        max-height:calc(100dvh - 205px - env(safe-area-inset-top))!important;
        overflow:auto!important;
        -webkit-overflow-scrolling:touch
      }
      body.mobile-alert-open{overflow:hidden!important}
      .mobile-alert-backdrop{
        position:fixed;inset:0;background:rgba(6,20,42,.38);z-index:6900;display:none
      }
      .mobile-alert-backdrop.show{display:block!important}
      #logout{position:relative!important;z-index:1!important;pointer-events:auto!important}
    }
  `;
  document.head.appendChild(style);

  let alertOpen = false;
  let backdrop = null;

  function ensureBackdrop() {
    if (backdrop?.isConnected) return backdrop;
    backdrop = document.createElement('div');
    backdrop.className = 'mobile-alert-backdrop';
    backdrop.addEventListener('click', closeAlertPanel);
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function openMenu() {
    const sidebar = $('sidebar');
    const overlay = $('mobileOverlay');
    if (!sidebar || !overlay) return;
    sidebar.classList.add('mobile-open');
    overlay.classList.add('show');
    document.body.classList.add('mobile-nav-open');
  }

  function closeMenu() {
    $('sidebar')?.classList.remove('mobile-open');
    $('mobileOverlay')?.classList.remove('show');
    document.body.classList.remove('mobile-nav-open');
  }

  function toggleMenu() {
    const sidebar = $('sidebar');
    if (!sidebar) return;
    sidebar.classList.contains('mobile-open') ? closeMenu() : openMenu();
  }

  function openAlertPanel() {
    const popover = $('operationalAlertPopover');
    const bell = $('operationalAlertBell');
    if (!popover || !bell) return;
    alertOpen = true;
    popover.classList.remove('hidden');
    popover.classList.add('mobile-alert-sheet');
    popover.style.display = 'block';
    ensureBackdrop().classList.add('show');
    document.body.classList.add('mobile-alert-open');
    bell.setAttribute('aria-expanded', 'true');
  }

  function closeAlertPanel() {
    const popover = $('operationalAlertPopover');
    const bell = $('operationalAlertBell');
    alertOpen = false;
    if (popover) {
      popover.classList.add('hidden');
      popover.classList.remove('mobile-alert-sheet');
      popover.style.display = '';
    }
    backdrop?.classList.remove('show');
    document.body.classList.remove('mobile-alert-open');
    bell?.setAttribute('aria-expanded', 'false');
  }

  function toggleAlertPanel() {
    alertOpen ? closeAlertPanel() : openAlertPanel();
  }

  function logoutNowStable() {
    localStorage.removeItem('export_mca_token');
    localStorage.removeItem('export_mca_user');
    sessionStorage.clear();
    window.location.replace('/admin/');
  }

  function bind() {
    const menuButton = $('mobileMenuBtn');
    const sidebarButton = $('sidebarToggle');
    const overlay = $('mobileOverlay');
    const bell = $('operationalAlertBell');
    const logout = $('logout');

    if (menuButton && menuButton.dataset.mobileStable !== '1') {
      menuButton.dataset.mobileStable = '1';
      menuButton.addEventListener('click', event => {
        if (!isMobile()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleMenu();
      }, true);
    }

    if (sidebarButton && sidebarButton.dataset.mobileStable !== '1') {
      sidebarButton.dataset.mobileStable = '1';
      sidebarButton.addEventListener('click', event => {
        if (!isMobile()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeMenu();
      }, true);
    }

    if (overlay && overlay.dataset.mobileStable !== '1') {
      overlay.dataset.mobileStable = '1';
      overlay.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeMenu();
      }, true);
    }

    document.querySelectorAll('#sidebar [data-section]').forEach(button => {
      if (button.dataset.mobileStable === '1') return;
      button.dataset.mobileStable = '1';
      button.addEventListener('click', () => { if (isMobile()) closeMenu(); });
    });

    if (bell && bell.dataset.mobileStable !== '1') {
      bell.dataset.mobileStable = '1';
      bell.addEventListener('click', event => {
        if (!isMobile()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleAlertPanel();
      }, true);
    }

    if (logout && logout.dataset.mobileStable !== '1') {
      logout.dataset.mobileStable = '1';
      logout.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        logoutNowStable();
      }, true);
    }
  }

  function mount() {
    bind();
    const observer = new MutationObserver(bind);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', () => {
      if (!isMobile()) {
        closeMenu();
        closeAlertPanel();
      }
    });
    window.addEventListener('pageshow', bind);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();