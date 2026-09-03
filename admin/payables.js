(() => {
  const $ = id => document.getElementById(id);
  let token = localStorage.getItem('export_mca_token') || '';
  const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';
  let moduleStarted = false;
  let pendingBillId = '';
  let pendingPaymentId = '';
  let traceSequence = 0;
  const modalReturnFocus = new Map();

  const state = {
    bills: [],
    purchaseOrders: [],
    payments: [],
    postedBills: [],
    paymentPOs: [],
    advancePurchaseOrders: [],
    writeAccess: false,
    entity: 'bills',
    view: 'open',
    search: '',
    editingBillId: null,
    allocationPaymentId: null,
    reversePaymentId: null,
    paymentMode: 'manual',
    directBillId: null,
    decision: null,
    loaded: false
  };

  const SAFE_AP_ERROR_PATTERNS = [
    /^(?:No tienes|Purchase Order|Selecciona|Indica|Agrega|Falta|La Purchase Order|La cantidad|La distribución|La acción|El monto|El costo|El total|El pago|Factura|Pago|Solo|Esta factura|Este pago|Revierte|Acción de|Sesión vencida)/i,
    /^No se pudo procesar (?:Cuentas por pagar|el pago del proveedor)(?:\. Intenta nuevamente\.)?$/i
  ];

  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));

  const num = value => {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  };

  const actionAllowed = (row, action) => row?.capabilities?.actions?.[action]?.allowed === true;

  function redirectToAdminLogin() {
    localStorage.removeItem('export_mca_token');
    localStorage.removeItem('export_mca_user');
    if (embeddedMode && window.top !== window) {
      window.top.location.replace('/admin/index.html');
      return;
    }
    location.replace('/admin/index.html');
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      redirectToAdminLogin();
      const error = new Error('Sesión vencida');
      error.status = 401;
      error.endpoint = String(url).split('?')[0];
      throw error;
    }
    if (!response.ok) {
      const error = new Error(data.error || 'No se pudo procesar Cuentas por pagar');
      error.status = response.status;
      error.code = data.details?.code || data.code || null;
      error.endpoint = String(url).split('?')[0];
      throw error;
    }
    return data;
  }

  function safeApMessage(error, fallback = 'No se pudo completar la operación. Intenta nuevamente.') {
    const value = String(error?.message || '').trim();
    const status = Number(error?.status || 0);
    if (status === 401 || value === 'Sesión vencida') return 'Tu sesión terminó. Inicia sesión nuevamente para continuar.';
    if (status === 403) return 'No tienes permiso para completar esta acción.';
    if ((status === 0 || [400, 404, 409, 422].includes(status)) && SAFE_AP_ERROR_PATTERNS.some(pattern => pattern.test(value))) return value;
    return fallback;
  }

  function reportApError(context, error, fallback = 'No se pudo completar la operación. Intenta nuevamente.') {
    const message = safeApMessage(error, fallback);
    if (message === fallback || Number(error?.status || 0) >= 500) {
      console.error('PAYABLES_UI_FAILED', {
        context,
        status: Number(error?.status || 0) || null,
        code: error?.code || null,
        endpoint: error?.endpoint || null,
        error
      });
    }
    return message;
  }

  function setPageMessage(value = '', tone = 'bad') {
    const node = $('payablesPageMsg');
    if (!node) return;
    node.textContent = value;
    node.className = `payables-feedback${value ? ` ${tone}` : ''}`;
  }

  function message(id, value = '', good = false) {
    const node = $(id);
    if (!node) return;
    node.textContent = value;
    node.className = `msg payables-dialog-message${value ? ` ${good ? 'ok' : 'bad'}` : ''}`;
  }

  function money(value, currency = 'USD') {
    const code = String(currency || 'USD').trim().toUpperCase().slice(0, 3) || 'USD';
    return `${code} ${num(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function moneyByCurrency(rows, amountFor, currencyFor) {
    if (!rows.length) return '—';
    const totals = new Map();
    rows.forEach(row => {
      const code = String(currencyFor(row) || 'USD').trim().toUpperCase().slice(0, 3) || 'USD';
      totals.set(code, (totals.get(code) || 0) + num(amountFor(row)));
    });
    return [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amount]) => money(amount, currency))
      .join(' · ');
  }

  function inputNumber(value, decimals = 8) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return '';
    return String(Number(parsed.toFixed(decimals)));
  }

  function date(value) {
    if (!value) return 'Sin fecha';
    const raw = String(value).slice(0, 10);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[2]}/${match[3]}/${match[1]}` : 'Fecha no disponible';
  }

  function localDateToday() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function supplierName(row) {
    return row?.supplier?.legal_name || row?.supplier?.name || 'Proveedor sin nombre';
  }

  function billPill(bill) {
    if (bill.status === 'void') return '<span class="pill off">Anulada</span>';
    if (bill.status === 'draft') return '<span class="pill warn">Borrador</span>';
    const financial = bill.financial || {};
    if (financial.payment_status === 'paid') return '<span class="pill ok">Pagada</span>';
    if (financial.overdue) return '<span class="pill bad">Vencida</span>';
    if (financial.payment_status === 'partial') return '<span class="pill warn">Pago parcial</span>';
    return '<span class="pill">Por pagar</span>';
  }

  function paymentPill(payment) {
    if (payment.status === 'reversed') return '<span class="pill off">Revertido</span>';
    const applicationStatus = payment.progress?.application_status;
    if (applicationStatus === 'applied') return '<span class="pill ok">Aplicado</span>';
    if (applicationStatus === 'partial') return '<span class="pill warn">Aplicación parcial</span>';
    return '<span class="pill">Sin aplicar</span>';
  }

  function metric(label, value, detail, className) {
    return `<article class="metric ${className}"><span>${esc(label)}</span><b>${esc(value ?? '—')}</b><small>${esc(detail)}</small></article>`;
  }

  function renderMetrics() {
    const activeBills = state.bills.filter(bill => bill.status !== 'void');
    const postedBills = state.bills.filter(bill => bill.status === 'posted');
    const postedPayments = state.payments.filter(payment => payment.status === 'posted');
    $('metrics').innerHTML = [
      ['Facturas', activeBills.length, 'Activas y en borrador', 'payable-metric-bills'],
      ['Por pagar', moneyByCurrency(postedBills, bill => bill.financial?.balance_due, bill => bill.currency), 'Saldo contabilizado pendiente', 'payable-metric-balance'],
      ['Vencidas', postedBills.filter(bill => bill.financial?.overdue).length, 'Requieren seguimiento', 'payable-metric-overdue'],
      ['Pagado', moneyByCurrency(postedPayments, payment => payment.amount, payment => payment.currency), 'Pagos registrados vigentes', 'payable-metric-paid'],
      ['Sin aplicar', moneyByCurrency(postedPayments, payment => payment.progress?.unapplied_amount, payment => payment.currency), 'Anticipos o pagos pendientes', 'payable-metric-unapplied']
    ].map(values => metric(...values)).join('');
  }

  function availableViews() {
    return state.entity === 'bills'
      ? [['open', 'Abiertas'], ['draft', 'Borradores'], ['paid', 'Pagadas'], ['all', 'Todas']]
      : [['active', 'Activos'], ['unapplied', 'Sin aplicar'], ['reversed', 'Revertidos'], ['all', 'Todos']];
  }

  function renderViewTabs() {
    const views = availableViews();
    if (!views.some(([id]) => id === state.view)) state.view = views[0][0];
    $('viewTabs').innerHTML = views.map(([id, label]) => {
      const active = state.view === id;
      return `<button class="btn${active ? ' active' : ''}" type="button" data-view="${esc(id)}" aria-pressed="${active}">${esc(label)}</button>`;
    }).join('');
  }

  function billMatches(bill) {
    if (state.view === 'draft' && bill.status !== 'draft') return false;
    if (state.view === 'paid' && !(bill.status === 'posted' && bill.financial?.payment_status === 'paid')) return false;
    if (state.view === 'open' && (bill.status === 'void' || (bill.status === 'posted' && bill.financial?.payment_status === 'paid'))) return false;
    const query = state.search.trim().toLowerCase();
    if (!query) return true;
    return [
      bill.bill_number,
      bill.supplier_invoice_number,
      bill.purchase_order?.po_number,
      bill.purchase_order?.supplier_reference,
      supplierName(bill),
      bill.status,
      bill.financial?.payment_status
    ].join(' ').toLowerCase().includes(query);
  }

  function paymentMatches(payment) {
    if (state.view === 'active' && payment.status !== 'posted') return false;
    if (state.view === 'unapplied' && !(payment.status === 'posted' && num(payment.progress?.unapplied_amount) > 0)) return false;
    if (state.view === 'reversed' && payment.status !== 'reversed') return false;
    const query = state.search.trim().toLowerCase();
    if (!query) return true;
    return [
      payment.payment_number,
      payment.purchase_order?.po_number,
      payment.purchase_order?.supplier_reference,
      supplierName(payment),
      payment.reference,
      payment.method,
      payment.status,
      payment.progress?.application_status
    ].join(' ').toLowerCase().includes(query);
  }

  function billActionButton(bill, action, label, className = '') {
    return `<button class="btn ${className}" type="button" data-bill-action="${esc(action)}" data-bill-id="${esc(bill.id)}">${esc(label)}</button>`;
  }

  function billActions(bill) {
    const actions = [billActionButton(bill, 'detail', 'Ver detalle')];
    if (actionAllowed(bill, 'pay')) actions.push(billActionButton(bill, 'pay', 'Pagar', 'orange'));
    if (actionAllowed(bill, 'edit')) actions.push(billActionButton(bill, 'edit', 'Editar'));
    if (actionAllowed(bill, 'post')) actions.push(billActionButton(bill, 'post', 'Contabilizar', 'primary'));
    if (actionAllowed(bill, 'void')) actions.push(billActionButton(bill, 'void', 'Anular', 'danger'));
    return actions.join('');
  }

  function paymentActionButton(payment, action, label, className = '') {
    return `<button class="btn ${className}" type="button" data-payment-action="${esc(action)}" data-payment-id="${esc(payment.id)}">${esc(label)}</button>`;
  }

  function paymentActions(payment) {
    const actions = [paymentActionButton(payment, 'detail', 'Ver detalle')];
    if (actionAllowed(payment, 'allocate')) actions.push(paymentActionButton(payment, 'allocate', 'Aplicar', 'orange'));
    if (actionAllowed(payment, 'reverse')) actions.push(paymentActionButton(payment, 'reverse', 'Revertir', 'danger'));
    return actions.join('');
  }

  function billRow(bill) {
    const financial = bill.financial || {};
    return `<article class="payable-row" data-bill-row="${esc(bill.id)}">
      <div class="payable-cell"><span class="payable-cell-label">Factura</span><span class="payable-number">${esc(bill.bill_number || 'Sin número')}</span><span class="payable-cell-sub">${esc(bill.supplier_invoice_number || 'Sin nº del proveedor')}</span></div>
      <div class="payable-cell"><span class="payable-cell-label">Proveedor</span><span class="payable-cell-main">${esc(supplierName(bill))}</span><span class="payable-cell-sub">${esc(bill.purchase_order?.supplier_reference || 'Sin referencia')}</span></div>
      <div class="payable-cell"><span class="payable-cell-label">Purchase Order</span><span class="payable-cell-main">${esc(bill.purchase_order?.po_number || 'Sin PO')}</span><span class="payable-cell-sub">${esc(date(bill.bill_date))}</span></div>
      <div class="payable-cell"><span class="payable-cell-label">Estado</span>${billPill(bill)}</div>
      <div class="payable-cell"><span class="payable-cell-label">Importe</span><span class="payable-money">${esc(money(financial.bill_total, bill.currency))}</span><span class="payable-cell-sub">Facturado</span></div>
      <div class="payable-cell"><span class="payable-cell-label">Pendiente</span><span class="payable-money balance">${esc(money(financial.balance_due, bill.currency))}</span><span class="payable-cell-sub">Saldo</span></div>
      <div class="payable-row-actions" aria-label="Acciones de ${esc(bill.bill_number || 'factura')}">${billActions(bill)}</div>
    </article>`;
  }

  function paymentRow(payment) {
    const progress = payment.progress || {};
    return `<article class="payable-row" data-payment-row="${esc(payment.id)}">
      <div class="payable-cell"><span class="payable-cell-label">Pago</span><span class="payable-number">${esc(payment.payment_number || 'Sin número')}</span><span class="payable-cell-sub">${esc(date(payment.payment_date))}</span></div>
      <div class="payable-cell"><span class="payable-cell-label">Proveedor</span><span class="payable-cell-main">${esc(supplierName(payment))}</span><span class="payable-cell-sub">${esc(payment.method || 'Método no indicado')}</span></div>
      <div class="payable-cell"><span class="payable-cell-label">Purchase Order</span><span class="payable-cell-main">${esc(payment.purchase_order?.po_number || 'Sin PO')}</span><span class="payable-cell-sub">${esc(payment.reference || 'Sin referencia')}</span></div>
      <div class="payable-cell"><span class="payable-cell-label">Estado</span>${paymentPill(payment)}</div>
      <div class="payable-cell"><span class="payable-cell-label">Importe</span><span class="payable-money">${esc(money(payment.amount, payment.currency))}</span><span class="payable-cell-sub">Registrado</span></div>
      <div class="payable-cell"><span class="payable-cell-label">Pendiente</span><span class="payable-money balance">${esc(money(progress.unapplied_amount, payment.currency))}</span><span class="payable-cell-sub">Sin aplicar</span></div>
      <div class="payable-row-actions" aria-label="Acciones de ${esc(payment.payment_number || 'pago')}">${paymentActions(payment)}</div>
    </article>`;
  }

  function emptyState(title, copy) {
    return `<div class="payables-empty"><strong>${esc(title)}</strong><span>${esc(copy)}</span></div>`;
  }

  function filteredRows() {
    return state.entity === 'bills' ? state.bills.filter(billMatches) : state.payments.filter(paymentMatches);
  }

  function renderList() {
    const rows = filteredRows();
    const total = state.entity === 'bills' ? state.bills.length : state.payments.length;
    const noun = state.entity === 'bills' ? ['factura', 'facturas'] : ['pago', 'pagos'];
    $('payablesResultCount').textContent = `${rows.length} ${rows.length === 1 ? noun[0] : noun[1]}${rows.length !== total ? ` · ${total} totales` : ''}`;
    if (!rows.length) {
      $('list').innerHTML = emptyState(
        total ? 'Sin resultados' : state.entity === 'bills' ? 'Aún no hay facturas de proveedor' : 'Aún no hay pagos de proveedor',
        total ? 'Ajusta la búsqueda o cambia el filtro para consultar otros registros.' : state.entity === 'bills' ? 'Las obligaciones creadas desde Compras aparecerán aquí.' : 'Los pagos y anticipos registrados aparecerán aquí.'
      );
      return;
    }
    $('list').innerHTML = rows.map(state.entity === 'bills' ? billRow : paymentRow).join('');
  }

  function render() {
    renderMetrics();
    renderViewTabs();
    document.querySelectorAll('[data-entity]').forEach(button => {
      const active = button.dataset.entity === state.entity;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderList();
  }

  function modalId(name) {
    return name.endsWith('Modal') ? name : `${name}Modal`;
  }

  function openModal(name, focusId = '') {
    const id = modalId(name);
    const modal = $(id);
    if (!modal) return false;
    if (modal.classList.contains('hidden')) modalReturnFocus.set(id, document.activeElement);
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => {
      const target = focusId ? $(focusId) : modal.querySelector('button,select,input,textarea');
      target?.focus();
    });
    return true;
  }

  function closeModal(name, restoreFocus = true) {
    const id = modalId(name);
    const modal = $(id);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal:not(.hidden)')) document.body.classList.remove('modal-open');
    const trigger = modalReturnFocus.get(id);
    modalReturnFocus.delete(id);
    if (restoreFocus && trigger instanceof HTMLElement) trigger.focus();
    if (id === 'detailModal') traceSequence += 1;
  }

  function closePaymentModal(restoreFocus = true) {
    state.paymentMode = 'manual';
    state.directBillId = null;
    $('pPO').disabled = false;
    closeModal('payment', restoreFocus);
  }

  function closeDecision(restoreFocus = true) {
    state.decision = null;
    message('decisionMsg', '');
    closeModal('decision', restoreFocus);
  }

  function billBalance(bill) {
    return num(bill?.financial?.balance_due);
  }

  function eligiblePOs(editingBill = null) {
    return state.purchaseOrders.filter(order => order.items?.some(item => {
      const own = editingBill?.items?.find(line => line.purchase_order_item_id === item.id);
      return num(item.ap_progress?.available_to_bill_quantity) + num(own?.billed_quantity) > 0;
    }));
  }

  function syncTopActions() {
    const billButton = $('newBill');
    const manualButton = $('newPayment');
    const advanceButton = $('newAdvancePayment');
    [billButton, manualButton, advanceButton].forEach(button => { button.hidden = !state.writeAccess; });
    if (!state.writeAccess) return;

    const billAllowed = eligiblePOs().length > 0;
    billButton.disabled = !billAllowed;
    billButton.setAttribute('aria-disabled', String(!billAllowed));
    billButton.title = billAllowed ? 'Registrar una factura desde una Purchase Order' : 'No hay cantidades disponibles para facturar';

    const manualAllowed = state.paymentPOs.length > 0;
    manualButton.disabled = !manualAllowed;
    manualButton.setAttribute('aria-disabled', String(!manualAllowed));
    manualButton.title = manualAllowed ? 'Registrar un pago para distribuirlo manualmente' : 'No hay facturas con saldo pendiente';

    const advanceAllowed = state.advancePurchaseOrders.length > 0;
    advanceButton.disabled = !advanceAllowed;
    advanceButton.setAttribute('aria-disabled', String(!advanceAllowed));
    advanceButton.title = advanceAllowed ? 'Registrar un anticipo contra una Purchase Order activa' : 'No hay Purchase Orders disponibles para anticipo';
  }

  function fillBillPOs(editingBill = null) {
    $('bPO').innerHTML = '<option value="">Selecciona una Purchase Order</option>' + eligiblePOs(editingBill).map(order => `<option value="${esc(order.id)}">${esc(order.po_number)} · ${esc(supplierName(order))}</option>`).join('');
  }

  function updateBillPreview() {
    const order = state.purchaseOrders.find(row => String(row.id) === String($('bPO').value));
    const total = [...document.querySelectorAll('[data-bill-line]')].reduce((sum, node) => {
      const quantity = num(node.querySelector('[data-qty]')?.value);
      if (!(quantity > 0)) return sum;
      if (node.dataset.pricingMode === 'total') return sum + num(node.querySelector('[data-total]')?.value);
      return sum + quantity * num(node.querySelector('[data-cost]')?.value);
    }, 0);
    $('billCalculatedTotal').textContent = `Total: ${money(total, order?.currency || 'USD')}`;
  }

  function syncBillLine(node, source = 'quantity') {
    if (!node) return;
    const quantityInput = node.querySelector('[data-qty]');
    const costInput = node.querySelector('[data-cost]');
    const totalInput = node.querySelector('[data-total]');
    const hint = node.querySelector('[data-price-hint]');
    const quantity = num(quantityInput?.value);
    if (source === 'total') node.dataset.pricingMode = 'total';
    if (source === 'cost') node.dataset.pricingMode = 'unit';
    if (node.dataset.pricingMode === 'total') {
      const total = num(totalInput?.value);
      if (costInput) costInput.value = quantity > 0 && totalInput?.value !== '' ? inputNumber(total / quantity) : '';
      if (hint) hint.textContent = 'Importe exacto: total facturado';
    } else {
      const cost = num(costInput?.value);
      if (totalInput) totalInput.value = quantity > 0 && costInput?.value !== '' ? inputNumber(quantity * cost, 6) : '';
      if (hint) hint.textContent = 'Importe calculado: cantidad × costo unitario';
    }
    updateBillPreview();
  }

  function renderBillLines(editingBill = null) {
    const order = state.purchaseOrders.find(row => String(row.id) === String($('bPO').value));
    if (!order) {
      $('billLines').innerHTML = emptyState('Selecciona una Purchase Order', 'Mostraremos únicamente las cantidades disponibles para facturar.');
      updateBillPreview();
      return;
    }
    const rows = (order.items || []).map(item => {
      const own = editingBill?.items?.find(line => line.purchase_order_item_id === item.id);
      const available = num(item.ap_progress?.available_to_bill_quantity) + num(own?.billed_quantity);
      if (available <= 0 && !own) return '';
      const product = item.product || {};
      const label = product.sku ? `${product.sku} · ${product.name || ''}` : (product.name || 'Producto');
      const quantity = own ? num(own.billed_quantity) : available;
      const cost = own ? num(own.unit_cost) : num(item.unit_cost);
      const pricingMode = own?.pricing_mode === 'total' ? 'total' : 'unit';
      const lineTotal = own ? num(own.line_total) : quantity * cost;
      const hint = pricingMode === 'total' ? 'Importe exacto: total facturado' : 'Importe calculado: cantidad × costo unitario';
      return `<article class="payable-line" data-bill-line="${esc(item.id)}" data-pricing-mode="${pricingMode}">
        <div class="payable-line-title">${esc(label)}</div>
        <div class="payable-line-meta">Ordenado ${esc(item.ordered_quantity)} ${esc(item.unit)} · Disponible ${esc(available)} · Costo PO ${esc(money(item.unit_cost, order.currency))}</div>
        <div class="payable-line-hint" data-price-hint>${esc(hint)}</div>
        <div class="grid4"><div><label>Cantidad</label><input data-qty type="number" min="0" max="${esc(available)}" step="any" value="${esc(quantity)}"></div><div><label>Costo unitario</label><input data-cost type="number" min="0" step="any" value="${esc(inputNumber(cost))}"></div><div><label>Total facturado</label><input data-total type="number" min="0" step="0.01" value="${esc(inputNumber(lineTotal, 6))}"></div><div><label>Nota</label><input data-note value="${esc(own?.notes || '')}" placeholder="Opcional"></div></div>
      </article>`;
    }).filter(Boolean);
    $('billLines').innerHTML = rows.length ? rows.join('') : emptyState('Sin saldo disponible', 'Esta PO no tiene cantidades pendientes de facturar.');
    updateBillPreview();
  }

  function openBillCreate() {
    if (!state.writeAccess || !eligiblePOs().length) return false;
    state.editingBillId = null;
    $('billTitle').textContent = 'Nueva factura de proveedor';
    fillBillPOs();
    $('bPO').disabled = false;
    $('bPO').value = '';
    $('bSupplierInvoice').value = '';
    $('bDate').value = localDateToday();
    $('bDue').value = '';
    $('bNotes').value = '';
    $('billLines').innerHTML = emptyState('Selecciona una Purchase Order', 'Mostraremos únicamente las cantidades disponibles para facturar.');
    message('billMsg', '');
    updateBillPreview();
    openModal('bill', 'bPO');
    return true;
  }

  function openBillEdit(id) {
    const bill = state.bills.find(row => String(row.id) === String(id));
    if (!bill || !actionAllowed(bill, 'edit')) return false;
    state.editingBillId = bill.id;
    $('billTitle').textContent = `Editar ${bill.bill_number}`;
    fillBillPOs(bill);
    $('bPO').value = bill.purchase_order_id;
    $('bPO').disabled = false;
    $('bSupplierInvoice').value = bill.supplier_invoice_number || '';
    $('bDate').value = String(bill.bill_date || '').slice(0, 10);
    $('bDue').value = String(bill.due_date || '').slice(0, 10);
    $('bNotes').value = bill.notes || '';
    renderBillLines(bill);
    message('billMsg', '');
    openModal('bill', 'bSupplierInvoice');
    return true;
  }

  function collectBillLines() {
    return [...document.querySelectorAll('[data-bill-line]')].map(node => {
      const mode = node.dataset.pricingMode === 'total' ? 'total' : 'unit';
      return {
        purchase_order_item_id: node.dataset.billLine,
        billed_quantity: node.querySelector('[data-qty]')?.value || '',
        unit_cost: mode === 'unit' ? (node.querySelector('[data-cost]')?.value || '') : '',
        line_total: mode === 'total' ? (node.querySelector('[data-total]')?.value || '') : '',
        notes: node.querySelector('[data-note]')?.value || ''
      };
    }).filter(row => num(row.billed_quantity) > 0);
  }

  async function saveBill() {
    message('billMsg', '');
    if (!state.writeAccess) return message('billMsg', 'No tienes permiso para guardar facturas.');
    const editing = state.editingBillId ? state.bills.find(row => row.id === state.editingBillId) : null;
    if (editing && !actionAllowed(editing, 'edit')) return message('billMsg', 'Esta factura ya no admite edición.');
    const purchaseOrderId = $('bPO').value;
    const lines = collectBillLines();
    if (!purchaseOrderId) return message('billMsg', 'Selecciona una Purchase Order.');
    if (!lines.length) return message('billMsg', 'Indica al menos una cantidad a facturar.');
    if (lines.some(row => row.unit_cost === '' && row.line_total === '')) return message('billMsg', 'Indica costo unitario o total facturado para cada producto.');
    const button = $('saveBill');
    button.disabled = true;
    try {
      await request('/api/payables', {
        method: 'POST',
        body: JSON.stringify({
          action: state.editingBillId ? 'replace_plan' : 'create_plan',
          supplier_bill_id: state.editingBillId,
          purchase_order_id: purchaseOrderId,
          supplier_invoice_number: $('bSupplierInvoice').value || null,
          bill_date: $('bDate').value || null,
          due_date: $('bDue').value || null,
          notes: $('bNotes').value || null,
          lines
        })
      });
      const confirmation = state.editingBillId ? 'Factura de proveedor actualizada correctamente.' : 'Borrador de factura de proveedor creado correctamente.';
      closeModal('bill', false);
      await refresh();
      setPageMessage(confirmation, 'ok');
    } catch (error) {
      message('billMsg', reportApError('save_bill', error, 'No se pudo guardar la factura. Revisa los datos e intenta nuevamente.'));
    } finally {
      button.disabled = false;
    }
  }

  function fillPaymentPOs() {
    const advance = state.paymentMode === 'advance';
    let rows = advance ? state.advancePurchaseOrders : state.paymentPOs;
    if (state.paymentMode === 'direct') {
      const bill = state.bills.find(row => String(row.id) === String(state.directBillId));
      const directOrder = rows.find(row => String(row.id) === String(bill?.purchase_order_id)) || (bill ? {
        ...(bill.purchase_order || {}),
        id: bill.purchase_order_id,
        supplier: bill.supplier,
        currency: bill.currency,
        open_balance: billBalance(bill)
      } : null);
      rows = directOrder ? [directOrder] : [];
    }
    $('pPO').innerHTML = `<option value="">${advance ? 'Selecciona una Purchase Order para anticipo' : 'Selecciona una Purchase Order'}</option>` + rows.map(order => `<option value="${esc(order.id)}">${esc(order.po_number)} · ${esc(supplierName(order))}${advance ? '' : ` · Saldo ${esc(money(order.open_balance, order.currency))}`}</option>`).join('');
  }

  function updatePaymentCopy(bill = null) {
    if (state.paymentMode === 'direct' && bill) {
      $('paymentTitle').textContent = `Pagar ${bill.bill_number}`;
      $('paymentSubtitle').textContent = `El pago se aplicará automáticamente a esta factura. Saldo ${money(billBalance(bill), bill.currency)}.`;
      $('savePayment').textContent = 'Registrar y aplicar pago';
      return;
    }
    if (state.paymentMode === 'advance') {
      $('paymentTitle').textContent = 'Registrar anticipo';
      $('paymentSubtitle').textContent = 'Quedará sin aplicar hasta que exista una factura contabilizada.';
      $('savePayment').textContent = 'Registrar anticipo';
      return;
    }
    $('paymentTitle').textContent = 'Registrar pago manual';
    $('paymentSubtitle').textContent = 'Podrás distribuirlo entre las facturas contabilizadas de la Purchase Order.';
    $('savePayment').textContent = 'Registrar pago';
  }

  function updatePaymentHint() {
    const select = $('pPO');
    const amount = $('pAmount');
    if (state.paymentMode === 'direct') {
      const bill = state.bills.find(row => String(row.id) === String(state.directBillId));
      $('pOpenBalanceHint').textContent = bill ? `Factura ${bill.bill_number} · Saldo actual ${money(billBalance(bill), bill.currency)}.` : '';
      return;
    }
    if (state.paymentMode === 'advance') {
      $('pOpenBalanceHint').textContent = select.value ? 'Este anticipo quedará pendiente de aplicación.' : 'Selecciona una Purchase Order activa.';
      return;
    }
    const order = state.paymentPOs.find(row => String(row.id) === String(select.value));
    if (!select.value) {
      $('pOpenBalanceHint').textContent = state.paymentPOs.length ? 'Selecciona una PO con saldo pendiente.' : 'No hay facturas con saldo pendiente.';
      return;
    }
    $('pOpenBalanceHint').textContent = `Saldo pendiente total de esta PO: ${money(order?.open_balance, order?.currency || 'USD')}.`;
    if (!(num(amount.value) > 0) && num(order?.open_balance) > 0) amount.value = String(order.open_balance);
  }

  function openPaymentCreate(mode = 'manual', billId = null) {
    if (!state.writeAccess) return false;
    const bill = mode === 'direct' ? state.bills.find(row => String(row.id) === String(billId)) : null;
    if (mode === 'direct' && (!bill || !actionAllowed(bill, 'pay'))) return false;
    const available = mode === 'advance' ? state.advancePurchaseOrders : mode === 'manual' ? state.paymentPOs : [bill];
    if (!available.length) return false;
    state.paymentMode = mode;
    state.directBillId = bill?.id || null;
    fillPaymentPOs();
    $('pPO').disabled = mode === 'direct';
    $('pPO').value = bill?.purchase_order_id || '';
    $('pAmount').value = bill ? String(billBalance(bill)) : '';
    $('pDate').value = localDateToday();
    $('pMethod').value = 'wire';
    $('pReference').value = '';
    $('pNotes').value = '';
    message('paymentMsg', '');
    updatePaymentCopy(bill);
    updatePaymentHint();
    openModal('payment', mode === 'direct' ? 'pAmount' : 'pPO');
    return true;
  }

  async function savePayment() {
    const purchaseOrderId = $('pPO').value;
    const amount = num($('pAmount').value);
    const bill = state.paymentMode === 'direct' ? state.bills.find(row => String(row.id) === String(state.directBillId)) : null;
    message('paymentMsg', '');
    if (!state.writeAccess) return message('paymentMsg', 'No tienes permiso para registrar pagos.');
    if (state.paymentMode === 'direct' && (!bill || !actionAllowed(bill, 'pay'))) return message('paymentMsg', 'Esta factura ya no admite un pago directo.');
    if (!purchaseOrderId) return message('paymentMsg', 'Selecciona una Purchase Order.');
    if (amount <= 0) return message('paymentMsg', 'El monto debe ser mayor que cero.');
    const button = $('savePayment');
    button.disabled = true;
    try {
      const body = {
        amount,
        payment_date: $('pDate').value || null,
        method: $('pMethod').value || null,
        reference: $('pReference').value || null,
        notes: $('pNotes').value || null
      };
      if (state.paymentMode === 'direct') {
        body.action = 'pay_bill';
        body.supplier_bill_id = bill.id;
      } else {
        body.action = 'register';
        body.purchase_order_id = purchaseOrderId;
      }
      await request('/api/supplier-payments', { method: 'POST', body: JSON.stringify(body) });
      const completedMode = state.paymentMode;
      closePaymentModal(false);
      state.entity = 'payments';
      state.view = 'active';
      await refresh();
      setPageMessage(completedMode === 'advance' ? 'Anticipo registrado correctamente.' : 'Pago de proveedor registrado correctamente.', 'ok');
    } catch (error) {
      message('paymentMsg', reportApError('save_payment', error, 'No se pudo registrar el pago. Intenta nuevamente.'));
    } finally {
      button.disabled = false;
    }
  }

  function openAllocation(id) {
    const payment = state.payments.find(row => String(row.id) === String(id));
    if (!payment || !actionAllowed(payment, 'allocate')) return false;
    state.allocationPaymentId = payment.id;
    const currentByBill = new Map((payment.applications || []).map(application => [String(application.supplier_bill_id), num(application.amount)]));
    const bills = state.postedBills
      .filter(bill => String(bill.purchase_order_id) === String(payment.purchase_order_id))
      .map(bill => ({
        bill,
        current: currentByBill.get(String(bill.id)) || 0,
        available: num(bill.financial?.balance_due) + (currentByBill.get(String(bill.id)) || 0)
      }))
      .filter(row => row.available > 0 || row.current > 0);
    $('allocationTitle').textContent = `Aplicar ${payment.payment_number}`;
    $('allocationSubtitle').textContent = `${money(payment.amount, payment.currency)} · ${payment.purchase_order?.po_number || 'Sin PO'}`;
    $('allocationBills').innerHTML = bills.length ? bills.map(({ bill, current, available }) => `<article class="payable-line" data-allocation-bill="${esc(bill.id)}"><div class="payable-detail-item"><div><div class="payable-line-title">${esc(bill.bill_number)} · ${esc(bill.supplier_invoice_number || 'Sin nº del proveedor')}</div><div class="payable-line-meta">Saldo disponible para este pago: ${esc(money(available, bill.currency))}</div></div><input class="allocation-amount" data-amount type="number" min="0" max="${esc(available)}" step="0.01" value="${esc(current)}" aria-label="Monto para ${esc(bill.bill_number)}"></div></article>`).join('') : emptyState('Sin facturas aplicables', 'Esta PO no tiene facturas contabilizadas con saldo pendiente.');
    message('allocationMsg', '');
    openModal('allocation');
    return true;
  }

  async function saveAllocation() {
    const payment = state.payments.find(row => String(row.id) === String(state.allocationPaymentId));
    if (!payment || !actionAllowed(payment, 'allocate')) return message('allocationMsg', 'Este pago ya no admite distribución.');
    const applications = [...document.querySelectorAll('[data-allocation-bill]')].map(node => ({
      supplier_bill_id: node.dataset.allocationBill,
      amount: node.querySelector('[data-amount]')?.value || ''
    })).filter(row => num(row.amount) > 0);
    const button = $('saveAllocation');
    button.disabled = true;
    try {
      await request('/api/supplier-payments', {
        method: 'POST',
        body: JSON.stringify({ action: 'replace_applications', supplier_payment_id: payment.id, applications })
      });
      closeModal('allocation', false);
      await refresh();
      setPageMessage('Distribución del pago actualizada correctamente.', 'ok');
    } catch (error) {
      message('allocationMsg', reportApError('allocate_payment', error, 'No se pudo guardar la distribución. Revisa los montos e intenta nuevamente.'));
    } finally {
      button.disabled = false;
    }
  }

  function openReverse(id) {
    const payment = state.payments.find(row => String(row.id) === String(id));
    if (!payment || !actionAllowed(payment, 'reverse')) return false;
    state.reversePaymentId = payment.id;
    $('reverseTitle').textContent = `Revertir ${payment.payment_number}`;
    $('rReason').value = '';
    message('reverseMsg', '');
    openModal('reverse', 'rReason');
    return true;
  }

  async function saveReverse() {
    const payment = state.payments.find(row => String(row.id) === String(state.reversePaymentId));
    const reason = $('rReason').value.trim();
    if (!payment || !actionAllowed(payment, 'reverse')) return message('reverseMsg', 'Este pago ya no puede revertirse.');
    if (!reason) return message('reverseMsg', 'Indica el motivo del reverso.');
    const button = $('saveReverse');
    button.disabled = true;
    try {
      await request('/api/supplier-payments', {
        method: 'POST',
        body: JSON.stringify({ action: 'reverse', supplier_payment_id: state.reversePaymentId, reason })
      });
      closeModal('reverse', false);
      await refresh();
      setPageMessage('Pago de proveedor revertido correctamente.', 'ok');
    } catch (error) {
      message('reverseMsg', reportApError('reverse_payment', error, 'No se pudo revertir el pago. Intenta nuevamente.'));
    } finally {
      button.disabled = false;
    }
  }

  function detailSection(title, count, content, emptyTitle, emptyCopy) {
    return `<section class="payable-detail-section"><header class="payable-detail-section-head"><h3>${esc(title)}</h3><span>${count} registro${count === 1 ? '' : 's'}</span></header><div class="payable-detail-items">${content || emptyState(emptyTitle, emptyCopy)}</div></section>`;
  }

  function apNavigation() {
    try {
      return window.parent?.APTraceability || null;
    } catch {
      return null;
    }
  }

  function traceButton(label, action, value, primary = false) {
    return `<button class="btn${primary ? ' primary' : ''}" type="button" data-trace-action="${esc(action)}" data-trace-value="${esc(value)}">${esc(label)}</button>`;
  }

  async function renderTraceability(type, number) {
    const sequence = ++traceSequence;
    const section = $('detailTraceability');
    const actions = $('detailTraceabilityActions');
    section.hidden = false;
    actions.innerHTML = '<span class="payable-cell-sub">Consultando relaciones de origen…</span>';
    const navigation = apNavigation();
    if (!navigation) {
      actions.innerHTML = '<span class="payable-cell-sub">La trazabilidad no está disponible en esta sesión.</span>';
      return;
    }
    try {
      const row = type === 'bill' ? await navigation.billByNumber(number) : await navigation.paymentByNumber(number);
      if (sequence !== traceSequence || $('detailModal').classList.contains('hidden')) return;
      if (!row) {
        actions.innerHTML = '<span class="payable-cell-sub">No hay relaciones financieras registradas.</span>';
        return;
      }
      const items = [];
      if (row.supplier_id) items.push(traceButton('Ver proveedor', 'supplier', row.supplier_id, true));
      if (row.purchase_order_id) items.push(traceButton(`Ver ${row.po_number || 'Purchase Order'}`, 'purchase', row.purchase_order_id));
      (row.receipts || []).forEach(receipt => {
        if (receipt.receipt_number) items.push(traceButton(`WR ${receipt.receipt_number}`, 'receipt', receipt.receipt_number));
      });
      if (type === 'bill') {
        (row.payments || []).forEach(payment => {
          if (payment.supplier_payment_id) items.push(traceButton(payment.payment_number || 'Ver pago', 'payment', payment.supplier_payment_id));
        });
      } else {
        (row.bills || []).forEach(bill => {
          if (bill.supplier_bill_id) items.push(traceButton(bill.bill_number || 'Ver factura', 'bill', bill.supplier_bill_id));
        });
      }
      actions.innerHTML = items.length ? items.join('') : '<span class="payable-cell-sub">No hay relaciones adicionales registradas.</span>';
    } catch (error) {
      if (sequence !== traceSequence || $('detailModal').classList.contains('hidden')) return;
      actions.innerHTML = '<span class="payable-cell-sub">No se pudo consultar la trazabilidad en este momento.</span>';
      reportApError('traceability', error, 'No se pudo consultar la trazabilidad.');
    }
  }

  function openBillDetail(id) {
    const bill = state.bills.find(row => String(row.id) === String(id));
    if (!bill) return false;
    const financial = bill.financial || {};
    $('detailTitle').textContent = bill.bill_number || 'Factura de proveedor';
    $('detailSubtitle').textContent = `${supplierName(bill)} · ${bill.purchase_order?.po_number || 'Sin PO'} · ${date(bill.bill_date)}`;
    const items = (bill.items || []).map(item => `<article class="payable-detail-item"><div><div class="payable-detail-item-title">${esc(item.product?.name || 'Producto')}</div><div class="payable-detail-item-meta">${esc(item.billed_quantity)} ${esc(item.unit)} × ${esc(money(item.unit_cost, bill.currency))} · Costo PO ${esc(money(item.po_unit_cost_snapshot, bill.currency))}${item.pricing_mode === 'total' ? ' · Total exacto capturado' : ''}</div></div><span class="payable-detail-item-value">${esc(money(item.line_total, bill.currency))}</span></article>`).join('');
    $('detailBody').innerHTML = `<div class="payable-detail-summary">
      <article><span>Total</span><strong>${esc(money(financial.bill_total, bill.currency))}</strong></article>
      <article><span>Pagado</span><strong>${esc(money(financial.paid_amount, bill.currency))}</strong></article>
      <article><span>Saldo</span><strong>${esc(money(financial.balance_due, bill.currency))}</strong></article>
      <article><span>Estado</span><strong>${billPill(bill)}</strong></article>
    </div>${detailSection('Líneas facturadas', bill.items?.length || 0, items, 'Sin líneas', 'Esta factura no contiene líneas disponibles.')}${bill.notes ? `<div class="payable-notes"><strong>Notas</strong><br>${esc(bill.notes)}</div>` : ''}`;
    const actions = [];
    if (actionAllowed(bill, 'pay')) actions.push(billActionButton(bill, 'pay', 'Pagar', 'orange'));
    if (actionAllowed(bill, 'edit')) actions.push(billActionButton(bill, 'edit', 'Editar'));
    if (actionAllowed(bill, 'post')) actions.push(billActionButton(bill, 'post', 'Contabilizar', 'primary'));
    if (actionAllowed(bill, 'void')) actions.push(billActionButton(bill, 'void', 'Anular', 'danger'));
    $('detailActions').innerHTML = actions.join('');
    message('detailMsg', '');
    openModal('detail');
    renderTraceability('bill', bill.bill_number);
    return true;
  }

  function openPaymentDetail(id) {
    const payment = state.payments.find(row => String(row.id) === String(id));
    if (!payment) return false;
    const progress = payment.progress || {};
    const applications = (payment.applications || []).map(application => {
      const bill = state.postedBills.find(row => String(row.id) === String(application.supplier_bill_id)) || state.bills.find(row => String(row.id) === String(application.supplier_bill_id));
      return `<article class="payable-detail-item"><div><div class="payable-detail-item-title">${esc(bill?.bill_number || 'Factura')}</div><div class="payable-detail-item-meta">${esc(bill?.supplier_invoice_number || 'Sin nº del proveedor')}</div></div><span class="payable-detail-item-value">${esc(money(application.amount, payment.currency))}</span></article>`;
    }).join('');
    $('detailTitle').textContent = payment.payment_number || 'Pago de proveedor';
    $('detailSubtitle').textContent = `${supplierName(payment)} · ${payment.purchase_order?.po_number || 'Sin PO'} · ${date(payment.payment_date)}`;
    $('detailBody').innerHTML = `<div class="payable-detail-summary">
      <article><span>Monto</span><strong>${esc(money(payment.amount, payment.currency))}</strong></article>
      <article><span>Aplicado</span><strong>${esc(money(progress.applied_amount, payment.currency))}</strong></article>
      <article><span>Sin aplicar</span><strong>${esc(money(progress.unapplied_amount, payment.currency))}</strong></article>
      <article><span>Estado</span><strong>${paymentPill(payment)}</strong></article>
    </div>${detailSection('Aplicaciones', payment.applications?.length || 0, applications, 'Sin aplicaciones', 'Este pago todavía no está aplicado a facturas.')}${payment.notes ? `<div class="payable-notes"><strong>Notas</strong><br>${esc(payment.notes)}</div>` : ''}${payment.reversal_reason ? `<div class="payable-notes"><strong>Motivo del reverso</strong><br>${esc(payment.reversal_reason)}</div>` : ''}`;
    const actions = [];
    if (actionAllowed(payment, 'allocate')) actions.push(paymentActionButton(payment, 'allocate', 'Aplicar', 'orange'));
    if (actionAllowed(payment, 'reverse')) actions.push(paymentActionButton(payment, 'reverse', 'Revertir', 'danger'));
    $('detailActions').innerHTML = actions.join('');
    message('detailMsg', '');
    openModal('detail');
    renderTraceability('payment', payment.payment_number);
    return true;
  }

  function askBillDecision(bill, action) {
    if (!bill || !['post', 'void'].includes(action) || !actionAllowed(bill, action)) return false;
    const posting = action === 'post';
    state.decision = { billId: bill.id, action };
    $('decisionTitle').textContent = posting ? 'Contabilizar factura' : 'Anular factura';
    $('decisionCopy').textContent = posting
      ? `Se contabilizará ${bill.bill_number}. Después sus líneas y encabezado quedarán bloqueados.`
      : `Se anulará ${bill.bill_number}. Esta acción solo está disponible si no tiene pagos activos aplicados.`;
    $('decisionAccept').textContent = posting ? 'Contabilizar factura' : 'Anular factura';
    $('decisionAccept').className = `btn ${posting ? 'orange' : 'danger'}`;
    message('decisionMsg', '');
    openModal('decision', 'decisionAccept');
    return true;
  }

  async function acceptDecision() {
    const decision = state.decision;
    const bill = state.bills.find(row => String(row.id) === String(decision?.billId));
    if (!decision || !bill || !actionAllowed(bill, decision.action)) return message('decisionMsg', 'Esta acción ya no está disponible.');
    const button = $('decisionAccept');
    button.disabled = true;
    try {
      await request('/api/payables', {
        method: 'POST',
        body: JSON.stringify({ action: decision.action, supplier_bill_id: bill.id })
      });
      const completedAction = decision.action;
      closeDecision(false);
      closeModal('detail', false);
      await refresh();
      setPageMessage(completedAction === 'post' ? 'Factura de proveedor contabilizada correctamente.' : 'Factura de proveedor anulada correctamente.', 'ok');
    } catch (error) {
      message('decisionMsg', reportApError(`bill_${decision.action}`, error, 'No se pudo completar la acción sobre la factura. Intenta nuevamente.'));
    } finally {
      button.disabled = false;
    }
  }

  function handleBillAction(target) {
    const button = target.closest('[data-bill-action]');
    if (!button) return false;
    const { billAction: action, billId: id } = button.dataset;
    if (action === 'detail') return openBillDetail(id);
    if (action === 'pay') {
      closeModal('detail', false);
      return openPaymentCreate('direct', id);
    }
    if (action === 'edit') {
      closeModal('detail', false);
      return openBillEdit(id);
    }
    if (action === 'post' || action === 'void') return askBillDecision(state.bills.find(row => String(row.id) === String(id)), action);
    return false;
  }

  function handlePaymentAction(target) {
    const button = target.closest('[data-payment-action]');
    if (!button) return false;
    const { paymentAction: action, paymentId: id } = button.dataset;
    if (action === 'detail') return openPaymentDetail(id);
    if (action === 'allocate') {
      closeModal('detail', false);
      return openAllocation(id);
    }
    if (action === 'reverse') {
      closeModal('detail', false);
      return openReverse(id);
    }
    return false;
  }

  function handleTraceAction(target) {
    const button = target.closest('[data-trace-action]');
    if (!button) return false;
    const navigation = apNavigation();
    if (!navigation) return false;
    const { traceAction: action, traceValue: value } = button.dataset;
    let result = false;
    if (action === 'supplier') result = navigation.openSupplier(value);
    else if (action === 'purchase') result = navigation.openPurchase(value);
    else if (action === 'receipt') result = navigation.openReceipt(value);
    else if (action === 'bill') result = navigation.openBill(value);
    else if (action === 'payment') result = navigation.openPayment(value);
    Promise.resolve(result).catch(error => reportApError('trace_navigation', error, 'No se pudo abrir la relación seleccionada.'));
    return true;
  }

  function resetFilters() {
    state.entity = 'bills';
    state.view = 'open';
    state.search = '';
    $('search').value = '';
    render();
    $('search').focus();
  }

  function bindEvents() {
    $('newBill').addEventListener('click', openBillCreate);
    $('newPayment').addEventListener('click', () => openPaymentCreate('manual'));
    $('newAdvancePayment').addEventListener('click', () => openPaymentCreate('advance'));
    $('refresh').addEventListener('click', () => refresh().catch(showLoadFailure));
    $('clearPayablesFilters').addEventListener('click', resetFilters);
    $('saveBill').addEventListener('click', saveBill);
    $('savePayment').addEventListener('click', savePayment);
    $('saveAllocation').addEventListener('click', saveAllocation);
    $('saveReverse').addEventListener('click', saveReverse);
    $('decisionAccept').addEventListener('click', acceptDecision);
    $('pPO').addEventListener('change', updatePaymentHint);
    $('bPO').addEventListener('change', () => renderBillLines(state.editingBillId ? state.bills.find(bill => bill.id === state.editingBillId) : null));
    $('billLines').addEventListener('input', event => {
      const target = event.target instanceof Element ? event.target : null;
      const line = target?.closest('[data-bill-line]');
      if (!line) return;
      if (target.matches('[data-total]')) syncBillLine(line, 'total');
      else if (target.matches('[data-cost]')) syncBillLine(line, 'cost');
      else if (target.matches('[data-qty]')) syncBillLine(line, 'quantity');
    });
    $('search').addEventListener('input', event => {
      state.search = event.target.value || '';
      renderList();
    });
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const close = target.closest('[data-close]');
      if (close) {
        if (close.dataset.close === 'payment') closePaymentModal();
        else if (close.dataset.close === 'decision') closeDecision();
        else closeModal(close.dataset.close);
        return;
      }
      const entity = target.closest('[data-entity]');
      if (entity) {
        state.entity = entity.dataset.entity;
        state.view = state.entity === 'bills' ? 'open' : 'active';
        render();
        return;
      }
      const view = target.closest('[data-view]');
      if (view) {
        state.view = view.dataset.view;
        renderViewTabs();
        renderList();
        return;
      }
      if (handleBillAction(target)) return;
      if (handlePaymentAction(target)) return;
      handleTraceAction(target);
    });
    document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', event => {
      if (event.target !== modal) return;
      if (modal.id === 'paymentModal') closePaymentModal();
      else if (modal.id === 'decisionModal') closeDecision();
      else closeModal(modal.id);
    }));
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const open = ['decisionModal', 'reverseModal', 'allocationModal', 'paymentModal', 'billModal', 'detailModal'].find(id => !$(id).classList.contains('hidden'));
      if (!open) return;
      event.stopImmediatePropagation();
      if (open === 'decisionModal') closeDecision();
      else if (open === 'paymentModal') closePaymentModal();
      else closeModal(open);
    }, true);
  }

  async function handlePendingNavigation() {
    if (pendingBillId) {
      const id = pendingBillId;
      pendingBillId = '';
      return openBill(id);
    }
    if (pendingPaymentId) {
      const id = pendingPaymentId;
      pendingPaymentId = '';
      return openPayment(id);
    }
    return false;
  }

  async function refresh() {
    if (!token) return false;
    const [payables, payments] = await Promise.all([request('/api/payables'), request('/api/supplier-payments')]);
    state.bills = Array.isArray(payables.bills) ? payables.bills : [];
    state.purchaseOrders = Array.isArray(payables.purchase_orders) ? payables.purchase_orders : [];
    state.payments = Array.isArray(payments.payments) ? payments.payments : [];
    state.postedBills = Array.isArray(payments.bills) ? payments.bills : [];
    state.paymentPOs = Array.isArray(payments.purchase_orders) ? payments.purchase_orders : [];
    state.advancePurchaseOrders = Array.isArray(payments.advance_purchase_orders) ? payments.advance_purchase_orders : [];
    state.writeAccess = payables.write_access === true && payments.write_access === true;
    state.loaded = true;
    syncTopActions();
    $('payablesReadOnlyNote').hidden = state.writeAccess;
    $('payablesLastUpdated').textContent = `Actualizado ${new Date().toLocaleTimeString('es-US', { hour: '2-digit', minute: '2-digit' })}`;
    setPageMessage('');
    render();
    window.parent?.dispatchEvent?.(new CustomEvent('export-mca:data-loaded'));
    await handlePendingNavigation();
    return true;
  }

  function showLoadFailure(error) {
    const value = reportApError('bootstrap', error, 'No se pudieron cargar las Cuentas por pagar. Intenta nuevamente.');
    setPageMessage(value);
    $('payablesResultCount').textContent = 'No disponible';
    $('list').innerHTML = `${emptyState('Cuentas por pagar no disponible', value)}<div class="payables-empty"><button id="payablesRetry" class="btn" type="button">Reintentar</button></div>`;
    $('payablesRetry')?.addEventListener('click', () => {
      $('list').innerHTML = '<div class="payables-loading" role="status"><span class="payables-spinner" aria-hidden="true"></span>Consultando Cuentas por pagar…</div>';
      refresh().catch(showLoadFailure);
    });
  }

  function openBill(id) {
    if (!state.loaded) {
      pendingBillId = String(id || '');
      return true;
    }
    const opened = openBillDetail(id);
    if (!opened) setPageMessage('La factura de proveedor solicitada ya no está disponible.');
    return opened;
  }

  function openPayment(id) {
    if (!state.loaded) {
      pendingPaymentId = String(id || '');
      return true;
    }
    const opened = openPaymentDetail(id);
    if (!opened) setPageMessage('El pago de proveedor solicitado ya no está disponible.');
    return opened;
  }

  function startPayables(sessionToken = token) {
    if (moduleStarted) return true;
    token = String(sessionToken || '');
    if (!token) return false;
    moduleStarted = true;
    bindEvents();
    refresh().catch(showLoadFailure);
    return true;
  }

  function handleStoredSession(event) {
    if (event.key !== 'export_mca_token' || !event.newValue) return;
    window.removeEventListener('storage', handleStoredSession);
    startPayables(event.newValue);
  }

  window.load = refresh;
  window.PayablesModule = Object.freeze({
    owner: 'payables.js',
    embedded: embeddedMode,
    safeApMessage,
    refresh,
    openBill,
    openPayment
  });

  if (!startPayables()) {
    if (embeddedMode) window.addEventListener('storage', handleStoredSession);
    else redirectToAdminLogin();
  }
})();
