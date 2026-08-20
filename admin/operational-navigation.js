(() => {
  if (window.__operationalNavigationInstalled) return;
  window.__operationalNavigationInstalled = true;

  const normalize = value => String(value || '').trim().toUpperCase();
  const CONTEXT_SECTIONS = ['suppliersSection','purchasesSection','warehouseSection','inventorySection'];
  const BRIDGE_SRC = '/admin/operational-context-bridge.js';
  let cache = null;
  let pending = null;
  let restoring = false;

  const section = id => typeof window.showSection === 'function' ? window.showSection(id) : false;
  const frameFor = id => document.querySelector(`#${id} iframe`);

  async function requestLinks({ refresh = false } = {}) {
    if (!refresh && cache) return cache;
    if (!refresh && pending) return pending;
    const token = localStorage.getItem('export_mca_token') || '';
    pending = fetch('/api/operational-links', { headers:token ? { Authorization:`Bearer ${token}` } : {} })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los enlaces operativos');
        cache = {
          links:Array.isArray(data.links) ? data.links : [],
          purchases:Array.isArray(data.purchases) ? data.purchases : [],
          receipts:Array.isArray(data.receipts) ? data.receipts : []
        };
        return cache;
      })
      .finally(() => { pending = null; });
    return pending;
  }

  function invalidateLinks() { cache = null; }

  function writeContext(type, value, { replace = false } = {}) {
    if (restoring || !type || !value) return;
    const params = new URLSearchParams({ opnav:type, id:String(value).trim() });
    const hash = `#${params.toString()}`;
    if (location.hash === hash) return;
    history[replace ? 'replaceState' : 'pushState'](
      { ...(history.state || {}), operationalContext:{ type, id:String(value) } },
      '',
      hash
    );
  }

  function readContext() {
    if (!location.hash) return null;
    const params = new URLSearchParams(location.hash.slice(1));
    const type = params.get('opnav');
    const id = params.get('id');
    return type && id ? { type, id } : null;
  }

  function findShipment({ shipmentId = null, containerNumber = null } = {}) {
    const rows = Array.isArray(window.shipments) ? window.shipments : [];
    if (shipmentId) {
      const found = rows.find(row => String(row.id) === String(shipmentId));
      if (found) return found;
    }
    const container = normalize(containerNumber);
    return container ? rows.find(row => normalize(row.container_number) === container) || null : null;
  }

  async function loadForShipment(shipmentId) {
    if (!shipmentId) return null;
    const data = await requestLinks();
    return data.links.find(row => String(row.shipment_id) === String(shipmentId)) || null;
  }

  async function loadsForOperation(operationId) {
    if (!operationId) return [];
    const data = await requestLinks();
    return data.links.filter(row => String(row.operation_id || '') === String(operationId));
  }

  async function loadsForReceipt(receiptNumber) {
    const receipt = normalize(receiptNumber);
    if (!receipt) return [];
    const data = await requestLinks();
    return data.links.filter(row => Array.isArray(row.receipt_numbers) && row.receipt_numbers.some(value => normalize(value) === receipt));
  }

  async function purchaseOrdersForSupplier(supplierId) {
    if (!supplierId) return [];
    const data = await requestLinks();
    return data.purchases.filter(row => String(row.supplier_id || '') === String(supplierId));
  }

  async function receiptsForSupplier(supplierId) {
    if (!supplierId) return [];
    const data = await requestLinks();
    return data.receipts.filter(row => String(row.supplier_id || '') === String(supplierId));
  }

  async function purchaseOrdersForReceipt(receiptNumber) {
    const receipt = normalize(receiptNumber);
    if (!receipt) return [];
    const data = await requestLinks();
    return data.purchases.filter(row => Array.isArray(row.receipts) && row.receipts.some(item => normalize(item.receipt_number) === receipt));
  }

  async function receiptsForPurchase(purchaseOrderId) {
    if (!purchaseOrderId) return [];
    const data = await requestLinks();
    return data.purchases.find(row => String(row.purchase_order_id) === String(purchaseOrderId))?.receipts || [];
  }

  async function purchaseByNumber(poNumber) {
    const po = normalize(poNumber);
    if (!po) return null;
    const data = await requestLinks();
    return data.purchases.find(row => normalize(row.po_number) === po) || null;
  }

  async function receiptByNumber(receiptNumber) {
    const receipt = normalize(receiptNumber);
    if (!receipt) return null;
    const data = await requestLinks();
    return data.receipts.find(row => normalize(row.receipt_number) === receipt) || null;
  }

  function installBridge(sectionId) {
    const frame = frameFor(sectionId);
    if (!frame) return Promise.resolve(false);

    const inject = () => new Promise(resolve => {
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!win || !doc) return resolve(false);
      if (win.OperationalContextBridge?.ready) return resolve(true);

      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const ready = () => finish(true);
      win.addEventListener('export-mca:context-bridge-ready', ready, { once:true });

      let script = doc.getElementById('operationalContextBridgeScript');
      if (!script) {
        script = doc.createElement('script');
        script.id = 'operationalContextBridgeScript';
        script.src = BRIDGE_SRC;
        script.async = false;
        script.onerror = () => finish(false);
        (doc.head || doc.documentElement).appendChild(script);
      }

      const timer = setTimeout(() => finish(Boolean(win.OperationalContextBridge?.ready)), 2500);
    });

    if (frame.contentDocument?.readyState === 'complete') return inject();
    return new Promise(resolve => frame.addEventListener('load', () => inject().then(resolve), { once:true }));
  }

  function installAllBridges() {
    CONTEXT_SECTIONS.forEach(id => installBridge(id).catch(error => console.error('[operational bridge]', id, error)));
  }

  function callEmbedded(sectionId, method, args = []) {
    const frame = frameFor(sectionId);
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

  async function callContextEmbedded(sectionId, method, args = []) {
    const ready = await installBridge(sectionId);
    if (!ready) return false;
    const frame = frameFor(sectionId);
    const fn = frame?.contentWindow?.[method];
    if (typeof fn !== 'function') return false;
    fn(...args);
    return true;
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
    return link ? openLoad({ loadId:link.load_id }, options) : false;
  }

  function openInventoryReceipt(receiptNumber, options = {}) {
    const receipt = String(receiptNumber || '').trim();
    if (!receipt) return false;
    if (options.history !== false) writeContext('wr', receipt, options);
    window.NavigationShell?.openInventory?.();
    installBridge('inventorySection').catch(error => console.error('[inventory context bridge]', error));
    return callEmbedded('inventorySection', 'traceWR', [receipt]);
  }

  async function openWarehouseReceipt({ receiptNumber = null } = {}, options = {}) {
    const receipt = await receiptByNumber(receiptNumber);
    if (!receipt?.id) return false;
    if (options.history !== false) writeContext('receipt', receipt.receipt_number, options);
    window.NavigationShell?.openWarehouse?.();
    return callContextEmbedded('warehouseSection', 'openOperationalReceipt', [receipt.id]);
  }

  async function openPurchase({ purchaseOrderId = null } = {}, options = {}) {
    if (!purchaseOrderId) return false;
    if (options.history !== false) writeContext('po', purchaseOrderId, options);
    window.NavigationShell?.openPurchases?.();
    return callContextEmbedded('purchasesSection', 'openOperationalPurchase', [purchaseOrderId]);
  }

  async function openSupplier({ supplierId = null } = {}, options = {}) {
    if (!supplierId) return false;
    if (options.history !== false) writeContext('supplier', supplierId, options);
    window.NavigationShell?.openSuppliers?.();
    return callContextEmbedded('suppliersSection', 'openOperationalSupplier', [supplierId]);
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
    if (!context || restoring) return false;
    restoring = true;
    try {
      if (context.type === 'tracking') return openTracking({ shipmentId:context.id }, { history:false });
      if (context.type === 'load') return openLoad({ loadId:context.id }, { history:false });
      if (context.type === 'wr') return openInventoryReceipt(context.id, { history:false });
      if (context.type === 'receipt') return openWarehouseReceipt({ receiptNumber:context.id }, { history:false });
      if (context.type === 'po') return openPurchase({ purchaseOrderId:context.id }, { history:false });
      if (context.type === 'supplier') return openSupplier({ supplierId:context.id }, { history:false });
      if (context.type === 'expediente') return openExpediente(context.id, { history:false });
      return false;
    } finally {
      restoring = false;
    }
  }

  window.addEventListener('hashchange', () => restoreContext().catch(error => console.error('[operational context restore]', error)));
  window.addEventListener('popstate', () => restoreContext().catch(error => console.error('[operational context restore]', error)));
  window.addEventListener('export-mca:data-loaded', () => {
    invalidateLinks();
    installAllBridges();
    restoreContext().catch(error => console.error('[operational context restore]', error));
  });
  window.addEventListener('export-mca:section-changed', () => requestAnimationFrame(installAllBridges));
  window.addEventListener('load', () => requestAnimationFrame(installAllBridges), { once:true });

  window.OperationalNavigation = Object.freeze({
    openTracking,
    openLoad,
    openLoadForShipment,
    openInventoryReceipt,
    openWarehouseReceipt,
    openPurchase,
    openSupplier,
    openExpediente,
    loadForShipment,
    loadsForOperation,
    loadsForReceipt,
    purchaseOrdersForSupplier,
    receiptsForSupplier,
    purchaseOrdersForReceipt,
    receiptsForPurchase,
    purchaseByNumber,
    receiptByNumber,
    restoreContext,
    refreshLinks:() => requestLinks({ refresh:true }),
    owner:'operational-navigation.js'
  });

  requestAnimationFrame(installAllBridges);
})();
