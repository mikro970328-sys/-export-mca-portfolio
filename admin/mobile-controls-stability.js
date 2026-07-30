(() => {
  if (window.__mobileUiControllerInstalled) return;
  window.__mobileUiControllerInstalled = true;

  const $ = id => document.getElementById(id);
  const isMobile = () => matchMedia('(max-width:900px)').matches;

  const style = document.createElement('style');
  style.textContent = `@media(max-width:900px){
    #mobileMenuBtn,#sidebarToggle,#logout,#operationalAlertBell{pointer-events:auto!important;touch-action:manipulation!important}
    #sidebar{z-index:6000!important}#mobileOverlay{z-index:5900!important}#mobileOverlay.show{display:block!important}
    body.mobile-nav-open{overflow:hidden!important}
    #operationalAlertBellWrap{position:relative!important;overflow:visible!important;z-index:6500!important}
    #operationalAlertPopover{position:fixed!important;left:12px!important;right:12px!important;top:calc(68px + env(safe-area-inset-top))!important;width:auto!important;max-width:none!important;max-height:calc(100dvh - 88px - env(safe-area-inset-top))!important;overflow:hidden!important;z-index:7000!important;background:#fff!important}
    #operationalAlertPopover.hidden{display:none!important}
    #operationalAlertPopover:not(.hidden){display:block!important;visibility:visible!important;opacity:1!important}
    #operationalAlertPopover .alert-popover-list{max-height:calc(100dvh - 205px - env(safe-area-inset-top))!important;overflow:auto!important;-webkit-overflow-scrolling:touch}
  }`;
  document.head.appendChild(style);

  function closeMenu(){
    $('sidebar')?.classList.remove('mobile-open');
    $('mobileOverlay')?.classList.remove('show');
    document.body.classList.remove('mobile-nav-open');
  }

  function toggleMenu(){
    const sidebar=$('sidebar'),overlay=$('mobileOverlay');
    if(!sidebar||!overlay)return;
    const open=sidebar.classList.toggle('mobile-open');
    overlay.classList.toggle('show',open);
    document.body.classList.toggle('mobile-nav-open',open);
  }

  function logout(){
    localStorage.removeItem('export_mca_token');
    localStorage.removeItem('export_mca_user');
    localStorage.removeItem('export_mca_current_section');
    sessionStorage.clear();
    location.href='/admin/';
  }

  function bind(){
    const menu=$('mobileMenuBtn'),inside=$('sidebarToggle'),overlay=$('mobileOverlay'),out=$('logout');
    if(menu)menu.onclick=e=>{if(!isMobile())return;e.preventDefault();toggleMenu()};
    if(inside)inside.onclick=e=>{if(!isMobile())return;e.preventDefault();closeMenu()};
    if(overlay)overlay.onclick=e=>{e.preventDefault();closeMenu()};
    if(out)out.onclick=e=>{e.preventDefault();logout()};
    document.querySelectorAll('#sidebar [data-section]').forEach(button=>{
      if(button.dataset.mobileCloseBound==='1')return;
      button.dataset.mobileCloseBound='1';
      button.addEventListener('click',()=>{if(isMobile())closeMenu()});
    });
  }

  function mount(){
    bind();
    new MutationObserver(bind).observe(document.body,{childList:true,subtree:true});
    addEventListener('resize',()=>{if(!isMobile())closeMenu()});
    addEventListener('pageshow',bind);
  }

  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',mount):mount();
})();