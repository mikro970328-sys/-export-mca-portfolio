(() => {
  'use strict';

  if (window.__executiveReportsInstalled) return;
  window.__executiveReportsInstalled = true;

  const $ = id => document.getElementById(id);
  const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';
  const state = {
    dataset:'sales',
    datasets:[],
    columns:[],
    rows:[],
    options:null,
    dimensions:new Set(),
    basis:'period_activity',
    loading:false,
    started:false,
    generatedAt:null
  };
  const token = () => localStorage.getItem('export_mca_token') || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[character]));

  const MONEY_FIELDS = new Set([
    'order_total','attributed_sales_revenue','unattributed_order_value','recognized_merchandise_cogs',
    'gross_margin','direct_cost_amount','contribution_margin','invoice_total','paid_amount','balance_due',
    'bill_total','amount'
  ]);
  const PERCENT_FIELDS = new Set(['gross_margin_pct','contribution_margin_pct']);
  const NUMBER_FIELDS = new Set([
    'item_count','costed_item_count','physical_quantity','reserved_quantity','available_quantity',
    'physical_pallets','reserved_pallets','available_pallets'
  ]);
  const DATE_FIELDS = new Set(['order_date','issue_date','due_date','bill_date','payment_date','received_at']);
  const STATUS_FIELDS = new Set([
    'status','fulfillment_status','receipt_status','payment_status','profitability_status',
    'contribution_status','merchandise_cost_coverage','order_value_coverage','has_excess','overdue','event_type','direction'
  ]);
  const PRIMARY_FIELDS = new Set(['so_number','po_number','invoice_number','bill_number','document_number','receipt_number','product_name']);
  const DATASET_DESCRIPTIONS = Object.freeze({
    sales:'Ventas y rentabilidad reconocida por orden, cliente y moneda.',
    purchases:'Compras, recepción, cobertura de costo y proveedor por Purchase Order.',
    invoices:'Facturas de clientes, cobros aplicados, saldos y vencimientos.',
    supplier_bills:'Facturas de proveedores, pagos aplicados y cuentas por pagar.',
    cash:'Entradas y salidas de efectivo registradas por contraparte y documento.',
    inventory:'Existencia física, reserva y disponibilidad actual por recepción y producto.'
  });
  const STATUS_LABELS = Object.freeze({
    draft:'Borrador', open:'Abierto', active:'Activo', issued:'Emitida', posted:'Contabilizado',
    confirmed:'Confirmado', closed:'Cerrado', cancelled:'Cancelado', void:'Anulado', paid:'Pagado',
    unpaid:'Pendiente', partial:'Parcial', partially_paid:'Pago parcial', overdue:'Vencido',
    complete:'Completa', completed:'Completado', available:'Disponible', comparable:'Comparable',
    incomplete:'Incompleta', unavailable:'No disponible', pending:'Pendiente', received:'Recibido',
    not_received:'Sin recibir', in_progress:'En proceso', fulfilled:'Cumplida', unfulfilled:'Sin cumplir',
    customer_payment:'Cobro de cliente', customer_collection:'Cobro de cliente', supplier_payment:'Pago a proveedor',
    in:'Entrada', out:'Salida', true:'Sí', false:'No'
  });
  const GOOD_STATES = new Set(['active','posted','paid','complete','completed','available','comparable','received','fulfilled','in','false']);
  const WARNING_STATES = new Set(['draft','pending','partial','partially_paid','incomplete','in_progress','unfulfilled','not_received']);
  const BAD_STATES = new Set(['cancelled','void','overdue','out','true']);

  function redirectToAdminLogin() {
    localStorage.removeItem('export_mca_token');
    if (embeddedMode && window.top !== window) window.top.location.replace('/admin/index.html');
    else location.replace('/admin/index.html');
  }

  function safeReportMessage(error, fallback = 'No se pudo cargar el reporte. Intenta actualizar nuevamente.') {
    const detail = String(error?.message || '').trim();
    if (/sesión vencida|unauthorized|no autorizado/i.test(detail)) return 'Tu sesión venció. Inicia sesión nuevamente.';
    if (/reporte inválido|filtro .* no aplica|límite inválido|valor entre 1 y 5000/i.test(detail)) return detail;
    return fallback;
  }

  function reportError(context, error) {
    const marker = context === 'load' ? 'REPORTS_UI_FAILED' : 'REPORTS_EXPORT_FAILED';
    console.error(marker, error);
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers:{...(token() ? { Authorization:`Bearer ${token()}` } : {}), ...(options.headers || {})}
    });
    if (options.raw) {
      if (response.status === 401) redirectToAdminLogin();
      return response;
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      redirectToAdminLogin();
      throw new Error('Sesión vencida');
    }
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar Reportes');
    return data;
  }

  function optionHtml(rows, labeler) {
    return (rows || []).map(row => `<option value="${esc(row.id)}">${esc(labeler(row))}</option>`).join('');
  }

  function populateOptions(options = {}) {
    state.options = options;
    $('currency').innerHTML = '<option value="">Todas, separadas</option>' + (options.currencies || [])
      .map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    $('clientId').innerHTML = '<option value="">Todos</option>' + optionHtml(options.clients, row => row.company ? `${row.name} · ${row.company}` : row.name);
    $('supplierId').innerHTML = '<option value="">Todos</option>' + optionHtml(options.suppliers, row => row.legal_name ? `${row.name} · ${row.legal_name}` : row.name);
    $('productId').innerHTML = '<option value="">Todos</option>' + optionHtml(options.products, row => [row.sku,row.name,row.brand].filter(Boolean).join(' · '));
  }

  function currentDataset() {
    return state.datasets.find(item => item.key === state.dataset) || { key:state.dataset, label:'Reporte', basis:state.basis };
  }

  function renderTabs() {
    $('datasetTabs').innerHTML = state.datasets.map(item => {
      const active = item.key === state.dataset;
      return `<button type="button" role="tab" class="dataset-tab ${active ? 'active' : ''}" data-dataset="${esc(item.key)}" aria-selected="${active}" aria-controls="reportTable" tabindex="${active ? '0' : '-1'}">${esc(item.label)}</button>`;
    }).join('');
    $('datasetTabs').querySelectorAll('[data-dataset]').forEach(button => {
      button.addEventListener('click', () => switchDataset(button.dataset.dataset));
    });
  }

  function setDimensions(dimensions, basis) {
    state.dimensions = new Set(dimensions || []);
    state.basis = basis || 'period_activity';
    document.querySelectorAll('[data-filter-dimension]').forEach(label => {
      label.classList.toggle('dimension-hidden', !state.dimensions.has(label.dataset.filterDimension));
    });
    if (!state.dimensions.has('period')) { $('startDate').value = ''; $('endDate').value = ''; }
    if (!state.dimensions.has('currency')) $('currency').value = '';
    if (!state.dimensions.has('client')) $('clientId').value = '';
    if (!state.dimensions.has('supplier')) $('supplierId').value = '';
    if (!state.dimensions.has('product')) $('productId').value = '';
  }

  function filters() {
    return {
      start_date:$('startDate').value,
      end_date:$('endDate').value,
      currency:$('currency').value,
      client_id:$('clientId').value,
      supplier_id:$('supplierId').value,
      product_id:$('productId').value,
      limit:$('rowLimit').value
    };
  }

  function activeFilterCount(values = filters()) {
    return Object.entries(values).filter(([key, value]) => key !== 'limit' && Boolean(value)).length;
  }

  function buildUrl(format = 'json', includeOptions = true) {
    const params = new URLSearchParams({ dataset:state.dataset, limit:$('rowLimit').value });
    const current = filters();
    for (const [key,value] of Object.entries(current)) {
      if (key === 'limit' || !value) continue;
      params.set(key,value);
    }
    if (format === 'csv') params.set('format','csv');
    if (!includeOptions) params.set('include_options','0');
    return `/api/reports?${params.toString()}`;
  }

  function formatDate(value) {
    const source = String(value || '').slice(0,10);
    const match = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return String(value || '—');
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return new Intl.DateTimeFormat('es-US', { day:'2-digit', month:'short', year:'numeric' }).format(date);
  }

  function statusLabel(value) {
    const key = String(value ?? '').trim().toLowerCase();
    return STATUS_LABELS[key] || String(value ?? '—').replaceAll('_',' ');
  }

  function statusTone(value) {
    const key = String(value ?? '').trim().toLowerCase();
    if (GOOD_STATES.has(key)) return 'good';
    if (WARNING_STATES.has(key)) return 'warn';
    if (BAD_STATES.has(key)) return 'bad';
    return 'info';
  }

  function formatValue(row, key) {
    const value = row?.[key];
    if (value === null || value === undefined || value === '') return '—';
    if (STATUS_FIELDS.has(key)) return statusLabel(value);
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (DATE_FIELDS.has(key)) return formatDate(value);
    if (PERCENT_FIELDS.has(key)) return `${Number(value).toLocaleString('es-US',{minimumFractionDigits:1,maximumFractionDigits:2})}%`;
    if (MONEY_FIELDS.has(key)) {
      const currency = row?.currency || '';
      const amount = Number(value);
      if (currency) {
        try {
          return new Intl.NumberFormat('es-US',{style:'currency',currency:String(currency).toUpperCase(),maximumFractionDigits:2}).format(amount);
        } catch {}
      }
      return amount.toLocaleString('es-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    }
    if (NUMBER_FIELDS.has(key)) return Number(value).toLocaleString('es-US',{maximumFractionDigits:4});
    return String(value);
  }

  function renderMeta(payload) {
    const applied = payload.filters || {};
    const chips = [
      `${Number(payload.row_count || 0).toLocaleString('es-US')} fila(s)`,
      state.basis === 'current_snapshot' ? 'Base: snapshot actual' : 'Base: actividad del período',
      'FX: no se aplica · monedas separadas'
    ];
    if (applied.start_date || applied.end_date) chips.push(`Período: ${applied.start_date || '…'} → ${applied.end_date || '…'}`);
    if (applied.currency) chips.push(`Moneda: ${applied.currency}`);
    if (Number(payload.row_count || 0) >= Number(payload.limit || 0)) chips.push(`Límite alcanzado: ${payload.limit}`);
    $('reportMeta').innerHTML = chips.map((value,index) => `<span class="meta-chip ${index === 1 && state.basis === 'current_snapshot' ? 'snapshot-note' : ''}">${esc(value)}</span>`).join('');
  }

  function renderMetrics(payload = {}) {
    const dataset = currentDataset();
    const snapshot = state.basis === 'current_snapshot';
    const selectedCurrency = filters().currency;
    $('reportDatasetMetric').textContent = dataset.label || 'Reporte';
    $('reportRowsMetric').textContent = Number(payload.row_count ?? state.rows.length ?? 0).toLocaleString('es-US');
    $('reportBasisMetric').textContent = snapshot ? 'Actual' : 'Período';
    $('reportCurrencyMetric').textContent = selectedCurrency || 'Separadas';
    $('reportFiltersMetric').textContent = String(activeFilterCount());
    $('reportScope').textContent = snapshot ? 'Inventario actual' : 'Actividad del período';
    $('reportDataTitle').textContent = dataset.label || 'Reporte';
    $('reportDataDescription').textContent = DATASET_DESCRIPTIONS[state.dataset] || 'Información ejecutiva calculada por el ERP.';
    const count = Number(payload.row_count ?? state.rows.length ?? 0);
    $('reportResultCount').textContent = `${count.toLocaleString('es-US')} ${count === 1 ? 'resultado' : 'resultados'}`;
    if (payload.generated_at || state.generatedAt) {
      const value = payload.generated_at || state.generatedAt;
      const date = new Date(value);
      $('reportLastUpdated').textContent = Number.isNaN(date.getTime())
        ? 'Información actualizada'
        : `Actualizado ${date.toLocaleTimeString('es-US',{hour:'numeric',minute:'2-digit'})}`;
    }
  }

  function cellMarkup(row, column) {
    const raw = row?.[column.key];
    const numeric = MONEY_FIELDS.has(column.key) || PERCENT_FIELDS.has(column.key) || NUMBER_FIELDS.has(column.key);
    const negative = numeric && Number(raw) < 0;
    const primary = PRIMARY_FIELDS.has(column.key);
    const classes = [numeric ? 'numeric' : '', negative ? 'negative' : '', primary ? 'primary-cell' : ''].filter(Boolean).join(' ');
    const value = formatValue(row,column.key);
    const content = STATUS_FIELDS.has(column.key) && raw !== null && raw !== undefined && raw !== ''
      ? `<span class="report-status ${statusTone(raw)}">${esc(value)}</span>`
      : esc(value);
    return `<td class="${classes}" data-label="${esc(column.label)}">${content}</td>`;
  }

  function renderTable() {
    const target = $('reportTable');
    if (!state.rows.length) {
      target.innerHTML = '<div class="reports-empty"><strong>No hay resultados para esta vista</strong><span>Prueba otro período o limpia los filtros para ampliar la consulta.</span></div>';
      return;
    }
    const header = state.columns.map(column => `<th scope="col">${esc(column.label)}</th>`).join('');
    const body = state.rows.map(row => `<tr>${state.columns.map(column => cellMarkup(row,column)).join('')}</tr>`).join('');
    target.innerHTML = `<table class="report-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function renderLoading() {
    $('reportResultCount').textContent = 'Consultando…';
    $('reportTable').innerHTML = '<div class="reports-loading" role="status"><span class="reports-spinner" aria-hidden="true"></span>Consultando reporte…</div>';
  }

  function renderLoadError() {
    $('reportResultCount').textContent = 'No disponible';
    $('reportTable').innerHTML = '<div class="reports-empty"><strong>No se pudo mostrar este reporte</strong><span>La información operativa no fue modificada. Puedes intentar la consulta nuevamente.</span><button id="reportsRetry" class="btn primary" type="button">Reintentar</button></div>';
    $('reportsRetry')?.addEventListener('click', () => loadReport(false));
  }

  function setMessage(message, tone = '') {
    const node = $('reportMessage');
    node.textContent = message || '';
    node.className = `reports-feedback ${message ? tone : ''}`.trim();
  }

  function setLoading(value) {
    state.loading = Boolean(value);
    $('reportTable')?.setAttribute('aria-busy', String(state.loading));
    for (const id of ['refreshReport','exportReport','clearFilters','applyFilters']) {
      const node = $(id);
      if (node) node.disabled = state.loading;
    }
  }

  async function loadReport(includeOptions = false) {
    if (state.loading || !token()) return;
    setLoading(true);
    setMessage('');
    renderLoading();
    try {
      const data = await request(buildUrl('json', includeOptions || !state.options));
      state.datasets = Array.isArray(data.datasets) ? data.datasets : state.datasets;
      state.columns = Array.isArray(data.report?.columns) ? data.report.columns : [];
      state.rows = Array.isArray(data.rows) ? data.rows : [];
      state.generatedAt = data.generated_at || new Date().toISOString();
      setDimensions(data.report?.dimensions || [], data.report?.basis);
      if (data.filter_options) populateOptions(data.filter_options);
      renderTabs();
      renderMeta(data);
      renderMetrics(data);
      renderTable();
      parent?.dispatchEvent?.(new CustomEvent('export-mca:data-loaded'));
    } catch (error) {
      reportError('load', error);
      setMessage(safeReportMessage(error), 'bad');
      renderLoadError();
    } finally {
      setLoading(false);
    }
  }

  async function switchDataset(dataset) {
    if (!dataset || dataset === state.dataset || state.loading) return;
    state.dataset = dataset;
    const config = state.datasets.find(item => item.key === dataset);
    if (config) setDimensions(config.dimensions,config.basis);
    renderTabs();
    renderMetrics({ row_count:0 });
    await loadReport(false);
  }

  function clearFilters() {
    for (const id of ['startDate','endDate','currency','clientId','supplierId','productId']) $(id).value = '';
    $('rowLimit').value = '1000';
    renderMetrics({ row_count:state.rows.length });
    loadReport(false);
  }

  function filenameFromDisposition(header) {
    const match = String(header || '').match(/filename="?([^";]+)"?/i);
    return match?.[1] || `export-mca-${state.dataset}.csv`;
  }

  async function exportCsv() {
    if (state.loading || !token()) return;
    setLoading(true);
    setMessage('');
    try {
      const response = await request(buildUrl('csv',false), { raw:true });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo exportar CSV');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameFromDisposition(response.headers.get('Content-Disposition'));
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage('El reporte se exportó correctamente.', 'good');
    } catch (error) {
      reportError('export', error);
      setMessage(safeReportMessage(error,'No se pudo exportar el CSV. Intenta nuevamente.'), 'bad');
    } finally {
      setLoading(false);
    }
  }

  function bindControls() {
    $('refreshReport').addEventListener('click', () => loadReport(false));
    $('applyFilters').addEventListener('click', () => loadReport(false));
    $('clearFilters').addEventListener('click', clearFilters);
    $('exportReport').addEventListener('click', exportCsv);
  }

  function handleStoredSession(event) {
    if (event?.key && event.key !== 'export_mca_token') return;
    if (!token() || state.started) return;
    window.removeEventListener('storage',handleStoredSession);
    startReports();
  }

  function startReports() {
    if (state.started) return;
    if (!token()) {
      if (embeddedMode) {
        setMessage('Esperando la sesión segura del ERP.');
        window.addEventListener('storage',handleStoredSession);
        return;
      }
      redirectToAdminLogin();
      return;
    }
    state.started = true;
    bindControls();
    loadReport(true);
  }

  window.load = () => loadReport(false);
  window.ExecutiveReports = Object.freeze({
    refresh:() => loadReport(false),
    open:dataset => switchDataset(dataset),
    owner:'reports.js',
    source:'api/reports.js'
  });
  startReports();
})();
