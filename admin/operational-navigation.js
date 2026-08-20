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

  function childStyle(doc) {
    if (!doc || doc.getElementById('b2-operational-navigation-style')) return;
    const style = doc.createElement('style');
    style.id = 'b2-operational-navigation-style';
    style.textContent = '.b2-opnav{margin-top:12px;padding:11px;border:1px solid #dfe5ee;border-radius:10px;background:#f8fafc}.b2-opnav-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}.b2-opnav-title{font-size:10px;text-transform:uppercase;color:#667085;font-weight:900}.b2-opnav-actions{display:flex;gap:7px;flex-wrap:wrap}.b2-opnav-btn{border:1px solid #cfd9e8!important;background:#fff!important;color:#06204a!important;border-radius:8px!important;padding:7px 9px!important;font-size:10px!important;font-weight:900!important;cursor:pointer!important}.b2-opnav-btn.primary{background:#06204a!important;color:#fff!important;border-color:#06204a!important}.b2-opnav-empty{font-size:11px;color:#667085}.b2-opnav-count{font-size:10px;color:#667085}.b2-opnav-highlight{outline:2px solid #f58220;outline-offset:2px;border-radius:9px}@media(max-width:650px){.b2-opnav-btn{flex:1 1 130px;text-align:left}}';
    doc.head?.appendChild(style);
  }

  function makeButton(doc, label, handler, primary = false) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `b2-opnav-btn${primary ? ' primary' : ''}`;
    button.textContent = label;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve(handler()).catch(error => console.error('[operational navigation action]', error));
    });
    return button;
  }

  function navigationBlock(doc, title, items = []) {
    const block = doc.createElement('div');
    block.className = 'b2-opnav';
    const head = doc.createElement('div');
    head.className = 'b2-opnav-head';
    const name = doc.createElement('div');
    name.className = 'b2-opnav-title';
    name.textContent = title;
    head.appendChild(name);
    if (items.length) {
      const count = doc.createElement('div');
      count.className = 'b2-opnav-count';
      count.textContent = `${items.length} relacionado${items.length === 1 ? '' : 's'}`;
      head.appendChild(count);
    }
    block.appendChild(head);
    const actions = doc.createElement('div');
    actions.className = 'b2-opnav-actions';
    if (!items.length) {
      const empty = doc.createElement('div');
      empty.className = 'b2-opnav-empty';
      empty.textContent = 'Sin relaciones operativas registradas.';
      actions.appendChild(empty);
    } else {
      items.forEach(item => actions.appendChild(makeButton(doc, item.label, item.action, item.primary)));
    }
    block.appendChild(actions);
    return block;
  }

  function callEmbedded(sectionId, method, args = []) {
    const frame = embeddedFrame(sectionId);
    if (!frame) return false;

    const invoke = () => {
      try {
        decorateEmbedded(sectionId, frame);
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
    if (!refresh && linksCache) return linksCache;
    if (!refresh && linksPromise) return linksPromise;

    const token = localStorage.getItem('export_mca_token') || '';
    linksPromise = fetch('/api/operational-links', {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los enlaces operativos');
        linksCache = {
          links:Array.isArray(data.links) ? data.links : [],
          purchases:Array.isArray(data.purchases) ? data.purchases : [],
          receipts:Array.isArray(data.receipts) ? data.receipts : []
        };
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
    const data = await requestLinks();
    return data.links.find(item => String(item.shipment_id) === String(shipmentId)) || null;
  }

  async function loadsForOperation(operationId) {
    if (!operationId) return [];
    const data = await requestLinks();
    return data.links.filter(item => String(item.operation_id || '') === String(operationId));
  }

  async function loadsForReceipt(receiptNumber) {
    const key = normalize(receiptNumber);
    if (!key) return [];
    const data = await requestLinks();
    return data.links.filter(item => Array.isArray(item.receipt_numbers) && item.receipt_numbers.some(receipt => normalize(receipt) === key));
  }

  async function purchaseOrdersForSupplier(supplierId) {
    if (!supplierId) return [];
    const data = await requestLinks();
    return data.purchases.filter(item => String(item.supplier_id || '') === String(supplierId));
  }

  async function receiptsForSupplier(supplierId) {
    if (!supplierId) return [];
    const data = await requestLinks();
    return data.receipts.filter(item => String(item.supplier_id || '') === String(supplierId));
  }

  async function purchaseOrdersForReceipt(receiptNumber) {
    const key = normalize(receiptNumber);
    if (!key) return [];
    const data = await requestLinks();
    return data.purchases.filter(item => Array.isArray(item.receipts) && item.receipts.some(receipt => normalize(receipt.receipt_number) === key));
  }

  async function receiptsForPurchase(purchaseOrderId) {
    if (!purchaseOrderId) return [];
    const data = await requestLinks();
    return data.purchases.find(item => String(item.purchase_order_id) === String(purchaseOrderId))?.receipts || [];
  }

  async function purchaseByNumber(poNumber) {
    const key = normalize(poNumber);
    if (!key) return null;
    const data = await requestLinks();
    return data.purchases.find(item => normalize(item.po_number) === key) || null;
  }

  async function receiptByNumber(receiptNumber) {
    const key = normalize(receiptNumber);
    if (!key) return null;
    const data = await requestLinks();
    return data.receipts.find(item => normalize(item.receipt_number) === key) || null;
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

  async function openWarehouseReceipt({ receiptNumber = null } = {}, options = {}) {
    const receipt = await receiptByNumber(receiptNumber);
    if (!receipt?.id) return false;
    if (options.history !== false) writeContext('receipt', receipt.receipt_number, options);
    window.NavigationShell?.openWarehouse?.();
    return callEmbedded('warehouseSection', 'showReceipt', [receipt.id]);
  }

  function openPurchase({ purchaseOrderId = null } = {}, options = {}) {
    if (!purchaseOrderId) return false;
    if (options.history !== false) writeContext('po', purchaseOrderId, options);
    window.NavigationShell?.openPurchases?.();
    return callEmbedded('purchasesSection', 'openPurchase', [purchaseOrderId]);
  }

  function openSupplier({ supplierId = null } = {}, options = {}) {
    if (!supplierId) return false;
    if (options.history !== false) writeContext('supplier', supplierId, options);
    window.NavigationShell?.openSuppliers?.();
    return callEmbedded('suppliersSection', 'openSupplier', [supplierId]);
  }

  function openExpediente(operationId, options = {}) {
    if (!operationId) return false;
    if (options.history !== false) writeContext('expediente', operationId, options);
    section('newOperationsSection');
    requestAnimationFrame(() => window.ExpedientesModule?.open?.(operationId));
    return true;
  }

  async function showSupplierActivity(frame, supplierId) {
    const doc = frame.contentDocument;
    if (!doc) return false;
    const supplierRow = doc.querySelector(`[data-edit="${CSS.escape(String(supplierId))}"]`)?.closest('.supplier-row');
    const supplierName = supplierRow?.querySelector('.supplier-name')?.textContent?.trim() || 'Proveedor';
    const [purchases, receipts] = await Promise.all([purchaseOrdersForSupplier(supplierId), receiptsForSupplier(supplierId)]);
    let modal = doc.getElementById('b2SupplierActivityModal');
    if (!modal) {
      modal = doc.createElement('div');
      modal.id = 'b2SupplierActivityModal';
      modal.className = 'modal hidden';
      modal.innerHTML = '<div class="dialog"><div class="dialog-head"><div><h2 id="b2SupplierActivityTitle"></h2><div class="supplier-meta">Purchase Orders y Warehouse Receipts vinculados por el proveedor maestro.</div></div><button class="btn" id="b2SupplierActivityClose">✕</button></div><div id="b2SupplierActivityBody"></div></div>';
      doc.body.appendChild(modal);
      doc.getElementById('b2SupplierActivityClose').onclick = () => modal.classList.add('hidden');
      modal.addEventListener('click', event => { if (event.target === modal) modal.classList.add('hidden'); });
    }
    doc.getElementById('b2SupplierActivityTitle').textContent = supplierName;
    const body = doc.getElementById('b2SupplierActivityBody');
    body.innerHTML = '';
    body.appendChild(navigationBlock(doc, 'Purchase Orders', purchases.map(po => ({
      label:`${po.po_number} · ${po.status || 'sin estado'}`,
      action:() => openPurchase({ purchaseOrderId:po.purchase_order_id })
    }))));
    body.appendChild(navigationBlock(doc, 'Warehouse Receipts', receipts.map(receipt => ({
      label:`${receipt.receipt_number} · ${receipt.status === 'cancelled' ? 'Anulado' : 'Recibido'}`,
      action:() => openWarehouseReceipt({ receiptNumber:receipt.receipt_number })
    }))));
    modal.classList.remove('hidden');
    supplierRow?.scrollIntoView({ block:'center', behavior:'smooth' });
    supplierRow?.classList.add('b2-opnav-highlight');
    setTimeout(() => supplierRow?.classList.remove('b2-opnav-highlight'), 1600);
    return true;
  }

  function decorateSuppliers(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    childStyle(doc);
    const attach = () => {
      doc.querySelectorAll('.supplier-row').forEach(row => {
        const edit = row.querySelector('[data-edit]');
        const actions = row.querySelector('.actions');
        if (!edit || !actions || actions.querySelector('[data-b2-supplier-trace]')) return;
        const button = makeButton(doc, 'Actividad', () => {
          writeContext('supplier', edit.dataset.edit);
          return showSupplierActivity(frame, edit.dataset.edit);
        });
        button.dataset.b2SupplierTrace = edit.dataset.edit;
        actions.prepend(button);
      });
    };
    attach();
    if (!frame.__b2SupplierObserver) {
      const target = doc.getElementById('supplierList');
      if (target) {
        frame.__b2SupplierObserver = new MutationObserver(attach);
        frame.__b2SupplierObserver.observe(target, { childList:true, subtree:true });
      }
    }
    frame.contentWindow.openSupplier = supplierId => showSupplierActivity(frame, supplierId);
  }

  async function renderPurchaseTrace(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    const modal = doc.getElementById('detailModal');
    if (!modal || modal.classList.contains('hidden')) return;
    const poNumber = doc.getElementById('detailTitle')?.textContent?.trim();
    const purchase = await purchaseByNumber(poNumber);
    if (!purchase?.purchase_order_id || modal.classList.contains('hidden')) return;
    const body = doc.getElementById('detailBody');
    if (!body) return;
    doc.getElementById('b2PurchaseTrace')?.remove();
    const items = [];
    if (purchase.supplier_id) items.push({ label:'Ver proveedor', primary:true, action:() => openSupplier({ supplierId:purchase.supplier_id }) });
    (purchase.receipts || []).forEach(receipt => items.push({
      label:`${receipt.receipt_number}${receipt.status === 'cancelled' ? ' · anulado' : ''}`,
      action:() => openWarehouseReceipt({ receiptNumber:receipt.receipt_number })
    }));
    const block = navigationBlock(doc, 'Trazabilidad · Proveedor y WR recibidos', items);
    block.id = 'b2PurchaseTrace';
    body.appendChild(block);
  }

  function decoratePurchases(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    childStyle(doc);
    const win = frame.contentWindow;
    if (typeof win.openPurchase !== 'function') win.openPurchase = purchaseOrderId => win.openDetail?.(purchaseOrderId);
    const modal = doc.getElementById('detailModal');
    if (modal && !frame.__b2PurchaseObserver) {
      frame.__b2PurchaseObserver = new MutationObserver(() => {
        renderPurchaseTrace(frame).catch(error => console.error('[purchase traceability]', error));
      });
      frame.__b2PurchaseObserver.observe(modal, { attributes:true, attributeFilter:['class'] });
      const title = doc.getElementById('detailTitle');
      if (title) frame.__b2PurchaseObserver.observe(title, { childList:true, subtree:true });
    }
    renderPurchaseTrace(frame).catch(error => console.error('[purchase traceability]', error));
  }

  async function renderWarehouseTrace(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    const modal = doc.getElementById('detailModal');
    if (!modal || modal.classList.contains('hidden')) return;
    const receiptNumber = doc.getElementById('detailTitle')?.textContent?.trim();
    if (!receiptNumber) return;
    const purchases = await purchaseOrdersForReceipt(receiptNumber);
    const body = doc.getElementById('detailBody');
    if (!body || modal.classList.contains('hidden')) return;
    doc.getElementById('b2WarehouseTrace')?.remove();
    const items = [
      { label:'Ver en Inventario', primary:true, action:() => openInventoryReceipt(receiptNumber) },
      ...purchases.map(po => ({ label:`Origen ${po.po_number}`, action:() => openPurchase({ purchaseOrderId:po.purchase_order_id }) }))
    ];
    const block = navigationBlock(doc, 'Trazabilidad · PO de origen e Inventario', items);
    block.id = 'b2WarehouseTrace';
    body.appendChild(block);
  }

  function decorateWarehouse(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    childStyle(doc);
    const modal = doc.getElementById('detailModal');
    if (modal && !frame.__b2WarehouseObserver) {
      frame.__b2WarehouseObserver = new MutationObserver(() => {
        renderWarehouseTrace(frame).catch(error => console.error('[warehouse traceability]', error));
      });
      frame.__b2WarehouseObserver.observe(modal, { attributes:true, attributeFilter:['class'] });
      const title = doc.getElementById('detailTitle');
      if (title) frame.__b2WarehouseObserver.observe(title, { childList:true, subtree:true });
    }
    renderWarehouseTrace(frame).catch(error => console.error('[warehouse traceability]', error));
  }

  async function renderInventoryOrigins(frame, receiptNumber) {
    const doc = frame.contentDocument;
    if (!doc || !receiptNumber) return;
    let card = doc.getElementById('b2PurchaseOriginsCard');
    if (!card) {
      card = doc.createElement('section');
      card.id = 'b2PurchaseOriginsCard';
      card.className = 'card hidden';
      const traceView = doc.getElementById('traceView');
      if (traceView) traceView.insertBefore(card, traceView.firstChild);
    }
    const purchases = await purchaseOrdersForReceipt(receiptNumber);
    card.innerHTML = '';
    const block = navigationBlock(doc, `Origen de compra · ${receiptNumber}`, purchases.map(po => ({
      label:po.po_number,
      action:() => openPurchase({ purchaseOrderId:po.purchase_order_id })
    })));
    card.appendChild(block);
    card.classList.remove('hidden');
  }

  function decorateInventory(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    childStyle(doc);
    const win = frame.contentWindow;
    if (!frame.__b2OriginalTraceWR && typeof win.traceWR === 'function') {
      frame.__b2OriginalTraceWR = win.traceWR;
      win.traceWR = receiptNumber => {
        const result = frame.__b2OriginalTraceWR(receiptNumber);
        renderInventoryOrigins(frame, String(receiptNumber || '').trim()).catch(error => console.error('[inventory purchase origins]', error));
        return result;
      };
    }
    const title = doc.getElementById('relatedLoadsTitle');
    if (title && !frame.__b2InventoryObserver) {
      frame.__b2InventoryObserver = new MutationObserver(() => {
        const match = title.textContent.match(/·\s*(WR-[A-Z0-9-]+)/i);
        if (match?.[1]) renderInventoryOrigins(frame, match[1]).catch(error => console.error('[inventory purchase origins]', error));
      });
      frame.__b2InventoryObserver.observe(title, { childList:true, subtree:true });
    }
  }

  function decorateEmbedded(sectionId, frame = embeddedFrame(sectionId)) {
    if (!frame?.contentDocument || frame.contentDocument.readyState !== 'complete') return false;
    try {
      if (sectionId === 'suppliersSection') decorateSuppliers(frame);
      if (sectionId === 'purchasesSection') decoratePurchases(frame);
      if (sectionId === 'warehouseSection') decorateWarehouse(frame);
      if (sectionId === 'inventorySection') decorateInventory(frame);
      return true;
    } catch (error) {
      console.error('[operational navigation decorate]', sectionId, error);
      return false;
    }
  }

  function decorateAllEmbedded() {
    ['suppliersSection','purchasesSection','warehouseSection','inventorySection'].forEach(sectionId => {
      const frame = embeddedFrame(sectionId);
      if (!frame) return;
      if (frame.contentDocument?.readyState === 'complete') decorateEmbedded(sectionId, frame);
      else frame.addEventListener('load', () => decorateEmbedded(sectionId, frame), { once:true });
    });
  }

  async function restoreContext() {
    const context = readContext();
    if (!context || restoringContext) return false;
    restoringContext = true;
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
      restoringContext = false;
    }
  }

  window.addEventListener('hashchange', () => { restoreContext().catch(error => console.error('[operational navigation restore]', error)); });
  window.addEventListener('popstate', () => { restoreContext().catch(error => console.error('[operational navigation restore]', error)); });
  window.addEventListener('export-mca:data-loaded', () => {
    invalidateLinks();
    decorateAllEmbedded();
    restoreContext().catch(error => console.error('[operational navigation restore]', error));
  });
  window.addEventListener('export-mca:section-changed', () => requestAnimationFrame(decorateAllEmbedded));
  window.addEventListener('load', () => requestAnimationFrame(decorateAllEmbedded), { once:true });

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
    refreshLinks: () => requestLinks({ refresh:true }),
    owner: 'operational-navigation.js'
  });

  requestAnimationFrame(decorateAllEmbedded);
})();
