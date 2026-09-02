(() => {
  const $ = id => document.getElementById(id);
  const state = {
    active:false,
    loaded:false,
    loading:false,
    subview:'sales_orders',
    profitability:{ sales_orders:[], invoices:[], loads:[], operations:[], operation_direct_costs:[] },
    traceability:{ sales_orders:[], invoices:[], cost_charges:[] },
    masters:{ products:[], clients:[] }
  };
  const esc = value => String(value ?? '').replace(/[&<>\"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch]));
  const num = value => Number(value || 0);
  const token = () => localStorage.getItem('export_mca_token') || '';
  const money = (value, currency) => value == null ? '—' : `${currency || '—'} ${num(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const pct = value => value == null ? '—' : `${num(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}%`;
  const short = value => value ? String(value).slice(0,8) : '—';
  const coverageLabel = value => ({ actual:'Actual', partial_actual:'Parcial real', estimated:'Estimado', incomplete_allocation:'Incompleto' }[value] || value || 'Incompleto');
  const statusLabels = {
    comparable:'Comparable', no_fulfillment:'Sin preparación logística', incomplete_cogs:'Costo de mercancía incompleto', currency_mismatch:'Moneda no comparable',
    cancelled:'Cancelado', no_sales_allocation:'Sin venta asignada', revenue_multi_currency:'Venta multimoneda',
    merchandise_currency_mismatch:'Moneda mercancía distinta', direct_cost_multi_currency:'Costos directos multimoneda',
    direct_cost_currency_mismatch:'Moneda de costos distinta', no_issued_revenue:'Sin ingreso emitido'
  };
  const statusLabel = value => statusLabels[value] || 'Pendiente de revisión';
  const statusClass = value => value === 'comparable' ? 'ok' : ['no_fulfillment','no_sales_allocation','no_issued_revenue','cancelled'].includes(value) ? 'warn' : 'bad';
  const statusPill = value => `<span class="profit-status ${statusClass(value)}">${esc(statusLabel(value))}</span>`;
  const entityStatusLabel = value => ({
    draft:'Borrador',confirmed:'Confirmada',cancelled:'Cancelada',closed:'Cerrada',issued:'Emitida',
    loading:'En preparación',loaded:'Preparada',dispatched:'Despachada',delivered:'Entregada',
    partially_paid:'Pago parcial',paid:'Pagada',void:'Anulada',posted:'Contabilizado'
  }[value] || 'Estado registrado');
  const categoryLabel = value => ({
    domestic_trucking:'Transporte terrestre',ocean_freight:'Flete marítimo',insurance:'Seguro',
    customs_duties:'Aranceles / aduana',port_terminal:'Puerto / terminal',warehouse:'Almacén',
    inspection:'Inspección',brokerage:'Gestión aduanal',nationalization:'Nacionalización',
    commission:'Comisión',gifts:'Obsequios',documentation:'Documentación',bank_fee:'Cargo bancario',other:'Otro'
  }[value] || 'Otra categoría');
  const stageLabel = value => ({ inbound:'Entrada',fulfillment:'Preparación',destination:'Destino',overhead:'Gastos generales' }[value] || 'Otra etapa');
  const targetLabel = value => ({
    purchase_order:'Orden de compra',warehouse_receipt:'Recepción de almacén',load:'Cargue',
    shipment:'Contenedor',operation:'Operación',sales_order:'Orden de venta',sales_order_item:'Producto de la venta'
  }[value] || 'Objetivo operativo');
  const SAFE_PROFIT_ERROR_PATTERNS = [/^Sesión vencida$/i,/^No autorizado$/i,/^No tienes permiso /i,/^No se pudo cargar la rentabilidad\.?$/i];
  function safeProfitabilityMessage(error) {
    const value = String(error?.message || '').trim();
    return SAFE_PROFIT_ERROR_PATTERNS.some(pattern => pattern.test(value)) ? value : 'No se pudo cargar la rentabilidad. Intenta nuevamente.';
  }

  async function request(url) {
    const response = await fetch(url, { headers:{ ...(token() ? { Authorization:`Bearer ${token()}` } : {}) } });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem('export_mca_token');
      location.href = '/admin/';
      throw new Error('Sesión vencida');
    }
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar la rentabilidad');
    return data;
  }

  async function loadData(force=false) {
    if (state.loading || (state.loaded && !force)) return;
    state.loading = true;
    if (state.active) $('profitabilityContent').innerHTML = '<div class="profit-loading">Cargando rentabilidad…</div>';
    try {
      const data = await request('/api/profitability');
      state.profitability = data.profitability || state.profitability;
      state.traceability = data.traceability || state.traceability;
      state.masters = data.masters || state.masters;
      state.loaded = true;
      if (state.active) render();
    } catch (error) {
      console.error('[PROFITABILITY_LOAD_FAILED]',error);
      if (state.active) $('profitabilityContent').innerHTML = `<div class="empty">${esc(safeProfitabilityMessage(error))}</div>`;
    } finally {
      state.loading = false;
    }
  }

  function activate() {
    state.active = true;
    $('profitabilityTab')?.classList.add('active');
    document.querySelectorAll('[data-view]').forEach(btn => btn.classList.remove('active'));
    $('content')?.classList.add('hidden');
    $('profitabilityContent')?.classList.remove('hidden');
    if (state.loaded) render();
    else loadData();
  }

  function deactivate() {
    if (!state.active) return;
    state.active = false;
    $('profitabilityTab')?.classList.remove('active');
    $('profitabilityContent')?.classList.add('hidden');
    $('content')?.classList.remove('hidden');
    closeTrace();
  }

  const searchText = () => String($('search')?.value || '').trim().toLowerCase();
  const matches = values => {
    const query = searchText();
    return !query || values.filter(value => value != null).join(' ').toLowerCase().includes(query);
  };
  const productName = id => {
    const row = (state.masters.products || []).find(item => String(item.id) === String(id));
    return row ? [row.sku,row.brand,row.name].filter(Boolean).join(' · ') : (id ? `Producto ${short(id)}` : 'Producto');
  };
  const clientName = id => {
    const row = (state.masters.clients || []).find(item => String(item.id) === String(id));
    return row?.company || row?.mipyme_name || row?.name || (id ? `Cliente ${short(id)}` : '—');
  };

  function rowsForSubview() {
    const rows = state.profitability[state.subview] || [];
    return rows.filter(row => {
      if (state.subview === 'sales_orders') return matches([row.so_number,row.sales_order_status,row.profitability_status,clientName(row.client_id),row.sales_currency,row.cogs_currency]);
      if (state.subview === 'invoices') return matches([row.invoice_number,row.profitability_status,row.invoice_currency,row.cogs_currency,row.sales_order_id,row.operation_id]);
      if (state.subview === 'loads') return matches([row.load_number,row.load_status,row.profitability_status,row.revenue_currency,row.cogs_currency,row.direct_cost_currency,row.operation_id]);
      return matches([row.operation_code,row.operation_status,row.container_number,row.profitability_status,row.revenue_currency,row.cogs_currency,row.direct_cost_currency]);
    });
  }

  function renderMetrics(rows) {
    const comparable = rows.filter(row => row.profitability_status === 'comparable').length;
    const multiCurrency = rows.filter(row => String(row.profitability_status || '').includes('currency')).length;
    const pending = rows.length - comparable;
    return `<div class="profit-metrics">
      <div class="profit-metric"><b>${esc(rows.length)}</b><span>Registros</span></div>
      <div class="profit-metric"><b>${esc(comparable)}</b><span>Comparables</span></div>
      <div class="profit-metric"><b>${esc(pending)}</b><span>Pendientes / bloqueados</span></div>
      <div class="profit-metric"><b>${esc(multiCurrency)}</b><span>Con conflicto de moneda</span></div>
    </div>`;
  }

  const cell = (label,value,cls='') => `<div class="profit-cell ${cls}"><b>${esc(label)}</b><span>${esc(value)}</span></div>`;
  const traceButton = (type,id) => `<button class="btn" type="button" data-profit-trace="${esc(type)}:${esc(id)}">Trazabilidad</button>`;

  function renderSalesOrder(row) {
    return `<article class="profit-card">
      <div class="profit-card-head"><div><div class="profit-title">${esc(row.so_number)}</div><div class="profit-sub">${esc(clientName(row.client_id))} · ${esc(entityStatusLabel(row.sales_order_status))}</div></div>${statusPill(row.profitability_status)}</div>
      <div class="profit-grid">
        ${cell('Valor total SO',money(row.order_total,row.sales_currency))}
        ${cell('Venta atribuida',money(row.attributed_sales_revenue,row.sales_currency),'emphasis')}
        ${cell('Valor no atribuido',money(row.unattributed_order_value,row.sales_currency))}
        ${cell('Costo de mercancía',money(row.recognized_merchandise_cogs,row.cogs_currency))}
        ${cell('Margen bruto',money(row.gross_margin,row.sales_currency),row.gross_margin != null ? 'positive' : 'warning')}
        ${cell('Margen %',pct(row.gross_margin_pct),row.gross_margin_pct != null ? 'positive' : 'warning')}
      </div>
      <div class="profit-sub profit-sub-spaced">Cobertura: ${esc(coverageLabel(row.merchandise_cost_coverage))}. El margen se calcula solo sobre la venta físicamente atribuida a Cargues activos.</div>
      <div class="profit-actions">${traceButton('so',row.sales_order_id)}</div>
    </article>`;
  }

  function renderInvoice(row) {
    return `<article class="profit-card">
      <div class="profit-card-head"><div><div class="profit-title">${esc(row.invoice_number)}</div><div class="profit-sub">SO ${esc(short(row.sales_order_id))}${row.operation_id?` · Operación ${esc(short(row.operation_id))}`:''}</div></div>${statusPill(row.profitability_status)}</div>
      <div class="profit-grid">
        ${cell('Ingreso emitido',money(row.invoice_total,row.invoice_currency),'emphasis')}
        ${cell('Costo de mercancía',money(row.recognized_merchandise_cogs,row.cogs_currency))}
        ${cell('Margen bruto',money(row.gross_margin,row.invoice_currency),row.gross_margin != null ? 'positive' : 'warning')}
        ${cell('Margen %',pct(row.gross_margin_pct),row.gross_margin_pct != null ? 'positive' : 'warning')}
        ${cell('Líneas',String(row.invoice_item_count ?? 0))}
        ${cell('Cobertura',coverageLabel(row.merchandise_cost_coverage))}
      </div>
      <div class="profit-sub profit-sub-spaced">Los cargos directos no se reparten a una factura sin una asignación explícita; este es el margen bruto de mercancía.</div>
      <div class="profit-actions">${traceButton('invoice',row.invoice_id)}</div>
    </article>`;
  }

  function directCostText(row) {
    if (Number(row.direct_cost_charge_count || 0) === 0) return 'Sin cargos directos';
    if (row.direct_cost_amount == null) return 'Multimoneda / no comparable';
    return money(row.direct_cost_amount,row.direct_cost_currency);
  }

  function renderLoad(row) {
    return `<article class="profit-card">
      <div class="profit-card-head"><div><div class="profit-title">${esc(row.load_number)}</div><div class="profit-sub">${esc(entityStatusLabel(row.load_status))}${row.operation_id?` · Operación ${esc(short(row.operation_id))}`:''}</div></div>${statusPill(row.profitability_status)}</div>
      <div class="profit-grid">
        ${cell('Venta atribuida',money(row.attributed_sales_revenue,row.revenue_currency),'emphasis')}
        ${cell('Costo de mercancía',money(row.recognized_merchandise_cogs,row.cogs_currency))}
        ${cell('Margen antes de directos',money(row.gross_margin_before_direct_costs,row.revenue_currency))}
        ${cell('Costos directos',directCostText(row))}
        ${cell('Margen contribución',money(row.contribution_margin,row.revenue_currency),row.contribution_margin != null ? 'positive' : 'warning')}
        ${cell('Contribución %',pct(row.contribution_margin_pct),row.contribution_margin_pct != null ? 'positive' : 'warning')}
      </div>
      <div class="profit-sub profit-sub-spaced">Solo descuenta cargos contabilizados asignados explícitamente a este Cargue. No hereda costos del Contenedor ni de la Operación.</div>
      <div class="profit-actions">${traceButton('load',row.load_id)}</div>
    </article>`;
  }

  function renderOperation(row) {
    return `<article class="profit-card">
      <div class="profit-card-head"><div><div class="profit-title">${esc(row.operation_code)}</div><div class="profit-sub">${esc(entityStatusLabel(row.operation_status))}${row.container_number?` · ${esc(row.container_number)}`:''}</div></div>${statusPill(row.profitability_status)}</div>
      <div class="profit-grid">
        ${cell('Ingreso facturado',money(row.issued_revenue,row.revenue_currency),'emphasis')}
        ${cell('Costo de mercancía',money(row.recognized_merchandise_cogs,row.cogs_currency))}
        ${cell('Margen antes de directos',money(row.gross_margin_before_direct_costs,row.revenue_currency))}
        ${cell('Costos directos jerarquía',directCostText(row))}
        ${cell('Margen contribución',money(row.contribution_margin,row.revenue_currency),row.contribution_margin != null ? 'positive' : 'warning')}
        ${cell('Contribución %',pct(row.contribution_margin_pct),row.contribution_margin_pct != null ? 'positive' : 'warning')}
      </div>
      <div class="profit-sub profit-sub-spaced">Los costos directos reúnen los cargos contabilizados de la Operación, sus Contenedores y sus Cargues. Cada cargo mantiene un único destino, sin doble conteo ni conversión de moneda.</div>
      <div class="profit-actions">${traceButton('operation',row.operation_id)}</div>
    </article>`;
  }

  function render() {
    if (!state.active) return;
    const rows = rowsForSubview();
    const renderers = { sales_orders:renderSalesOrder, invoices:renderInvoice, loads:renderLoad, operations:renderOperation };
    const cards = rows.length ? rows.map(renderers[state.subview]).join('') : '<div class="empty">No hay registros para esta vista o búsqueda.</div>';
    $('profitabilityContent').innerHTML = `<div class="profit-shell">
      <div class="profit-note"><b>Rentabilidad calculada por el ERP.</b> Las reglas financieras determinan cobertura, comparabilidad y margen. Esta vista no suma monedas incompatibles ni reparte cargos entre entidades.</div>
      <div class="profit-toolbar"><div class="profit-tabs">
        <button class="btn ${state.subview==='sales_orders'?'active':''}" data-profit-subview="sales_orders">Órdenes de venta</button>
        <button class="btn ${state.subview==='invoices'?'active':''}" data-profit-subview="invoices">Facturas</button>
        <button class="btn ${state.subview==='loads'?'active':''}" data-profit-subview="loads">Cargues</button>
        <button class="btn ${state.subview==='operations'?'active':''}" data-profit-subview="operations">Operaciones</button>
      </div><div class="muted">${esc(rows.length)} resultado(s)</div></div>
      ${renderMetrics(rows)}
      <div class="profit-list">${cards}</div>
    </div>`;
  }

  function dedupe(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = [row.sales_order_item_id,row.load_item_id,row.receipt_item_id,row.purchase_order_item_id,row.supplier_bill_item_id].map(value => value || '').join('|');
      if (!map.has(key)) map.set(key,row);
    }
    return [...map.values()];
  }

  function traceSources(type,id) {
    if (type === 'so') return dedupe((state.traceability.sales_orders || []).filter(row => String(row.sales_order_id) === String(id)));
    if (type === 'invoice') return dedupe((state.traceability.invoices || []).filter(row => String(row.invoice_id) === String(id)));
    if (type === 'load') return dedupe((state.traceability.sales_orders || []).filter(row => String(row.load_id) === String(id)));
    const invoiceIds = new Set((state.profitability.invoices || []).filter(row => String(row.operation_id) === String(id)).map(row => String(row.invoice_id)));
    return dedupe([
      ...(state.traceability.invoices || []).filter(row => invoiceIds.has(String(row.invoice_id))),
      ...(state.traceability.sales_orders || []).filter(row => String(row.operation_id) === String(id))
    ]);
  }

  function relatedCharges(type,id,sources) {
    const rows = state.traceability.cost_charges || [];
    if (type === 'load') return rows.filter(row => row.target_type === 'load' && String(row.load_id) === String(id));
    if (type === 'operation') return rows.filter(row => String(row.operation_id) === String(id));
    const po = new Set(sources.map(row => String(row.purchase_order_id || '')).filter(Boolean));
    const wr = new Set(sources.map(row => String(row.warehouse_receipt_id || '')).filter(Boolean));
    const loads = new Set(sources.map(row => String(row.load_id || '')).filter(Boolean));
    const shipments = new Set(sources.map(row => String(row.shipment_id || '')).filter(Boolean));
    const operations = new Set(sources.map(row => String(row.operation_id || row.traced_operation_id || '')).filter(Boolean));
    return rows.filter(row =>
      (row.purchase_order_id && po.has(String(row.purchase_order_id))) ||
      (row.warehouse_receipt_id && wr.has(String(row.warehouse_receipt_id))) ||
      (row.load_id && loads.has(String(row.load_id))) ||
      (row.shipment_id && shipments.has(String(row.shipment_id))) ||
      (row.operation_id && operations.has(String(row.operation_id)))
    );
  }

  const navButton = (kind,label) => `<button class="btn" type="button" data-profit-nav="${esc(kind)}">${esc(label)}</button>`;
  function sourceHtml(row) {
    const productId = row.product_id || row.invoice_product_id;
    const bill = row.supplier_bill_number ? `${row.supplier_bill_number}${row.supplier_invoice_number?` · ${row.supplier_invoice_number}`:''}` : 'Sin factura de proveedor contabilizada';
    const poCost = row.po_unit_cost == null ? '—' : money(row.po_unit_cost,row.po_currency);
    const billCost = row.supplier_bill_unit_cost == null ? '—' : money(row.supplier_bill_unit_cost,row.supplier_bill_currency);
    const recognized = row.recognized_unit_cogs == null ? '—' : money(row.recognized_unit_cogs,row.recognized_cogs_currency);
    return `<div class="trace-row">
      <div class="trace-row-head"><div><b>${esc(productName(productId))}</b><div class="profit-sub">Cobertura ${esc(coverageLabel(row.cost_coverage))}</div></div><div><b>Costo unitario reconocido: ${esc(recognized)}</b></div></div>
      <div class="trace-chain">
        <div class="trace-node"><b>Cargue</b><span>${esc(row.load_number || short(row.load_id))}</span></div>
        <div class="trace-node"><b>Recepción de almacén</b><span>${esc(row.receipt_number || short(row.warehouse_receipt_id))}</span></div>
        <div class="trace-node"><b>Orden de compra</b><span>${esc(row.po_number || short(row.purchase_order_id))}<br>${esc(poCost)}</span></div>
        <div class="trace-node"><b>Factura de proveedor</b><span>${esc(bill)}<br>${esc(billCost)}</span></div>
        <div class="trace-node"><b>Asignación física</b><span>Cargue ${esc(row.load_allocated_quantity ?? '—')} · Venta ${esc(row.sales_allocated_quantity ?? '—')}</span></div>
      </div>
      <div class="trace-nav">
        ${row.load_id?navButton('loads','Abrir Cargues'):''}
        ${row.warehouse_receipt_id?navButton('warehouse','Abrir Almacén'):''}
        ${row.purchase_order_id?navButton('purchases','Abrir Compras'):''}
        ${row.supplier_bill_id?navButton('payables','Abrir Cuentas por pagar'):''}
      </div>
    </div>`;
  }

  function chargeHtml(row) {
    return `<div class="trace-charge"><div><b>${esc(row.cost_number)}</b></div><div>${esc(categoryLabel(row.category))} · ${esc(stageLabel(row.stage))}<div class="profit-sub">${esc(targetLabel(row.target_type))} · ${esc(row.target_reference || short(row.target_id))}</div></div><div class="amount">${esc(money(row.allocated_amount,row.currency))}</div><div>${navButton('costs','Abrir Costos')}</div></div>`;
  }

  function traceHeading(type,id) {
    if (type === 'so') return (state.profitability.sales_orders || []).find(row => String(row.sales_order_id) === String(id))?.so_number || `SO ${short(id)}`;
    if (type === 'invoice') return (state.profitability.invoices || []).find(row => String(row.invoice_id) === String(id))?.invoice_number || `Factura ${short(id)}`;
    if (type === 'load') return (state.profitability.loads || []).find(row => String(row.load_id) === String(id))?.load_number || `Cargue ${short(id)}`;
    return (state.profitability.operations || []).find(row => String(row.operation_id) === String(id))?.operation_code || `Operación ${short(id)}`;
  }

  function openTrace(type,id) {
    const sources = traceSources(type,id);
    const charges = relatedCharges(type,id,sources);
    $('profitTraceTitle').textContent = `Trazabilidad · ${traceHeading(type,id)}`;
    $('profitTraceSubtitle').textContent = type === 'so' || type === 'invoice'
      ? 'Fuentes de mercancía y cargos relacionados como contexto. Los cargos no se reparten automáticamente en este margen.'
      : type === 'load'
        ? 'Fuentes de mercancía y cargos directos incluidos cuando están asignados a este Cargue.'
        : 'Fuentes de facturación, costo de mercancía y cargos de la Operación, sus Contenedores y sus Cargues.';
    $('profitTraceBody').innerHTML = `<div class="trace-section"><h3>Cadena de mercancía</h3><div class="trace-note">Venta o factura → Cargue → recepción de almacén → orden de compra → factura de proveedor. Se muestra el costo reconocido por las reglas financieras del ERP.</div><div class="trace-list">${sources.length?sources.map(sourceHtml).join(''):'<div class="empty compact">No hay cadena de mercancía atribuida todavía.</div>'}</div></div>
      <div class="trace-section"><h3>Cargos relacionados</h3><div class="trace-note">Se listan por asignación explícita y moneda original; esta vista no convierte ni suma monedas incompatibles.</div><div class="trace-list">${charges.length?charges.map(chargeHtml).join(''):'<div class="empty compact">No hay cargos contabilizados relacionados.</div>'}</div></div>`;
    $('profitTraceModal').classList.remove('hidden');
  }

  function closeTrace() { $('profitTraceModal')?.classList.add('hidden'); }

  function navigate(kind) {
    const shell = window.parent?.NavigationShell;
    const map = {
      warehouse:'openWarehouse', purchases:'openPurchases', payables:'openPayables', loads:'openLoads',
      sales:'openSales', invoices:'openInvoices', costs:'openCosts'
    };
    const method = map[kind];
    if (shell && method && typeof shell[method] === 'function') {
      closeTrace();
      shell[method]();
    }
  }

  $('profitabilityTab')?.addEventListener('click', activate);
  document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', deactivate));
  $('search')?.addEventListener('input', () => { if (state.active && state.loaded) render(); });
  $('refresh')?.addEventListener('click', () => { if (state.active) loadData(true); });
  $('closeProfitTrace')?.addEventListener('click', closeTrace);
  $('profitTraceModal')?.addEventListener('click', event => { if (event.target === $('profitTraceModal')) closeTrace(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('profitTraceModal')?.classList.contains('hidden')) closeTrace(); });

  $('profitabilityContent')?.addEventListener('click', event => {
    const sub = event.target.closest('[data-profit-subview]');
    if (sub) { state.subview = sub.dataset.profitSubview; render(); return; }
    const trace = event.target.closest('[data-profit-trace]');
    if (trace) {
      const [type,id] = String(trace.dataset.profitTrace || '').split(':');
      if (type && id) openTrace(type,id);
    }
  });
  $('profitTraceBody')?.addEventListener('click', event => {
    const nav = event.target.closest('[data-profit-nav]');
    if (nav) navigate(nav.dataset.profitNav);
  });
})();
