(() => {
  if (window.APTraceability) return;

  const CONTEXT_SECTIONS = ['suppliersSection','purchasesSection','warehouseSection'];
  const BRIDGE_SRC = '/admin/ap-context-bridge.js';
  let cache = null;
  let pending = null;
  let restoring = false;

  const token = () => localStorage.getItem('export_mca_token') || '';
  const frameFor = id => document.querySelector(`#${id} iframe`);

  async function requestLinks({ refresh = false } = {}) {
    if (!refresh && cache) return cache;
    if (pending) return pending;
    pending = fetch('/api/ap-links', { headers:token() ? { Authorization:`Bearer ${token()}` } : {} })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la trazabilidad AP');
        cache = {
          bills:Array.isArray(data.bills) ? data.bills : [],
          payments:Array.isArray(data.payments) ? data.payments : [],
          purchases:Array.isArray(data.purchases) ? data.purchases : []
        };
        return cache;
      })
      .finally(() => { pending = null; });
    return pending;
  }

  const invalidate = () => { cache = null; };

  function writeContext(type, id, { replace = false } = {}) {
    if (restoring || !type || !id) return;
    const hash = `#${new URLSearchParams({ apnav:type, id:String(id) }).toString()}`;
    if (location.hash === hash) return;
    history[replace ? 'replaceState' : 'pushState']({ ...(history.state || {}), apContext:{ type,id:String(id) } }, '', hash);
  }

  function readContext() {
    if (!location.hash) return null;
    const params = new URLSearchParams(location.hash.slice(1));
    const type = params.get('apnav');
    const id = params.get('id');
    return type && id ? { type,id } : null;
  }

  async function installBridge(sectionId) {
    const frame = frameFor(sectionId);
    if (!frame) return false;
    const inject = () => new Promise(resolve => {
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!win || !doc) return resolve(false);
      if (win.APContextBridge?.ready) return resolve(true);
      let settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } };
      win.addEventListener('export-mca:ap-context-ready', () => finish(true), { once:true });
      let script = doc.getElementById('apContextBridgeScript');
      if (!script) {
        script = doc.createElement('script');
        script.id = 'apContextBridgeScript';
        script.src = BRIDGE_SRC;
        script.async = false;
        script.onerror = () => finish(false);
        (doc.head || doc.documentElement).appendChild(script);
      }
      setTimeout(() => finish(Boolean(win.APContextBridge?.ready)), 2500);
    });
    if (frame.contentDocument?.readyState === 'complete') return inject();
    return new Promise(resolve => frame.addEventListener('load', () => inject().then(resolve), { once:true }));
  }

  function installAllBridges() {
    CONTEXT_SECTIONS.forEach(id => installBridge(id).catch(error => console.error('[ap bridge]', id, error)));
  }

  async function callPayables(method, id) {
    window.NavigationShell?.openPayables?.();
    const frame = frameFor('payablesSection');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const fn = frame?.contentWindow?.PayablesModule?.[method];
      if (typeof fn === 'function') { fn(id); return true; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  async function billsForSupplier(supplierId) {
    const data = await requestLinks();
    return data.bills.filter(row => String(row.supplier_id || '') === String(supplierId));
  }
  async function paymentsForSupplier(supplierId) {
    const data = await requestLinks();
    return data.payments.filter(row => String(row.supplier_id || '') === String(supplierId));
  }
  async function billsForPurchase(purchaseOrderId) {
    const data = await requestLinks();
    return data.bills.filter(row => String(row.purchase_order_id || '') === String(purchaseOrderId));
  }
  async function paymentsForPurchase(purchaseOrderId) {
    const data = await requestLinks();
    return data.payments.filter(row => String(row.purchase_order_id || '') === String(purchaseOrderId));
  }
  async function billsForReceipt(receiptNumber) {
    const data = await requestLinks();
    const key = String(receiptNumber || '').trim().toUpperCase();
    return data.bills.filter(row => row.receipts?.some(receipt => String(receipt.receipt_number || '').trim().toUpperCase() === key));
  }
  async function paymentsForReceipt(receiptNumber) {
    const data = await requestLinks();
    const key = String(receiptNumber || '').trim().toUpperCase();
    return data.payments.filter(row => row.receipts?.some(receipt => String(receipt.receipt_number || '').trim().toUpperCase() === key));
  }
  async function purchaseByNumber(poNumber) {
    const data = await requestLinks();
    const key = String(poNumber || '').trim().toUpperCase();
    return data.purchases.find(row => String(row.po_number || '').trim().toUpperCase() === key) || null;
  }
  async function billByNumber(billNumber) {
    const data = await requestLinks();
    const key = String(billNumber || '').trim().toUpperCase();
    return data.bills.find(row => String(row.bill_number || '').trim().toUpperCase() === key) || null;
  }
  async function paymentByNumber(paymentNumber) {
    const data = await requestLinks();
    const key = String(paymentNumber || '').trim().toUpperCase();
    return data.payments.find(row => String(row.payment_number || '').trim().toUpperCase() === key) || null;
  }

  async function openBill(billId, options = {}) {
    if (!billId) return false;
    if (options.history !== false) writeContext('bill', billId, options);
    return callPayables('openBill', billId);
  }
  async function openPayment(paymentId, options = {}) {
    if (!paymentId) return false;
    if (options.history !== false) writeContext('payment', paymentId, options);
    return callPayables('openPayment', paymentId);
  }
  const openSupplier = supplierId => window.OperationalNavigation?.openSupplier?.({ supplierId });
  const openPurchase = purchaseOrderId => window.OperationalNavigation?.openPurchase?.({ purchaseOrderId });
  const openReceipt = receiptNumber => window.OperationalNavigation?.openWarehouseReceipt?.({ receiptNumber });

  async function restoreContext() {
    const context = readContext();
    if (!context || restoring) return false;
    restoring = true;
    try {
      if (context.type === 'bill') return openBill(context.id, { history:false });
      if (context.type === 'payment') return openPayment(context.id, { history:false });
      return false;
    } finally { restoring = false; }
  }

  window.addEventListener('hashchange', () => restoreContext().catch(console.error));
  window.addEventListener('popstate', () => restoreContext().catch(console.error));
  window.addEventListener('export-mca:data-loaded', () => { invalidate(); installAllBridges(); restoreContext().catch(console.error); });
  window.addEventListener('export-mca:section-changed', () => requestAnimationFrame(installAllBridges));
  window.addEventListener('load', () => requestAnimationFrame(installAllBridges), { once:true });

  window.APTraceability = Object.freeze({
    owner:'ap-traceability.js',
    billsForSupplier, paymentsForSupplier, billsForPurchase, paymentsForPurchase,
    billsForReceipt, paymentsForReceipt, purchaseByNumber, billByNumber, paymentByNumber,
    openBill, openPayment, openSupplier, openPurchase, openReceipt,
    invalidate, refreshLinks:() => requestLinks({ refresh:true })
  });
  installAllBridges();
})();
