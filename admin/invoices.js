(() => {
  const $ = id => document.getElementById(id);
  let token = localStorage.getItem('export_mca_token') || '';
  const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';
  let moduleStarted = false;
  let pendingInvoiceId = '';
  let pendingCollectionId = '';
  let pendingSalesOrderId = '';
  const modalReturnFocus = new Map();

  const state = {
    invoices: [],
    salesOrders: [],
    metrics: null,
    writeAccess: false,
    view: 'open',
    search: '',
    editingId: null,
    paymentInvoiceId: null,
    decisionAction: null,
    loaded: false
  };

  const SAFE_INVOICE_ERROR_PATTERNS = [
    /^(?:No tienes|Esta factura|Factura|La factura|El monto|El cobro|Ese cobro|La cantidad|La operación|La Sales Order|Sales Order|La solicitud|Una línea|Uno de los productos|Solo se|Selecciona|Indica|Agrega|Falta|Revierte|Vincula|Transición|Acción de|Sesión vencida)/i,
    /^No se pudo procesar (?:Facturación|el cobro)(?:\. Intenta nuevamente\.)?$/i
  ];

  const PAYMENT_STATUS_LABELS = Object.freeze({
    posted: 'Registrado',
    reversed: 'Revertido'
  });

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

  const capability=(entity,key)=>entity?.capabilities?.actions?.[key]||{allowed:false,reason:'CAPABILITY_UNAVAILABLE'};
  const can=(entity,key)=>capability(entity,key).allowed===true;
  const paymentCapability=(payment,key)=>payment?.capabilities?.actions?.[key]||{allowed:false,reason:'CAPABILITY_UNAVAILABLE'};
  const canPayment=(payment,key)=>paymentCapability(payment,key).allowed===true;

  function redirectToAdminLogin() {
    localStorage.removeItem('export_mca_token');
    localStorage.removeItem('export_mca_user');
    if (embeddedMode && window.top !== window) {
      window.top.location.replace('/admin/index.html');
      return;
    }
    location.replace('/admin/index.html');
  }

  async function request(url = '/api/invoices', options = {}) {
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
      const error = new Error(data.error || 'No se pudo procesar Facturación');
      error.status = response.status;
      error.code = data.details?.code || data.code || null;
      error.endpoint = String(url).split('?')[0];
      throw error;
    }
    return data;
  }

  function safeInvoiceMessage(error, fallback = 'No se pudo completar la operación. Intenta nuevamente.') {
    const value = String(error?.message || '').trim();
    const status = Number(error?.status || 0);
    if (status === 401 || value === 'Sesión vencida') return 'Tu sesión terminó. Inicia sesión nuevamente para continuar.';
    if (status === 403) return 'No tienes permiso para completar esta acción.';
    if ((status === 0 || [400, 404, 409, 422].includes(status)) && SAFE_INVOICE_ERROR_PATTERNS.some(pattern => pattern.test(value))) return value;
    return fallback;
  }

  function reportInvoiceError(context, error, fallback = 'No se pudo completar la operación. Intenta nuevamente.') {
    const message = safeInvoiceMessage(error, fallback);
    if (message === fallback || Number(error?.status || 0) >= 500) {
      console.error('INVOICES_UI_FAILED', {
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
    const node = $('invoicePageMsg');
    if (!node) return;
    node.textContent = value;
    node.className = `invoice-feedback${value ? ` ${tone}` : ''}`;
  }

  function message(id, value = '', ok = false) {
    const node = $(id);
    if (!node) return;
    node.textContent = value;
    node.className = `msg invoice-dialog-message${value ? ` ${ok ? 'ok' : 'bad'}` : ''}`;
  }

  function money(value, currency = 'USD') {
    const code = String(currency || 'USD').trim().toUpperCase().slice(0, 3) || 'USD';
    return `${code} ${num(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  function clientName(row) {
    return row?.client?.company || row?.client?.mipyme_name || row?.client?.name || 'Cliente sin nombre';
  }

  function paymentStatusLabel(value) {
    return PAYMENT_STATUS_LABELS[value] || 'Estado no disponible';
  }

  function statusPill(invoice) {
    const financial = invoice.financial || {};
    if (invoice.status === 'void') return '<span class="pill off">Anulada</span>';
    if (invoice.status === 'draft') return '<span class="pill warn">Borrador</span>';
    if (financial.payment_status === 'paid') return '<span class="pill ok">Pagada</span>';
    if (financial.payment_status === 'partial') return '<span class="pill warn">Pago parcial</span>';
    if (financial.payment_status === 'overdue') return '<span class="pill bad">Vencida</span>';
    return '<span class="pill">Emitida</span>';
  }

  function receivableLabel() {
    const rows = Array.isArray(state.metrics?.receivable_by_currency) ? state.metrics.receivable_by_currency : [];
    return rows.length ? rows.map(row => money(row.amount, row.currency)).join(' · ') : '—';
  }

  function metric(label, value, detail, className) {
    return `<article class="metric ${className}"><span>${esc(label)}</span><b>${esc(value ?? '—')}</b><small>${esc(detail)}</small></article>`;
  }

  function renderMetrics() {
    const metrics = state.metrics || {};
    $('metrics').innerHTML = [
      ['Facturas', metrics.invoice_count ?? '—', 'Activas en cartera', 'invoice-metric-total'],
      ['Borradores', metrics.draft_count ?? '—', 'Pendientes de emisión', 'invoice-metric-draft'],
      ['Pagadas', metrics.paid_count ?? '—', 'Saldo liquidado', 'invoice-metric-paid'],
      ['Vencidas', metrics.overdue_count ?? '—', 'Requieren seguimiento', 'invoice-metric-overdue'],
      ['Por cobrar', receivableLabel(), 'Saldo emitido pendiente', 'invoice-metric-receivable']
    ].map(values => metric(...values)).join('');
  }

  function matchesView(invoice) {
    if (state.view === 'all') return true;
    if (state.view === 'draft') return invoice.status === 'draft';
    if (state.view === 'paid') return invoice.status === 'issued' && invoice.financial?.payment_status === 'paid';
    return invoice.status !== 'void' && !(invoice.status === 'issued' && invoice.financial?.payment_status === 'paid');
  }

  function filteredInvoices() {
    const query = state.search.trim().toLowerCase();
    return state.invoices.filter(invoice => {
      if (!matchesView(invoice)) return false;
      if (!query) return true;
      return [
        invoice.invoice_number,
        invoice.sales_order?.so_number,
        invoice.sales_order?.customer_reference,
        clientName(invoice),
        invoice.status,
        invoice.financial?.payment_status
      ].join(' ').toLowerCase().includes(query);
    });
  }

  function invoiceActionButton(invoice, action, label, className = '') {
    return `<button class="btn ${className}" type="button" data-invoice-action="${esc(action)}" data-invoice-id="${esc(invoice.id)}">${esc(label)}</button>`;
  }

  function invoiceActions(invoice) {
    const actions = [invoiceActionButton(invoice, 'detail', 'Ver detalle')];
    if (can(invoice, 'record_payment')) actions.push(invoiceActionButton(invoice, 'payment', 'Registrar cobro', 'orange'));
    if (can(invoice, 'edit')) actions.push(invoiceActionButton(invoice, 'edit', 'Editar'));
    if (can(invoice, 'issue')) actions.push(invoiceActionButton(invoice, 'issue', 'Emitir', 'primary'));
    if (can(invoice, 'void')) actions.push(invoiceActionButton(invoice, 'void', 'Anular', 'danger'));
    return actions.join('');
  }

  function invoiceRow(invoice) {
    const financial = invoice.financial || {};
    const reference = invoice.sales_order?.customer_reference || 'Sin referencia';
    return `<article class="invoice-row" data-invoice-row="${esc(invoice.id)}">
      <div class="invoice-cell"><span class="invoice-cell-label">Factura</span><span class="invoice-number">${esc(invoice.invoice_number || 'Sin número')}</span><span class="invoice-cell-sub">${esc(date(invoice.issue_date))}</span></div>
      <div class="invoice-cell"><span class="invoice-cell-label">Cliente</span><span class="invoice-cell-main">${esc(clientName(invoice))}</span><span class="invoice-cell-sub">${esc(reference)}</span></div>
      <div class="invoice-cell"><span class="invoice-cell-label">Venta</span><span class="invoice-cell-main">${esc(invoice.sales_order?.so_number || 'Sin venta')}</span><span class="invoice-cell-sub">Vence ${esc(date(invoice.due_date))}</span></div>
      <div class="invoice-cell"><span class="invoice-cell-label">Estado</span>${statusPill(invoice)}</div>
      <div class="invoice-cell"><span class="invoice-cell-label">Total</span><span class="invoice-money">${esc(money(financial.total, invoice.currency))}</span><span class="invoice-cell-sub">Facturado</span></div>
      <div class="invoice-cell"><span class="invoice-cell-label">Saldo</span><span class="invoice-money balance">${esc(money(financial.balance_due, invoice.currency))}</span><span class="invoice-cell-sub">Pendiente</span></div>
      <div class="invoice-row-actions" aria-label="Acciones de ${esc(invoice.invoice_number || 'factura')}">${invoiceActions(invoice)}</div>
    </article>`;
  }

  function emptyState(title, copy) {
    return `<div class="invoices-empty"><strong>${esc(title)}</strong><span>${esc(copy)}</span></div>`;
  }

  function renderList() {
    const rows = filteredInvoices();
    $('invoiceResultCount').textContent = `${rows.length} factura${rows.length === 1 ? '' : 's'}${rows.length !== state.invoices.length ? ` · ${state.invoices.length} totales` : ''}`;
    if (!rows.length) {
      $('invoiceList').innerHTML = emptyState(
        state.invoices.length ? 'Sin resultados' : 'Aún no hay facturas',
        state.invoices.length ? 'Ajusta la búsqueda o cambia el filtro para consultar otras facturas.' : 'Las facturas creadas desde una venta aparecerán aquí con sus cobros y saldo.'
      );
      return;
    }
    $('invoiceList').innerHTML = rows.map(invoiceRow).join('');
  }

  function render() {
    renderMetrics();
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
  }

  function eligibleOrders(editingInvoice = null) {
    return state.salesOrders.filter(order => order.items?.some(item => {
      const own = editingInvoice?.items?.find(line => line.sales_order_item_id === item.id);
      return num(item.invoice_progress?.available_to_invoice_quantity) + num(own?.quantity) > 0;
    }));
  }

  function fillSalesOrderOptions(editingInvoice = null) {
    const orders = eligibleOrders(editingInvoice);
    $('iSalesOrder').innerHTML = '<option value="">Selecciona una venta</option>' + orders.map(order => `<option value="${esc(order.id)}">${esc(order.so_number)} · ${esc(clientName(order))}</option>`).join('');
  }

  function renderInvoiceLines(editingInvoice = null) {
    const order = state.salesOrders.find(row => String(row.id) === String($('iSalesOrder').value));
    if (!order) {
      $('invoiceLines').innerHTML = emptyState('Selecciona una venta', 'Mostraremos únicamente las cantidades disponibles para facturar.');
      return;
    }
    const rows = (order.items || []).map(item => {
      const own = editingInvoice?.items?.find(line => line.sales_order_item_id === item.id);
      const available = num(item.invoice_progress?.available_to_invoice_quantity) + num(own?.quantity);
      if (available <= 0 && !own) return '';
      const product = item.product || {};
      const label = product.sku ? `${product.sku} · ${product.name || ''}` : (product.name || 'Producto');
      const quantity = own ? num(own.quantity) : available;
      return `<div class="invoice-line" data-invoice-line="${esc(item.id)}">
        <div class="invoice-line-title">${esc(label)}</div>
        <div class="invoice-line-meta">Ordenado ${esc(item.ordered_quantity)} ${esc(item.unit)} · Disponible ${esc(available)} · Precio ${esc(money(item.unit_price, order.currency))}</div>
        <div class="grid"><div><label>Cantidad a facturar</label><input data-qty type="number" min="0" max="${esc(available)}" step="any" value="${esc(quantity)}"></div><div><label>Nota</label><input data-note value="${esc(own?.notes || '')}" placeholder="Opcional"></div></div>
      </div>`;
    }).filter(Boolean);
    $('invoiceLines').innerHTML = rows.length ? rows.join('') : emptyState('Sin saldo disponible', 'Esta venta no tiene cantidades pendientes de facturar.');
  }

  function openCreate(salesOrderId = '') {
    if (!state.writeAccess) {
      setPageMessage('No tienes permiso para crear facturas financieras.');
      return false;
    }
    state.editingId = null;
    $('invoiceTitle').textContent = 'Nueva factura de cobro';
    fillSalesOrderOptions();
    $('iSalesOrder').disabled = false;
    $('iSalesOrder').value = salesOrderId ? String(salesOrderId) : '';
    $('iIssueDate').value = localDateToday();
    $('iDueDate').value = '';
    $('iNotes').value = '';
    message('invoiceMsg', '');
    renderInvoiceLines();
    if (salesOrderId && $('iSalesOrder').value !== String(salesOrderId)) {
      message('invoiceMsg', 'La venta ya no tiene cantidades disponibles para facturar.');
    }
    openModal('invoice', 'iSalesOrder');
    return true;
  }

  function openEdit(id) {
    const invoice = state.invoices.find(row => String(row.id) === String(id));
    if (!invoice || !can(invoice, 'edit')) return false;
    state.editingId = invoice.id;
    $('invoiceTitle').textContent = `Editar ${invoice.invoice_number}`;
    fillSalesOrderOptions(invoice);
    $('iSalesOrder').value = invoice.sales_order_id;
    $('iSalesOrder').disabled = false;
    $('iIssueDate').value = String(invoice.issue_date || '').slice(0, 10);
    $('iDueDate').value = String(invoice.due_date || '').slice(0, 10);
    $('iNotes').value = invoice.notes || '';
    renderInvoiceLines(invoice);
    message('invoiceMsg', '');
    openModal('invoice', 'iIssueDate');
    return true;
  }

  function collectLines() {
    return [...document.querySelectorAll('[data-invoice-line]')].map(node => ({
      sales_order_item_id: node.dataset.invoiceLine,
      quantity: node.querySelector('[data-qty]')?.value || '',
      notes: node.querySelector('[data-note]')?.value || ''
    })).filter(line => num(line.quantity) > 0);
  }

  async function saveInvoice() {
    message('invoiceMsg', '');
    if (!state.writeAccess) return message('invoiceMsg', 'No tienes permiso para modificar facturas.');
    const editing = state.editingId ? state.invoices.find(row => row.id === state.editingId) : null;
    if (editing && !can(editing, 'edit')) return message('invoiceMsg', 'Esta factura ya no admite edición.');
    const salesOrderId = $('iSalesOrder').value;
    const lines = collectLines();
    if (!salesOrderId) return message('invoiceMsg', 'Selecciona una venta.');
    if (!lines.length) return message('invoiceMsg', 'Indica al menos una cantidad a facturar.');
    const button = $('saveInvoice');
    button.disabled = true;
    try {
      await request('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          action: state.editingId ? 'replace_plan' : 'create_plan',
          invoice_id: state.editingId,
          sales_order_id: salesOrderId,
          issue_date: $('iIssueDate').value || null,
          due_date: $('iDueDate').value || null,
          notes: $('iNotes').value || null,
          lines
        })
      });
      closeModal('invoice', false);
      setPageMessage(state.editingId ? 'Factura actualizada correctamente.' : 'Borrador de factura creado correctamente.', 'ok');
      await refresh();
    } catch (error) {
      message('invoiceMsg', reportInvoiceError('save_invoice', error));
    } finally {
      button.disabled = false;
    }
  }

  function paymentRows(invoice) {
    return (invoice.payments || []).map(payment => `<div class="invoice-detail-item">
      <div><div class="invoice-detail-item-title">${esc(date(payment.payment_date))} · ${esc(payment.method || 'Cobro')}</div><div class="invoice-detail-item-meta">${esc(payment.reference_number || 'Sin referencia')} · ${esc(paymentStatusLabel(payment.status))}</div></div>
      <div class="invoice-payment-actions"><span class="invoice-detail-item-value">${esc(money(payment.amount, payment.currency))}</span>${canPayment(payment, 'reverse') ? `<button class="btn danger" type="button" data-reverse-payment="${esc(payment.id)}" data-invoice-id="${esc(invoice.id)}">Revertir cobro</button>` : ''}</div>
    </div>`).join('');
  }

  function openDetail(id) {
    const invoice = state.invoices.find(row => String(row.id) === String(id));
    if (!invoice) return false;
    const financial = invoice.financial || {};
    $('detailTitle').textContent = invoice.invoice_number || 'Factura';
    $('detailSubtitle').textContent = `${clientName(invoice)} · ${invoice.sales_order?.so_number || 'Sin venta'} · ${date(invoice.issue_date)}`;
    const items = (invoice.items || []).map(item => `<div class="invoice-detail-item"><div><div class="invoice-detail-item-title">${esc(item.description || 'Producto')}</div><div class="invoice-detail-item-meta">${esc(item.quantity)} ${esc(item.unit)} × ${esc(money(item.unit_price, invoice.currency))}</div></div><span class="invoice-detail-item-value">${esc(money(item.line_total, invoice.currency))}</span></div>`).join('');
    const payments = paymentRows(invoice);
    $('detailBody').innerHTML = `
      <div class="invoice-detail-summary">
        <article><span>Total</span><strong>${esc(money(financial.total, invoice.currency))}</strong></article>
        <article><span>Cobrado</span><strong>${esc(money(financial.paid_amount, invoice.currency))}</strong></article>
        <article><span>Saldo</span><strong>${esc(money(financial.balance_due, invoice.currency))}</strong></article>
        <article><span>Estado</span><strong>${statusPill(invoice)}</strong></article>
      </div>
      <section class="invoice-detail-section"><header class="invoice-detail-section-head"><h3>Líneas facturadas</h3><span>${invoice.items?.length || 0} registro${invoice.items?.length === 1 ? '' : 's'}</span></header><div class="invoice-detail-items">${items || emptyState('Sin líneas', 'Esta factura no contiene líneas disponibles.')}</div></section>
      <section class="invoice-detail-section"><header class="invoice-detail-section-head"><h3>Cobros aplicados</h3><span>${invoice.payments?.length || 0} registro${invoice.payments?.length === 1 ? '' : 's'}</span></header><div class="invoice-detail-items">${payments || emptyState('Sin cobros', 'Todavía no hay dinero registrado contra esta factura.')}</div></section>
      ${invoice.notes ? `<div class="invoice-notes"><strong>Notas</strong><br>${esc(invoice.notes)}</div>` : ''}`;
    const actions = [];
    if (can(invoice, 'record_payment')) actions.push(invoiceActionButton(invoice, 'payment', 'Registrar cobro', 'orange'));
    if (can(invoice, 'edit')) actions.push(invoiceActionButton(invoice, 'edit', 'Editar'));
    if (can(invoice, 'issue')) actions.push(invoiceActionButton(invoice, 'issue', 'Emitir factura', 'primary'));
    if (can(invoice, 'void')) actions.push(invoiceActionButton(invoice, 'void', 'Anular factura', 'danger'));
    $('detailActions').innerHTML = actions.join('');
    message('detailMsg', '');
    openModal('detail');
    return true;
  }

  function openPayment(id) {
    const invoice = state.invoices.find(row => String(row.id) === String(id));
    if (!invoice || !can(invoice, 'record_payment')) return false;
    const balance = num(invoice.financial?.balance_due);
    state.paymentInvoiceId = invoice.id;
    $('paymentTitle').textContent = `Registrar cobro · ${invoice.invoice_number}`;
    $('paymentSubtitle').textContent = `Saldo pendiente: ${money(balance, invoice.currency)}`;
    $('pAmount').max = String(balance);
    $('pAmount').value = String(balance);
    $('pDate').value = localDateToday();
    $('pMethod').value = 'wire';
    $('pReference').value = '';
    $('pNotes').value = '';
    message('paymentMsg', '');
    closeModal('detail', false);
    openModal('payment', 'pAmount');
    return true;
  }

  async function savePayment() {
    const invoice = state.invoices.find(row => row.id === state.paymentInvoiceId);
    if (!invoice) return message('paymentMsg', 'Factura no encontrada.');
    if (!can(invoice, 'record_payment')) return message('paymentMsg', 'Esta factura ya no admite cobros.');
    const amount = num($('pAmount').value);
    if (amount <= 0) return message('paymentMsg', 'El monto debe ser mayor que cero.');
    const button = $('savePayment');
    button.disabled = true;
    try {
      await request('/api/invoice-payments', {
        method: 'POST',
        body: JSON.stringify({
          action: 'register',
          invoice_id: invoice.id,
          amount,
          payment_date: $('pDate').value || null,
          method: $('pMethod').value || null,
          reference_number: $('pReference').value || null,
          notes: $('pNotes').value || null
        })
      });
      closeModal('payment', false);
      setPageMessage('Cobro registrado correctamente.', 'ok');
      await refresh();
      openDetail(invoice.id);
    } catch (error) {
      message('paymentMsg', reportInvoiceError('save_payment', error));
    } finally {
      button.disabled = false;
    }
  }

  function closeDecision() {
    state.decisionAction = null;
    closeModal('decision');
    message('decisionMsg', '');
    $('decisionReason').value = '';
  }

  function askDecision({ title, copy, acceptLabel = 'Continuar', reason = false, danger = false, onAccept }) {
    state.decisionAction = onAccept;
    $('decisionTitle').textContent = title;
    $('decisionCopy').textContent = copy;
    $('decisionAccept').textContent = acceptLabel;
    $('decisionAccept').className = `btn ${danger ? 'danger' : 'orange'}`;
    $('decisionReasonWrap').classList.toggle('hidden', !reason);
    $('decisionReason').value = '';
    message('decisionMsg', '');
    openModal('decision', reason ? 'decisionReason' : 'decisionAccept');
  }

  async function acceptDecision() {
    if (typeof state.decisionAction !== 'function') return;
    const button = $('decisionAccept');
    button.disabled = true;
    try {
      await state.decisionAction($('decisionReason').value.trim());
      closeDecision();
    } catch (error) {
      message('decisionMsg', reportInvoiceError('decision', error));
    } finally {
      button.disabled = false;
    }
  }

  function transition(id, action) {
    const invoice = state.invoices.find(row => String(row.id) === String(id));
    if (!invoice || !can(invoice, action)) return;
    const issue = action === 'issue';
    askDecision({
      title: issue ? 'Emitir factura' : 'Anular factura',
      copy: issue ? `Se emitirá ${invoice.invoice_number}. Después sus líneas y estructura quedan bloqueadas.` : `Se anulará ${invoice.invoice_number}. Esta acción solo está disponible sin cobros ni anticipos aplicados.`,
      acceptLabel: issue ? 'Emitir factura' : 'Anular factura',
      danger: !issue,
      onAccept: async () => {
        await request('/api/invoices', { method: 'POST', body: JSON.stringify({ action, invoice_id: id }) });
        closeModal('detail', false);
        setPageMessage(issue ? 'Factura emitida correctamente.' : 'Factura anulada correctamente.', 'ok');
        await refresh();
      }
    });
  }

  function reversePayment(paymentId, invoiceId) {
    const invoice = state.invoices.find(row => String(row.id) === String(invoiceId));
    const payment = invoice?.payments?.find(row => String(row.id) === String(paymentId));
    if (!payment || !canPayment(payment, 'reverse')) return;
    askDecision({
      title: 'Revertir cobro',
      copy: `Se revertirá el cobro de ${money(payment.amount, payment.currency)}. La factura recuperará ese saldo pendiente.`,
      acceptLabel: 'Revertir cobro',
      reason: true,
      danger: true,
      onAccept: async reason => {
        await request('/api/invoice-payments', { method: 'POST', body: JSON.stringify({ action: 'reverse', payment_id: paymentId, reason }) });
        setPageMessage('Cobro revertido correctamente.', 'ok');
        await refresh();
        openDetail(invoiceId);
      }
    });
  }

  function handleInvoiceAction(target) {
    const button = target.closest('[data-invoice-action]');
    if (!button) return false;
    const { invoiceAction: action, invoiceId: id } = button.dataset;
    if (action === 'detail') return openDetail(id);
    if (action === 'payment') return openPayment(id);
    if (action === 'edit') {
      closeModal('detail', false);
      return openEdit(id);
    }
    if (action === 'issue' || action === 'void') return transition(id, action);
    return false;
  }

  function bindEvents() {
    $('newInvoice').addEventListener('click', () => openCreate());
    $('refresh').addEventListener('click', () => refresh().catch(showLoadFailure));
    $('clearInvoiceFilters').addEventListener('click', () => {
      state.search = '';
      state.view = 'open';
      $('search').value = '';
      document.querySelectorAll('[data-view]').forEach(button => {
        const active = button.dataset.view === 'open';
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      renderList();
      $('search').focus();
    });
    $('search').addEventListener('input', event => {
      state.search = event.target.value || '';
      renderList();
    });
    $('iSalesOrder').addEventListener('change', () => renderInvoiceLines(state.editingId ? state.invoices.find(row => row.id === state.editingId) : null));
    $('saveInvoice').addEventListener('click', saveInvoice);
    $('savePayment').addEventListener('click', savePayment);
    $('decisionAccept').addEventListener('click', acceptDecision);
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
      state.view = button.dataset.view;
      document.querySelectorAll('[data-view]').forEach(tab => {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-pressed', String(active));
      });
      renderList();
    }));
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const close = target.closest('[data-close]');
      if (close) {
        if (close.dataset.close === 'decision') closeDecision();
        else closeModal(close.dataset.close);
        return;
      }
      if (handleInvoiceAction(target)) return;
      const reverse = target.closest('[data-reverse-payment]');
      if (reverse) reversePayment(reverse.dataset.reversePayment, reverse.dataset.invoiceId);
    });
    document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', event => {
      if (event.target !== modal) return;
      if (modal.id === 'decisionModal') closeDecision();
      else closeModal(modal.id);
    }));
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const open = ['decisionModal', 'paymentModal', 'invoiceModal', 'detailModal'].find(id => !$(id).classList.contains('hidden'));
      if (!open) return;
      event.stopImmediatePropagation();
      if (open === 'decisionModal') closeDecision();
      else closeModal(open);
    }, true);
  }

  async function handlePendingNavigation() {
    if (pendingCollectionId) {
      const id = pendingCollectionId;
      pendingCollectionId = '';
      return openCollection(id);
    }
    if (pendingInvoiceId) {
      const id = pendingInvoiceId;
      pendingInvoiceId = '';
      return openInvoice(id);
    }
    if (pendingSalesOrderId) {
      const id = pendingSalesOrderId;
      pendingSalesOrderId = '';
      return openForSalesOrder(id);
    }
    return false;
  }

  async function refresh() {
    const data = await request();
    state.invoices = Array.isArray(data.invoices) ? data.invoices : [];
    state.salesOrders = Array.isArray(data.sales_orders) ? data.sales_orders : [];
    state.metrics = data.metrics || null;
    state.writeAccess = data.write_access === true;
    state.loaded = true;
    $('newInvoice').hidden=!state.writeAccess;
    $('invoicesReadOnlyNote').hidden = state.writeAccess;
    $('invoiceLastUpdated').textContent = `Actualizado ${new Date().toLocaleTimeString('es-US', { hour: '2-digit', minute: '2-digit' })}`;
    setPageMessage('');
    render();
    window.parent?.dispatchEvent?.(new CustomEvent('export-mca:data-loaded'));
    await handlePendingNavigation();
    return true;
  }

  function showLoadFailure(error) {
    const value = reportInvoiceError('bootstrap', error, 'No se pudieron cargar las facturas. Intenta nuevamente.');
    setPageMessage(value);
    $('invoiceResultCount').textContent = 'No disponible';
    $('invoiceList').innerHTML = `${emptyState('Facturación no disponible', value)}<div class="invoices-empty"><button id="invoiceRetry" class="btn" type="button">Reintentar</button></div>`;
    $('invoiceRetry')?.addEventListener('click', () => {
      $('invoiceList').innerHTML = '<div class="invoices-loading" role="status"><span class="invoices-spinner" aria-hidden="true"></span>Consultando facturas…</div>';
      refresh().catch(showLoadFailure);
    });
  }

  function openInvoice(id) {
    if (!state.loaded) {
      pendingInvoiceId = String(id || '');
      return true;
    }
    const opened = openDetail(id);
    if (!opened) setPageMessage('La factura solicitada ya no está disponible.');
    return opened;
  }

  function openCollection(id) {
    if (!state.loaded) {
      pendingCollectionId = String(id || '');
      return true;
    }
    const invoice = state.invoices.find(row => String(row.id) === String(id));
    if (!invoice) {
      setPageMessage('La factura solicitada ya no está disponible.');
      return false;
    }
    if (can(invoice, 'record_payment')) return openPayment(invoice.id);
    return openDetail(invoice.id);
  }

  function openForSalesOrder(salesOrderId) {
    if (!state.loaded) {
      pendingSalesOrderId = String(salesOrderId || '');
      return true;
    }
    return openCreate(salesOrderId);
  }

  function startInvoices(sessionToken = token) {
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
    startInvoices(event.newValue);
  }

  window.load = refresh;
  window.openOperationalInvoice = openInvoice;
  window.openOperationalInvoiceCollection = openCollection;
  window.openOperationalInvoiceForSalesOrder = openForSalesOrder;
  window.InvoicesModule = Object.freeze({
    owner: 'invoices.js',
    embedded: embeddedMode,
    safeInvoiceMessage,
    refresh,
    openInvoice,
    openCollection,
    openForSalesOrder
  });

  if (!startInvoices()) {
    if (embeddedMode) window.addEventListener('storage', handleStoredSession);
    else redirectToAdminLogin();
  }
})();
