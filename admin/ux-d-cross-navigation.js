(() => {
  if (window.__uxdCrossNavigationInstalled) return;
  window.__uxdCrossNavigationInstalled = true;

  const byId = id => document.getElementById(id);

  function shipments() {
    return Array.isArray(window.shipments) ? window.shipments : [];
  }

  function operations() {
    return typeof window.ExpedientesModule?.getState === 'function'
      ? window.ExpedientesModule.getState().operations || []
      : [];
  }

  function openTracking(containerNumber = '') {
    if (typeof window.showSection === 'function') window.showSection('containersSection');
    const allTab = document.querySelector('[data-container-filter="all"]');
    if (allTab) allTab.click();
    const search = byId('shipmentSearch');
    if (!search) return;
    search.value = containerNumber;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    if (containerNumber) search.focus({ preventScroll: true });
  }

  function openExpedientes() {
    if (typeof window.showSection === 'function') window.showSection('newOperationsSection');
  }

  function installStyles() {
    if (byId('uxdCrossNavigationStyles')) return;
    const style = document.createElement('style');
    style.id = 'uxdCrossNavigationStyles';
    style.textContent = `
      .uxd-context-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 14px;margin:0 0 14px;border:1px solid #dbe4ef;border-radius:12px;background:#f8fbff}
      .uxd-context-copy{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.uxd-context-copy b{color:#06204a}.uxd-context-chip{display:inline-flex;align-items:center;padding:6px 9px;border-radius:999px;background:#fff;border:1px solid #dbe4ef;color:#475467;font-size:11px;font-weight:800}
      .uxd-context-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.uxd-context-actions input{width:min(260px,70vw);padding:9px 10px}.uxd-context-actions button{padding:9px 12px}
      @media(max-width:700px){.uxd-context-bar{align-items:stretch}.uxd-context-actions{width:100%}.uxd-context-actions input,.uxd-context-actions button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function mountTrackingBar() {
    const section = byId('containersSection');
    const card = section?.querySelector('.card');
    if (!card) return;
    let bar = byId('uxdTrackingBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'uxdTrackingBar';
      bar.className = 'uxd-context-bar';
      const heading = card.querySelector('h2');
      if (heading?.nextSibling) card.insertBefore(bar, heading.nextSibling);
      else card.prepend(bar);
    }

    const all = shipments();
    const withOperation = all.filter(item => item.operation_id).length;
    const withoutOperation = all.filter(item => !item.operation_id).length;
    bar.innerHTML = `
      <div class="uxd-context-copy">
        <b>Tracking ↔ Expedientes</b>
        <span class="uxd-context-chip">${withOperation} con expediente</span>
        <span class="uxd-context-chip">${withoutOperation} sin expediente</span>
      </div>
      <div class="uxd-context-actions"><button id="uxdOpenExpedientes" class="alt" type="button">Abrir expedientes</button></div>`;
    byId('uxdOpenExpedientes')?.addEventListener('click', openExpedientes, { once: true });
  }

  function mountExpedientesBar() {
    const section = byId('newOperationsSection');
    const card = section?.querySelector('.card');
    if (!card) return;
    let bar = byId('uxdExpedientesBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'uxdExpedientesBar';
      bar.className = 'uxd-context-bar';
      const toolbar = card.querySelector('.toolbar');
      if (toolbar?.nextSibling) card.insertBefore(bar, toolbar.nextSibling);
      else card.prepend(bar);
    }

    const operationCount = operations().length;
    bar.innerHTML = `
      <div class="uxd-context-copy">
        <b>Expedientes ↔ Tracking</b>
        <span class="uxd-context-chip">${operationCount} expedientes cargados</span>
      </div>
      <div class="uxd-context-actions">
        <input id="uxdContainerLookup" list="uxdContainerOptions" placeholder="Número de contenedor">
        <datalist id="uxdContainerOptions">${shipments().map(item => `<option value="${String(item.container_number || '').replace(/"/g, '&quot;')}"></option>`).join('')}</datalist>
        <button id="uxdOpenTracking" class="alt" type="button">Abrir en Tracking</button>
      </div>`;

    const lookup = byId('uxdContainerLookup');
    const go = () => openTracking(String(lookup?.value || '').trim());
    byId('uxdOpenTracking')?.addEventListener('click', go, { once: true });
    lookup?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      go();
    }, { once: true });
  }

  function refresh() {
    installStyles();
    mountTrackingBar();
    mountExpedientesBar();
  }

  window.addEventListener('export-mca:data-loaded', refresh);
  window.addEventListener('export-mca:section-changed', refresh);
  window.addEventListener('export-mca:admin-ready', refresh);

  window.UXDCrossNavigation = Object.freeze({
    owner: 'ux-d-cross-navigation.js',
    responsibility: 'cross-module-navigation-only',
    openTracking,
    openExpedientes,
    refresh
  });

  refresh();
})();
