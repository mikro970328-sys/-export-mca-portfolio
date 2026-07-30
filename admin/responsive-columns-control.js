(() => {
  if (window.__responsiveColumnsControlInstalled) return;
  window.__responsiveColumnsControlInstalled = true;

  const style = document.createElement('style');
  style.textContent = `
    .mca-columns-wrap{display:flex;justify-content:flex-end;align-items:center;margin:10px 0;position:relative}
    .mca-columns-btn{width:auto!important;min-width:0!important;padding:9px 12px!important;border:1px solid #cfd7e3!important;background:#fff!important;color:#06204a!important;border-radius:9px!important;font-size:13px!important;line-height:1!important;display:inline-flex!important;align-items:center!important;gap:7px!important;box-shadow:none!important}
    .mca-columns-btn:hover{background:#f7f9fc!important}
    .mca-columns-btn::before{content:'☷';font-size:16px;line-height:1}
    .mca-columns-panel{position:absolute!important;right:0!important;top:calc(100% + 8px)!important;left:auto!important;width:270px!important;max-width:min(270px,calc(100vw - 32px))!important;max-height:420px!important;overflow:auto!important;background:#fff!important;border:1px solid #dfe5ee!important;border-radius:12px!important;padding:10px!important;box-shadow:0 18px 45px rgba(6,32,74,.18)!important;z-index:1401!important}
    .mca-columns-panel label{display:flex!important;align-items:center!important;gap:10px!important;padding:9px 8px!important;margin:0!important;border-radius:8px!important;font-size:14px!important;font-weight:600!important;color:#152238!important}
    .mca-columns-panel label:hover{background:#f4f7fb!important}
    .mca-columns-panel input[type='checkbox']{width:18px!important;height:18px!important;margin:0!important;flex:0 0 auto!important}
    .mca-columns-backdrop{display:none;position:fixed;inset:0;background:rgba(6,20,42,.46);z-index:1400}
    .mca-columns-backdrop.show{display:block}
    .mca-columns-close{display:none!important}
    @media(max-width:700px){
      .mca-columns-wrap{margin:8px 0 10px}
      .mca-columns-btn{padding:9px 11px!important;font-size:12px!important}
      .mca-columns-panel{position:fixed!important;left:12px!important;right:12px!important;top:auto!important;bottom:12px!important;width:auto!important;max-width:none!important;max-height:56vh!important;border-radius:16px!important;padding:14px!important;box-shadow:0 24px 70px rgba(0,0,0,.28)!important}
      .mca-columns-panel::before{content:'Seleccionar columnas';display:block;font-size:16px;font-weight:800;color:#06204a;padding:2px 44px 10px 4px;border-bottom:1px solid #e6ebf2;margin-bottom:6px}
      .mca-columns-panel label{padding:12px 8px!important;font-size:15px!important}
      .mca-columns-close{display:grid!important;place-items:center;position:absolute;top:9px;right:10px;width:34px!important;height:34px!important;min-width:34px!important;padding:0!important;border:0!important;border-radius:50%!important;background:#eef2f7!important;color:#06204a!important;font-size:22px!important;line-height:1!important;z-index:2}
      body.mca-columns-open{overflow:hidden!important;touch-action:none}
      body.mca-columns-open .mca-columns-panel{touch-action:auto}
    }
  `;
  document.head.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'mca-columns-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.appendChild(backdrop);

  function textOf(el){ return String(el?.textContent || '').trim().toLowerCase(); }

  function getControl(){
    const trigger = document.querySelector('.mca-columns-btn');
    const panel = document.querySelector('.mca-columns-panel');
    const details = trigger?.closest('details') || null;
    return { trigger, panel, details };
  }

  function closeColumns(){
    const { details } = getControl();
    if (details) details.open = false;
    backdrop.classList.remove('show');
    document.body.classList.remove('mca-columns-open');
  }

  function syncOpenState(){
    const { details } = getControl();
    const mobile = window.matchMedia('(max-width:700px)').matches;
    const open = Boolean(details?.open);
    backdrop.classList.toggle('show', mobile && open);
    document.body.classList.toggle('mca-columns-open', mobile && open);
  }

  function install(){
    const tracking = document.getElementById('trackingSection') || document.getElementById('containersSection');
    if (!tracking) return;

    const candidates = [...tracking.querySelectorAll('button,summary,[role="button"]')];
    const trigger = candidates.find(el => ['columnas','ver columnas','personalizar columnas'].includes(textOf(el)));
    if (!trigger || trigger.dataset.responsiveColumnsReady === '1') {
      syncOpenState();
      return;
    }

    trigger.dataset.responsiveColumnsReady = '1';
    trigger.classList.add('mca-columns-btn');
    trigger.textContent = 'Columnas';
    trigger.setAttribute('aria-label','Personalizar columnas visibles');
    trigger.title = 'Personalizar columnas visibles';

    const details = trigger.closest('details');
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

    if (panel) {
      panel.classList.add('mca-columns-panel');
      if (panel.parentElement !== wrap) wrap.appendChild(panel);
      if (!panel.querySelector('.mca-columns-close')) {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'mca-columns-close';
        close.setAttribute('aria-label', 'Cerrar selector de columnas');
        close.textContent = '×';
        close.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          closeColumns();
        });
        panel.prepend(close);
      }
    }

    if (details && details.dataset.mcaToggleReady !== '1') {
      details.dataset.mcaToggleReady = '1';
      details.addEventListener('toggle', syncOpenState);
    }
    syncOpenState();
  }

  backdrop.addEventListener('click', closeColumns);
  backdrop.addEventListener('pointerdown', event => {
    event.preventDefault();
    closeColumns();
  });

  document.addEventListener('pointerdown', event => {
    const { trigger, panel, details } = getControl();
    if (!details?.open) return;
    if (trigger?.contains(event.target) || panel?.contains(event.target)) return;
    closeColumns();
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeColumns();
  });

  window.addEventListener('resize', syncOpenState);
  install();
  const observer = new MutationObserver(install);
  observer.observe(document.body,{childList:true,subtree:true});
})();