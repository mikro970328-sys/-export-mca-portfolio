(() => {
  if (window.OperationalContextBridge?.ready) return;

  const path = location.pathname.toLowerCase();
  const parentNav = () => { try { return parent?.OperationalNavigation || null; } catch { return null; } };
  const parentCan = permission => { try { return parent?.ExportMcaAccessControl?.can?.(permission) === true; } catch { return false; } };

  function installStyles() {
    if (document.getElementById('operationalContextStyles')) return;
    const style = document.createElement('style');
    style.id = 'operationalContextStyles';
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
    document.head.appendChild(style);
  }

  function button(label, action, primary = false) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = `op-context-btn${primary ? ' primary' : ''}`;
    control.textContent = label;
    control.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve(action()).catch(error => console.error('[operational context action]', error));
    });
    return control;
  }

  function block(title, items = [], emptyText = 'Sin relaciones operativas registradas.') {
    const wrapper = document.createElement('div');
    wrapper.className = 'op-context';
    const head = document.createElement('div');
    head.className = 'op-context-head';
    const heading = document.createElement('div');
    heading.className = 'op-context-title';
    heading.textContent = title;
    head.appendChild(heading);
    if (items.length) {
      const count = document.createElement('div');
      count.className = 'op-context-count';
      count.textContent = `${items.length} relacionado${items.length === 1 ? '' : 's'}`;
      head.appendChild(count);
    }
    wrapper.appendChild(head);
    const actions = document.createElement('div');
    actions.className = 'op-context-actions';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'op-context-empty';
      empty.textContent = emptyText;
      actions.appendChild(empty);
    } else items.forEach(item => actions.appendChild(button(item.label, item.action, item.primary)));
    wrapper.appendChild(actions);
    return wrapper;
  }

  function findByData(attribute, value) {
    return [...document.querySelectorAll(`[data-${attribute}]`)]
      .find(element => String(element.dataset[attribute] || '') === String(value)) || null;
  }
  function flash(element) {
    if (!element) return;
    element.scrollIntoView({ block:'center', behavior:'smooth' });
    element.classList.add('op-context-highlight');
    setTimeout(() => element.classList.remove('op-context-highlight'), 1500);
  }
  function observeChanges(target, callback) {
    if (!target) return null;
    const observer = new MutationObserver(callback);
    observer.observe(target, { childList:true, subtree:true });
    return observer;
  }
  function uniqueReceiptNumbers(loads = []) {
    return [...new Set(loads.flatMap(load => Array.isArray(load.receipt_numbers) ? load.receipt_numbers : []).filter(Boolean))];
  }

  function initSuppliers() {
    const nav = parentNav();
    if (!nav) return;
    async function openSupplier(supplierId) {
      const edit = findByData('edit', supplierId);
      const row = edit?.closest('.supplier-row') || null;
      const name = row?.querySelector('.supplier-name')?.textContent?.trim() || 'Proveedor';
      const [purchases, receipts] = await Promise.all([nav.purchaseOrdersForSupplier(supplierId),nav.receiptsForSupplier(supplierId)]);
      let modal = document.getElementById('supplierOperationalActivity');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'supplierOperationalActivity';
        modal.className = 'modal hidden';
        modal.innerHTML = '<div class="dialog"><div class="dialog-head"><div><h2 id="supplierOperationalTitle"></h2><div class="supplier-meta">Compras y recepciones físicas vinculadas al proveedor.</div></div><button class="btn" id="supplierOperationalClose">Cerrar</button></div><div id="supplierOperationalBody"></div></div>';
        document.body.appendChild(modal);
        document.getElementById('supplierOperationalClose').onclick = () => modal.classList.add('hidden');
        modal.addEventListener('click', event => { if (event.target === modal) modal.classList.add('hidden'); });
      }
      document.getElementById('supplierOperationalTitle').textContent = name;
      const body = document.getElementById('supplierOperationalBody');
      body.innerHTML = '';
      body.appendChild(block('Purchase Orders',purchases.map(po => ({label:`${po.po_number} · ${po.po_status || 'sin estado'}`,action:() => nav.openPurchase({ purchaseOrderId:po.purchase_order_id })})),'Este proveedor todavía no tiene Purchase Orders.'));
      body.appendChild(block('Warehouse Receipts',receipts.map(receipt => ({label:`${receipt.receipt_number} · ${receipt.status === 'cancelled' ? 'Anulado' : 'Recibido'}`,action:() => nav.openWarehouseReceipt({ receiptNumber:receipt.receipt_number })})),'Este proveedor todavía no tiene WR vinculados.'));
      modal.classList.remove('hidden');
      flash(row);
      return true;
    }
    function attachActivityButtons() {
      document.querySelectorAll('.supplier-row').forEach(row => {
        const edit = row.querySelector('[data-edit]');
        const actions = row.querySelector('.actions');
        if (!edit || !actions || actions.querySelector('[data-operational-activity]')) return;
        const control = button('Actividad', () => nav.openSupplier({ supplierId:edit.dataset.edit }));
        control.dataset.operationalActivity = edit.dataset.edit;
        actions.prepend(control);
      });
    }
    attachActivityButtons();
    observeChanges(document.getElementById('supplierList'), () => { nav.invalidateLinks?.(); attachActivityButtons(); });
    window.openOperationalSupplier = openSupplier;
  }

  function initPurchases() {
    const nav = parentNav();
    if (!nav) return;
    async function renderContext() {
      const modal = document.getElementById('detailModal');
      if (!modal || modal.classList.contains('hidden')) return;
      const poNumber = document.getElementById('detailTitle')?.textContent?.trim();
      const purchase = await nav.purchaseByNumber(poNumber);
      if (!purchase?.purchase_order_id || modal.classList.contains('hidden')) return;
      const body = document.getElementById('detailBody');
      if (!body) return;
      document.getElementById('purchaseOperationalContextSupplier')?.remove();
      document.getElementById('purchaseOperationalContextReceipts')?.remove();
      const supplierBlock = block('Proveedor',purchase.supplier_id ? [{label:'Ver proveedor',primary:true,action:() => nav.openSupplier({ supplierId:purchase.supplier_id })}] : [],'La PO no tiene proveedor resoluble.');
      supplierBlock.id = 'purchaseOperationalContextSupplier';
      body.appendChild(supplierBlock);
      const receiptBlock = block('Warehouse Receipts recibidos',(purchase.receipts || []).map(receipt => ({label:`${receipt.receipt_number}${receipt.receipt_status === 'cancelled' ? ' · anulado' : ''}`,action:() => nav.openWarehouseReceipt({ receiptNumber:receipt.receipt_number })})),'Todavía no hay WR creados desde esta PO.');
      receiptBlock.id = 'purchaseOperationalContextReceipts';
      body.appendChild(receiptBlock);
    }
    window.openOperationalPurchase = purchaseOrderId => {
      if (typeof window.openDetail !== 'function') return false;
      window.openDetail(purchaseOrderId);
      renderContext().catch(error => console.error('[purchase operational context]', error));
      return true;
    };
    window.openOperationalPurchaseReceipt = purchaseOrderId => {
      if (typeof window.openDetail !== 'function') return false;
      window.openDetail(purchaseOrderId);
      requestAnimationFrame(() => document.querySelector('#detailActions [data-detail-action="receive"]')?.click());
      return true;
    };
    const modal = document.getElementById('detailModal');
    if (modal) {
      const observer = new MutationObserver(() => renderContext().catch(error => console.error('[purchase operational context]', error)));
      observer.observe(modal, { attributes:true, attributeFilter:['class'] });
      const title = document.getElementById('detailTitle');
      if (title) observer.observe(title, { childList:true, subtree:true });
    }
    observeChanges(document.getElementById('orderList'), () => nav.invalidateLinks?.());
  }

  function initSales() {
    const nav = parentNav();
    if (!nav) return;
    async function renderContext() {
      const modal = document.getElementById('detailModal');
      if (!modal || modal.classList.contains('hidden')) return;
      const title = document.getElementById('detailTitle')?.textContent?.trim() || '';
      const soNumber = title.split(' · ')[0].trim();
      const sale = await nav.salesByNumber(soNumber);
      if (!sale?.sales_order_id || modal.classList.contains('hidden')) return;
      const body = document.getElementById('detailBody');
      if (!body) return;
      ['salesOperationalClient','salesOperationalLoads','salesOperationalSources','salesOperationalDownstream','salesOperationalBilling'].forEach(id => document.getElementById(id)?.remove());

      if (parentCan('clients.read')) {
        const clientBlock = block('Cliente',sale.client_id ? [{ label:'Ver cliente', primary:true, action:() => nav.openClient({ clientId:sale.client_id }) }] : [],'La Sales Order no tiene cliente resoluble.');
        clientBlock.id = 'salesOperationalClient';body.appendChild(clientBlock);
      }
      if (parentCan('logistics.read')) {
        const loadBlock = block('Cargues vinculados',(sale.loads || []).map(load => ({label:`${load.load_number} · ${load.load_status || 'sin estado'}`,action:() => nav.openLoad({ loadId:load.load_id })})),'Todavía no hay Cargues vinculados a esta Sales Order.');
        loadBlock.id = 'salesOperationalLoads';body.appendChild(loadBlock);
      }
      if (parentCan('warehouse.read')) {
        const receiptNumbers = uniqueReceiptNumbers(sale.loads || []);
        const sourceBlock = block('Inventario / WR de origen',receiptNumbers.map(receiptNumber => ({label:receiptNumber,action:() => nav.openInventoryReceipt(receiptNumber)})),'Todavía no hay WR físicos vinculados.');
        sourceBlock.id = 'salesOperationalSources';body.appendChild(sourceBlock);
      }
      if (parentCan('logistics.read')) {
        const downstream = [];
        (sale.loads || []).forEach(load => { if (load.shipment_id) downstream.push({label:`Contenedor · ${load.container_number || load.load_number}`,action:() => nav.openTracking({ shipmentId:load.shipment_id })}); });
        (sale.direct_shipments || []).forEach(shipment => downstream.push({label:`Direct Ship · ${shipment.container_number || 'Contenedor'}`,action:() => nav.openTracking({ shipmentId:shipment.shipment_id })}));
        const downstreamBlock = block('Contenedores / Tracking',downstream,'Esta venta todavía no tiene un contenedor vinculado.');
        downstreamBlock.id = 'salesOperationalDownstream';body.appendChild(downstreamBlock);
      }
      if (parentCan('finance.read')) {
        const invoices = await nav.invoicesForSalesOrder(sale.sales_order_id);
        const billingBlock = block('Facturación',invoices.filter(row=>row.status!=='void').map(invoice => ({label:`${invoice.invoice_number} · ${invoice.status === 'draft' ? 'Borrador' : 'Emitida'}`,action:() => nav.openInvoice(invoice.invoice_id)})),parentCan('finance.write')?'Todavía no hay factura financiera. Usa Facturación para crearla.':'Todavía no hay factura financiera.');
        billingBlock.id = 'salesOperationalBilling';body.appendChild(billingBlock);
      }
    }
    window.openOperationalSale = salesOrderId => {
      if (typeof window.openDetail !== 'function') return false;
      window.openDetail(salesOrderId);
      renderContext().catch(error => console.error('[sales operational context]', error));
      return true;
    };
    window.openOperationalSalesSupply = salesOrderId => {
      if (window.SalesSupplyWorkspace?.open) { window.SalesSupplyWorkspace.open(salesOrderId); return true; }
      return window.openOperationalSale(salesOrderId);
    };
    const modal = document.getElementById('detailModal');
    if (modal) {
      const observer = new MutationObserver(() => renderContext().catch(error => console.error('[sales operational context]', error)));
      observer.observe(modal, { attributes:true, attributeFilter:['class'] });
      const title = document.getElementById('detailTitle');
      if (title) observer.observe(title, { childList:true, subtree:true });
    }
    observeChanges(document.getElementById('orderList'), () => nav.invalidateLinks?.());
  }

  function initLoads() {
    const nav = parentNav();
    if (!nav || typeof window.openLoad !== 'function') return;
    const originalOpenLoad = window.openLoad;
    let currentLoadId = null;
    async function renderContext(loadId = currentLoadId) {
      const modal = document.getElementById('drawerModal');
      if (!loadId || !modal || modal.classList.contains('hidden')) return;
      const [load, sales] = await Promise.all([nav.loadById(loadId),nav.salesOrdersForLoad(loadId)]);
      if (!load || modal.classList.contains('hidden')) return;
      const body = document.getElementById('drawerBody');
      if (!body) return;
      ['loadOperationalSales','loadOperationalSources','loadOperationalDownstream'].forEach(id => document.getElementById(id)?.remove());
      if (parentCan('sales.read')) {
        const salesBlock = block('Sales Orders',sales.map(order => ({label:`${order.so_number} · ${order.so_status || 'sin estado'}`,action:() => nav.openSales({ salesOrderId:order.sales_order_id })})),'Este Cargue no está vinculado a una Sales Order.');
        salesBlock.id = 'loadOperationalSales';body.appendChild(salesBlock);
      }
      if (parentCan('warehouse.read')) {
        const sourceBlock = block('Warehouse Receipts de origen',(load.receipt_numbers || []).map(receiptNumber => ({label:receiptNumber,action:() => nav.openInventoryReceipt(receiptNumber)})),'Este Cargue no tiene WR resolubles.');
        sourceBlock.id = 'loadOperationalSources';body.appendChild(sourceBlock);
      }
      const downstream = load.shipment_id ? [{label:`Contenedor · ${load.container_number || load.load_number}`,action:() => nav.openTracking({ shipmentId:load.shipment_id })}] : [];
      const downstreamBlock = block('Contenedor / Tracking',downstream,'Este Cargue todavía no tiene un contenedor vinculado.');
      downstreamBlock.id = 'loadOperationalDownstream';body.appendChild(downstreamBlock);
    }
    window.openLoad = loadId => { currentLoadId = loadId; const result = originalOpenLoad(loadId); requestAnimationFrame(() => renderContext(loadId).catch(error => console.error('[load operational context]', error))); return result; };
    window.openOperationalLoad = loadId => window.openLoad(loadId);
    const modal = document.getElementById('drawerModal');
    if (modal) new MutationObserver(() => renderContext().catch(error => console.error('[load operational context]', error))).observe(modal, { attributes:true, attributeFilter:['class'] });
    observeChanges(document.getElementById('loadRows'), () => nav.invalidateLinks?.());
  }

  function initWarehouse() {
    const nav = parentNav();
    if (!nav) return;
    async function renderContext() {
      const modal = document.getElementById('detailModal');
      if (!modal || modal.classList.contains('hidden')) return;
      const receiptNumber = document.getElementById('detailTitle')?.textContent?.trim();
      if (!receiptNumber) return;
      const [purchases, loads, sales] = await Promise.all([nav.purchaseOrdersForReceipt(receiptNumber),nav.loadsForReceipt(receiptNumber),nav.salesOrdersForReceipt(receiptNumber)]);
      if (modal.classList.contains('hidden')) return;
      const body = document.getElementById('detailBody');
      if (!body) return;
      document.getElementById('warehouseOperationalContext')?.remove();
      document.getElementById('warehouseCommercialContext')?.remove();
      const originItems = [{ label:'Ver en Inventario', primary:true, action:() => nav.openInventoryReceipt(receiptNumber) }];
      if (parentCan('procurement.read')) originItems.push(...purchases.map(po => ({label:`Origen ${po.po_number}`,action:() => nav.openPurchase({ purchaseOrderId:po.purchase_order_id })})));
      const context = block('Trazabilidad física',originItems);context.id = 'warehouseOperationalContext';body.appendChild(context);
      const commercialItems=[];
      if(parentCan('logistics.read'))commercialItems.push(...loads.map(load => ({ label:load.load_number, action:() => nav.openLoad({ loadId:load.load_id }) })));
      if(parentCan('sales.read'))commercialItems.push(...sales.map(order => ({ label:order.so_number, action:() => nav.openSales({ salesOrderId:order.sales_order_id }) })));
      const commercial = block('Salida comercial',commercialItems,'Este WR todavía no participa en un flujo comercial visible para tu rol.');commercial.id = 'warehouseCommercialContext';body.appendChild(commercial);
    }
    window.openOperationalReceipt = receiptId => { if (typeof window.showReceipt !== 'function') return false; window.showReceipt(receiptId); renderContext().catch(error => console.error('[warehouse operational context]', error)); return true; };
    const modal = document.getElementById('detailModal');
    if (modal) {
      const observer = new MutationObserver(() => renderContext().catch(error => console.error('[warehouse operational context]', error)));
      observer.observe(modal, { attributes:true, attributeFilter:['class'] });
      const title = document.getElementById('detailTitle');if (title) observer.observe(title, { childList:true, subtree:true });
    }
    observeChanges(document.getElementById('receiptList'), () => nav.invalidateLinks?.());
  }

  function initInventory() {
    const nav = parentNav();
    if (!nav) return;
    async function renderOrigin(receiptNumber) {
      if (!receiptNumber) return;
      let card = document.getElementById('purchaseOriginCard');
      if (!card) { card = document.createElement('section');card.id='purchaseOriginCard';card.className='card hidden';document.getElementById('traceView')?.prepend(card); }
      let commercialCard = document.getElementById('salesUsageCard');
      if (!commercialCard) { commercialCard=document.createElement('section');commercialCard.id='salesUsageCard';commercialCard.className='card hidden';card.after(commercialCard); }
      const [purchases, loads, sales] = await Promise.all([nav.purchaseOrdersForReceipt(receiptNumber),nav.loadsForReceipt(receiptNumber),nav.salesOrdersForReceipt(receiptNumber)]);
      card.innerHTML='';card.appendChild(block(`Origen de compra · ${receiptNumber}`,parentCan('procurement.read')?purchases.map(po => ({label:po.po_number,action:() => nav.openPurchase({ purchaseOrderId:po.purchase_order_id })})):[],'No hay una PO visible para tu rol.'));card.classList.remove('hidden');
      const commercialItems=[];
      if(parentCan('logistics.read'))commercialItems.push(...loads.map(load => ({label:load.load_number,action:() => nav.openLoad({loadId:load.load_id})})));
      if(parentCan('sales.read'))commercialItems.push(...sales.map(order => ({label:order.so_number,action:() => nav.openSales({salesOrderId:order.sales_order_id})})));
      commercialCard.innerHTML='';commercialCard.appendChild(block(`Salida comercial · ${receiptNumber}`,commercialItems,'Este WR todavía no tiene salida comercial visible.'));commercialCard.classList.remove('hidden');
    }
    const originalTraceWR = typeof window.traceWR === 'function' ? window.traceWR : null;
    if (originalTraceWR) window.traceWR = receiptNumber => { const result=originalTraceWR(receiptNumber);renderOrigin(String(receiptNumber||'').trim()).catch(error=>console.error('[inventory operational origin]',error));return result; };
    const title = document.getElementById('relatedLoadsTitle');
    if (title) {
      const updateFromTitle = () => { const match=title.textContent.match(/·\s*(WR-[A-Z0-9-]+)/i);if(match?.[1])renderOrigin(match[1]).catch(error=>console.error('[inventory operational origin]',error)); };
      new MutationObserver(updateFromTitle).observe(title,{childList:true,subtree:true});updateFromTitle();
    }
  }

  function initInvoices() {
    window.openOperationalInvoiceCollection = invoiceId => {
      if (typeof window.openOperationalInvoice !== 'function') return false;
      window.openOperationalInvoice(invoiceId);
      requestAnimationFrame(() => document.querySelector('#detailActions [data-payment]')?.click());
      return true;
    };
    window.openOperationalInvoiceForSalesOrder = salesOrderId => {
      const create = document.getElementById('newInvoice');
      if (!create) return false;
      create.click();
      const select = document.getElementById('iSalesOrder');
      if (!select) return false;
      select.value = String(salesOrderId);
      if (select.value !== String(salesOrderId)) return false;
      select.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    };
  }

  function initPayables() {
    window.openOperationalSupplierBill = billId => {
      if (!window.PayablesModule?.openBill) return false;
      window.PayablesModule.openBill(billId);
      return true;
    };
  }

  installStyles();
  let moduleName = 'none';
  if (path.endsWith('/admin/suppliers.html')) { moduleName='suppliers';initSuppliers(); }
  else if (path.endsWith('/admin/purchases.html')) { moduleName='purchases';initPurchases(); }
  else if (path.endsWith('/admin/sales.html')) { moduleName='sales';initSales(); }
  else if (path.endsWith('/admin/loads.html')) { moduleName='loads';initLoads(); }
  else if (path.endsWith('/admin/warehouse.html')) { moduleName='warehouse';initWarehouse(); }
  else if (path.endsWith('/admin/inventory.html')) { moduleName='inventory';initInventory(); }
  else if (path.endsWith('/admin/invoices.html')) { moduleName='invoices';initInvoices(); }
  else if (path.endsWith('/admin/payables.html')) { moduleName='payables';initPayables(); }

  window.OperationalContextBridge = Object.freeze({ ready:true,module:moduleName,owner:'operational-context-bridge.js' });
  window.dispatchEvent(new CustomEvent('export-mca:context-bridge-ready',{detail:{module:moduleName}}));
})();