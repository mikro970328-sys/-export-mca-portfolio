(() => {
  if (window.__operationalNavigationInstalled) return;
  window.__operationalNavigationInstalled = true;

  const normalize = value => String(value || '').trim().toUpperCase();
  let linksCache = null;
  let linksPromise = null;
  let restoringContext = false;

  function section(id) {
    return typeof window.showSection === 'function' ? window.showSection(id) : false;
  }

  function embeddedFrame(sectionId) {
    return document.querySelector(`#${sectionId} iframe`);
  }

  function callEmbedded(sectionId, method, args = []) {
    const frame = embeddedFrame(sectionId);
    if (!frame) return false;

    const invoke = () => {
      try {
        const fn = frame.contentWindow?.[method];
        if (typeof fn !== 'function') return false;
        fn(...args);
        return true;
      } catch (error) {
        console.error('[operational navigation embedded]', sectionId, method, error);
        return false;
      }
    };

    if (frame.contentDocument?.readyState === 'complete') {
      requestAnimationFrame(invoke);
      return true;
    }
    frame.addEventListener('load', () => requestAnimationFrame(invoke), { once:true });
    return true;
  }

  async function requestLinks({ refresh = false } = {}) {
    if (!refresh && Array.isArray(linksCache)) return linksCache;
    if (!refresh && linksPromise) return linksPromise;

    const token = localStorage.getItem('export_mca_token') || '';
    linksPromise = fetch('/api/operational-links', {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los enlaces operativos');
        linksCache = Array.isArray(data.links) ? data.links : [];
        return linksCache;
      })
      .finally(() => { linksPromise = null; });

    return linksPromise;
  }

  function invalidateLinks() {
    linksCache = null;
  }

  function contextHash(type, value) {
    const params = new URLSearchParams();
    params.set('opnav', type);
    params.set('id', String(value || '').trim());
    return `#${params.toString()}`;
  }

  function writeContext(type, value, { replace = false } = {}) {
    if (restoringContext || !type || !value) return;
    const hash = contextHash(type, value);
    if (location.hash === hash) return;
    const method = replace ? 'replaceState' : 'pushState';
    history[method]({ ...(history.state || {}), operationalContext: { type, id:String(value) } }, '', hash);
  }

  function readContext() {
    if (!location.hash) return null;
    const params = new URLSearchParams(location.hash.slice(1));
    const type = params.get('opnav');
    const id = params.get('id');
    if (!type || !id) return null;
    return { type, id };
  }

  function findShipment({ shipmentId = null, containerNumber = null } = {}) {
    const rows = Array.isArray(window.shipments) ? window.shipments : [];
    if (shipmentId) {
      const byId = rows.find(item => String(item.id) === String(shipmentId));
      if (byId) return byId;
    }
    const key = normalize(containerNumber);
    return key ? rows.find(item => normalize(item.container_number) === key) || null : null;
  }

  async function loadForShipment(shipmentId) {
    if (!shipmentId) return null;
    const links = await requestLinks();
    return links.find(item => String(item.shipment_id) === String(shipmentId)) || null;
  }

  async function loadsForOperation(operationId) {
    if (!operationId) return [];
    const links = await requestLinks();
    return links.filter(item => String(item.operation_id || '') === String(operationId));
  }

  async function loadsForReceipt(receiptNumber) {
    const key = normalize(receiptNumber);
    if (!key) return [];
    const links = await requestLinks();
    return links.filter(item => Array.isArray(item.receipt_numbers) && item.receipt_numbers.some(receipt => normalize(receipt) === key));
  }

  function openTracking(context = {}, options = {}) {
    section('containersSection');
    const shipment = findShipment(context);
    if (!shipment) return false;
    if (options.history !== false) writeContext('tracking', shipment.id, options);
    requestAnimationFrame(() => window.ContainersModule?.openDetails?.(shipment));
    return true;
  }

  function openLoad({ loadId = null } = {}, options = {}) {
    if (!loadId) return false;
    if (options.history !== false) writeContext('load', loadId, options);
    window.NavigationShell?.openLoads?.();
    return callEmbedded('loadsSection', 'openLoad', [loadId]);
  }

  async function openLoadForShipment(shipmentId, options = {}) {
    const link = await loadForShipment(shipmentId);
    if (!link) return false;
    return openLoad({ loadId: link.load_id }, options);
  }

  function openInventoryReceipt(receiptNumber, options = {}) {
    const receipt = String(receiptNumber || '').trim();
    if (!receipt) return false;
    if (options.history !== false) writeContext('wr', receipt, options);
    window.NavigationShell?.openInventory?.();
    return callEmbedded('inventorySection', 'traceWR', [receipt]);
  }

  function openExpediente(operationId, options = {}) {
    if (!operationId) return false;
    if (options.history !== false) writeContext('expediente', operationId, options);
    section('newOperationsSection');
    requestAnimationFrame(() => window.ExpedientesModule?.open?.(operationId));
    return true;
  }

  async function restoreContext() {
    const context = readContext();
    if (!context || restoringContext) return false;
    restoringContext = true;
    try {
      if (context.type === 'tracking') return openTracking({ shipmentId:context.id }, { history:false });
      if (context.type === 'load') return openLoad({ loadId:context.id }, { history:false });
      if (context.type === 'wr') return openInventoryReceipt(context.id, { history:false });
      if (context.type === 'expediente') return openExpediente(context.id, { history:false });
      return false;
    } finally {
      restoringContext = false;
    }
  }

  window.addEventListener('hashchange', () => { restoreContext().catch(error => console.error('[operational navigation restore]', error)); });
  window.addEventListener('popstate', () => { restoreContext().catch(error => console.error('[operational navigation restore]', error)); });
  window.addEventListener('export-mca:data-loaded', () => {
    invalidateLinks();
    restoreContext().catch(error => console.error('[operational navigation restore]', error));
  });

  window.OperationalNavigation = Object.freeze({
    openTracking,
    openLoad,
    openLoadForShipment,
    openInventoryReceipt,
    openExpediente,
    loadForShipment,
    loadsForOperation,
    loadsForReceipt,
    restoreContext,
    refreshLinks: () => requestLinks({ refresh:true }),
    owner: 'operational-navigation.js'
  });
})();
