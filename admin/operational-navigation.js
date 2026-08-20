(() => {
  if (window.__operationalNavigationInstalled) return;
  window.__operationalNavigationInstalled = true;

  const normalize = value => String(value || '').trim().toUpperCase();
  const OPERATIONAL_SECTIONS = ['suppliersSection','purchasesSection','warehouseSection','inventorySection'];
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

  function installChildStyle(doc) {
    if (!doc?.head || doc.getElementById('operational-context-style')) return;
    const style = doc.createElement('style');
    style.id = 'operational-context-style';
    style.textContent = `
      .op-context{margin-top:12px;padding:11px;border:1px solid #dfe5ee;border-radius:10px;background:#f8fafc}
      .op-context-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}
      .op-context-title{font-size:10px;text-transform:uppercase;color:#667085;font-weight:900}
      .op-context-count,.op-context-empty{font-size:10px;color:#667085}
      .op-context-actions{display:flex;gap:7px;flex-wrap:wrap}
      .op-context-btn{border:1px solid #cfd9e8!important;background:#fff!important;color:#06204a!important;border-radius:8px!important;padding:7px 9px!important;font-size:10px!important;font-weight:900!important;cursor:pointer!important}
      .op-context-btn.primary{background:#06204a!important;color:#fff!important;border-color:#06204a!important}
      .op-context-highlight{outline:2px solid #f58220;outline-offset:2px;border-radius:9px}
      @media(max-width:650px){.op-context-btn{flex:1 1 130px;text-align:left}}
    `;
    doc.head.appendChild(style);
  }

  function contextButton(doc, label, action, primary = false) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `op-context-btn${primary ? ' primary' : ''}`;
    button.textContent = label;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve(action()).catch(error => console.error('[operational context action]', error));
    });
    return button;
  }

  function contextBlock(doc, title, items) {
    const block = doc.createElement('div');
    block.className = 'op-context';
    const head = doc.createElement('div');
    head.className = 'op-context-head';
    const heading = doc.createElement('div');
    heading.className = 'op-context-title';
    heading.textContent = title;
    head.appendChild(heading);
    if (items.length) {
      const count = doc.createElement('div');
      count.className = 'op-context-count';
      count.textContent = `${items.length} relacionado${items.length === 1 ? '' : 's'}`;
      head.appendChild(count);
    }
    block.appendChild(head);
    const actions = doc.createElement('div');
    actions.className = 'op-context-actions';
    if (!items.length) {
      const empty = doc.createElement('div');
      empty.className = 'op-context-empty';
      empty.textContent = 'Sin relaciones operativas registradas.';
      actions.appendChild(empty);
    } else {
      items.forEach(item => actions.appendChild(contextButton(doc, item.label, item.action, item.primary)));
    }
    block.appendChild(actions);
    return block;
  }

  function decorateSuppliers(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    installChildStyle(doc);

    async function openSupplierActivity(supplierId) {
      const row = doc.querySelector(`[data-edit="${CSS.escape(String(supplierId))}"]`)?.closest('.supplier-row');
      const supplierName = row?.querySelector('.supplier-name')?.textContent?.trim() || 'Proveedor';
      const [purchases, receipts] = await Promise.all([
        purchaseOrdersForSupplier(supplierId),
        receiptsForSupplier(supplierId)
      ]);

      let modal = doc.getElementById('supplierOperationalActivity');
      if (!modal) {
        modal = doc.createElement('div');
        modal.id = 'supplierOperationalActivity';
        modal.className = 'modal hidden';
        modal.innerHTML = '<div class="dialog"><div class="dialog-head"><div><h2 id="supplierOperationalTitle"></h2><div class="supplier-meta">Purchase Orders y Warehouse Receipts vinculados al proveedor maestro.</div></div><button class="btn" id="supplierOperationalClose">✕</button></div><div id="supplierOperationalBody"></div></div>';
        doc.body.appendChild(modal);
        doc.getElementById('supplierOperationalClose').onclick = () => modal.classList.add('hidden');
        modal.addEventListener('click', event => { if (event.target === modal) modal.classList.add('hidden'); });
      }

      doc.getElementById('supplierOperationalTitle').textContent = supplierName;
      const body = doc.getElementById('supplierOperationalBody');
      body.innerHTML = '';
      body.appendChild(contextBlock(doc, 'Purchase Orders', purchases.map(po => ({
        label:`${po.po_number} · ${po.po_status || 'sin estado'}`,
        action:() => openPurchase({ purchaseOrderId:po.purchase_order_id })
      }))));
      body.appendChild(contextBlock(doc, 'Warehouse Receipts', receipts.map(receipt => ({
        label:`${receipt.receipt_number} · ${receipt.status === 'cancelled' ? 'Anulado' : 'Recibido'}`,
        action:() => openWarehouseReceipt({ receiptNumber:receipt.receipt_number })
      }))));
      modal.classList.remove('hidden');
      row?.scrollIntoView({ block:'center', behavior:'smooth' });
      row?.classList.add('op-context-highlight');
      setTimeout(() => row?.classList.remove('op-context-highlight'), 1500);
      return true;
    }

    function attachButtons() {
      doc.querySelectorAll('.supplier-row').forEach(row => {
        const edit = row.querySelector('[data-edit]');
        const actions = row.querySelector('.actions');
        if (!edit || !actions || actions.querySelector('[data-operational-activity]')) return;
        const button = contextButton(doc, 'Actividad', () => {
          writeContext('supplier', edit.dataset.edit);
          return openSupplierActivity(edit.dataset.edit);
        });
        button.dataset.operationalActivity = edit.dataset.edit;
        actions.prepend(button);
      });
    }

    attachButtons();
    if (!frame.__supplierOperationalObserver) {
      const list = doc.getElementById('supplierList');
      if (list) {
        frame.__supplierOperationalObserver = new MutationObserver(attachButtons);
        frame.__supplierOperationalObserver.observe(list, { childList:true, subtree:true });
      }
    }
    frame.contentWindow.openSupplier = openSupplierActivity;
  }

  async function renderPurchaseContext(frame) {
    const doc = frame.contentDocument;
    const modal = doc?.getElementById('detailModal');
    if (!doc || !modal || modal.classList.contains('hidden')) return;
    const poNumber = doc.getElementById('detailTitle')?.textContent?.trim();
    const purchase = await purchaseByNumber(poNumber);
    if (!purchase?.purchase_order_id || modal.classList.contains('hidden')) return;
    const body = doc.getElementById('detailBody');
    if (!body) return;
    doc.getElementById('purchaseOperationalContext')?.remove();
    const items = [];
    if (purchase.supplier_id) items.push({
      label:'Ver proveedor', primary:true,
      action:() => openSupplier({ supplierId:purchase.supplier_id })
    });
    purchase.receipts.forEach(receipt => items.push({
      label:`${receipt.receipt_number}${receipt.receipt_status === 'cancelled' ? ' · anulado' : ''}`,
      action:() => openWarehouseReceipt({ receiptNumber:receipt.receipt_number })
    }));
    const block = contextBlock(doc, 'Trazabilidad · Proveedor y WR recibidos', items);
    block.id = 'purchaseOperationalContext';
    body.appendChild(block);
  }

  function decoratePurchases(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    installChildStyle(doc);
    const win = frame.contentWindow;
    if (typeof win.openPurchase !== 'function') win.openPurchase = id => win.openDetail?.(id);
    const modal = doc.getElementById('detailModal');
    if (modal && !frame.__purchaseOperationalObserver) {
      frame.__purchaseOperationalObserver = new MutationObserver(() => {
        renderPurchaseContext(frame).catch(error => console.error('[purchase operational context]', error));
      });
      frame.__purchaseOperationalObserver.observe(modal, { attributes:true, attributeFilter:['class'] });
      const title = doc.getElementById('detailTitle');
      if (title) frame.__purchaseOperationalObserver.observe(title, { childList:true, subtree:true });
    }
    renderPurchaseContext(frame).catch(error => console.error('[purchase operational context]', error));
  }

  async function renderWarehouseContext(frame) {
    const doc = frame.contentDocument;
    const modal = doc?.getElementById('detailModal');
    if (!doc || !modal || modal.classList.contains('hidden')) return;
    const receiptNumber = doc.getElementById('detailTitle')?.textContent?.trim();
    if (!receiptNumber) return;
    const purchases = await purchaseOrdersForReceipt(receiptNumber);
    if (modal.classList.contains('hidden')) return;
    const body = doc.getElementById('detailBody');
    if (!body) return;
    doc.getElementById('warehouseOperationalContext')?.remove();
    const items = [
      { label:'Ver en Inventario', primary:true, action:() => openInventoryReceipt(receiptNumber) },
      ...purchases.map(po => ({ label:`Origen ${po.po_number}`, action:() => openPurchase({ purchaseOrderId:po.purchase_order_id }) }))
    ];
    const block = contextBlock(doc, 'Trazabilidad · PO de origen e Inventario', items);
    block.id = 'warehouseOperationalContext';
    body.appendChild(block);
  }

  function decorateWarehouse(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    installChildStyle(doc);
    const modal = doc.getElementById('detailModal');
    if (modal && !frame.__warehouseOperationalObserver) {
      frame.__warehouseOperationalObserver = new MutationObserver(() => {
        renderWarehouseContext(frame).catch(error => console.error('[warehouse operational context]', error));
      });
      frame.__warehouseOperationalObserver.observe(modal, { attributes:true, attributeFilter:['class'] });
      const title = doc.getElementById('detailTitle');
      if (title) frame.__warehouseOperationalObserver.observe(title, { childList:true, subtree:true });
    }
    renderWarehouseContext(frame).catch(error => console.error('[warehouse operational context]', error));
  }

  async function renderInventoryContext(frame, receiptNumber) {
    const doc = frame.contentDocument;
    if (!doc || !receiptNumber) return;
    installChildStyle(doc);
    let card = doc.getElementById('purchaseOriginCard');
    if (!card) {
      card = doc.createElement('section');
      card.id = 'purchaseOriginCard';
      card.className = 'card hidden';
      const trace = doc.getElementById('traceView');
      if (trace) trace.insertBefore(card, trace.firstChild);
    }
    const purchases = await purchaseOrdersForReceipt(receiptNumber);
    card.innerHTML = '';
    card.appendChild(contextBlock(doc, `Origen de compra · ${receiptNumber}`, purchases.map(po => ({
      label:po.po_number,
      action:() => openPurchase({ purchaseOrderId:po.purchase_order_id })
    }))));
    card.classList.remove('hidden');
  }

  function decorateInventory(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    installChildStyle(doc);
    const win = frame.contentWindow;
    if (!frame.__originalTraceWR && typeof win.traceWR === 'function') {
      frame.__originalTraceWR = win.traceWR;
      win.traceWR = receiptNumber => {
        const result = frame.__originalTraceWR(receiptNumber);
        renderInventoryContext(frame, String(receiptNumber || '').trim()).catch(error => console.error('[inventory purchase origin]', error));
        return result;
      };
    }
    const title = doc.getElementById('relatedLoadsTitle');
    if (title && !frame.__inventoryOperationalObserver) {
      frame.__inventoryOperationalObserver = new MutationObserver(() => {
        const match = title.textContent.match(/·\s*(WR-[A-Z0-9-]+)/i);
        if (match?.[1]) renderInventoryContext(frame, match[1]).catch(error => console.error('[inventory purchase origin]', error));
      });
      frame.__inventoryOperationalObserver.observe(title, { childList:true, subtree:true });
    }
  }

  function decorateEmbedded(sectionId, frame = frameFor(sectionId)) {
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

  function decorateAll() {
    OPERATIONAL_SECTIONS.forEach(id => {
      const frame = frameFor(id);
      if (!frame) return;
      if (frame.contentDocument?.readyState === 'complete') decorateEmbedded(id, frame);
      else frame.addEventListener('load', () => decorateEmbedded(id, frame), { once:true });
    });
  }

  function callEmbedded(sectionId, method, args = []) {
    const frame = frameFor(sectionId);
    if (!frame) return false;
    const invoke = () => {
      decorateEmbedded(sectionId, frame);
      const fn = frame.contentWindow?.[method];
      if (typeof fn !== 'function') return false;
      fn(...args);
      return true;
    };
    if (frame.contentDocument?.readyState === 'complete') {
      requestAnimationFrame(invoke);
      return true;
    }
    frame.addEventListener('load', () => requestAnimationFrame(invoke), { once:true });
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
    decorateAll();
    restoreContext().catch(error => console.error('[operational context restore]', error));
  });
  window.addEventListener('export-mca:section-changed', () => requestAnimationFrame(decorateAll));
  window.addEventListener('load', () => requestAnimationFrame(decorateAll), { once:true });

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

  requestAnimationFrame(decorateAll);
})();
