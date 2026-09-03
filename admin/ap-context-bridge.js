(() => {
  if (window.APContextBridge?.ready) return;

  const path = location.pathname.toLowerCase();
  const nav = () => { try { return parent?.APTraceability || null; } catch { return null; } };

  function installStyles() {
    if (document.getElementById('apContextStyles')) return;
    const style = document.createElement('style');
    style.id = 'apContextStyles';
    style.textContent = `
      .ap-context{margin-top:12px;padding:11px;border:1px solid #ead9c7;border-radius:10px;background:#fffaf5}
      .ap-context-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px}
      .ap-context-title{font-size:10px;text-transform:uppercase;color:#8b5e34;font-weight:900}
      .ap-context-actions{display:flex;gap:7px;flex-wrap:wrap}
      .ap-context-btn{border:1px solid #e5c9aa!important;background:#fff!important;color:#5f3e22!important;border-radius:8px!important;padding:7px 9px!important;font-size:10px!important;font-weight:900!important;cursor:pointer!important}
      .ap-context-empty{font-size:10px;color:#8b6f58}
      @media(max-width:650px){.ap-context-btn{flex:1 1 140px;text-align:left}}
    `;
    document.head.appendChild(style);
  }

  function button(label, action) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'ap-context-btn';
    control.textContent = label;
    control.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      Promise.resolve(action()).catch(error => console.error('[ap context action]', error));
    });
    return control;
  }

  function block(title, items = [], empty = 'Sin relaciones financieras registradas.') {
    const wrapper = document.createElement('div');
    wrapper.className = 'ap-context';
    const head = document.createElement('div'); head.className = 'ap-context-head';
    const heading = document.createElement('div'); heading.className = 'ap-context-title'; heading.textContent = title;
    head.appendChild(heading); wrapper.appendChild(head);
    const actions = document.createElement('div'); actions.className = 'ap-context-actions';
    if (!items.length) { const node = document.createElement('div'); node.className = 'ap-context-empty'; node.textContent = empty; actions.appendChild(node); }
    else items.forEach(item => actions.appendChild(button(item.label, item.action)));
    wrapper.appendChild(actions); return wrapper;
  }

  function observe(target, callback, options = { childList:true, subtree:true }) {
    if (!target) return null;
    const observer = new MutationObserver(callback); observer.observe(target, options); return observer;
  }

  function initSuppliers() {
    const ap = nav(); if (!ap) return;
    let currentSupplierId = null;

    async function openSupplierAP(supplierId, name = 'Proveedor') {
      currentSupplierId = supplierId;
      const [bills,payments] = await Promise.all([ap.billsForSupplier(supplierId), ap.paymentsForSupplier(supplierId)]);
      let modal = document.getElementById('supplierAPActivity');
      if (!modal) {
        modal = document.createElement('div'); modal.id = 'supplierAPActivity'; modal.className = 'modal hidden';
        modal.innerHTML = '<div class="dialog"><div class="dialog-head"><div><h2 id="supplierAPTitle"></h2><div class="supplier-meta">Facturas de proveedor, pagos y anticipos vinculados al maestro.</div></div><button class="btn" id="supplierAPClose">✕</button></div><div id="supplierAPBody"></div></div>';
        document.body.appendChild(modal);
        document.getElementById('supplierAPClose').onclick = () => modal.classList.add('hidden');
        modal.addEventListener('click', event => { if (event.target === modal) modal.classList.add('hidden'); });
      }
      document.getElementById('supplierAPTitle').textContent = name;
      const body = document.getElementById('supplierAPBody'); body.innerHTML = '';
      body.appendChild(block('Supplier Bills', bills.map(row => ({ label:`${row.bill_number} · ${row.bill_status}`, action:() => ap.openBill(row.supplier_bill_id) })), 'Este proveedor todavía no tiene Supplier Bills.'));
      body.appendChild(block('Pagos / anticipos', payments.map(row => ({ label:`${row.payment_number} · ${row.payment_status}`, action:() => ap.openPayment(row.supplier_payment_id) })), 'Este proveedor todavía no tiene pagos registrados.'));
      modal.classList.remove('hidden');
      return true;
    }

    function attach() {
      document.querySelectorAll('.supplier-row').forEach(row => {
        const edit = row.querySelector('[data-edit]'); const actions = row.querySelector('.actions');
        if (!edit || !actions || actions.querySelector('[data-ap-activity]')) return;
        const control = button('Ctas. por pagar', () => openSupplierAP(edit.dataset.edit, row.querySelector('.supplier-name')?.textContent?.trim() || 'Proveedor'));
        control.dataset.apActivity = edit.dataset.edit; actions.prepend(control);
      });
    }
    attach(); observe(document.getElementById('supplierList'), () => { ap.invalidate?.(); attach(); });
    window.openSupplierAP = supplierId => openSupplierAP(supplierId);
  }

  function initPurchases() {
    const ap = nav(); if (!ap) return;
    async function render() {
      const modal = document.getElementById('detailModal'); if (!modal || modal.classList.contains('hidden')) return;
      const poNumber = document.getElementById('detailTitle')?.textContent?.trim();
      const po = await ap.purchaseByNumber(poNumber); if (!po?.purchase_order_id || modal.classList.contains('hidden')) return;
      const [bills,payments] = await Promise.all([ap.billsForPurchase(po.purchase_order_id), ap.paymentsForPurchase(po.purchase_order_id)]);
      const body = document.getElementById('detailBody'); if (!body) return;
      document.getElementById('purchaseAPContext')?.remove();
      const context = block('Cuentas por pagar', [
        ...bills.map(row => ({ label:`${row.bill_number} · ${row.bill_status}`, action:() => ap.openBill(row.supplier_bill_id) })),
        ...payments.map(row => ({ label:`${row.payment_number} · ${row.payment_status}`, action:() => ap.openPayment(row.supplier_payment_id) }))
      ], 'Esta PO todavía no tiene factura o pago de proveedor.');
      context.id = 'purchaseAPContext'; body.appendChild(context);
    }
    const modal = document.getElementById('detailModal');
    if (modal) { observe(modal, () => render().catch(console.error), { attributes:true, attributeFilter:['class'] }); observe(document.getElementById('detailTitle'), () => render().catch(console.error)); }
  }

  function initWarehouse() {
    const ap = nav(); if (!ap) return;
    async function render() {
      const modal = document.getElementById('detailModal'); if (!modal || modal.classList.contains('hidden')) return;
      const receiptNumber = document.getElementById('detailTitle')?.textContent?.trim(); if (!receiptNumber) return;
      const [bills,payments] = await Promise.all([ap.billsForReceipt(receiptNumber), ap.paymentsForReceipt(receiptNumber)]);
      const body = document.getElementById('detailBody'); if (!body || modal.classList.contains('hidden')) return;
      document.getElementById('warehouseAPContext')?.remove();
      const context = block('Cuentas por pagar de PO origen', [
        ...bills.map(row => ({ label:`${row.bill_number} · ${row.bill_status}`, action:() => ap.openBill(row.supplier_bill_id) })),
        ...payments.map(row => ({ label:`${row.payment_number} · ${row.payment_status}`, action:() => ap.openPayment(row.supplier_payment_id) }))
      ], 'Las PO vinculadas a este WR todavía no tienen AP registrado.');
      context.id = 'warehouseAPContext'; body.appendChild(context);
    }
    const modal = document.getElementById('detailModal');
    if (modal) { observe(modal, () => render().catch(console.error), { attributes:true, attributeFilter:['class'] }); observe(document.getElementById('detailTitle'), () => render().catch(console.error)); }
  }

  installStyles();
  if (path.endsWith('/suppliers.html')) initSuppliers();
  else if (path.endsWith('/purchases.html')) initPurchases();
  else if (path.endsWith('/warehouse.html')) initWarehouse();

  window.APContextBridge = Object.freeze({ ready:true, owner:'ap-context-bridge.js' });
  window.dispatchEvent(new CustomEvent('export-mca:ap-context-ready'));
})();
