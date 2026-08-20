(() => {
  if (window.OperationalContextBridge?.ready) return;

  const path = location.pathname.toLowerCase();
  const parentNav = () => {
    try { return parent?.OperationalNavigation || null; }
    catch { return null; }
  };

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
    } else {
      items.forEach(item => actions.appendChild(button(item.label, item.action, item.primary)));
    }
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

  function initSuppliers() {
    const nav = parentNav();
    if (!nav) return;

    async function openSupplier(supplierId) {
      const edit = findByData('edit', supplierId);
      const row = edit?.closest('.supplier-row') || null;
      const name = row?.querySelector('.supplier-name')?.textContent?.trim() || 'Proveedor';
      const [purchases, receipts] = await Promise.all([
        nav.purchaseOrdersForSupplier(supplierId),
        nav.receiptsForSupplier(supplierId)
      ]);

      let modal = document.getElementById('supplierOperationalActivity');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'supplierOperationalActivity';
        modal.className = 'modal hidden';
        modal.innerHTML = '<div class="dialog"><div class="dialog-head"><div><h2 id="supplierOperationalTitle"></h2><div class="supplier-meta">Purchase Orders y Warehouse Receipts vinculados al proveedor maestro.</div></div><button class="btn" id="supplierOperationalClose">✕</button></div><div id="supplierOperationalBody"></div></div>';
        document.body.appendChild(modal);
        document.getElementById('supplierOperationalClose').onclick = () => modal.classList.add('hidden');
        modal.addEventListener('click', event => { if (event.target === modal) modal.classList.add('hidden'); });
      }

      document.getElementById('supplierOperationalTitle').textContent = name;
      const body = document.getElementById('supplierOperationalBody');
      body.innerHTML = '';
      body.appendChild(block(
        'Purchase Orders',
        purchases.map(po => ({
          label:`${po.po_number} · ${po.po_status || 'sin estado'}`,
          action:() => nav.openPurchase({ purchaseOrderId:po.purchase_order_id })
        })),
        'Este proveedor todavía no tiene Purchase Orders.'
      ));
      body.appendChild(block(
        'Warehouse Receipts',
        receipts.map(receipt => ({
          label:`${receipt.receipt_number} · ${receipt.status === 'cancelled' ? 'Anulado' : 'Recibido'}`,
          action:() => nav.openWarehouseReceipt({ receiptNumber:receipt.receipt_number })
        })),
        'Este proveedor todavía no tiene WR vinculados.'
      ));
      modal.classList.remove('hidden');
      flash(row);
      return true;
    }

    function attachActivityButtons() {
      document.querySelectorAll('.supplier-row').forEach(row => {
        const edit = row.querySelector('[data-edit]');
        const actions = row.querySelector('.actions');
        if (!edit || !actions || actions.querySelector('[data-operational-activity]')) return;
        const control = button('Actividad', () => {
          history.replaceState(history.state, '', location.href);
          return nav.openSupplier({ supplierId:edit.dataset.edit });
        });
        control.dataset.operationalActivity = edit.dataset.edit;
        actions.prepend(control);
      });
    }

    attachActivityButtons();
    const list = document.getElementById('supplierList');
    if (list) new MutationObserver(attachActivityButtons).observe(list, { childList:true, subtree:true });
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

      const supplierBlock = block(
        'Proveedor',
        purchase.supplier_id ? [{
          label:'Ver proveedor', primary:true,
          action:() => nav.openSupplier({ supplierId:purchase.supplier_id })
        }] : [],
        'La PO no tiene proveedor resoluble.'
      );
      supplierBlock.id = 'purchaseOperationalContextSupplier';
      body.appendChild(supplierBlock);

      const receiptBlock = block(
        'Warehouse Receipts recibidos',
        (purchase.receipts || []).map(receipt => ({
          label:`${receipt.receipt_number}${receipt.receipt_status === 'cancelled' ? ' · anulado' : ''}`,
          action:() => nav.openWarehouseReceipt({ receiptNumber:receipt.receipt_number })
        })),
        'Todavía no hay WR creados desde esta PO.'
      );
      receiptBlock.id = 'purchaseOperationalContextReceipts';
      body.appendChild(receiptBlock);
    }

    window.openOperationalPurchase = purchaseOrderId => {
      if (typeof window.openDetail !== 'function') return false;
      window.openDetail(purchaseOrderId);
      renderContext().catch(error => console.error('[purchase operational context]', error));
      return true;
    };

    const modal = document.getElementById('detailModal');
    if (modal) {
      const observer = new MutationObserver(() => renderContext().catch(error => console.error('[purchase operational context]', error)));
      observer.observe(modal, { attributes:true, attributeFilter:['class'] });
      const title = document.getElementById('detailTitle');
      if (title) observer.observe(title, { childList:true, subtree:true });
    }
  }

  function initWarehouse() {
    const nav = parentNav();
    if (!nav) return;

    async function renderContext() {
      const modal = document.getElementById('detailModal');
      if (!modal || modal.classList.contains('hidden')) return;
      const receiptNumber = document.getElementById('detailTitle')?.textContent?.trim();
      if (!receiptNumber) return;
      const purchases = await nav.purchaseOrdersForReceipt(receiptNumber);
      if (modal.classList.contains('hidden')) return;
      const body = document.getElementById('detailBody');
      if (!body) return;
      document.getElementById('warehouseOperationalContext')?.remove();
      const context = block('Trazabilidad · PO de origen e Inventario', [
        { label:'Ver en Inventario', primary:true, action:() => nav.openInventoryReceipt(receiptNumber) },
        ...purchases.map(po => ({
          label:`Origen ${po.po_number}`,
          action:() => nav.openPurchase({ purchaseOrderId:po.purchase_order_id })
        }))
      ]);
      context.id = 'warehouseOperationalContext';
      body.appendChild(context);
    }

    window.openOperationalReceipt = receiptId => {
      if (typeof window.showReceipt !== 'function') return false;
      window.showReceipt(receiptId);
      renderContext().catch(error => console.error('[warehouse operational context]', error));
      return true;
    };

    const modal = document.getElementById('detailModal');
    if (modal) {
      const observer = new MutationObserver(() => renderContext().catch(error => console.error('[warehouse operational context]', error)));
      observer.observe(modal, { attributes:true, attributeFilter:['class'] });
      const title = document.getElementById('detailTitle');
      if (title) observer.observe(title, { childList:true, subtree:true });
    }
  }

  function initInventory() {
    const nav = parentNav();
    if (!nav) return;

    async function renderOrigin(receiptNumber) {
      if (!receiptNumber) return;
      let card = document.getElementById('purchaseOriginCard');
      if (!card) {
        card = document.createElement('section');
        card.id = 'purchaseOriginCard';
        card.className = 'card hidden';
        const traceView = document.getElementById('traceView');
        if (traceView) traceView.insertBefore(card, traceView.firstChild);
      }
      const purchases = await nav.purchaseOrdersForReceipt(receiptNumber);
      card.innerHTML = '';
      card.appendChild(block(
        `Origen de compra · ${receiptNumber}`,
        purchases.map(po => ({
          label:po.po_number,
          action:() => nav.openPurchase({ purchaseOrderId:po.purchase_order_id })
        })),
        'Este WR no tiene una PO de origen activa; puede ser directo o histórico.'
      ));
      card.classList.remove('hidden');
    }

    const originalTraceWR = typeof window.traceWR === 'function' ? window.traceWR : null;
    if (originalTraceWR) {
      window.traceWR = receiptNumber => {
        const result = originalTraceWR(receiptNumber);
        renderOrigin(String(receiptNumber || '').trim()).catch(error => console.error('[inventory purchase origin]', error));
        return result;
      };
    }

    const title = document.getElementById('relatedLoadsTitle');
    if (title) {
      const updateFromTitle = () => {
        const match = title.textContent.match(/·\s*(WR-[A-Z0-9-]+)/i);
        if (match?.[1]) renderOrigin(match[1]).catch(error => console.error('[inventory purchase origin]', error));
      };
      new MutationObserver(updateFromTitle).observe(title, { childList:true, subtree:true });
      updateFromTitle();
    }
  }

  installStyles();
  let moduleName = 'none';
  if (path.endsWith('/admin/suppliers.html')) { moduleName = 'suppliers'; initSuppliers(); }
  else if (path.endsWith('/admin/purchases.html')) { moduleName = 'purchases'; initPurchases(); }
  else if (path.endsWith('/admin/warehouse.html')) { moduleName = 'warehouse'; initWarehouse(); }
  else if (path.endsWith('/admin/inventory.html')) { moduleName = 'inventory'; initInventory(); }

  window.OperationalContextBridge = Object.freeze({ ready:true, module:moduleName });
  window.dispatchEvent(new CustomEvent('export-mca:context-bridge-ready', { detail:{ module:moduleName } }));
})();
