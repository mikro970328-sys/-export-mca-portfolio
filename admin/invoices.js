(() => {
  const $ = id => document.getElementById(id);
  let token = localStorage.getItem('export_mca_token') || '';
  const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';
  let moduleStarted = false;
  let pendingInvoiceId = '';
  let pendingCollectionId = '';
  let pendingSalesOrderId = '';
  const modalReturnFocus = new Map();
  let invoiceDraft = null;

  const state = {
    invoices: [],
    salesOrders: [],
    metrics: null,
    writeAccess: false,
    view: 'open',
    search: '',
    editingId: null,
    paymentInvoiceId: null,
    paymentRequestId: null,
    paymentAttempted: false,
    paymentSaving: false,
    creditInvoice: null,
    creditRequestId: null,
    creditSaving: false,
    balanceInvoice: null,
    balanceTargets: [],
    balanceKind: null,
    balanceRequestId: null,
    balanceSaving: false,
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
      ['Por cobrar', receivableLabel(), 'Saldo emitido pendiente', 'invoice-metric-receivable'],
      ['Vencidas', metrics.overdue_count ?? '—', 'Requieren seguimiento', 'invoice-metric-overdue'],
      ['Borradores', metrics.draft_count ?? '—', 'Pendientes de emisión', 'invoice-metric-draft']
    ].map(values => metric(...values)).join('');
  }

  function matchesView(invoice) {
    if (state.view === 'all') return true;
    if (state.view === 'draft') return invoice.status === 'draft';
    if (state.view === 'paid') return invoice.status === 'issued' && invoice.financial?.payment_status === 'paid';
    return invoice.status === 'issued' && invoice.financial?.payment_status !== 'paid';
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
    return invoiceActionButton(invoice, 'detail', 'Abrir factura');
  }

  function invoiceRow(invoice) {
    const financial = invoice.financial || {};
    const reference = invoice.sales_order?.customer_reference || 'Sin referencia';
    return `<article class="invoice-row" data-invoice-row="${esc(invoice.id)}">
      <div class="invoice-cell"><span class="invoice-cell-label">Factura</span><span class="invoice-number">${esc(invoice.invoice_number || 'Sin número')}</span><span class="invoice-cell-sub">${esc(date(invoice.issue_date))}</span></div>
      <div class="invoice-cell"><span class="invoice-cell-label">Cliente</span><span class="invoice-cell-main">${esc(clientName(invoice))}</span><span class="invoice-cell-sub">${esc(reference)}</span></div>
      <div class="invoice-cell"><span class="invoice-cell-label">Venta</span><span class="invoice-cell-main">${esc(invoice.sales_order?.so_number || 'Sin venta')}</span><span class="invoice-cell-sub">Vence ${esc(date(invoice.due_date))}</span></div>
      <div class="invoice-cell"><span class="invoice-cell-label">Estado</span>${statusPill(invoice)}</div>
      <div class="invoice-cell"><span class="invoice-cell-label">Total</span><span class="invoice-money">${esc(money(financial.total, invoice.currency))}</span><span class="invoice-cell-sub">${num(financial.credited_amount)>0?'Neto tras notas de crédito':'Facturado'}</span></div>
      <div class="invoice-cell"><span class="invoice-cell-label">Saldo</span><span class="invoice-money balance">${esc(money(financial.balance_due, invoice.currency))}</span><span class="invoice-cell-sub">${num(financ