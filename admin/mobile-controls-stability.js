(() => {
  if (window.__mobileUiControllerInstalled) return;
  window.__mobileUiControllerInstalled = true;

  const $ = id => document.getElementById(id);
  const isMobile = () => matchMedia('(max-width:900px)').matches;

  const style = document.createElement('style');
  style.id = 'mobileInteractionRecoveryStyles';
  style.textContent = `
    @media(max-width:900px){
      html,body,#appShell,.main-shell,main,.app-section{pointer-events:auto!important}
      button,a,input,select,textarea,[role="button"]{touch-action:manipulation!important;-webkit-tap-highlight-color:rgba(0,0,0,.08)}
      button,a,[role="button"]{pointer-events:auto!important}

      #mobileOverlay{display:none!important;pointer-events:none!important}
      #mobileOverlay.show{display:block!important;pointer-events:auto!important;position:fixed!important;inset:0!important;z-index:5900!important}
      #sidebar{z-index:6000!important}
      body.mobile-nav-open{overflow:hidden!important}

      .modal.hidden,.shipment-action-popover:not(.open),#operationalAlertPopover.hidden{
        display:none!important;
        pointer-events:none!important;
      }
      .modal:not(.hidden),.shipment-action-popover.open,#operationalAlertPopover:not(.hidden){pointer-events:auto!important}

      #operationalAlertBellWrap{position:relative!important;overflow:visible!important;z-index:6500!important}
      #operationalAlertPopover{position:fixed!important;left:12px!important;right:12px!important;top:calc(68px + env(safe-area-inset-top))!important;width:auto!important;max-width:none!important;max-height:calc(100dvh - 88px - env(safe-area-inset-top))!important;overflow:hidden!important;z-index:7000!important;background:#fff!important}
      #operationalAlertPopover .alert-popover-list{max-height:calc(100dvh - 205px - env(safe-area-inset-top))!important;overflow:auto!important;-webkit-overflow-scrolling:touch}
    }
  `;
  document.head.appendChild(style);

  function clearClosedBlockers(){
    const sidebar = $('sidebar');
    const overlay = $('mobileOverlay');
    const menuOpen = !!sidebar?.classList.contains('mobile-open');

    if (overlay && !menuOpen) {
      overlay.classList.remove('show');
      overlay.style.pointerEvents = 'none';
      overlay.style.display = 'none';
    }

    document.querySelectorAll('.shipment-action-popover:not(.open), .modal.hidden, #operationalAlertPopover.hidden').forEach(el => {
      el.style.pointerEvents = 'none';
    });

    document.querySelectorAll('.shipment-action-popover.open, .modal:not(.hidden), #operationalAlertPopover:not(.hidden)').forEach(el => {
      el.style.pointerEvents = 'auto';
    });

    const shell = $('appShell');
    if (shell && !shell.classList.contains('hidden')) shell.style.pointerEvents = 'auto';
  }

  function closeMenu(){
    $('sidebar')?.classList.remove('mobile-open');
    $('mobileOverlay')?.classList.remove('show');
    document.body.classList.remove('mobile-nav-open');
    clearClosedBlockers();
  }

  function toggleMenu(){
    const sidebar=$('sidebar'), overlay=$('mobileOverlay');
    if(!sidebar || !overlay) return;
    const open=sidebar.classList.toggle('mobile-open');
    overlay.classList.toggle('show',open);
    document.body.classList.toggle('mobile-nav-open',open);
    overlay.style.display = open ? 'block' : 'none';
    overlay.style.pointerEvents = open ? 'auto' : 'none';
  }

  function logout(){
    localStorage.removeItem('export_mca_token');
    localStorage.removeItem('export_mca_user');
    localStorage.removeItem('export_mca_current_section');
    sessionStorage.clear();
    location.replace('/admin/');
  }

  function bind(){
    const menu=$('mobileMenuBtn'), inside=$('sidebarToggle'), overlay=$('mobileOverlay'), out=$('logout');

    if(menu) menu.onclick=e=>{ if(!isMobile()) return; e.preventDefault(); toggleMenu(); };
    if(inside) inside.onclick=e=>{ if(!isMobile()) return; e.preventDefault(); closeMenu(); };
    if(overlay) overlay.onclick=e=>{ e.preventDefault(); closeMenu(); };
    if(out) out.onclick=e=>{ e.preventDefault(); logout(); };

    document.querySelectorAll('#sidebar [data-section]').forEach(button=>{
      if(button.dataset.mobileCloseBound==='1') return;
      button.dataset.mobileCloseBound='1';
      button.addEventListener('click',()=>{ if(isMobile()) closeMenu(); });
    });

    clearClosedBlockers();
  }

  function mount(){
    bind();
    const observer = new MutationObserver(() => queueMicrotask(bind));
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    addEventListener('resize',()=>{ if(!isMobile()) closeMenu(); else clearClosedBlockers(); });
    addEventListener('orientationchange',()=>setTimeout(clearClosedBlockers,100));
    addEventListener('pageshow',()=>setTimeout(bind,0));
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) setTimeout(bind,0); });
  }

  document.readyState==='loading' ? document.addEventListener('DOMContentLoaded',mount) : mount();
})();