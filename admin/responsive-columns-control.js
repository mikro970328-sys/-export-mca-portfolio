(() => {
  if (window.__responsiveColumnsControlInstalled) return;
  window.__responsiveColumnsControlInstalled = true;

  const style = document.createElement('style');
  style.textContent = `
    .mca-columns-wrap{display:flex;justify-content:flex-end;align-items:center;margin:10px 0;position:relative}
    .mca-columns-btn{width:auto!important;min-width:0!important;padding:9px 12px!important;border:1px solid #cfd7e3!important;background:#fff!important;color:#06204a!important;border-radius:9px!important;font-size:13px!important;line-height:1!important;display:inline-flex!important;align-items:center!important;gap:7px!important;box-shadow:none!important}
    .mca-columns-btn:hover{background:#f7f9fc!important}
    .mca-columns-btn::before{content:'☷';font-size:16px;line-height:1}
    .mca-columns-panel{position:absolute!important;right:0!important;top:calc(100% + 8px)!important;left:auto!important;width:270px!important;max-width:min(270px,calc(100vw - 32px))!important;max-height:420px!important;overflow:auto!important;background:#fff!important;border:1px solid #dfe5ee!important;border-radius:12px!important;padding:10px!important;box-shadow:0 18px 45px rgba(6,32,74,.18)!important;z-index:1300!important}
    .mca-columns-panel label{display:flex!important;align-items:center!important;gap:10px!important;padding:9px 8px!important;margin:0!important;border-radius:8px!important;font-size:14px!important;font-weight:600!important;color:#152238!important}
    .mca-columns-panel label:hover{background:#f4f7fb!important}
    .mca-columns-panel input[type='checkbox']{width:18px!important;height:18px!important;margin:0!important;flex:0 0 auto!important}
    @media(max-width:700px){
      .mca-columns-wrap{margin:8px 0 10px}
      .mca-columns-btn{padding:9px 11px!important;font-size:12px!important}
      .mca-columns-panel{position:fixed!important;left:12px!important;right:12px!important;top:auto!important;bottom:12px!important;width:auto!important;max-width:none!important;max-height:56vh!important;border-radius:16px!important;padding:14px!important;box-shadow:0 24px 70px rgba(0,0,0,.28)!important}
      .mca-columns-panel::before{content:'Seleccionar columnas';display:block;font-size:16px;font-weight:800;color:#06204a;padding:2px 4px 10px;border-bottom:1px solid #e6ebf2;margin-bottom:6px}
      .mca-columns-panel label{padding:12px 8px!important;font-size:15px!important}
    }
  `;
  document.head.appendChild(style);

  function textOf(el){ return String(el?.textContent || '').trim().toLowerCase(); }

  function install(){
    const tracking = document.getElementById('trackingSection') || document.getElementById('containersSection');
    if (!tracking) return;

    const candidates = [...tracking.querySelectorAll('button,summary,[role="button"]')];
    const trigger = candidates.find(el => ['columnas','ver columnas','personalizar columnas'].includes(textOf(el)));
    if (!trigger || trigger.dataset.responsiveColumnsReady === '1') return;

    trigger.dataset.responsiveColumnsReady = '1';
    trigger.classList.add('mca-columns-btn');
    trigger.textContent = 'Columnas';
    trigger.setAttribute('aria-label','Personalizar columnas visibles');
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
      const checks = el.querySelectorAll('input[type="checkbox"]');
      return checks.length >= 2;
    });
    const panel = possiblePanels.find(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 150 || textOf(el).includes('contenedor');
    });
    if (panel) {
      panel.classList.add('mca-columns-panel');
      if (panel.parentElement !== wrap) wrap.appendChild(panel);
    }
  }

  function getControl(){
    const trigger = document.querySelector('.mca-columns-btn');
    const panel = document.querySelector('.mca-columns-panel');
    return { trigger, panel };
  }

  function panelIsVisible(panel){
    if (!panel) return false;
    const styles = getComputedStyle(panel);
    return styles.display !== 'none' && styles.visibility !== 'hidden' && panel.getClientRects().length > 0;
  }

  document.addEventListener('click', event => {
    if (window.matchMedia('(max-width:700px)').matches) return;
    const { trigger, panel } = getControl();
    if (!trigger || !panel || !panelIsVisible(panel)) return;
    if (trigger.contains(event.target) || panel.contains(event.target)) return;
    setTimeout(() => trigger.click(), 0);
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const { trigger, panel } = getControl();
    if (trigger && panelIsVisible(panel)) trigger.click();
  });

  install();
  const observer = new MutationObserver(install);
  observer.observe(document.body,{childList:true,subtree:true});
})();