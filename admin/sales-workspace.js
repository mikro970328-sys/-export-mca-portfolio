(() => {
  if (window.__salesWorkspaceInstalled) return;
  window.__salesWorkspaceInstalled = true;

  const byId = id => document.getElementById(id);
  const token = () => localStorage.getItem('export_mca_token') || '';
  const num = value => Number(value || 0);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt = value => new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(num(value));
  const money = (value, currency='USD') => {
    if (value === null || value === undefined || value === '') return 'No comparable';
    try { return new Intl.NumberFormat('en-US',{style:'currency',currency:String(currency || 'USD').toUpperCase(),maximumFractionDigits:2}).format(num(value)); }
    catch { return `${String(currency || 'USD').toUpperCase()} ${num(value).toFixed(2)}`; }
  };
  const date = value => value ? new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString('es-US') : '—';
  const dateTime = value => value ? new Date(value).toLocaleString('es-US') : '—';
  const today = () => new Date().toISOString().slice(0,10);

  const state = { salesOrderId:null, data:null, tab:'summary', loading:false };
  const TABS = [
    ['summary','Resumen'],
    ['logistics','Logística'],
    ['billing','Facturación y cobros'],
    ['costs','Costos y ganancia'],
    ['documents','Documentos aduanales'],
    ['history','Historial']
  ];
  const COST_CATEGORIES = [
    ['domestic_trucking','Transporte terrestre'],['ocean_freight','Flete marítimo'],['insurance','Seguro'],
    ['customs_duties','Aranceles / aduana'],['port_terminal','Puerto / terminal'],['warehouse','Almacén'],
    ['inspection','Inspección'],['brokerage','Broker / gestión'],['nationalization','Nacionalización'],
    ['commission','Comisión'],['gifts','Regalos'],['documentation','Documentación'],['bank_fee','Cargo bancario'],['other','Otro']
  ];
  const COST_STAGES = [
    ['fulfillment','Embarque / cumplimiento'],['destination','Destino'],['inbound','Entrada / compra']
  ];

  async function request(path, options={}) {
    const response = await fetch(path, {
      ...options,
      headers:{'Content-Type':'application/json',...(token() ? {Authorization:`Bearer ${token()}`} : {}),...(options.headers || {})}
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem('export_mca_token');
      location.href='/admin/';
      throw new Error('Sesión vencida');
    }
    if (!response.ok) throw new Error(data.error || 'No se pudo procesar la operación');
    return data;
  }

  function controller() { return window.SalesOrderController || null; }
  function parentNavigation() {
    try { return window.parent !== window ? window.parent.OperationalNavigation : null; }
    catch { return null; }
  }
  function parentShell() {
    try { return window.parent !== window ? window.parent.NavigationShell : null; }
    catch { return null; }
  }

  function clientLabel(summary) { return summary?.client_company || summary?.client_name || 'Cliente'; }
  function statusLabel(value) {
    return ({draft:'Borrador',confirmed:'Confirmada',closed:'Cerrada',cancelled:'Cancelada',pending:'Pendiente',partial:'Parcial',planned:'Planificada',prepared:'Preparada',dispatched:'Despachada',issued:'Emitida',void:'Anulada',paid:'Pagada',unpaid:'Pendiente',not_invoiced:'Sin factura'})[value] || value || '—';
  }
  function statusClass(value) {
    if (['confirmed','dispatched','issued','paid','comparable','actual'].includes(value)) return 'ok';
    if (['cancelled','void','currency_mismatch','direct_cost_currency_mismatch','direct_cost_multi_currency','incomplete_cogs'].includes(value)) return 'bad';
    if (['partial','planned','prepared','draft','pending','unpaid','not_invoiced'].includes(value)) return 'warn';
    return '';
  }
  function pill(label, value) { return `<span class="sales-ws-status ${statusClass(value)}">${esc(label)}</span>`; }
  function financialValue(value, currency, comparable=true) { return comparable ? money(value,currency) : 'No comparable'; }

  function uniqueLogistics() {
    const rows = Array.isArray(state.data?.logistics) ? state.data.logistics : [];
    const byLoad = new Map();
    for (const row of rows) {
      const key = row.load_id || row.fulfillment_allocation_id;
      if (!key) continue;
      if (!byLoad.has(key)) byLoad.set(key, {...row, receipt_numbers:[...(row.receipt_numbers || [])], item_rows:[]});
      const target = byLoad.get(key);
      target.item_rows.push(row);
      target.receipt_numbers = [...new Set([...(target.receipt_numbers || []),...(row.receipt_numbers || [])].filter(Boolean))];
    }
    return [...byLoad.values()];
  }

  function uniqueShipments() {
    const rows = Array.isArray(state.data?.logistics) ? state.data.logistics : [];
    const map = new Map();
    for (const row of rows) {
      if (!row.shipment_id) continue;
      if (!map.has(row.shipment_id)) map.set(row.shipment_id, {...row, load_numbers:[], receipt_numbers:[]});
      const target = map.get(row.shipment_id);
      if (row.load_number) target.load_numbers.push(row.load_number);
      target.load_numbers = [...new Set(target.load_numbers)];
      target.receipt_numbers = [...new Set([...target.receipt_numbers,...(row.receipt_numbers || [])].filter(Boolean))];
      if (!target.operation_id && row.operation_id) {
        target.operation_id = row.operation_id;
        target.operation_code = row.operation_code;
        target.operation_status = row.operation_status;
      }
    }
    return [...map.values()];
  }

  function realContainerShipments() {
    return uniqueShipments().filter(row => String(row.container_number || '').trim());
  }

  function normalizeDocType(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  }
  function docsForShipment(shipment) {
    const docs = Array.isArray(state.data?.documents) ? state.data.documents : [];
    const bol = String(shipment?.bol_number || '').trim().toUpperCase();
    return docs.filter(doc => {
      if (doc.generated === true) return false;
      if (!shipment?.operation_id || String(doc.operation_id || '') !== String(shipment.operation_id)) return false;
      if (doc.shipment_id) return String(doc.shipment_id) === String(shipment.shipment_id);
      if (doc.bol_number) return Boolean(bol) && String(doc.bol_number).trim().toUpperCase() === bol;
      return true;
    });
  }
  function customsStatus(shipment) {
    const docs = docsForShipment(shipment);
    const types = docs.map(doc => normalizeDocType(doc.document_type));
    return {
      docs,
      hasPackingList:types.some(type => type === 'packing list' || type.includes('packing list')),
      hasCommercialInvoice:types.some(type => type === 'factura comercial' || type.includes('commercial invoice'))
    };
  }

  function setLoading() {
    byId('detailBody').innerHTML = '<div class="sales-ws-loading">Cargando operación comercial…</div>';
    byId('detailActions').innerHTML = '';
    byId('detailMsg').textContent = '';
  }

  async function fetchWorkspace() {
    if (!state.salesOrderId) return null;
    const result = await request(`/api/sales-workspace?sales_order_id=${encodeURIComponent(state.salesOrderId)}`);
    state.data = result.workspace || null;
    return state.data;
  }

  async function open(salesOrderId) {
    if (!salesOrderId) return;
    state.salesOrderId = String(salesOrderId);
    state.tab = 'summary';
    state.data = null;
    const modal = byId('detailModal');
    const dialog = modal?.querySelector('.dialog');
    dialog?.classList.add('sales-workspace-dialog');
    byId('detailTitle').textContent = 'Venta';
    byId('detailSubtitle').textContent = 'Cargando…';
    setLoading();
    modal?.classList.remove('hidden');
    state.loading = true;
    try {
      await fetchWorkspace();
      render();
    } catch (error) {
      byId('detailBody').innerHTML = `<div class="sales-ws-callout">${esc(error.message)}</div>`;
    } finally { state.loading = false; }
  }

  async function reload({ keepTab=true }={}) {
    const tab = state.tab;
    await fetchWorkspace();
    if (keepTab) state.tab = tab;
    render();
  }

  function kpi(label, value, className='') {
    return `<div class="sales-workspace-kpi ${className}"><span>${esc(label)}</span><b title="${esc(value)}">${esc(value)}</b></div>`;
  }

  function nextAction() {
    const s = state.data?.summary;
    if (!s) return { text:'Operación no disponible', actions:[] };
    const c = controller();
    const order = c?.getOrder?.(state.salesOrderId) || null;
    const shipments = realContainerShipments();
    const missingExp = shipments.find(row => !row.operation_id);
    const invoices = state.data?.billing?.invoices || [];
    const draft = invoices.find(invoice => invoice.status === 'draft');
    const issuedOpen = invoices.find(invoice => invoice.status === 'issued' && num(invoice.financial?.balance_due) > 0);

    if (s.commercial_status === 'draft') return { text:'Confirma la venta para iniciar su cumplimiento.', actions:[['Confirmar venta','confirm','primary']] };
    if (missingExp) return { text:`El contenedor ${missingExp.container_number} ya está asignado y todavía no tiene Expediente.`, actions:[['Crear Expediente','create_expediente','orange',missingExp.shipment_id]] };
    if (order && c?.hasUnallocated?.(order)) return { text:'La venta tiene mercancía pendiente de asignar a un Cargue.', actions:[['Preparar Cargue','create_load','orange'],['Vincular Cargue existente','link_load','']] };
    if (s.billing_status === 'not_invoiced' && num(s.available_to_invoice_value) > 0) return { text:'La venta está lista para crear su factura de cobro al cliente.', actions:[['Crear factura de cobro','new_invoice','primary']] };
    if (draft && !draft.operation_id) return { text:'La factura está en borrador. Asigna un Expediente antes de emitirla.', actions:[['Facturación y cobros','tab_billing','']] };
    if (draft?.operation_id) return { text:`${draft.invoice_number} está lista para emitir.`, actions:[['Emitir factura','issue_invoice','primary',draft.id]] };
    if (issuedOpen) return { text:`Hay ${money(issuedOpen.financial?.balance_due,issuedOpen.currency)} pendiente de cobrar.`, actions:[['Registrar cobro','payment','orange',issuedOpen.id]] };
    return { text:'La operación no tiene una acción crítica pendiente en este momento.', actions:[] };
  }

  function actionButton([label, action, kind='', id='']) {
    return `<button type="button" class="btn ${kind}" data-ws-action="${esc(action)}" ${id ? `data-ws-id="${esc(id)}"` : ''}>${esc(label)}</button>`;
  }

  function render() {
    const data = state.data;
    const s = data?.summary;
    if (!s) return;
    byId('detailTitle').textContent = `${s.so_number} · ${clientLabel(s)}`;
    byId('detailSubtitle').textContent = `${statusLabel(s.commercial_status)} · ${statusLabel(s.fulfillment_status)} · ${s.importer_name || 'Sin importadora'}`;
    byId('detailActions').innerHTML = '';
    byId('detailMsg').textContent = '';

    const contributionComparable = s.contribution_status === 'comparable';
    const cogsComparable = s.profitability_status === 'comparable';
    const invoiceComparable = Boolean(s.billing_currency_comparable);
    const next = nextAction();
    const shell = `<div class="sales-workspace-shell">
      <div class="sales-workspace-top">
        <div class="sales-workspace-kpis">
          ${kpi('Venta',money(s.order_total,s.sales_currency))}
          ${kpi('Costo mercancía',financialValue(s.recognized_merchandise_cogs,s.cogs_currency || s.sales_currency,cogsComparable))}
          ${kpi('Gastos directos',financialValue(s.direct_cost_amount,s.direct_cost_currency || s.sales_currency,s.direct_cost_currency_count === 0 || s.direct_cost_currency === s.sales_currency))}
          ${kpi('Contribución',financialValue(s.contribution_margin,s.sales_currency,contributionComparable),contributionComparable ? 'good' : 'warn')}
          ${kpi('Facturado',financialValue(s.issued_invoice_total,s.issued_currency || s.sales_currency,invoiceComparable))}
          ${kpi('Cobrado',financialValue(s.collected_amount,s.issued_currency || s.sales_currency,invoiceComparable))}
        </div>
        <div class="sales-workspace-next"><div class="sales-workspace-next-text"><div class="sales-workspace-next-label">Siguiente paso</div><b>${esc(next.text)}</b></div><div class="sales-workspace-next-actions">${next.actions.map(actionButton).join('')}</div></div>
      </div>
      <div class="sales-workspace-tabs">${TABS.map(([key,label]) => `<button type="button" class="sales-workspace-tab ${state.tab===key?'active':''}" data-ws-tab="${key}">${esc(label)}</button>`).join('')}</div>
      <div id="salesWorkspaceContent" class="sales-workspace-content">${renderTab()}</div>
    </div>`;
    byId('detailBody').innerHTML = shell;
    bindWorkspaceEvents();
  }

  function renderTab() {
    if (state.tab === 'logistics') return renderLogistics();
    if (state.tab === 'billing') return renderBilling();
    if (state.tab === 'costs') return renderCosts();
    if (state.tab === 'documents') return renderDocuments();
    if (state.tab === 'history') return renderHistory();
    return renderSummary();
  }

  function renderSummary() {
    const s = state.data.summary;
    const items = state.data.items || [];
    return `<div class="sales-ws-grid">
      <div class="sales-ws-card"><h3>Venta</h3>
        <div class="sales-ws-field"><span>Cliente</span><b>${esc(clientLabel(s))}</b></div>
        <div class="sales-ws-field"><span>Importadora</span><b>${esc(s.importer_name || 'Sin definir')}</b></div>
        <div class="sales-ws-field"><span>Fecha</span><b>${esc(date(s.order_date))}</b></div>
        <div class="sales-ws-field"><span>Referencia cliente</span><b>${esc(s.customer_reference || '—')}</b></div>
        <div class="sales-ws-field"><span>Estado comercial</span><b>${pill(statusLabel(s.commercial_status),s.commercial_status)}</b></div>
        <div class="sales-ws-field"><span>Cumplimiento</span><b>${pill(statusLabel(s.fulfillment_status),s.fulfillment_status)}</b></div>
      </div>
      <div class="sales-ws-card soft"><h3>Estado financiero</h3>
        <div class="sales-ws-money-table">
          <div class="sales-ws-money-row"><span>Venta atribuida a mercancía despachada</span><strong>${financialValue(s.attributed_sales_revenue,s.sales_currency,s.profitability_status==='comparable')}</strong></div>
          <div class="sales-ws-money-row"><span>Costo real de mercancía</span><strong>${financialValue(s.recognized_merchandise_cogs,s.cogs_currency || s.sales_currency,s.profitability_status==='comparable')}</strong></div>
          <div class="sales-ws-money-row"><span>Margen bruto</span><strong>${financialValue(s.gross_margin,s.sales_currency,s.profitability_status==='comparable')}</strong></div>
          <div class="sales-ws-money-row"><span>Gastos directos</span><strong>${financialValue(s.direct_cost_amount,s.direct_cost_currency || s.sales_currency,s.direct_cost_currency_count===0 || s.direct_cost_currency===s.sales_currency)}</strong></div>
          <div class="sales-ws-money-row total"><span>Contribución de la venta</span><strong>${financialValue(s.contribution_margin,s.sales_currency,s.contribution_status==='comparable')}</strong></div>
        </div>
        ${s.contribution_status !== 'comparable' ? '<div class="sales-ws-callout" style="margin-top:9px">La contribución no se presenta porque las monedas o el COGS no son comparables. El ERP no aplica FX automático.</div>' : ''}
        <div class="sales-ws-meta" style="margin-top:9px">Los gastos generales de la compañía se controlan por separado. Esta contribución no es flujo de caja.</div>
      </div>
    </div>
    <div class="sales-ws-card" style="margin-top:12px"><div class="sales-ws-row-head"><h3>Mercancía vendida</h3><span class="sales-ws-status">${items.length} línea${items.length===1?'':'s'}</span></div><div class="sales-ws-list">${items.map(item => {
      const product = item.product || {};
      const lineTotal = item.entered_line_total;
      return `<div class="sales-ws-row"><div class="sales-ws-row-head"><div><div class="sales-ws-row-title">${esc(product.sku ? product.sku+' · ' : '')}${esc(product.name || 'Producto')}</div><div class="sales-ws-meta">${fmt(item.ordered_quantity)} ${esc(item.unit)}${num(item.ordered_pallets)>0 ? ` · ${fmt(item.ordered_pallets)} pallets` : ''}</div></div><b>${money(lineTotal,s.sales_currency)}</b></div><div class="sales-ws-meta">Despachado: ${fmt(item.fulfillment?.dispatched_quantity || 0)} · Pendiente: ${fmt(item.fulfillment?.remaining_to_dispatch_quantity || 0)} · Disponible para facturar: ${fmt(item.invoicing?.available_to_invoice_quantity || 0)}</div></div>`;
    }).join('')}</div></div>`;
  }

  function renderLogistics() {
    const loads = uniqueLogistics();
    if (!loads.length) return `<div class="sales-ws-empty">Esta venta todavía no tiene Cargues vinculados.<div class="sales-ws-actions" style="justify-content:center"><button class="btn orange" data-ws-action="create_load">Preparar Cargue</button><button class="btn" data-ws-action="link_load">Vincular Cargue existente</button></div></div>`;
    return `<div class="sales-ws-list">${loads.map(load => `<div class="sales-ws-row"><div class="sales-ws-row-head"><div><div class="sales-ws-row-title">${esc(load.load_number || 'Cargue')}</div><div class="sales-ws-meta">${esc(statusLabel(load.load_status))}${load.container_number ? ` · Contenedor ${esc(load.container_number)}` : ' · Contenedor pendiente'}${load.receipt_numbers?.length ? ` · Origen ${esc(load.receipt_numbers.join(', '))}` : ''}</div></div>${pill(statusLabel(load.load_status),load.load_status)}</div><div class="sales-ws-actions"><button class="btn" data-ws-action="open_load" data-ws-id="${esc(load.load_id)}">Ver Cargue</button>${load.shipment_id ? `<button class="btn" data-ws-action="open_tracking" data-ws-id="${esc(load.shipment_id)}">Ver Tracking</button>` : ''}${load.receipt_numbers?.[0] ? `<button class="btn" data-ws-action="open_wr" data-ws-id="${esc(load.receipt_numbers[0])}">Ver WR</button>` : ''}</div></div>`).join('')}</div>`;
  }

  function invoiceStatus(invoice) {
    if (invoice.status === 'draft') return pill('Borrador','draft');
    if (invoice.status === 'void') return pill('Anulada','void');
    return pill(statusLabel(invoice.financial?.payment_status || invoice.status),invoice.financial?.payment_status || invoice.status);
  }

  function renderBilling() {
    const s = state.data.summary;
    const invoices = state.data.billing?.invoices || [];
    const comparable = Boolean(s.billing_currency_comparable);
    return `<div class="sales-ws-callout info">Esta sección es la <b>factura de cobro al cliente</b> y sus cobros. No es la Commercial Invoice aduanal; esa se controla en “Documentos aduanales”.</div>
      <div class="sales-ws-grid three" style="margin-top:12px">
        <div class="sales-ws-card"><h4>Venta</h4><b>${money(s.order_total,s.sales_currency)}</b></div>
        <div class="sales-ws-card"><h4>Facturado emitido</h4><b>${financialValue(s.issued_invoice_total,s.issued_currency || s.sales_currency,comparable)}</b></div>
        <div class="sales-ws-card"><h4>Por cobrar</h4><b>${financialValue(s.balance_due,s.issued_currency || s.sales_currency,comparable)}</b></div>
      </div>
      <div class="sales-ws-card" style="margin-top:12px"><div class="sales-ws-row-head"><h3>Facturas de cobro</h3>${num(s.available_to_invoice_value)>0 ? '<button class="btn primary" data-ws-action="new_invoice">+ Crear factura</button>' : ''}</div>
        <div class="sales-ws-list">${invoices.length ? invoices.map(invoice => {
          const f = invoice.financial || {};
          const op = state.data.operations?.find(row => String(row.id) === String(invoice.operation_id || ''));
          return `<div class="sales-ws-row"><div class="sales-ws-row-head"><div><div class="sales-ws-row-title">${esc(invoice.invoice_number || 'Factura')}</div><div class="sales-ws-meta">${esc(date(invoice.issue_date))} · ${money(f.total ?? 0,invoice.currency)} · Expediente: ${esc(op?.operation_code || (invoice.operation_id ? 'Asignado' : 'pendiente'))}</div></div>${invoiceStatus(invoice)}</div><div class="sales-ws-meta">Cobrado ${money(f.paid_amount ?? 0,invoice.currency)} · Saldo ${money(f.balance_due ?? 0,invoice.currency)}</div><div class="sales-ws-actions">
            ${invoice.status==='draft' && !invoice.operation_id ? `<button class="btn" data-ws-action="assign_invoice_operation" data-ws-id="${esc(invoice.id)}">Asignar Expediente</button>` : ''}
            ${invoice.status==='draft' && invoice.operation_id ? `<button class="btn primary" data-ws-action="issue_invoice" data-ws-id="${esc(invoice.id)}">Emitir factura</button>` : ''}
            ${invoice.status==='issued' && num(f.balance_due)>0 ? `<button class="btn orange" data-ws-action="payment" data-ws-id="${esc(invoice.id)}">Registrar cobro</button>` : ''}
          </div>${invoice.status==='draft' && !invoice.operation_id ? '<div class="sales-ws-callout" style="margin-top:9px">El borrador es válido. Antes de emitirlo debes asignarle un Expediente del mismo cliente.</div>' : ''}</div>`;
        }).join('') : '<div class="sales-ws-empty">Todavía no hay factura de cobro para esta venta.</div>'}</div>
      </div>`;
  }

  function costLabel(row) {
    const category = row.cost_charge?.category || '';
    return COST_CATEGORIES.find(([key]) => key === category)?.[1] || category || 'Gasto';
  }

  function renderCosts() {
    const s = state.data.summary;
    const allocations = (state.data.costs?.allocations || []).filter(row => row.cost_charge?.status === 'posted');
    const comparable = s.contribution_status === 'comparable';
    return `<div class="sales-ws-grid">
      <div class="sales-ws-card soft"><h3>Contribución de esta venta</h3><div class="sales-ws-money-table">
        <div class="sales-ws-money-row"><span>Venta atribuida</span><strong>${financialValue(s.attributed_sales_revenue,s.sales_currency,s.profitability_status==='comparable')}</strong></div>
        <div class="sales-ws-money-row"><span>− Costo mercancía</span><strong>${financialValue(s.recognized_merchandise_cogs,s.cogs_currency || s.sales_currency,s.profitability_status==='comparable')}</strong></div>
        <div class="sales-ws-money-row"><span>= Margen bruto</span><strong>${financialValue(s.gross_margin,s.sales_currency,s.profitability_status==='comparable')}</strong></div>
        <div class="sales-ws-money-row"><span>− Gastos directos</span><strong>${financialValue(s.direct_cost_amount,s.direct_cost_currency || s.sales_currency,s.direct_cost_currency_count===0 || s.direct_cost_currency===s.sales_currency)}</strong></div>
        <div class="sales-ws-money-row total"><span>= Contribución</span><strong>${financialValue(s.contribution_margin,s.sales_currency,comparable)}</strong></div>
      </div>${!comparable ? '<div class="sales-ws-callout" style="margin-top:9px">No se presenta contribución si los costos no son comparables en moneda o falta COGS real.</div>' : ''}<div class="sales-ws-meta" style="margin-top:9px">No incluye gastos generales de la compañía y no representa flujo de caja.</div></div>
      <div class="sales-ws-card"><div class="sales-ws-row-head"><div><h3>Gastos directos</h3><div class="sales-ws-meta">Transporte, flete, seguro, comisión, regalos, documentación y otros gastos que pertenecen directamente a esta venta. Los gastos generales van fuera de esta ficha.</div></div><button class="btn orange" data-ws-action="new_cost">+ Agregar gasto</button></div><div class="sales-ws-list" style="margin-top:10px">${allocations.length ? allocations.map(row => `<div class="sales-ws-row"><div class="sales-ws-row-head"><div><div class="sales-ws-row-title">${esc(costLabel(row))}</div><div class="sales-ws-meta">${esc(row.cost_charge?.cost_number || '')} · ${esc(date(row.cost_charge?.incurred_date))}${row.sales_order_item_id ? ' · Producto específico' : ' · Toda la venta'}</div></div><b>${money(row.amount,row.cost_charge?.currency || s.sales_currency)}</b></div>${row.cost_charge?.reference ? `<div class="sales-ws-meta">Ref: ${esc(row.cost_charge.reference)}</div>` : ''}</div>`).join('') : '<div class="sales-ws-empty">No hay gastos directos contabilizados en esta venta.</div>'}</div></div>
    </div>`;
  }

  function renderDocuments() {
    const shipments = realContainerShipments();
    if (!shipments.length) return '<div class="sales-ws-empty">Todavía no hay un contenedor real asignado. El control documental se activa cuando exista un número de contenedor.</div>';
    return `<div class="sales-ws-callout info">Aquí se controla la documentación <b>aduanal</b>. El Packing List y la Commercial Invoice se crean/suben manualmente en el Expediente; el ERP solo los marca completos cuando existe el archivo oficial cargado.</div><div class="sales-ws-list" style="margin-top:12px">${shipments.map(shipment => {
      const status = customsStatus(shipment);
      const op = state.data.operations?.find(row => String(row.id) === String(shipment.operation_id || ''));
      return `<div class="sales-ws-row"><div class="sales-ws-row-head"><div><div class="sales-ws-row-title">${esc(shipment.container_number)}</div><div class="sales-ws-meta">${esc(shipment.carrier || 'Naviera pendiente')} · ${esc(shipment.bol_number ? `B/L ${shipment.bol_number}` : 'B/L pendiente')} · ${esc(shipment.shipment_last_status || shipment.shipment_operational_status || 'Tracking activo')}</div></div>${shipment.operation_id ? pill('Expediente creado','confirmed') : pill('Expediente pendiente','warn')}</div>
        <div class="sales-ws-doc-checks">
          <div class="sales-ws-doc-check"><span>Expediente</span>${shipment.operation_id ? pill(op?.operation_code || 'Creado','confirmed') : pill('Pendiente','warn')}</div>
          <div class="sales-ws-doc-check"><span>Packing List aduanal</span>${shipment.operation_id && status.hasPackingList ? pill('Cargado','confirmed') : pill('Pendiente','warn')}</div>
          <div class="sales-ws-doc-check"><span>Commercial Invoice aduanal</span>${shipment.operation_id && status.hasCommercialInvoice ? pill('Cargada','confirmed') : pill('Pendiente','warn')}</div>
        </div><div class="sales-ws-actions">${shipment.operation_id ? `<button class="btn primary" data-ws-action="open_expediente" data-ws-id="${esc(shipment.operation_id)}">Abrir Expediente</button>` : `<button class="btn orange" data-ws-action="create_expediente" data-ws-id="${esc(shipment.shipment_id)}">Crear Expediente</button>`}<button class="btn" data-ws-action="open_tracking" data-ws-id="${esc(shipment.shipment_id)}">Ver Tracking</button></div></div>`;
    }).join('')}</div>`;
  }

  function renderHistory() {
    const rows = state.data.history || [];
    return rows.length ? `<div class="sales-ws-history">${rows.map(row => `<div class="sales-ws-history-row"><b>${esc(row.action || 'Evento')}</b><div>${esc(row.entity_type || '')}${row.details ? `<div class="sales-ws-meta">${esc(typeof row.details === 'string' ? row.details : JSON.stringify(row.details))}</div>` : ''}</div><time>${esc(dateTime(row.created_at))}</time></div>`).join('')}</div>` : '<div class="sales-ws-empty">Todavía no hay eventos auditables relacionados.</div>';
  }

  function bindWorkspaceEvents() {
    byId('detailBody').querySelectorAll('[data-ws-tab]').forEach(button => button.onclick = () => {
      state.tab = button.dataset.wsTab;
      render();
    });
    byId('detailBody').querySelectorAll('[data-ws-action]').forEach(button => button.onclick = () => runAction(button.dataset.wsAction, button.dataset.wsId || ''));
  }

  async function runAction(action, id='') {
    try {
      if (action === 'tab_billing') { state.tab='billing'; render(); return; }
      if (action === 'confirm') return transitionSale('confirm');
      if (action === 'close') return transitionSale('close');
      if (action === 'create_load') return createLoad();
      if (action === 'link_load') return linkExistingLoad();
      if (action === 'open_load') return parentNavigation()?.openLoad?.({loadId:id});
      if (action === 'open_tracking') return parentNavigation()?.openTracking?.({shipmentId:id});
      if (action === 'open_wr') return parentNavigation()?.openInventoryReceipt?.(id);
      if (action === 'open_expediente') return parentNavigation()?.openExpediente?.(id);
      if (action === 'create_expediente') return createExpediente(id);
      if (action === 'new_invoice') return openInvoiceModal();
      if (action === 'assign_invoice_operation') return assignInvoiceOperation(id);
      if (action === 'issue_invoice') return issueInvoice(id);
      if (action === 'payment') return openPaymentModal(id);
      if (action === 'new_cost') return openCostModal();
    } catch (error) { showMessage(error.message); }
  }

  function showMessage(message, ok=false) {
    const node = byId('detailMsg');
    if (!node) return;
    node.className = `msg ${ok ? 'ok' : ''}`;
    node.textContent = message || '';
  }

  async function transitionSale(action) {
    const c = controller();
    if (!c?.transition) throw new Error('No está disponible la acción de Ventas.');
    const prompt = action === 'confirm' ? '¿Confirmar esta venta? Después sus líneas quedan bloqueadas.' : '¿Cerrar esta venta?';
    if (!confirm(prompt)) return;
    await c.transition(state.salesOrderId,action);
    await reload();
  }

  function createLoad() {
    const c = controller();
    if (!c?.createLoad) throw new Error('No está disponible Cargues desde Ventas.');
    byId('detailModal').classList.add('hidden');
    c.createLoad(state.salesOrderId);
  }

  function linkExistingLoad() {
    if (!window.SalesExistingLoadLink?.openForOrder) throw new Error('No está disponible la vinculación de Cargues.');
    byId('detailModal').classList.add('hidden');
    window.SalesExistingLoadLink.openForOrder(state.salesOrderId);
  }

  async function createExpediente(shipmentId) {
    const shipment = realContainerShipments().find(row => String(row.shipment_id) === String(shipmentId));
    const s = state.data.summary;
    if (!shipment) throw new Error('No hay un contenedor real asignado para crear el Expediente.');
    if (shipment.operation_id) return parentNavigation()?.openExpediente?.(shipment.operation_id);
    const existingOps = state.data.operations || [];
    if (existingOps.length) return openOperationChooser(shipment);
    if (!confirm(`¿Crear un Expediente para el contenedor ${shipment.container_number}?`)) return;
    const result = await request('/api/operations',{method:'POST',body:JSON.stringify({client_id:s.client_id,shipment_id:shipment.shipment_id,notes:`Creado desde ${s.so_number}`})});
    if (!result.operation?.id) throw new Error('No se pudo crear el Expediente.');
    await reload();
    parentNavigation()?.openExpediente?.(result.operation.id);
  }

  function ensureOperationChooser() {
    if (byId('salesWorkspaceOperationModal')) return;
    const modal = document.createElement('div');
    modal.id='salesWorkspaceOperationModal'; modal.className='modal hidden';
    modal.innerHTML='<div class="dialog"><div class="dialog-head"><div><h2>Expediente del contenedor</h2><div class="muted">Selecciona un Expediente ya relacionado con esta venta o crea uno nuevo.</div></div><button class="btn" data-ws-op-close>✕</button></div><div id="salesWorkspaceOperationBody"></div><div id="salesWorkspaceOperationMsg" class="msg"></div></div>';
    document.body.appendChild(modal);
    modal.querySelector('[data-ws-op-close]').onclick=()=>modal.classList.add('hidden');
    modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.add('hidden')});
  }

  function openOperationChooser(shipment) {
    ensureOperationChooser();
    const ops = state.data.operations || [];
    const body = byId('salesWorkspaceOperationBody');
    body.innerHTML=`<div class="sales-ws-list">${ops.map(op=>`<div class="sales-ws-row"><div class="sales-ws-row-title">${esc(op.operation_code || 'Expediente')}</div><div class="sales-ws-meta">${esc(statusLabel(op.status))}</div><div class="sales-ws-actions"><button class="btn primary" data-choose-op="${esc(op.id)}">Usar este Expediente</button></div></div>`).join('')}</div><div class="sales-ws-actions" style="margin-top:12px"><button class="btn orange" id="salesWorkspaceCreateSeparateExp">Crear Expediente nuevo</button></div>`;
    body.querySelectorAll('[data-choose-op]').forEach(button=>button.onclick=async()=>{
      try{
        await request('/api/operations',{method:'PATCH',body:JSON.stringify({action:'assign_shipment',operation_id:button.dataset.chooseOp,shipment_id:shipment.shipment_id})});
        byId('salesWorkspaceOperationModal').classList.add('hidden');
        await reload();
      }catch(error){byId('salesWorkspaceOperationMsg').textContent=error.message}
    });
    byId('salesWorkspaceCreateSeparateExp').onclick=async()=>{
      try{
        const result=await request('/api/operations',{method:'POST',body:JSON.stringify({client_id:state.data.summary.client_id,shipment_id:shipment.shipment_id,notes:`Creado desde ${state.data.summary.so_number}`})});
        byId('salesWorkspaceOperationModal').classList.add('hidden');
        await reload();
        if(result.operation?.id)parentNavigation()?.openExpediente?.(result.operation.id);
      }catch(error){byId('salesWorkspaceOperationMsg').textContent=error.message}
    };
    byId('salesWorkspaceOperationMsg').textContent='';
    byId('salesWorkspaceOperationModal').classList.remove('hidden');
  }

  function ensureInvoiceModal() {
    if (byId('salesWorkspaceInvoiceModal')) return;
    const modal=document.createElement('div');modal.id='salesWorkspaceInvoiceModal';modal.className='modal hidden';
    modal.innerHTML=`<div class="dialog"><div class="dialog-head"><div><h2>Nueva factura de cobro al cliente</h2><div class="muted">Crea el borrador financiero de esta venta. El Expediente es opcional mientras sea borrador y obligatorio antes de emitir.</div></div><button class="btn" data-ws-invoice-close>✕</button></div><div class="sales-ws-modal-grid"><div><label>Fecha de factura</label><input id="wsInvoiceDate" type="date"></div><div><label>Vencimiento</label><input id="wsInvoiceDue" type="date"></div><div class="full"><label>Expediente</label><select id="wsInvoiceOperation"></select><div class="sales-ws-helper">Puedes dejarlo pendiente y crear el borrador. Antes de emitir tendrás que asignar un Expediente del mismo cliente.</div></div><div class="full"><label>Mercancía a facturar</label><div id="wsInvoiceLines" class="sales-ws-list"></div></div><div class="full"><label>Nota opcional</label><input id="wsInvoiceNotes"></div></div><div class="sales-ws-form-actions"><button class="btn" data-ws-invoice-close>Cancelar</button><button id="wsSaveInvoice" class="btn primary">Guardar borrador</button></div><div id="wsInvoiceMsg" class="msg"></div></div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-ws-invoice-close]').forEach(button=>button.onclick=()=>modal.classList.add('hidden'));
    modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.add('hidden')});
    byId('wsSaveInvoice').onclick=saveInvoiceDraft;
  }

  function openInvoiceModal() {
    ensureInvoiceModal();
    const items=(state.data.items || []).filter(item=>num(item.invoicing?.available_to_invoice_quantity)>0);
    if(!items.length)throw new Error('No hay mercancía disponible para facturar.');
    const operations=state.data.operations || [];
    byId('wsInvoiceDate').value=today();byId('wsInvoiceDue').value='';byId('wsInvoiceNotes').value='';byId('wsInvoiceMsg').textContent='';
    byId('wsInvoiceOperation').innerHTML='<option value="">Expediente pendiente</option>'+operations.map(op=>`<option value="${esc(op.id)}">${esc(op.operation_code || 'Expediente')}</option>`).join('');
    byId('wsInvoiceLines').innerHTML=items.map(item=>`<div class="sales-ws-row" data-ws-invoice-line="${esc(item.id)}"><div class="sales-ws-row-title">${esc(item.product?.sku ? item.product.sku+' · ' : '')}${esc(item.product?.name || 'Producto')}</div><div class="sales-ws-meta">Disponible ${fmt(item.invoicing?.available_to_invoice_quantity)} ${esc(item.unit)} · Precio de la venta ${money(item.unit_price,state.data.summary.sales_currency)}</div><label>Cantidad a facturar</label><input data-ws-invoice-qty type="number" min="0" max="${esc(item.invoicing?.available_to_invoice_quantity)}" step="any" value="${esc(item.invoicing?.available_to_invoice_quantity)}"></div>`).join('');
    byId('salesWorkspaceInvoiceModal').classList.remove('hidden');
  }

  async function saveInvoiceDraft() {
    const button=byId('wsSaveInvoice');const msg=byId('wsInvoiceMsg');button.disabled=true;msg.textContent='';
    try{
      const lines=[...document.querySelectorAll('[data-ws-invoice-line]')].map(row=>({sales_order_item_id:row.dataset.wsInvoiceLine,quantity:row.querySelector('[data-ws-invoice-qty]').value,notes:null})).filter(line=>num(line.quantity)>0);
      if(!lines.length)throw new Error('Indica al menos una cantidad a facturar.');
      await request('/api/invoices',{method:'POST',body:JSON.stringify({action:'create_plan',sales_order_id:state.salesOrderId,operation_id:byId('wsInvoiceOperation').value || null,issue_date:byId('wsInvoiceDate').value || null,due_date:byId('wsInvoiceDue').value || null,notes:byId('wsInvoiceNotes').value || null,lines})});
      byId('salesWorkspaceInvoiceModal').classList.add('hidden');state.tab='billing';await reload();
    }catch(error){msg.textContent=error.message}finally{button.disabled=false}
  }

  function selectOperationForInvoice(invoice) {
    const ops=state.data.operations || [];
    if(!ops.length)throw new Error('Primero crea un Expediente para uno de los contenedores de esta venta.');
    if(ops.length===1)return Promise.resolve(ops[0].id);
    return new Promise(resolve=>{
      ensureOperationChooser();
      const body=byId('salesWorkspaceOperationBody');
      body.innerHTML=`<div class="sales-ws-callout info">Selecciona el Expediente que corresponde a ${esc(invoice.invoice_number)}.</div><div class="sales-ws-list" style="margin-top:10px">${ops.map(op=>`<button type="button" class="btn" data-invoice-op="${esc(op.id)}">${esc(op.operation_code || 'Expediente')}</button>`).join('')}</div>`;
      body.querySelectorAll('[data-invoice-op]').forEach(button=>button.onclick=()=>{byId('salesWorkspaceOperationModal').classList.add('hidden');resolve(button.dataset.invoiceOp)});
      byId('salesWorkspaceOperationModal').classList.remove('hidden');
    });
  }

  async function assignInvoiceOperation(invoiceId) {
    const invoice=(state.data.billing?.invoices || []).find(row=>String(row.id)===String(invoiceId));
    if(!invoice || invoice.status!=='draft')throw new Error('Factura en borrador no encontrada.');
    const operationId=await selectOperationForInvoice(invoice);
    if(!operationId)return;
    const lines=(invoice.items || []).map(item=>({sales_order_item_id:item.sales_order_item_id,quantity:item.quantity,notes:item.notes || null}));
    await request('/api/invoices',{method:'POST',body:JSON.stringify({action:'replace_plan',invoice_id:invoice.id,sales_order_id:state.salesOrderId,operation_id:operationId,issue_date:invoice.issue_date,due_date:invoice.due_date,notes:invoice.notes || null,lines})});
    state.tab='billing';await reload();showMessage('Expediente asignado a la factura.',true);
  }

  async function issueInvoice(invoiceId) {
    const invoice=(state.data.billing?.invoices || []).find(row=>String(row.id)===String(invoiceId));
    if(!invoice || invoice.status!=='draft')throw new Error('Factura en borrador no encontrada.');
    if(!invoice.operation_id)throw new Error('Asigna un Expediente antes de emitir la factura.');
    if(!confirm(`¿Emitir ${invoice.invoice_number}? Después sus líneas quedan bloqueadas.`))return;
    await request('/api/invoices',{method:'POST',body:JSON.stringify({action:'issue',invoice_id:invoice.id})});
    state.tab='billing';await reload();showMessage('Factura emitida.',true);
  }

  function ensurePaymentModal() {
    if(byId('salesWorkspacePaymentModal'))return;
    const modal=document.createElement('div');modal.id='salesWorkspacePaymentModal';modal.className='modal hidden';
    modal.innerHTML=`<div class="dialog"><div class="dialog-head"><div><h2>Registrar cobro</h2><div id="wsPaymentSubtitle" class="muted"></div></div><button class="btn" data-ws-payment-close>✕</button></div><div class="sales-ws-modal-grid"><div><label>Monto</label><input id="wsPaymentAmount" type="number" min="0" step="0.01"></div><div><label>Fecha</label><input id="wsPaymentDate" type="date"></div><div><label>Método</label><select id="wsPaymentMethod"><option value="wire">Wire</option><option value="ach">ACH</option><option value="cash">Efectivo</option><option value="check">Cheque</option><option value="other">Otro</option></select></div><div><label>Referencia</label><input id="wsPaymentReference"></div><div class="full"><label>Nota opcional</label><input id="wsPaymentNotes"></div></div><div class="sales-ws-form-actions"><button class="btn" data-ws-payment-close>Cancelar</button><button id="wsSavePayment" class="btn orange">Registrar cobro</button></div><div id="wsPaymentMsg" class="msg"></div></div>`;
    document.body.appendChild(modal);modal.querySelectorAll('[data-ws-payment-close]').forEach(button=>button.onclick=()=>modal.classList.add('hidden'));modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.add('hidden')});
  }

  function openPaymentModal(invoiceId) {
    ensurePaymentModal();const invoice=(state.data.billing?.invoices || []).find(row=>String(row.id)===String(invoiceId));
    if(!invoice || invoice.status!=='issued')throw new Error('Solo se cobran facturas emitidas.');
    const balance=num(invoice.financial?.balance_due);if(balance<=0)throw new Error('Esta factura no tiene saldo pendiente.');
    byId('wsPaymentSubtitle').textContent=`${invoice.invoice_number} · Saldo ${money(balance,invoice.currency)}`;byId('wsPaymentAmount').value=String(balance);byId('wsPaymentAmount').max=String(balance);byId('wsPaymentDate').value=today();byId('wsPaymentMethod').value='wire';byId('wsPaymentReference').value='';byId('wsPaymentNotes').value='';byId('wsPaymentMsg').textContent='';
    byId('wsSavePayment').onclick=()=>savePayment(invoice.id);byId('salesWorkspacePaymentModal').classList.remove('hidden');
  }

  async function savePayment(invoiceId) {
    const invoice=(state.data.billing?.invoices || []).find(row=>String(row.id)===String(invoiceId));const button=byId('wsSavePayment');const msg=byId('wsPaymentMsg');button.disabled=true;msg.textContent='';
    try{
      const amount=num(byId('wsPaymentAmount').value);if(amount<=0)throw new Error('El monto debe ser mayor que cero.');if(amount>num(invoice.financial?.balance_due))throw new Error('El monto supera el saldo pendiente.');
      await request('/api/invoice-payments',{method:'POST',body:JSON.stringify({action:'register',invoice_id:invoice.id,amount,payment_date:byId('wsPaymentDate').value || null,method:byId('wsPaymentMethod').value || null,reference_number:byId('wsPaymentReference').value || null,notes:byId('wsPaymentNotes').value || null})});
      byId('salesWorkspacePaymentModal').classList.add('hidden');state.tab='billing';await reload();showMessage('Cobro registrado.',true);
    }catch(error){msg.textContent=error.message}finally{button.disabled=false}
  }

  function ensureCostModal() {
    if(byId('salesWorkspaceCostModal'))return;
    const modal=document.createElement('div');modal.id='salesWorkspaceCostModal';modal.className='modal hidden';
    modal.innerHTML=`<div class="dialog"><div class="dialog-head"><div><h2>Agregar gasto directo</h2><div class="muted">Este gasto quedará contabilizado y vinculado explícitamente a esta venta o a uno de sus productos. Los gastos generales de la compañía no se registran aquí.</div></div><button class="btn" data-ws-cost-close>✕</button></div><div class="sales-ws-modal-grid"><div><label>Tipo de gasto</label><select id="wsCostCategory">${COST_CATEGORIES.map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join('')}</select></div><div><label>Etapa</label><select id="wsCostStage">${COST_STAGES.map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join('')}</select></div><div><label>Monto</label><input id="wsCostAmount" type="number" min="0" step="0.01"></div><div><label>Moneda</label><input id="wsCostCurrency" maxlength="3"></div><div><label>Fecha</label><input id="wsCostDate" type="date"></div><div><label>Aplicar a</label><select id="wsCostTarget"></select></div><div class="full"><label>Referencia</label><input id="wsCostReference" placeholder="Factura, wire, proveedor o referencia"></div><div class="full"><label>Nota opcional</label><input id="wsCostNotes"></div></div><div class="sales-ws-helper">Si registras una moneda diferente a la venta, el ERP la conserva pero no inventará un tipo de cambio; la contribución quedará “no comparable” hasta que exista una regla de FX explícita.</div><div class="sales-ws-form-actions"><button class="btn" data-ws-cost-close>Cancelar</button><button id="wsSaveCost" class="btn orange">Guardar gasto</button></div><div id="wsCostMsg" class="msg"></div></div>`;
    document.body.appendChild(modal);modal.querySelectorAll('[data-ws-cost-close]').forEach(button=>button.onclick=()=>modal.classList.add('hidden'));modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.add('hidden')});byId('wsSaveCost').onclick=saveCost;
  }

  function openCostModal() {
    ensureCostModal();const s=state.data.summary;const items=state.data.items || [];
    byId('wsCostCategory').value='domestic_trucking';byId('wsCostStage').value='fulfillment';byId('wsCostAmount').value='';byId('wsCostCurrency').value=s.sales_currency || 'USD';byId('wsCostDate').value=today();byId('wsCostReference').value='';byId('wsCostNotes').value='';byId('wsCostMsg').textContent='';
    byId('wsCostTarget').innerHTML=`<option value="so:${esc(state.salesOrderId)}">Toda la venta · ${esc(s.so_number)}</option>`+items.map(item=>`<option value="item:${esc(item.id)}">${esc(item.product?.sku ? item.product.sku+' · ' : '')}${esc(item.product?.name || 'Producto')}</option>`).join('');
    byId('salesWorkspaceCostModal').classList.remove('hidden');
  }

  async function saveCost() {
    const button=byId('wsSaveCost');const msg=byId('wsCostMsg');button.disabled=true;msg.textContent='';
    try{
      const amount=num(byId('wsCostAmount').value);if(amount<=0)throw new Error('Indica un monto mayor que cero.');
      const currency=String(byId('wsCostCurrency').value || '').trim().toUpperCase();if(!/^[A-Z]{3}$/.test(currency))throw new Error('La moneda debe tener tres letras.');
      const [targetType,targetId]=String(byId('wsCostTarget').value || '').split(':');if(!targetId)throw new Error('Selecciona a qué pertenece el gasto.');
      const allocation={amount,basis:'manual',notes:byId('wsCostNotes').value || null};
      if(targetType==='item')allocation.sales_order_item_id=targetId;else allocation.sales_order_id=targetId;
      await request('/api/costs',{method:'POST',body:JSON.stringify({action:'create_posted',category:byId('wsCostCategory').value,stage:byId('wsCostStage').value,amount,currency,incurred_date:byId('wsCostDate').value || null,reference:byId('wsCostReference').value || null,notes:byId('wsCostNotes').value || null,allocations:[allocation]})});
      byId('salesWorkspaceCostModal').classList.add('hidden');state.tab='costs';await reload();showMessage('Gasto contabilizado y aplicado a la venta.',true);
    }catch(error){msg.textContent=error.message}finally{button.disabled=false}
  }

  window.SalesWorkspace = Object.freeze({ open, reload, owner:'sales-workspace.js' });
})();