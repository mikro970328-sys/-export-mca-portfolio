(() => {
  const $ = id => document.getElementById(id);
  let token = localStorage.getItem('export_mca_token') || '';
  const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';
  let moduleStarted = false;
  let pendingCostId = '';
  let decisionResolve = null;
  const modalReturnFocus = new Map();

  const state = {
    charges: [],
    targets: {},
    products: [],
    models: {},
    profitability: {
      sales_orders: [],
      invoices: [],
      loads: [],
      operations: [],
      operation_direct_costs: []
    },
    traceability: {
      sales_orders: [],
      invoices: [],
      cost_charges: []
    },
    masters: {
      products: [],
      clients: []
    },
    view: 'charges',
    subview: 'sales_orders',
    search: '',
    editingId: null,
    writeAccess: false,
    loaded: false,
    profitabilityLoaded: false,
    profitabilityLoading: false
  };

  const categories = [
    ['domestic_trucking', 'Transporte terrestre'],
    ['ocean_freight', 'Flete marítimo'],
    ['insurance', 'Seguro'],
    ['customs_duties', 'Aranceles / aduana'],
    ['port_terminal', 'Puerto / terminal'],
    ['warehouse', 'Almacén'],
    ['inspection', 'Inspección'],
    ['brokerage', 'Gestión aduanal'],
    ['nationalization', 'Nacionalización'],
    ['commission', 'Comisión'],
    ['gifts', 'Obsequios'],
    ['documentation', 'Documentación'],
    ['bank_fee', 'Cargo bancario'],
    ['other', 'Otro']
  ];
  const stages = [
    ['inbound', 'Entrada'],
    ['fulfillment', 'Preparación'],
    ['destination', 'Destino'],
    ['overhead', 'Gastos generales']
  ];
  const bases = [
    ['manual', 'Manual'],
    ['quantity', 'Cantidad'],
    ['pallets', 'Pallets'],
    ['value', 'Valor'],
    ['weight', 'Peso']
  ];
  const targetTypes = [
    ['purchase_order_id', 'Orden de compra'],
    ['warehouse_receipt_id', 'Recepción de almacén'],
    ['load_id', 'Cargue'],
    ['shipment_id', 'Contenedor'],
    ['operation_id', 'Operación']
  ];
  const profitabilityStatusLabels = {
    comparable: 'Comparable',
    no_fulfillment: 'Sin preparación logística',
    incomplete_cogs: 'Costo de mercancía incompleto',
    currency_mismatch: 'Moneda no comparable',
    cancelled: 'Cancelado',
    no_sales_allocation: 'Sin venta asignada',
    revenue_multi_currency: 'Venta multimoneda',
    merchandise_currency_mismatch: 'Moneda mercancía distinta',
    direct_cost_multi_currency: 'Costos directos multimoneda',
    direct_cost_currency_mismatch: 'Moneda de costos distinta',
    no_issued_revenue: 'Sin ingreso emitido'
  };
  const SAFE_COST_ERROR_PATTERNS = [
    /^(?:No tienes|No autorizado|La solicitud|Selecciona|Indica|Cada distribución|El monto|La moneda|La distribución|Cargo de costo|Solo un cargo|Distribuye el cargo|El cargo|Acción de Costos|Sesión vencida)/i,
    /^No se pudo procesar Costos(?:\. Intenta nuevamente\.)?$/i
  ];
  const SAFE_PROFIT_ERROR_PATTERNS = [
    /^Sesión vencida$/i,
    /^No autorizado$/i,
    /^No tienes permiso /i,
    /^No se pudo cargar la rentabilidad\.?$/i
  ];

  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));

  const num = value => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const short = value => value ? String(value).slice(0, 8) : '—';
  const categoryLabel = value => categories.find(([id]) => id === value)?.[1] || value || 'Otra categoría';
  const stageLabel = value => stages.find(([id]) => id === value)?.[1] || value || 'Otra etapa';
  const basisLabel = value => bases.find(([id]) => id === value)?.[1] || value || 'Manual';
  const coverageLabel = value => ({
    actual: 'Actual',
    partial_actual: 'Parcial real',
    estimated: 'Estimado',
    incomplete_allocation: 'Incompleto'
  }[value] || value || 'Incompleto');
  const allocationLabel = value => ({
    allocated: 'Distribuido',
    partial: 'Distribución parcial',
    unallocated: 'Sin distribuir',
    void: 'Anulado',
    invalid: 'Revisión requerida'
  }[value] || 'Sin información');
  const statusLabel = value => ({
    posted: 'Contabilizado',
    void: 'Anulado',
    draft: 'Borrador'
  }[value] || 'Estado desconocido');
  const entityStatusLabel = value => ({
    draft: 'Borrador',
    confirmed: 'Confirmada',
    cancelled: 'Cancelada',
    closed: 'Cerrada',
    issued: 'Emitida',
    loading: 'En preparación',
    loaded: 'Preparada',
    dispatched: 'Despachada',
    delivered: 'Entregada',
    partially_paid: 'Pago parcial',
    paid: 'Pagada',
    void: 'Anulada',
    posted: 'Contabilizado'
  }[value] || 'Estado registrado');
  const traceTargetLabel = value => ({
    purchase_order: 'Orden de compra',
    warehouse_receipt: 'Recepción de almacén',
    load: 'Cargue',
    shipment: 'Contenedor',
    operation: 'Operación',
    sales_order: 'Orden de venta',
    sales_order_item: 'Producto de la venta'
  }[value] || 'Objetivo operativo');

  function money(value, currency = 'USD') {
    if (value == null) return '—';
    const code = String(currency || 'USD').trim().toUpperCase().slice(0, 3) || 'USD';
    return code + ' ' + num(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function quantity(value) {
    return num(value).toLocaleString('en-US', { maximumFractionDigits: 4 });
  }

  function percent(value) {
    return value == null ? '—' : num(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  }

  function date(value) {
    if (!value) return 'Sin fecha';
    const raw = String(value).slice(0, 10);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? match[2] + '/' + match[3] + '/' + match[1] : 'Fecha no disponible';
  }

  function localDateToday() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  const actionAllowed = (charge, action) => charge?.capabilities?.actions?.[action]?.allowed === true;

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
        Authorization: 'Bearer ' + token,
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
      const error = new Error(data.error || (url === '/api/profitability' ? 'No se pudo cargar la rentabilidad' : 'No se pudo procesar Costos'));
      error.code = data.details?.code || data.code || null;
      error.status = response.status;
      error.endpoint = String(url).split('?')[0];
      throw error;
    }
    return data;
  }

  function safeCostMessage(error, fallback = 'No se pudo completar la operación. Intenta nuevamente.') {
    const value = String(error?.message || '').trim();
    const status = Number(error?.status || 0);
    if (status === 401 || value === 'Sesión vencida') return 'Tu sesión terminó. Inicia sesión nuevamente para continuar.';
    if (status === 403) return 'No tienes permiso para completar esta acción.';
    if ((status === 0 || [400, 404, 409, 422].includes(status)) && SAFE_COST_ERROR_PATTERNS.some(pattern => pattern.test(value))) return value;
    return fallback;
  }

  function safeProfitabilityMessage(error) {
    const value = String(error?.message || '').trim();
    const status = Number(error?.status || 0);
    if (status === 401 || value === 'Sesión vencida') return 'Tu sesión terminó. Inicia sesión nuevamente para continuar.';
    if (status === 403) return 'No tienes permiso para consultar la rentabilidad.';
    return SAFE_PROFIT_ERROR_PATTERNS.some(pattern => pattern.test(value))
      ? value
      : 'No se pudo cargar la rentabilidad. Intenta nuevamente.';
  }

  function reportCostError(context, error, fallback) {
    const value = context === 'profitability'
      ? safeProfitabilityMessage(error)
      : safeCostMessage(error, fallback);
    if (value === fallback || Number(error?.status || 0) >= 500 || context === 'bootstrap' || context === 'profitability') {
      const marker = context === 'bootstrap'
        ? 'COSTS_INITIAL_LOAD_FAILED'
        : context === 'profitability'
          ? 'PROFITABILITY_LOAD_FAILED'
          : context === 'refresh'
            ? 'COSTS_REFRESH_FAILED'
            : 'COSTS_UI_FAILED';
      console.error(marker, {
        context,
        status: Number(error?.status || 0) || null,
        code: error?.code || null,
        endpoint: error?.endpoint || null,
        error
      });
    }
    return value;
  }

  function setPageMessage(value = '', tone = 'bad') {
    const node = $('pageMsg');
    if (!node) return;
    node.textContent = value;
    node.className = 'costs-feedback' + (value ? ' ' + tone : '');
  }

  function message(id, value = '', good = false) {
    const node = $(id);
    if (!node) return;
    node.textContent = value;
    node.className = 'msg cost-dialog-message' + (value ? ' ' + (good ? 'ok' : 'bad') : '');
  }

  function emptyState(title, copy, compact = false) {
    return [
      '<div class="costs-empty', compact ? ' compact' : '', '">',
      '<div><span class="costs-empty-icon" aria-hidden="true">◇</span>',
      '<strong>', esc(title), '</strong><span>', esc(copy), '</span></div></div>'
    ].join('');
  }

  function metric(label, value, detail, className) {
    return [
      '<article class="metric ', esc(className), '">',
      '<span>', esc(label), '</span><b>', esc(value ?? '—'), '</b><small>', esc(detail), '</small></article>'
    ].join('');
  }

  function renderMetrics() {
    const receipts = state.models.warehouse_receipt_items || [];
    const loads = state.models.loads || [];
    const posted = state.charges.filter(row => row.status === 'posted').length;
    const drafts = state.charges.filter(row => row.status === 'draft').length;
    const incomplete = state.charges.filter(row => row.status === 'draft' && row.progress?.allocation_status !== 'allocated').length;
    const costedReceipts = receipts.filter(row => row.cost_coverage !== 'incomplete_allocation' && row.recognized_merchandise_cost != null).length;
    const costedLoads = loads.filter(row => row.cost_coverage !== 'incomplete_allocation' && row.recognized_merchandise_cogs != null).length;
    $('metrics').innerHTML = [
      ['Cargos activos', posted, 'Contabilizados y vigentes', 'cost-metric-active'],
      ['Borradores', drafts, 'Pendientes de contabilizar', 'cost-metric-drafts'],
      ['Sin asignar', incomplete, 'Requieren distribución', 'cost-metric-pending'],
      ['Recepciones', costedReceipts, 'Con costo reconocido', 'cost-metric-receipts'],
      ['Cargues', costedLoads, 'Con costo de mercancía', 'cost-metric-loads']
    ].map(values => metric(...values)).join('');
  }

  const supplierName = id => {
    const row = (state.targets.suppliers || []).find(item => String(item.id) === String(id));
    return row?.legal_name || row?.name || 'Sin proveedor';
  };

  const costProductName = id => {
    const row = state.products.find(item => String(item.id) === String(id));
    return row ? [row.sku, row.brand, row.name].filter(Boolean).join(' · ') : 'Producto';
  };

  function targetConfig(key) {
    if (key === 'purchase_order_id') return { rows: state.targets.purchase_orders || [], label: row => row.po_number || row.id };
    if (key === 'warehouse_receipt_id') return { rows: state.targets.warehouse_receipts || [], label: row => row.receipt_number || row.id };
    if (key === 'load_id') return { rows: state.targets.loads || [], label: row => row.load_number || row.id };
    if (key === 'shipment_id') return { rows: state.targets.shipments || [], label: row => row.container_number || 'Contenedor ' + short(row.id) };
    if (key === 'operation_id') return { rows: state.targets.operations || [], label: row => row.operation_code || row.container_number || row.id };
    return { rows: [], label: row => row?.id || '—' };
  }

  function allocationTarget(row) {
    const key = targetTypes.find(([id]) => row?.[id])?.[0];
    if (!key) return { key: null, label: 'Sin objetivo' };
    const config = targetConfig(key);
    const target = config.rows.find(item => String(item.id) === String(row[key]));
    return { key, label: target ? config.label(target) : short(row[key]) };
  }

  function matches(values) {
    const query = state.search.toLowerCase();
    return !query || values.filter(value => value != null).join(' ').toLowerCase().includes(query);
  }

  function chargeMatches(charge) {
    const allocationText = (charge.allocations || []).map(row => allocationTarget(row).label).join(' ');
    return matches([
      charge.cost_number,
      charge.reference,
      categoryLabel(charge.category),
      stageLabel(charge.stage),
      supplierName(charge.supplier_id),
      charge.status,
      allocationText
    ]);
  }

  function statusPill(value) {
    if (value === 'posted') return '<span class="pill ok">Contabilizado</span>';
    if (value === 'void') return '<span class="pill off">Anulado</span>';
    return '<span class="pill warn">Borrador</span>';
  }

  function coveragePill(value) {
    const className = value === 'actual' ? 'ok' : value === 'estimated' || value === 'partial_actual' ? 'warn' : 'bad';
    return '<span class="pill ' + className + '">' + esc(coverageLabel(value)) + '</span>';
  }

  function renderChargeActions(charge, prefix = '') {
    const attribute = prefix ? 'data-detail-' : 'data-';
    const actions = [
      '<button class="btn" type="button" data-detail="' + esc(charge.id) + '">Ver detalle</button>'
    ];
    if (actionAllowed(charge, 'edit')) {
      actions.push('<button class="btn" type="button" ' + attribute + 'edit="' + esc(charge.id) + '">Editar</button>');
    }
    if (actionAllowed(charge, 'post')) {
      actions.push('<button class="btn primary" type="button" ' + attribute + 'post="' + esc(charge.id) + '">Contabilizar</button>');
    }
    if (actionAllowed(charge, 'void')) {
      actions.push('<button class="btn danger" type="button" ' + attribute + 'void="' + esc(charge.id) + '">Anular</button>');
    }
    return actions.join('');
  }

  function renderCharges() {
    const rows = state.charges.filter(chargeMatches);
    if (!rows.length) {
      return emptyState(
        state.search ? 'Sin resultados' : 'Sin cargos registrados',
        state.search ? 'Ajusta la búsqueda para consultar otros cargos.' : 'Los cargos aparecerán aquí cuando existan registros financieros.'
      );
    }
    const records = rows.map(charge => {
      const progress = charge.progress || {};
      const allocations = (charge.allocations || []).map(row => {
        const target = allocationTarget(row);
        const targetType = targetTypes.find(([id]) => id === target.key)?.[1] || 'Objetivo';
        return [
          '<div class="cost-allocation">',
          '<div class="cost-allocation-label">Distribución</div>',
          '<div><b>', esc(target.label), '</b><div class="small">', esc(targetType), ' · ', esc(basisLabel(row.basis)),
          row.notes ? ' · ' + esc(row.notes) : '', '</div></div>',
          '<div class="money-strong">', esc(money(row.amount, charge.currency)), '</div>',
          '<div>', esc(stageLabel(charge.stage)), '</div><div></div><div></div></div>'
        ].join('');
      }).join('');
      return [
        '<article class="cost-record"><div class="cost-row">',
        '<div><div class="cost-title">', esc(charge.cost_number || 'Cargo'), '</div><div class="cost-sub">', esc(date(charge.incurred_date)), '</div></div>',
        '<div><b>', esc(categoryLabel(charge.category)), '</b><div class="cost-sub">', esc(stageLabel(charge.stage)),
        charge.supplier_id ? ' · ' + esc(supplierName(charge.supplier_id)) : '', '</div></div>',
        '<div>', statusPill(charge.status), '<div class="cost-sub">', esc(allocationLabel(progress.allocation_status)), '</div></div>',
        '<div><div class="money-strong">', esc(money(charge.amount, charge.currency)), '</div><div class="cost-sub">Asignado ', esc(money(progress.allocated_amount, charge.currency)), '</div></div>',
        '<div><b>', esc(charge.reference || 'Sin referencia'), '</b><div class="cost-sub">', esc(charge.notes || 'Sin notas'), '</div></div>',
        '<div class="cost-row-actions">', renderChargeActions(charge), '</div></div>',
        allocations ? '<div class="cost-allocations">' + allocations + '</div>' : '<div class="cost-no-allocation">Sin distribución registrada.</div>',
        '</article>'
      ].join('');
    }).join('');
    return [
      '<div class="costs-table-wrap"><div class="costs-table-head" aria-hidden="true">',
      '<span>Cargo</span><span>Concepto</span><span>Estado</span><span>Importe</span><span>Referencia</span><span>Acciones</span>',
      '</div><div class="cost-list">', records, '</div></div>'
    ].join('');
  }

  function landedRows() {
    const receiptItems = state.models.warehouse_receipt_items || [];
    const posted = state.models.posted_allocations || [];
    const grouped = new Map();
    receiptItems.forEach(row => {
      if (!grouped.has(row.receipt_id)) grouped.set(row.receipt_id, []);
      grouped.get(row.receipt_id).push(row);
    });
    return [...grouped.entries()].map(([receiptId, items]) => {
      const receipt = (state.targets.warehouse_receipts || []).find(row => String(row.id) === String(receiptId));
      const charges = posted.filter(row => String(row.warehouse_receipt_id) === String(receiptId));
      return { receiptId, receipt, items, charges };
    }).filter(group => matches([
      group.receipt?.receipt_number,
      group.receipt?.status,
      ...group.items.map(row => costProductName(row.product_id)),
      ...group.charges.map(row => String(row.cost_number || '') + ' ' + String(row.category || ''))
    ]));
  }

  function renderLanded() {
    const groups = landedRows();
    if (!groups.length) {
      return emptyState(
        state.search ? 'Sin recepciones coincidentes' : 'Sin costo recibido disponible',
        state.search ? 'Ajusta la búsqueda para consultar otras recepciones.' : 'El costo reconocido aparecerá cuando existan recepciones vinculadas a compras.'
      );
    }
    const cards = groups.map(group => {
      const itemHtml = group.items.map(row => [
        '<div class="model-card"><div class="model-head"><div><div class="model-title">', esc(costProductName(row.product_id)),
        '</div><div class="small">Línea de recepción ', esc(short(row.receipt_item_id)), '</div></div>', coveragePill(row.cost_coverage), '</div>',
        '<div class="model-grid">',
        '<div class="model-cell"><b>Cantidad física</b><span>', esc(quantity(row.physical_quantity)), ' ', esc(row.unit || ''), '</span></div>',
        '<div class="model-cell"><b>Vinculada a la orden</b><span>', esc(quantity(row.linked_quantity)), '</span></div>',
        '<div class="model-cell"><b>Cantidad con costo</b><span>', esc(quantity(row.costed_quantity)), '</span></div>',
        '<div class="model-cell"><b>Costo de mercancía</b><span>', esc(money(row.recognized_merchandise_cost, row.currency)), '</span></div>',
        '<div class="model-cell"><b>Costo unitario</b><span>', esc(money(row.recognized_unit_cost, row.currency)), '</span></div>',
        '</div></div>'
      ].join('')).join('');
      const chargeHtml = group.charges.length
        ? group.charges.map(row => [
          '<div class="linked-cost"><span><b>', esc(row.cost_number), '</b> · ', esc(categoryLabel(row.category)), ' · ', esc(stageLabel(row.stage)),
          '</span><span class="money-strong">', esc(money(row.allocated_amount, row.currency)), '</span></div>'
        ].join('')).join('')
        : emptyState('Sin cargos directos', 'No hay cargos contabilizados asignados directamente a esta recepción.', true);
      return [
        '<article class="model-card"><div class="model-head"><div><div class="model-title">',
        esc(group.receipt?.receipt_number || 'Recepción ' + short(group.receiptId)),
        '</div><div class="small">Recibido ', esc(date(group.receipt?.received_at)), '</div></div></div>',
        '<div class="cost-view-note warning cost-section-note">El costo de mercancía proviene de órdenes de compra, facturas de proveedor y cantidades recibidas. Los cargos directos permanecen separados.</div>',
        '<div class="cost-model-list cost-model-inner">', itemHtml, '</div>',
        '<div class="linked-costs"><b>Cargos directos de la recepción</b>', chargeHtml, '</div></article>'
      ].join('');
    }).join('');
    return [
      '<div class="cost-model-shell"><div class="cost-view-note"><b>Cobertura del costo.</b> Actual, parcial real, estimado e incompleto describen la fuente reconocida por el ERP; una cobertura incompleta nunca se presenta como definitiva.</div>',
      '<div class="cost-model-list">', cards, '</div></div>'
    ].join('');
  }

  function cogsRows() {
    return (state.models.loads || []).filter(row => {
      const load = (state.targets.loads || []).find(item => String(item.id) === String(row.load_id));
      const direct = (state.models.load_direct || []).filter(item => String(item.load_id) === String(row.load_id));
      return matches([
        row.load_number,
        load?.load_number,
        row.load_status,
        row.cost_coverage,
        row.operation_id,
        ...direct.map(item => item.currency)
      ]);
    });
  }

  function renderCogs() {
    const rows = cogsRows();
    if (!rows.length) {
      return emptyState(
        state.search ? 'Sin Cargues coincidentes' : 'Sin costo de Cargues disponible',
        state.search ? 'Ajusta la búsqueda para consultar otros Cargues.' : 'Los costos aparecerán cuando la mercancía se vincule físicamente a Cargues.'
      );
    }
    const cards = rows.map(row => {
      const directRows = (state.models.load_direct || []).filter(item => String(item.load_id) === String(row.load_id));
      const directHtml = directRows.length
        ? directRows.map(item => [
          '<div class="linked-cost"><span>', esc(item.currency), ' · ', esc(item.charge_count), ' cargo(s)',
          '<div class="small">Entrada ', esc(money(item.inbound_amount, item.currency)),
          ' · Preparación ', esc(money(item.fulfillment_amount, item.currency)),
          ' · Destino ', esc(money(item.destination_amount, item.currency)),
          ' · Generales ', esc(money(item.overhead_amount, item.currency)), '</div></span>',
          '<span class="money-strong">', esc(money(item.direct_cost_amount, item.currency)), '</span></div>'
        ].join('')).join('')
        : emptyState('Sin cargos directos', 'No hay cargos contabilizados asignados directamente al Cargue.', true);
      return [
        '<article class="model-card"><div class="model-head"><div><div class="model-title">', esc(row.load_number || 'Cargue ' + short(row.load_id)),
        '</div><div class="small">', row.shipment_id ? 'Contenedor ' + esc(short(row.shipment_id)) : 'Sin contenedor asignado', '</div></div>',
        coveragePill(row.cost_coverage), '</div><div class="model-grid">',
        '<div class="model-cell"><b>Productos</b><span>', esc(row.item_count), '</span></div>',
        '<div class="model-cell"><b>Productos con costo</b><span>', esc(row.costed_item_count), '</span></div>',
        '<div class="model-cell"><b>Monedas de origen</b><span>', esc(row.source_currency_count), '</span></div>',
        '<div class="model-cell"><b>Costo reconocido</b><span>', esc(money(row.recognized_merchandise_cogs, row.currency)), '</span></div>',
        '<div class="model-cell"><b>Cobertura</b><span>', esc(coverageLabel(row.cost_coverage)), '</span></div>',
        '</div><div class="linked-costs"><b>Costos directos del Cargue</b>', directHtml, '</div></article>'
      ].join('');
    }).join('');
    return [
      '<div class="cost-model-shell"><div class="cost-view-note warning">El costo reconocido de mercancía y los cargos directos se muestran separados. No se suman cuando pertenecen a monedas diferentes.</div>',
      '<div class="cost-model-list">', cards, '</div></div>'
    ].join('');
  }

  function profitabilityStatusClass(value) {
    if (value === 'comparable') return 'ok';
    return ['no_fulfillment', 'no_sales_allocation', 'no_issued_revenue', 'cancelled'].includes(value) ? 'warn' : 'bad';
  }

  function profitabilityPill(value) {
    return '<span class="profit-status ' + profitabilityStatusClass(value) + '">' + esc(profitabilityStatusLabels[value] || 'Pendiente de revisión') + '</span>';
  }

  const profitProductName = id => {
    const row = (state.masters.products || []).find(item => String(item.id) === String(id));
    return row ? [row.sku, row.brand, row.name].filter(Boolean).join(' · ') : id ? 'Producto ' + short(id) : 'Producto';
  };

  const clientName = id => {
    const row = (state.masters.clients || []).find(item => String(item.id) === String(id));
    return row?.company || row?.mipyme_name || row?.name || (id ? 'Cliente ' + short(id) : '—');
  };

  function profitabilityRows() {
    const rows = state.profitability[state.subview] || [];
    return rows.filter(row => {
      if (state.subview === 'sales_orders') return matches([row.so_number, row.sales_order_status, row.profitability_status, clientName(row.client_id), row.sales_currency, row.cogs_currency]);
      if (state.subview === 'invoices') return matches([row.invoice_number, row.profitability_status, row.invoice_currency, row.cogs_currency, row.sales_order_id, row.operation_id]);
      if (state.subview === 'loads') return matches([row.load_number, row.load_status, row.profitability_status, row.revenue_currency, row.cogs_currency, row.direct_cost_currency, row.operation_id]);
      return matches([row.operation_code, row.operation_status, row.container_number, row.profitability_status, row.revenue_currency, row.cogs_currency, row.direct_cost_currency]);
    });
  }

  function profitabilityMetrics(rows) {
    const comparable = rows.filter(row => row.profitability_status === 'comparable').length;
    const multiCurrency = rows.filter(row => String(row.profitability_status || '').includes('currency')).length;
    const pending = rows.length - comparable;
    return [
      '<div class="profit-metrics">',
      '<div class="profit-metric"><b>', esc(rows.length), '</b><span>Registros</span></div>',
      '<div class="profit-metric"><b>', esc(comparable), '</b><span>Comparables</span></div>',
      '<div class="profit-metric"><b>', esc(pending), '</b><span>Pendientes o bloqueados</span></div>',
      '<div class="profit-metric"><b>', esc(multiCurrency), '</b><span>Conflicto de moneda</span></div>',
      '</div>'
    ].join('');
  }

  function profitCell(label, value, className = '') {
    return '<div class="profit-cell ' + esc(className) + '"><b>' + esc(label) + '</b><span>' + esc(value) + '</span></div>';
  }

  function traceButton(type, id) {
    return '<button class="btn" type="button" data-profit-trace="' + esc(type) + ':' + esc(id) + '">Ver trazabilidad</button>';
  }

  function renderSalesOrderProfit(row) {
    return [
      '<article class="profit-card"><div class="profit-card-head"><div><div class="profit-title">', esc(row.so_number),
      '</div><div class="profit-sub">', esc(clientName(row.client_id)), ' · ', esc(entityStatusLabel(row.sales_order_status)),
      '</div></div>', profitabilityPill(row.profitability_status), '</div><div class="profit-grid">',
      profitCell('Valor total SO', money(row.order_total, row.sales_currency)),
      profitCell('Venta atribuida', money(row.attributed_sales_revenue, row.sales_currency), 'emphasis'),
      profitCell('Valor no atribuido', money(row.unattributed_order_value, row.sales_currency)),
      profitCell('Costo de mercancía', money(row.recognized_merchandise_cogs, row.cogs_currency)),
      profitCell('Margen bruto', money(row.gross_margin, row.sales_currency), row.gross_margin != null ? 'positive' : 'warning'),
      profitCell('Margen %', percent(row.gross_margin_pct), row.gross_margin_pct != null ? 'positive' : 'warning'),
      '</div><div class="profit-sub profit-sub-spaced">Cobertura: ', esc(coverageLabel(row.merchandise_cost_coverage)),
      '. El margen se calcula solo sobre la venta físicamente atribuida a Cargues activos.</div>',
      '<div class="profit-actions">', traceButton('so', row.sales_order_id), '</div></article>'
    ].join('');
  }

  function renderInvoiceProfit(row) {
    return [
      '<article class="profit-card"><div class="profit-card-head"><div><div class="profit-title">', esc(row.invoice_number),
      '</div><div class="profit-sub">SO ', esc(short(row.sales_order_id)), row.operation_id ? ' · Operación ' + esc(short(row.operation_id)) : '',
      '</div></div>', profitabilityPill(row.profitability_status), '</div><div class="profit-grid">',
      profitCell('Ingreso emitido', money(row.invoice_total, row.invoice_currency), 'emphasis'),
      profitCell('Costo de mercancía', money(row.recognized_merchandise_cogs, row.cogs_currency)),
      profitCell('Margen bruto', money(row.gross_margin, row.invoice_currency), row.gross_margin != null ? 'positive' : 'warning'),
      profitCell('Margen %', percent(row.gross_margin_pct), row.gross_margin_pct != null ? 'positive' : 'warning'),
      profitCell('Líneas', String(row.invoice_item_count ?? 0)),
      profitCell('Cobertura', coverageLabel(row.merchandise_cost_coverage)),
      '</div><div class="profit-sub profit-sub-spaced">Los cargos directos no se reparten a una factura sin una asignación explícita; este es el margen bruto de mercancía.</div>',
      '<div class="profit-actions">', traceButton('invoice', row.invoice_id), '</div></article>'
    ].join('');
  }

  function directCostText(row) {
    if (Number(row.direct_cost_charge_count || 0) === 0) return 'Sin cargos directos';
    if (row.direct_cost_amount == null) return 'Multimoneda / no comparable';
    return money(row.direct_cost_amount, row.direct_cost_currency);
  }

  function renderLoadProfit(row) {
    return [
      '<article class="profit-card"><div class="profit-card-head"><div><div class="profit-title">', esc(row.load_number),
      '</div><div class="profit-sub">', esc(entityStatusLabel(row.load_status)), row.operation_id ? ' · Operación ' + esc(short(row.operation_id)) : '',
      '</div></div>', profitabilityPill(row.profitability_status), '</div><div class="profit-grid">',
      profitCell('Venta atribuida', money(row.attributed_sales_revenue, row.revenue_currency), 'emphasis'),
      profitCell('Costo de mercancía', money(row.recognized_merchandise_cogs, row.cogs_currency)),
      profitCell('Margen antes de directos', money(row.gross_margin_before_direct_costs, row.revenue_currency)),
      profitCell('Costos directos', directCostText(row)),
      profitCell('Margen contribución', money(row.contribution_margin, row.revenue_currency), row.contribution_margin != null ? 'positive' : 'warning'),
      profitCell('Contribución %', percent(row.contribution_margin_pct), row.contribution_margin_pct != null ? 'positive' : 'warning'),
      '</div><div class="profit-sub profit-sub-spaced">Solo descuenta cargos contabilizados asignados explícitamente a este Cargue. No hereda costos del Contenedor ni de la Operación.</div>',
      '<div class="profit-actions">', traceButton('load', row.load_id), '</div></article>'
    ].join('');
  }

  function renderOperationProfit(row) {
    return [
      '<article class="profit-card"><div class="profit-card-head"><div><div class="profit-title">', esc(row.operation_code),
      '</div><div class="profit-sub">', esc(entityStatusLabel(row.operation_status)), row.container_number ? ' · ' + esc(row.container_number) : '',
      '</div></div>', profitabilityPill(row.profitability_status), '</div><div class="profit-grid">',
      profitCell('Ingreso facturado', money(row.issued_revenue, row.revenue_currency), 'emphasis'),
      profitCell('Costo de mercancía', money(row.recognized_merchandise_cogs, row.cogs_currency)),
      profitCell('Margen antes de directos', money(row.gross_margin_before_direct_costs, row.revenue_currency)),
      profitCell('Costos directos jerarquía', directCostText(row)),
      profitCell('Margen contribución', money(row.contribution_margin, row.revenue_currency), row.contribution_margin != null ? 'positive' : 'warning'),
      profitCell('Contribución %', percent(row.contribution_margin_pct), row.contribution_margin_pct != null ? 'positive' : 'warning'),
      '</div><div class="profit-sub profit-sub-spaced">Los costos directos reúnen cargos contabilizados de la Operación, sus Contenedores y sus Cargues sin doble conteo ni conversión de moneda.</div>',
      '<div class="profit-actions">', traceButton('operation', row.operation_id), '</div></article>'
    ].join('');
  }

  function renderProfitability() {
    if (state.profitabilityLoading && !state.profitabilityLoaded) {
      return '<div class="profit-loading"><span class="costs-spinner" aria-hidden="true"></span>Consultando rentabilidad…</div>';
    }
    const rows = profitabilityRows();
    const renderers = {
      sales_orders: renderSalesOrderProfit,
      invoices: renderInvoiceProfit,
      loads: renderLoadProfit,
      operations: renderOperationProfit
    };
    const cards = rows.length
      ? rows.map(renderers[state.subview]).join('')
      : emptyState(state.search ? 'Sin resultados' : 'Sin rentabilidad disponible', state.search ? 'Ajusta la búsqueda para consultar otros registros.' : 'Los márgenes aparecerán cuando el ERP pueda atribuir ventas y costos.', true);
    return [
      '<div class="profit-shell"><div class="profit-note"><b>Rentabilidad calculada por el ERP.</b> Las reglas financieras determinan cobertura, comparabilidad y margen. Esta vista no suma monedas incompatibles ni reparte cargos entre entidades.</div>',
      '<div class="profit-toolbar"><div class="profit-tabs" role="group" aria-label="Elegir nivel de rentabilidad">',
      '<button class="btn ', state.subview === 'sales_orders' ? 'active' : '', '" type="button" data-profit-subview="sales_orders" aria-pressed="', state.subview === 'sales_orders', '">Órdenes de venta</button>',
      '<button class="btn ', state.subview === 'invoices' ? 'active' : '', '" type="button" data-profit-subview="invoices" aria-pressed="', state.subview === 'invoices', '">Facturas</button>',
      '<button class="btn ', state.subview === 'loads' ? 'active' : '', '" type="button" data-profit-subview="loads" aria-pressed="', state.subview === 'loads', '">Cargues</button>',
      '<button class="btn ', state.subview === 'operations' ? 'active' : '', '" type="button" data-profit-subview="operations" aria-pressed="', state.subview === 'operations', '">Operaciones</button>',
      '</div><span class="costs-result-count">', esc(rows.length), ' resultado(s)</span></div>',
      profitabilityMetrics(rows), '<div class="profit-list">', cards, '</div></div>'
    ].join('');
  }

  function resultCount() {
    if (state.view === 'charges') return state.charges.filter(chargeMatches).length;
    if (state.view === 'landed') return landedRows().length;
    if (state.view === 'cogs') return cogsRows().length;
    return state.profitabilityLoaded ? profitabilityRows().length : 0;
  }

  function resultLabel(count) {
    if (state.view === 'charges') return count + (count === 1 ? ' cargo' : ' cargos');
    if (state.view === 'landed') return count + (count === 1 ? ' recepción' : ' recepciones');
    if (state.view === 'cogs') return count + (count === 1 ? ' Cargue' : ' Cargues');
    return state.profitabilityLoading && !state.profitabilityLoaded ? 'Consultando…' : count + (count === 1 ? ' resultado' : ' resultados');
  }

  function render() {
    if (!state.loaded) return;
    renderMetrics();
    $('newCharge').hidden = state.writeAccess !== true;
    $('costsReadOnlyNote').hidden = state.writeAccess === true;
    $('clearCostFilters').hidden = !state.search;
    document.querySelectorAll('[data-view]').forEach(button => {
      const active = button.dataset.view === state.view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('costsResultCount').textContent = resultLabel(resultCount());
    if (state.view === 'landed') $('content').innerHTML = renderLanded();
    else if (state.view === 'cogs') $('content').innerHTML = renderCogs();
    else if (state.view === 'profitability') $('content').innerHTML = renderProfitability();
    else $('content').innerHTML = renderCharges();
  }

  async function loadProfitability(force = false, renderAfter = true) {
    if (state.profitabilityLoading || (state.profitabilityLoaded && !force)) return true;
    state.profitabilityLoading = true;
    if (renderAfter && state.view === 'profitability') render();
    try {
      const data = await request('/api/profitability');
      state.profitability = data.profitability || state.profitability;
      state.traceability = data.traceability || state.traceability;
      state.masters = data.masters || state.masters;
      state.profitabilityLoaded = true;
      setPageMessage('');
      return true;
    } catch (error) {
      const value = reportCostError('profitability', error, 'No se pudo cargar la rentabilidad. Intenta nuevamente.');
      if (state.view === 'profitability') {
        $('content').innerHTML = emptyState('Rentabilidad no disponible', value) + '<div class="costs-empty compact"><button id="profitabilityRetry" class="btn" type="button">Reintentar</button></div>';
        $('profitabilityRetry')?.addEventListener('click', () => loadProfitability(true));
      }
      return false;
    } finally {
      state.profitabilityLoading = false;
      if (renderAfter && state.view === 'profitability' && state.profitabilityLoaded) render();
    }
  }

  async function refresh() {
    if (!token) return false;
    const data = await request('/api/costs');
    state.charges = Array.isArray(data.charges) ? data.charges : [];
    state.targets = data.targets || {};
    state.products = Array.isArray(data.products) ? data.products : [];
    state.models = data.cost_models || {};
    state.writeAccess = data.write_access === true;
    state.loaded = true;
    if (state.view === 'profitability') await loadProfitability(true, false);
    $('costsLastUpdated').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-US', { hour: '2-digit', minute: '2-digit' });
    setPageMessage('');
    render();
    window.parent?.dispatchEvent?.(new CustomEvent('export-mca:data-loaded'));
    if (pendingCostId) {
      const id = pendingCostId;
      pendingCostId = '';
      openCost(id);
    }
    return true;
  }

  function showLoadFailure(error) {
    const value = reportCostError('bootstrap', error, 'No se pudieron cargar los Costos. Intenta nuevamente.');
    setPageMessage(value);
    $('costsResultCount').textContent = 'No disponible';
    $('content').innerHTML = emptyState('Costos no disponibles', value) + '<div class="costs-empty compact"><button id="costsRetry" class="btn" type="button">Reintentar</button></div>';
    $('costsRetry')?.addEventListener('click', () => {
      $('content').innerHTML = '<div class="costs-loading" role="status"><span class="costs-spinner" aria-hidden="true"></span>Consultando Costos y rentabilidad…</div>';
      refresh().catch(showLoadFailure);
    });
  }

  function setModal(id, open, focusSelector = '') {
    const modal = $(id);
    if (!modal) return;
    if (open) {
      modalReturnFocus.set(id, document.activeElement);
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => modal.querySelector(focusSelector || 'button,select,input,textarea')?.focus());
      return;
    }
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    const previous = modalReturnFocus.get(id);
    modalReturnFocus.delete(id);
    if (previous instanceof HTMLElement) requestAnimationFrame(() => previous.focus());
  }

  function fillSelects() {
    $('cCategory').innerHTML = categories.map(([id, label]) => '<option value="' + esc(id) + '">' + esc(label) + '</option>').join('');
    $('cStage').innerHTML = stages.map(([id, label]) => '<option value="' + esc(id) + '">' + esc(label) + '</option>').join('');
    $('cSupplier').innerHTML = '<option value="">Sin proveedor</option>' + (state.targets.suppliers || []).map(row => '<option value="' + esc(row.id) + '">' + esc(row.legal_name || row.name || row.id) + '</option>').join('');
  }

  function detectTarget(row) {
    return targetTypes.find(([key]) => row?.[key])?.[0] || 'purchase_order_id';
  }

  function targetOptions(type, selected = '') {
    const config = targetConfig(type);
    return '<option value="">Selecciona objetivo</option>' + config.rows.map(row => {
      const isSelected = String(row.id) === String(selected) ? ' selected' : '';
      return '<option value="' + esc(row.id) + '"' + isSelected + '>' + esc(config.label(row)) + '</option>';
    }).join('');
  }

  function allocationLine(row = {}) {
    const type = detectTarget(row);
    const selected = row[type] || '';
    return [
      '<div class="allocation-line" data-allocation-line>',
      '<div><label>Tipo</label><select data-target-type>',
      targetTypes.map(([id, label]) => '<option value="' + esc(id) + '"' + (id === type ? ' selected' : '') + '>' + esc(label) + '</option>').join(''),
      '</select></div><div><label>Objetivo</label><select data-target-id>', targetOptions(type, selected), '</select></div>',
      '<div><label>Monto</label><input data-amount type="number" min="0" step="0.01" inputmode="decimal" value="', esc(row.amount ?? ''), '"></div>',
      '<div><label>Base</label><select data-basis>',
      bases.map(([id, label]) => '<option value="' + esc(id) + '"' + (id === (row.basis || 'manual') ? ' selected' : '') + '>' + esc(label) + '</option>').join(''),
      '</select></div><div><label>Nota</label><input data-note value="', esc(row.notes || ''), '"></div>',
      '<div class="actions"><button class="btn danger" type="button" data-remove-allocation>Quitar</button></div></div>'
    ].join('');
  }

  function addAllocation(row = {}) {
    $('allocationEditor').insertAdjacentHTML('beforeend', allocationLine(row));
  }

  function resetChargeForm(charge = null) {
    fillSelects();
    state.editingId = charge?.id || null;
    $('chargeTitle').textContent = charge ? 'Editar ' + charge.cost_number : 'Nuevo cargo';
    $('cCategory').value = charge?.category || 'domestic_trucking';
    $('cStage').value = charge?.stage || 'inbound';
    $('cDate').value = String(charge?.incurred_date || localDateToday()).slice(0, 10);
    $('cAmount').value = charge?.amount ?? '';
    $('cCurrency').value = charge?.currency || 'USD';
    $('cSupplier').value = charge?.supplier_id || '';
    $('cReference').value = charge?.reference || '';
    $('cNotes').value = charge?.notes || '';
    $('allocationEditor').innerHTML = '';
    (charge?.allocations || []).forEach(addAllocation);
    if (!(charge?.allocations || []).length) addAllocation();
    message('chargeMsg');
  }

  function openCreate() {
    if (state.writeAccess !== true) return false;
    resetChargeForm();
    setModal('chargeModal', true, '#cCategory');
    return true;
  }

  function openEdit(id) {
    const charge = state.charges.find(row => String(row.id) === String(id));
    if (!charge || !actionAllowed(charge, 'edit')) return false;
    resetChargeForm(charge);
    setModal('chargeModal', true, '#cCategory');
    return true;
  }

  function collectAllocations() {
    return [...document.querySelectorAll('[data-allocation-line]')].map(node => {
      const type = node.querySelector('[data-target-type]')?.value;
      const target = node.querySelector('[data-target-id]')?.value;
      return {
        amount: node.querySelector('[data-amount]')?.value || '',
        basis: node.querySelector('[data-basis]')?.value || 'manual',
        [type]: target || null,
        notes: node.querySelector('[data-note]')?.value || null
      };
    }).filter(row => num(row.amount) > 0 || targetTypes.some(([key]) => row[key]));
  }

  async function saveCharge() {
    message('chargeMsg');
    const amount = num($('cAmount').value);
    if (amount <= 0) return message('chargeMsg', 'El monto debe ser mayor que cero.');
    const allocations = collectAllocations();
    if (allocations.some(row => !targetTypes.some(([key]) => row[key]) || num(row.amount) <= 0)) {
      return message('chargeMsg', 'Cada distribución requiere objetivo y monto mayor que cero.');
    }
    $('saveCharge').disabled = true;
    try {
      const editingId = state.editingId;
      await request('/api/costs', {
        method: 'POST',
        body: JSON.stringify({
          action: editingId ? 'replace' : 'create',
          cost_charge_id: editingId,
          category: $('cCategory').value,
          stage: $('cStage').value,
          amount,
          currency: $('cCurrency').value,
          incurred_date: $('cDate').value || null,
          supplier_id: $('cSupplier').value || null,
          reference: $('cReference').value || null,
          notes: $('cNotes').value || null,
          allocations
        })
      });
      setModal('chargeModal', false);
      await refresh();
      setPageMessage(editingId ? 'Cargo actualizado correctamente.' : 'Cargo creado correctamente.', 'good');
    } catch (error) {
      const value = reportCostError('save', error, 'No se pudo guardar el cargo. Revisa los datos e intenta nuevamente.');
      message('chargeMsg', value);
    } finally {
      $('saveCharge').disabled = false;
    }
  }

  function openDetail(id) {
    const charge = state.charges.find(row => String(row.id) === String(id));
    if (!charge) return false;
    const progress = charge.progress || {};
    $('detailTitle').textContent = charge.cost_number || 'Cargo';
    $('detailSubtitle').textContent = categoryLabel(charge.category) + ' · ' + stageLabel(charge.stage) + ' · ' + statusLabel(charge.status);
    const allocations = (charge.allocations || []).map(row => {
      const target = allocationTarget(row);
      const label = targetTypes.find(([key]) => key === target.key)?.[1] || 'Objetivo';
      return [
        '<div class="detail-item"><div><b>', esc(target.label), '</b><div class="small">', esc(label), ' · ', esc(basisLabel(row.basis)),
        '</div></div><div class="money-strong">', esc(money(row.amount, charge.currency)), '</div></div>'
      ].join('');
    }).join('');
    $('detailBody').innerHTML = [
      '<div class="summary">',
      '<div><b>Total</b>', esc(money(charge.amount, charge.currency)), '</div>',
      '<div><b>Asignado</b>', esc(money(progress.allocated_amount, charge.currency)), '</div>',
      '<div><b>Sin asignar</b>', esc(money(progress.unallocated_amount, charge.currency)), '</div>',
      '<div><b>Fecha</b>', esc(date(charge.incurred_date)), '</div></div>',
      '<div class="small">Proveedor: ', esc(supplierName(charge.supplier_id)), ' · Referencia: ', esc(charge.reference || '—'), '</div>',
      '<div class="detail-items">', allocations || emptyState('Sin distribución', 'Este cargo no tiene líneas de distribución.', true), '</div>'
    ].join('');
    const actions = [];
    if (actionAllowed(charge, 'edit')) actions.push('<button class="btn" type="button" data-detail-edit="' + esc(charge.id) + '">Editar</button>');
    if (actionAllowed(charge, 'post')) actions.push('<button class="btn primary" type="button" data-detail-post="' + esc(charge.id) + '">Contabilizar</button>');
    if (actionAllowed(charge, 'void')) actions.push('<button class="btn danger" type="button" data-detail-void="' + esc(charge.id) + '">Anular</button>');
    $('detailActions').innerHTML = actions.join('');
    message('detailMsg');
    setModal('detailModal', true);
    return true;
  }

  function openCost(id) {
    if (!state.loaded) {
      pendingCostId = String(id || '');
      return true;
    }
    const opened = openDetail(id);
    if (!opened) setPageMessage('El cargo solicitado ya no está disponible.');
    return opened;
  }

  function closeCostDecision(accepted = false) {
    setModal('costDecisionModal', false);
    const resolve = decisionResolve;
    decisionResolve = null;
    resolve?.(Boolean(accepted));
  }

  function costDecision({ title, copy, accept = 'Continuar', danger = false }) {
    if (decisionResolve) closeCostDecision(false);
    $('costDecisionTitle').textContent = title;
    $('costDecisionCopy').textContent = copy;
    $('costDecisionAccept').textContent = accept;
    $('costDecisionAccept').classList.toggle('danger', danger);
    message('costDecisionMsg');
    return new Promise(resolve => {
      decisionResolve = resolve;
      setModal('costDecisionModal', true, '#costDecisionCancel');
    });
  }

  async function transition(id, action) {
    const charge = state.charges.find(row => String(row.id) === String(id));
    if (!charge || !actionAllowed(charge, action)) return false;
    const posting = action === 'post';
    const detailWasOpen = !$('detailModal').classList.contains('hidden');
    if (detailWasOpen) setModal('detailModal', false);
    const accepted = await costDecision({
      title: posting ? 'Contabilizar ' + charge.cost_number : 'Anular ' + charge.cost_number,
      copy: posting
        ? 'El cargo quedará bloqueado para edición y comenzará a afectar los costos reconocidos.'
        : 'El cargo conservará su historial, pero dejará de afectar los costos reconocidos.',
      accept: posting ? 'Contabilizar' : 'Anular cargo',
      danger: !posting
    });
    if (!accepted) {
      if (detailWasOpen) openDetail(id);
      return false;
    }
    try {
      await request('/api/costs', {
        method: 'POST',
        body: JSON.stringify({ action, cost_charge_id: id })
      });
      await refresh();
      setPageMessage(posting ? 'Cargo contabilizado correctamente.' : 'Cargo anulado correctamente.', 'good');
      return true;
    } catch (error) {
      const value = reportCostError('transition', error, 'No se pudo actualizar el cargo. Intenta nuevamente.');
      setPageMessage(value);
      if (detailWasOpen) openDetail(id);
      return false;
    }
  }

  function dedupe(rows) {
    const map = new Map();
    rows.forEach(row => {
      const key = [row.sales_order_item_id, row.load_item_id, row.receipt_item_id, row.purchase_order_item_id, row.supplier_bill_item_id]
        .map(value => value || '')
        .join('|');
      if (!map.has(key)) map.set(key, row);
    });
    return [...map.values()];
  }

  function traceSources(type, id) {
    if (type === 'so') return dedupe((state.traceability.sales_orders || []).filter(row => String(row.sales_order_id) === String(id)));
    if (type === 'invoice') return dedupe((state.traceability.invoices || []).filter(row => String(row.invoice_id) === String(id)));
    if (type === 'load') return dedupe((state.traceability.sales_orders || []).filter(row => String(row.load_id) === String(id)));
    const invoiceIds = new Set((state.profitability.invoices || []).filter(row => String(row.operation_id) === String(id)).map(row => String(row.invoice_id)));
    return dedupe([
      ...(state.traceability.invoices || []).filter(row => invoiceIds.has(String(row.invoice_id))),
      ...(state.traceability.sales_orders || []).filter(row => String(row.operation_id) === String(id))
    ]);
  }

  function relatedCharges(type, id, sources) {
    const rows = state.traceability.cost_charges || [];
    if (type === 'load') return rows.filter(row => row.target_type === 'load' && String(row.load_id) === String(id));
    if (type === 'operation') return rows.filter(row => String(row.operation_id) === String(id));
    const purchaseOrders = new Set(sources.map(row => String(row.purchase_order_id || '')).filter(Boolean));
    const receipts = new Set(sources.map(row => String(row.warehouse_receipt_id || '')).filter(Boolean));
    const loads = new Set(sources.map(row => String(row.load_id || '')).filter(Boolean));
    const shipments = new Set(sources.map(row => String(row.shipment_id || '')).filter(Boolean));
    const operations = new Set(sources.map(row => String(row.operation_id || row.traced_operation_id || '')).filter(Boolean));
    return rows.filter(row =>
      (row.purchase_order_id && purchaseOrders.has(String(row.purchase_order_id))) ||
      (row.warehouse_receipt_id && receipts.has(String(row.warehouse_receipt_id))) ||
      (row.load_id && loads.has(String(row.load_id))) ||
      (row.shipment_id && shipments.has(String(row.shipment_id))) ||
      (row.operation_id && operations.has(String(row.operation_id)))
    );
  }

  function navigationButton(kind, label) {
    return '<button class="btn" type="button" data-profit-nav="' + esc(kind) + '">' + esc(label) + '</button>';
  }

  function traceSourceHtml(row) {
    const productId = row.product_id || row.invoice_product_id;
    const bill = row.supplier_bill_number
      ? row.supplier_bill_number + (row.supplier_invoice_number ? ' · ' + row.supplier_invoice_number : '')
      : 'Sin factura de proveedor contabilizada';
    const purchaseOrderCost = row.po_unit_cost == null ? '—' : money(row.po_unit_cost, row.po_currency);
    const billCost = row.supplier_bill_unit_cost == null ? '—' : money(row.supplier_bill_unit_cost, row.supplier_bill_currency);
    const recognized = row.recognized_unit_cogs == null ? '—' : money(row.recognized_unit_cogs, row.recognized_cogs_currency);
    return [
      '<div class="trace-row"><div class="trace-row-head"><div><b>', esc(profitProductName(productId)),
      '</b><div class="profit-sub">Cobertura ', esc(coverageLabel(row.cost_coverage)), '</div></div>',
      '<div><b>Costo unitario reconocido: ', esc(recognized), '</b></div></div><div class="trace-chain">',
      '<div class="trace-node"><b>Cargue</b><span>', esc(row.load_number || short(row.load_id)), '</span></div>',
      '<div class="trace-node"><b>Recepción de almacén</b><span>', esc(row.receipt_number || short(row.warehouse_receipt_id)), '</span></div>',
      '<div class="trace-node"><b>Orden de compra</b><span>', esc(row.po_number || short(row.purchase_order_id)), '<br>', esc(purchaseOrderCost), '</span></div>',
      '<div class="trace-node"><b>Factura de proveedor</b><span>', esc(bill), '<br>', esc(billCost), '</span></div>',
      '<div class="trace-node"><b>Asignación física</b><span>Cargue ', esc(row.load_allocated_quantity ?? '—'), ' · Venta ', esc(row.sales_allocated_quantity ?? '—'), '</span></div>',
      '</div><div class="trace-nav">',
      row.load_id ? navigationButton('loads', 'Abrir Cargues') : '',
      row.warehouse_receipt_id ? navigationButton('warehouse', 'Abrir Almacén') : '',
      row.purchase_order_id ? navigationButton('purchases', 'Abrir Compras') : '',
      row.supplier_bill_id ? navigationButton('payables', 'Abrir Cuentas por pagar') : '',
      '</div></div>'
    ].join('');
  }

  function traceChargeHtml(row) {
    return [
      '<div class="trace-charge"><div><b>', esc(row.cost_number), '</b></div><div>', esc(categoryLabel(row.category)), ' · ', esc(stageLabel(row.stage)),
      '<div class="profit-sub">', esc(traceTargetLabel(row.target_type)), ' · ', esc(row.target_reference || short(row.target_id)), '</div></div>',
      '<div class="amount">', esc(money(row.allocated_amount, row.currency)), '</div><div>', navigationButton('costs', 'Abrir Costos'), '</div></div>'
    ].join('');
  }

  function traceHeading(type, id) {
    if (type === 'so') return (state.profitability.sales_orders || []).find(row => String(row.sales_order_id) === String(id))?.so_number || 'SO ' + short(id);
    if (type === 'invoice') return (state.profitability.invoices || []).find(row => String(row.invoice_id) === String(id))?.invoice_number || 'Factura ' + short(id);
    if (type === 'load') return (state.profitability.loads || []).find(row => String(row.load_id) === String(id))?.load_number || 'Cargue ' + short(id);
    return (state.profitability.operations || []).find(row => String(row.operation_id) === String(id))?.operation_code || 'Operación ' + short(id);
  }

  function openTrace(type, id) {
    const sources = traceSources(type, id);
    const charges = relatedCharges(type, id, sources);
    $('profitTraceTitle').textContent = 'Trazabilidad · ' + traceHeading(type, id);
    $('profitTraceSubtitle').textContent = type === 'so' || type === 'invoice'
      ? 'Fuentes de mercancía y cargos relacionados como contexto. Los cargos no se reparten automáticamente en este margen.'
      : type === 'load'
        ? 'Fuentes de mercancía y cargos directos incluidos cuando están asignados a este Cargue.'
        : 'Fuentes de facturación, costo de mercancía y cargos de la Operación, sus Contenedores y sus Cargues.';
    $('profitTraceBody').innerHTML = [
      '<div class="trace-section"><h3>Cadena de mercancía</h3><div class="trace-note">Venta o factura → Cargue → recepción de almacén → orden de compra → factura de proveedor. Se muestra el costo reconocido por las reglas financieras del ERP.</div>',
      '<div class="trace-list">', sources.length ? sources.map(traceSourceHtml).join('') : emptyState('Sin cadena atribuida', 'No hay cadena de mercancía atribuida todavía.', true), '</div></div>',
      '<div class="trace-section"><h3>Cargos relacionados</h3><div class="trace-note">Se listan por asignación explícita y moneda original; esta vista no convierte ni suma monedas incompatibles.</div>',
      '<div class="trace-list">', charges.length ? charges.map(traceChargeHtml).join('') : emptyState('Sin cargos relacionados', 'No hay cargos contabilizados relacionados.', true), '</div></div>'
    ].join('');
    setModal('profitTraceModal', true);
  }

  function closeTrace() {
    setModal('profitTraceModal', false);
  }

  function navigate(kind) {
    const shell = window.parent?.NavigationShell;
    const map = {
      warehouse: 'openWarehouse',
      purchases: 'openPurchases',
      payables: 'openPayables',
      loads: 'openLoads',
      sales: 'openSales',
      invoices: 'openInvoices',
      costs: 'openCosts'
    };
    const method = map[kind];
    if (shell && method && typeof shell[method] === 'function') {
      closeTrace();
      shell[method]();
    }
  }

  function selectView(view) {
    if (!['charges', 'landed', 'cogs', 'profitability'].includes(view)) return false;
    state.view = view;
    setPageMessage('');
    render();
    if (view === 'profitability' && !state.profitabilityLoaded) loadProfitability();
    return true;
  }

  function openProfitability(subview = 'sales_orders') {
    if (['sales_orders', 'invoices', 'loads', 'operations'].includes(subview)) state.subview = subview;
    return selectView('profitability');
  }

  function closeNamedModal(name) {
    if (name === 'profitTrace') return closeTrace();
    if (name === 'costDecision') return closeCostDecision(false);
    setModal(name + 'Modal', false);
  }

  function bindEvents() {
    $('newCharge')?.addEventListener('click', openCreate);
    $('addAllocation')?.addEventListener('click', () => addAllocation());
    $('saveCharge')?.addEventListener('click', saveCharge);
    $('refresh')?.addEventListener('click', () => {
      $('refresh').disabled = true;
      refresh().catch(error => {
        const value = reportCostError('refresh', error, 'No se pudo actualizar Costos. Intenta nuevamente.');
        setPageMessage(value);
      }).finally(() => {
        $('refresh').disabled = false;
      });
    });
    $('search')?.addEventListener('input', event => {
      state.search = event.target.value.trim();
      render();
    });
    $('clearCostFilters')?.addEventListener('click', () => {
      state.search = '';
      $('search').value = '';
      render();
      $('search').focus();
    });
    $('costDecisionCancel')?.addEventListener('click', () => closeCostDecision(false));
    $('costDecisionAccept')?.addEventListener('click', () => closeCostDecision(true));

    document.addEventListener('change', event => {
      const select = event.target.closest?.('[data-target-type]');
      if (!select) return;
      const line = select.closest('[data-allocation-line]');
      const target = line?.querySelector('[data-target-id]');
      if (target) target.innerHTML = targetOptions(select.value);
    });

    document.addEventListener('click', event => {
      const close = event.target.closest?.('[data-close]');
      if (close) {
        closeNamedModal(close.dataset.close);
        return;
      }
      if (event.target.classList?.contains('modal')) {
        if (event.target.id === 'costDecisionModal') closeCostDecision(false);
        else setModal(event.target.id, false);
        return;
      }
      const remove = event.target.closest?.('[data-remove-allocation]');
      if (remove) {
        remove.closest('[data-allocation-line]')?.remove();
        return;
      }
      const detail = event.target.closest?.('[data-detail]');
      if (detail) {
        openDetail(detail.dataset.detail);
        return;
      }
      const edit = event.target.closest?.('[data-edit]');
      if (edit) {
        openEdit(edit.dataset.edit);
        return;
      }
      const post = event.target.closest?.('[data-post]');
      if (post) {
        transition(post.dataset.post, 'post');
        return;
      }
      const voidButton = event.target.closest?.('[data-void]');
      if (voidButton) {
        transition(voidButton.dataset.void, 'void');
        return;
      }
      const detailEdit = event.target.closest?.('[data-detail-edit]');
      if (detailEdit) {
        setModal('detailModal', false);
        openEdit(detailEdit.dataset.detailEdit);
        return;
      }
      const detailPost = event.target.closest?.('[data-detail-post]');
      if (detailPost) {
        transition(detailPost.dataset.detailPost, 'post');
        return;
      }
      const detailVoid = event.target.closest?.('[data-detail-void]');
      if (detailVoid) {
        transition(detailVoid.dataset.detailVoid, 'void');
        return;
      }
      const view = event.target.closest?.('[data-view]');
      if (view) {
        selectView(view.dataset.view);
        return;
      }
      const subview = event.target.closest?.('[data-profit-subview]');
      if (subview) {
        state.subview = subview.dataset.profitSubview;
        render();
        return;
      }
      const trace = event.target.closest?.('[data-profit-trace]');
      if (trace) {
        const [type, id] = String(trace.dataset.profitTrace || '').split(':');
        if (type && id) openTrace(type, id);
        return;
      }
      const navigation = event.target.closest?.('[data-profit-nav]');
      if (navigation) navigate(navigation.dataset.profitNav);
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!$('costDecisionModal').classList.contains('hidden')) closeCostDecision(false);
      else if (!$('profitTraceModal').classList.contains('hidden')) closeTrace();
      else if (!$('detailModal').classList.contains('hidden')) setModal('detailModal', false);
      else if (!$('chargeModal').classList.contains('hidden')) setModal('chargeModal', false);
    });
  }

  function startCosts(sessionToken = token) {
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
    startCosts(event.newValue);
  }

  window.load = refresh;
  window.openOperationalCost = openCost;
  window.CostsModule = Object.freeze({
    owner: 'costs.js',
    embedded: embeddedMode,
    safeCostMessage,
    safeProfitabilityMessage,
    refresh,
    openCost,
    openProfitability
  });

  if (!startCosts()) {
    if (embeddedMode) window.addEventListener('storage', handleStoredSession);
    else redirectToAdminLogin();
  }
})();
