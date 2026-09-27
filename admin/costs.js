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
      shipments: [],
      operations: [],
      operation_direct_costs: []
    },
    payroll:{ workers:[], entries:[], write_access:false },
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
  let payrollEditingId = null;
  let profitabilityPromise = null;
  let companyYear = new Date().getFullYear();

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
    /^(?:No tienes|No autorizado|La solicitud|Selecciona|Indica|Cada distribución|El monto|La moneda|La distribución|Cargo de costo|Solo un cargo|Distribuye el cargo|El cargo|Acción de Costos|Sesión vencida|El salario y las propinas|Ya existe un salario|El registro ya no está disponible|No se pudo guardar el salario)/i,
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
    node.className = 'msg cost-dialog-message