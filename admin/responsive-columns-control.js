(() => {
  if (window.__responsiveColumnsControlInstalled) return;
  window.__responsiveColumnsControlInstalled = true;

  const style = document.createElement('style');
  style.textContent = `
    .mca-columns-wrap{display:flex;justify-content:flex-end;align-items:center;margin:10px 0;position:relative}
    .mca-columns-btn{width:auto!important;min-width:0!important;padding:9px 12px!important;border:1px solid #cfd7e3!important;background:#fff!important;color:#06204a!important;border-radius:9px!important;font-size:13px!important;line-height:1!important;display:inline-flex!important;align-items:center!important;gap:7px!important;box-shadow:none!important}
    .mca-columns-btn:hover{background:#f7f9fc!important}
    .mca-columns-btn::before{content:'☷';font-size:16px;line-height:1}
    .mca-columns-panel{position:absolute!important;right:0!important;top:calc(100% + 8px)!important;left:auto!important;width:270px!important;max-width:min(270px,calc(100vw - 32px))!important;max-height:420px!important;overflow:auto!important;background:#fff!important;border:1px solid #dfe5ee!important;border-radius:12px!important;padding:10px!important;box-shadow:0 18px 45px rgba(6,32,74,.18)!important;z-index:1301!important}
    .mca-columns-panel[hidden],.mca-columns-panel.mca-columns-closed{display:none!important}
    .mca-columns-panel label{display:flex!important;align-items:center!important;gap:10px!important;padding:9px 8px!important;margin:0!important;border-radius:8px!important;font-size:14px!important;font-weight:600!important;color:#152238!important}
    .mca-columns-panel label:hover{background:#f4f7fb!important}
    .mca-columns-panel input[type='checkbox']{width:18px!important;height:18px!important;margin:0!important;flex:0 0 auto!important}
    .mca-columns-mobile-head{display:none}
    .mca-columns-backdrop{display:none;position:fixed;inset:0;background:rgba(6,20,42,.38);z-index:1300}
    .mca-columns-backdrop.is-open{display:block}
    body.mca-columns-lock{overflow:hidden}
    @media(max-width:700px){
      .mca-columns-wrap{margin:8px 0 10px}
      .mca-columns-btn{padding:9px 11px!important;font-size:12px!important}
      .mca-columns-panel{position:fixed!important;left:12px!important;right:12px!important;top:auto!important;bottom:12px!important;width:auto!important;max-width:none!important;max-height:min(70vh,620px)!important;border-radius:16px!important;padding:0 14px 14px!important;box-shadow:0 24px 70px rgba(0,0,0,.28)!important;overscroll-behavior:contain!important}
      .mca-columns-mobile-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fff;padding:14px 2px 10px;border-bottom:1px solid #e6ebf2;margin-bottom:6px}
      .mca-columns-mobile-title{font-size:16px;font-weight:800;color:#06204a}
      .mca-columns-close{width:36px!important;height:36px!important;min-width:36px!important;padding:0!important;border-radius:50%!important;background:#f1f4f8!important;color:#06204a!important;font-size:22px!important;line-height:1!important;display:grid!important;place-items:center!important}
      .mca-columns-panel label{padding:12px 8px!important;font-size:15px!important}
    }
  `;
  document.head.appendChild(style);

  function textOf(el){ return String(el?.textContent || '').trim().toLowerCase(); }

  let activePanel = null;
  let activeTrigger = null;
  let backdrop = null;

  function ensureBackdrop(){
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.className = 'mca-columns-backdrop';
    backdrop.addEventListener('click', closePanel);
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function isMobile(){ return window.matchMedia('(max-width:700px)').matches; }

  function openPanel(){
    if (!activePanel) return;
    activePanel.hidden = false;
    activePanel.classList.remove('mca-columns-closed');
    activeTrigger?.setAttribute('aria-expanded','true');
    if (isMobile()) {
      ensureBackdrop().classList.add('is-open');
      document.body.classList.add('mca-columns-lock');
    }
  }

  function closePanel(){
    if (!activePanel) return;
    activePanel.classList.add('mca-columns-closed');
    activeTrigger?.setAttribute('aria-expanded','false');
    backdrop?.classList.remove('is-open');
    document.body.classList.remove('mca-columns-lock');
  }

  function togglePanel(event){
    event.preventDefault();
    event.stopPropagation();
    if (!activePanel) return;
    const closed = activePanel.classList.contains('mca-columns-closed') || activePanel.hidden;
    closed ? openPanel() : closePanel();
  }

  function install(){
    const tracking = document.getElementById('trackingSection') || document.getElementById('containersSection');
    if (!tracking) return;

    const candidates = [...tracking.querySelectorAll('button,summary,[role="button"]')];
    const trigger = candidates.find(el => ['columnas','ver columnas','personalizar columnas'].includes(textOf(el)));
    if (!trigger) return;

    trigger.classList.add('mca-columns-btn');
    trigger.textContent = 'Columnas';
    trigger.setAttribute('aria-label','Personalizar columnas visibles');
    trigger.setAttribute('aria-haspopup','dialog');
    trigger.title = 'Personalizar columnas visibles';

    let wrap = trigger.parentElement;
    if (!wrap || !wrap.classList.contains('mca-columns-wrap')) {
      const newWrap = document.createElement('div');
      newWrap.className = 'mca-columns-wrap';
      trigger.parentNode.insertBefore(newWrap, trigger);
      newWrap.appendChild(trigger);
      wrap = newWrap;
    }

    const possiblePanels = [...tracking.querySelectorAll('div,section,ul')].filter(el => {
      if (el === wrap || el.contains(trigger)) return false;
      return el.querySelectorAll('input[type="checkbox"]').length >= 2;
    });
    const panel = possiblePanels.find(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 150 || textOf(el).includes('contenedor');
    });
    if (!panel) return;

    panel.classList.add('mca-columns-panel');
    if (panel.parentElement !== wrap) wrap.appendChild(panel);
    activePanel = panel;
    activeTrigger = trigger;

    if (!panel.querySelector('.mca-columns-mobile-head')) {
      const head = document.createElement('div');
      head.className = 'mca-columns-mobile-head';
      head.innerHTML = '<div class="mca-columns-mobile-title">Seleccionar columnas</div><button type="button" class="mca-columns-close" aria-label="Cerrar">×</button>';
      panel.insertBefore(head, panel.firstChild);
      head.querySelector('.mca-columns-close').addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        closePanel();
      });
    }

    if (trigger.dataset.responsiveColumnsReady !== '1') {
      trigger.dataset.responsiveColumnsReady = '1';
      trigger.addEventListener('click', togglePanel, true);
      closePanel();
    }
  }

  document.addEventListener('click', event => {
    if (!activePanel || activePanel.classList.contains('mca-columns-closed')) return;
    if (activePanel.contains(event.target) || activeTrigger?.contains(event.target)) return;
    closePanel();
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePanel();
  });

  window.addEventListener('resize', () => {
    if (!isMobile()) {
      backdrop?.classList.remove('is-open');
      document.body.classList.remove('mca-columns-lock');
    }
  });

  install();
  const observer = new MutationObserver(install);
  observer.observe(document.body,{childList:true,subtree:true});
})();