(() => {
  'use strict';
  if (window.__executiveDashboardInstalled) return;
  window.__executiveDashboardInstalled = true;

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const state = { data:null, loading:false, filters:{ start_date:'',end_date:'',currency:'',client_id:'',supplier_id:'',product_id:'' } };

  const number = value => new Intl.NumberFormat('es-US',{maximumFractionDigits:2}).format(Number(value || 0));
  const integer = value => new Intl.NumberFormat('es-US',{maximumFractionDigits:0}).format(Number(value || 0));
  const percent = value => value === null || value === undefined ? '—' : `${new Intl.NumberFormat('es-US',{minimumFractionDigits:1,maximumFractionDigits:2}).format(Number(value))}%`;
  const money = (value,currency) => {
    const amount=Number(value || 0);
    try { return new Intl.NumberFormat('es-US',{style:'currency',currency:String(currency||'USD').toUpperCase(),maximumFractionDigits:2}).format(amount); }
    catch { return `${number(amount)} ${String(currency||'').toUpperCase()}`.trim(); }
  };
  const dateLabel = value => {
    if(!value)return '—';
    const date=new Date(value);
    return Number.isNaN(date.getTime())?'—':date.toLocaleString('es-US',{dateStyle:'medium',timeStyle:'short'});
  };

  function currentPeriodLabel(executive={}) {
    const period=executive.period||{};
    if(period.start_date && period.end_date)return `${period.start_date} → ${period.end_date}`;
    if(period.start_date)return `Desde ${period.start_date}`;
    if(period.end_date)return `Hasta ${period.end_date}`;
    return 'Todo el histórico de actividad';
  }

  function optionRows(rows,labeler) {
    return (rows||[]).map(row=>`<option value="${esc(row.id)}">${esc(labeler(row))}</option>`).join('');
  }

  function filterBar(data) {
    const options=data.filter_options||{};
    const selected=state.filters;
    const capabilities=options.capabilities||{};
    return `<section class="executive-filter-card">
      <div class="executive-filter-head"><div><h2>Dashboard ejecutivo</h2><p>Actividad por período. AR y AP se muestran como saldos actuales.</p></div><div class="executive-filter-actions"><button type="button" class="alt" id="dashboardResetFilters">Limpiar</button><button type="button" id="dashboardApplyFilters">Aplicar filtros</button></div></div>
      <div class="executive-filters">
        <label>Desde<input id="dashboardStartDate" type="date" value="${esc(selected.start_date)}"></label>
        <label>Hasta<input id="dashboardEndDate" type="date" value="${esc(selected.end_date)}"></label>
        <label>Moneda<select id="dashboardCurrency"><option value="">Todas, separadas</option>${(options.currencies||[]).map(currency=>`<option value="${esc(currency)}" ${selected.currency===currency?'selected':''}>${esc(currency)}</option>`).join('')}</select></label>
        ${capabilities.clients?`<label>Cliente<select id="dashboardClient"><option value="">Todos</option>${optionRows(options.clients,row=>row.company?`${row.name} · ${row.company}`:row.name)}</select></label>`:''}
        ${capabilities.suppliers?`<label>Proveedor<select id="dashboardSupplier"><option value="">Todos</option>${optionRows(options.suppliers,row=>row.legal_name?`${row.name} · ${row.legal_name}`:row.name)}</select></label>`:''}
        ${capabilities.products?`<label>Producto<select id="dashboardProduct"><option value="">Todos</option>${optionRows(options.products,row=>[row.sku,row.name,row.brand].filter(Boolean).join(' · '))}</select></label>`:''}
      </div>
      <div class="executive-filter-basis"><span>Período: <b>${esc(currentPeriodLabel(data.executive))}</b></span><span>Base AR/AP: <b>snapshot actual</b></span><span>FX: <b>no se aplica</b></span></div>
    </section>`;
  }

  function metricCard(label,value,detail='',tone='') {
    return `<div class="executive-metric ${tone}"><span>${esc(label)}</span><strong>${value}</strong>${detail?`<small>${detail}</small>`:''}</div>`;
  }

  function financeByCurrency(data) {
    const executive=data.executive||{};
    const activity=executive.activity_by_currency||[];
    const balances=executive.balances_by_currency||[];
    const byBalance=new Map(balances.map(row=>[String(row.currency),row]));
    const currencies=[...new Set([...activity.map(row=>String(row.currency)),...balances.map(row=>String(row.currency))])].filter(Boolean).sort();
    if(!currencies.length)return '<section class="executive-section"><div class="executive-section-head"><div><h3>Finanzas por moneda</h3><p>No hay actividad financiera para los filtros seleccionados.</p></div></div><div class="executive-empty">Sin datos financieros para este período.</div></section>';

    const panels=currencies.map(currency=>{
      const a=activity.find(row=>String(row.currency)===currency)||{};
      const b=byBalance.get(currency)||{};
      const marginReady=Number(a.margin_eligible_invoice_count||0)>0;
      const contributionReady=Number(a.contribution_eligible_order_count||0)>0;
      const marginDetail=marginReady?`${integer(a.margin_eligible_invoice_count)} factura(s) elegible(s) · ${percent(a.gross_margin_pct)}`:`${integer(a.margin_incomplete_invoice_count||0)} factura(s) sin rentabilidad completa`;
      const contributionDetail=contributionReady?`${integer(a.contribution_eligible_order_count)} SO elegible(s) · ${percent(a.contribution_margin_pct)}`:`${integer(a.contribution_incomplete_order_count||0)} SO sin contribución comparable`;
      return `<article class="executive-currency-panel">
        <div class="executive-currency-head"><div><span>Moneda</span><h3>${esc(currency)}</h3></div><div class="executive-snapshot-chip">Sin conversión FX</div></div>
        <div class="executive-finance-grid">
          ${metricCard('Ventas emitidas',money(a.issued_sales,currency),`${integer(a.issued_invoice_count)} factura(s)`)}
          ${metricCard('Ventas confirmadas',money(a.booked_sales_order_value,currency),`${integer(a.so_confirmed_count)} SO confirmada(s)`)}
          ${metricCard('Compras comprometidas',money(a.po_committed_value,currency),`${integer(a.po_committed_count)} PO comprometida(s)`)}
          ${metricCard('Cobrado',money(a.cash_collected,currency),`${integer(a.customer_payment_count)} cobro(s)`,'positive')}
          ${metricCard('Pagado',money(a.cash_paid,currency),`${integer(a.supplier_payment_count)} pago(s)`)}
          ${metricCard('Flujo neto de caja',money(a.net_cash_flow,currency),'Calculado por backend con cash posted',Number(a.net_cash_flow||0)<0?'negative':'positive')}
          ${metricCard('AR actual',money(b.ar_balance,currency),`${integer(b.open_ar_invoice_count)} factura(s) abierta(s) · ${integer(b.overdue_ar_count)} vencida(s)`)}
          ${metricCard('AP actual',money(b.ap_balance,currency),`${integer(b.open_ap_bill_count)} cuenta(s) abierta(s) · ${integer(b.overdue_ap_count)} vencida(s)`)}
          ${metricCard('COGS reconocido',marginReady?money(a.recognized_cogs,currency):'No disponible',marginDetail)}
          ${metricCard('Margen bruto',marginReady?money(a.gross_margin,currency):'No disponible',marginDetail,marginReady&&Number(a.gross_margin||0)<0?'negative':'')}
          ${metricCard('Contribución',contributionReady?money(a.contribution_margin,currency):'No disponible',contributionDetail,contributionReady&&Number(a.contribution_margin||0)<0?'negative':'')}
          ${metricCard('Costos directos elegibles',contributionReady?money(a.contribution_direct_cost,currency):'No disponible',contributionDetail)}
        </div>
      </article>`;
    }).join('');
    return `<section class="executive-section"><div class="executive-section-head"><div><h3>Finanzas por moneda</h3><p>Los importes nunca se suman entre monedas.</p></div><button type="button" class="alt" data-dashboard-open="costs">Costos y rentabilidad</button></div><div class="executive-currency-list">${panels}</div></section>`;
  }

  function operationalSummary(data) {
    const task=data.work_attention?.tasks;
    const alerts=data.work_attention?.alerts;
    const cards=[
      ['Clientes activos',data.stats?.clients||0,'clients','Base comercial'],
      ['Productos activos',data.stats?.products||0,'products','Catálogo maestro'],
      ['Proveedores activos',data.stats?.suppliers||0,'suppliers','Abastecimiento'],
      ['Contenedores activos',data.stats?.active||0,'containers',`${integer(data.stats?.in_transit||0)} en tránsito`],
      ['WR recibidos',data.warehouse_receipts?.received||0,'warehouse',`${integer(data.warehouse_receipts?.total||0)} históricos`],
      ['Cargues activos',data.loads?.active||0,'loads',`${integer(data.loads?.dispatched||0)} despachados`],
      ['Productos con stock',data.inventory?.products_with_stock||0,'inventory',`${number(data.inventory?.available_quantity||0)} unidades disponibles`],
      ['Pallets disponibles',number(data.inventory?.available_pallets||0),'inventory',`${number(data.inventory?.reserved_pallets||0)} reservados`]
    ];
    if(task)cards.push(['Tareas abiertas',task.open,'tasks',`${integer(task.blocked)} bloqueadas · ${integer(task.overdue)} vencidas`]);
    if(alerts)cards.push(['Alertas activas',alerts.active,'alerts',`${integer(alerts.critical)} críticas`]);
    return `<section class="executive-section"><div class="executive-section-head"><div><h3>Operación actual</h3><p>Conteos derivados del estado actual del ERP.</p></div></div><div class="executive-ops-grid">${cards.map(([label,value,target,detail])=>`<button type="button" class="executive-op-card" data-dashboard-open="${target}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></button>`).join('')}</div></section>`;
  }

  function exceptionsPanel(data) {
    const financial=data.executive?.exceptions||{};
    const task=data.work_attention?.tasks;
    const alerts=data.work_attention?.alerts;
    const rows=[
      ['AR vencido',financial.overdue_ar_count||0,'invoices'],
      ['AP vencido',financial.overdue_ap_count||0,'payables'],
      ['Rentabilidad de factura incompleta',financial.invoice_profitability_incomplete_count||0,'costs'],
      ['Contribución de venta incompleta',financial.sales_order_contribution_incomplete_count||0,'costs'],
      ['Pagos proveedor sin aplicar',financial.supplier_unapplied_payment_count||0,'payables'],
      ['PO con exceso de recepción',financial.po_receipt_excess_count||0,'purchases'],
      ['PO con valor incompleto',financial.po_order_value_incomplete_count||0,'purchases'],
      ['SO con despacho parcial',financial.sales_order_partial_dispatch_count||0,'sales']
    ];
    if(task){ rows.push(['Tareas bloqueadas',task.blocked,'tasks'],['Tareas vencidas',task.overdue,'tasks'],['Routing incompatible',task.routing,'tasks']); }
    if(alerts)rows.push(['Alertas críticas',alerts.critical,'alerts']);
    const active=rows.filter(row=>Number(row[1]||0)>0);
    return `<section class="executive-section"><div class="executive-section-head"><div><h3>Excepciones que requieren atención</h3><p>Solo desviaciones; el trabajo normal permanece en Tareas.</p></div></div>${active.length?`<div class="executive-exception-list">${active.map(([label,value,target])=>`<button type="button" data-dashboard-open="${target}"><span>${esc(label)}</span><strong>${integer(value)}</strong></button>`).join('')}</div>`:'<div class="executive-empty">No hay excepciones activas en los indicadores disponibles.</div>'}</section>`;
  }

  function activityPanel(data) {
    const rows=data.recent_activity||[];
    return `<section class="executive-section"><div class="executive-section-head"><div><h3>Actividad logística reciente</h3><p>Últimos movimientos de contenedores registrados.</p></div><button type="button" class="alt" data-dashboard-open="containers">Ver tracking</button></div>${rows.length?`<div class="executive-activity-list">${rows.map(row=>`<button type="button" class="executive-activity-row" data-dashboard-shipment="${esc(row.id)}"><div><strong>${esc(row.container_number||'Sin número')}</strong><span>${esc(row.client_name||'Sin cliente')}</span></div><div><span>${esc(row.operational_status||'Registrado')}</span><small>${esc(dateLabel(row.updated_at))}</small></div></button>`).join('')}</div>`:'<div class="executive-empty">No hay actividad logística reciente.</div>'}</section>`;
  }

  function renderDashboard(data) {
    state.data=data;
    window.__lastDashboardPayload=data;
    const section=$('dashboardSection');
    if(!section)return;
    const executive=data.executive||{};
    const period=executive.period||{};
    state.filters={
      start_date:period.start_date||'',
      end_date:period.end_date||'',
      currency:period.currency||'',
      client_id:period.client_id||'',
      supplier_id:period.supplier_id||'',
      product_id:period.product_id||''
    };
    section.innerHTML=`<div class="executive-dashboard">${filterBar(data)}${financeByCurrency(data)}${operationalSummary(data)}${exceptionsPanel(data)}${activityPanel(data)}<div class="executive-generated">Actualizado ${esc(dateLabel(data.generated_at))} · Fuente financiera: ${esc(executive.owner||'public.executive_dashboard_rollup')}</div></div>`;
    restoreSelect('dashboardClient',state.filters.client_id);
    restoreSelect('dashboardSupplier',state.filters.supplier_id);
    restoreSelect('dashboardProduct',state.filters.product_id);
    bind();
  }

  function restoreSelect(id,value){ const node=$(id); if(node&&value)node.value=value; }

  function readFilters() {
    return {
      start_date:$('dashboardStartDate')?.value||'',
      end_date:$('dashboardEndDate')?.value||'',
      currency:$('dashboardCurrency')?.value||'',
      client_id:$('dashboardClient')?.value||'',
      supplier_id:$('dashboardSupplier')?.value||'',
      product_id:$('dashboardProduct')?.value||''
    };
  }

  function renderLoading() {
    const section=$('dashboardSection');
    if(!section || state.data)return;
    section.innerHTML='<section class="executive-section"><div class="executive-section-head"><div><h3>Cargando dashboard</h3><p>La plataforma ya está disponible. Estamos actualizando los indicadores ejecutivos.</p></div></div><div class="executive-empty">Cargando indicadores…</div></section>';
  }

  function renderError(error) {
    const section=$('dashboardSection');
    if(!section)return;
    const message=esc(error?.message||'No se pudo cargar el dashboard.');
    section.innerHTML=`<section class="executive-section"><div class="executive-section-head"><div><h3>Dashboard temporalmente no disponible</h3><p>${message}</p></div><button type="button" class="alt" id="dashboardRetry">Reintentar</button></div><div class="executive-empty">El resto del ERP sigue disponible desde el menú.</div></section>`;
    $('dashboardRetry')?.addEventListener('click',()=>reloadDashboard(state.filters));
  }

  async function reloadDashboard(filters=readFilters()) {
    if(state.loading)return false;
    state.loading=true;
    const button=$('dashboardApplyFilters');
    if(button)button.disabled=true;
    if(!state.data)renderLoading();
    try {
      const params=new URLSearchParams();
      Object.entries(filters).forEach(([key,value])=>{if(value)params.set(key,value);});
      const result=await window.api(`/api/dashboard${params.size?`?${params}`:''}`);
      renderDashboard(result);
      return true;
    } catch(error) {
      console.error('[executive dashboard]',error);
      renderError(error);
      return false;
    } finally {
      state.loading=false;
      if(button)button.disabled=false;
    }
  }

  function openTarget(target) {
    const shell=window.NavigationShell;
    const section=id=>typeof window.showSection==='function'&&window.showSection(id);
    if(target==='clients')return section('clientsSection');
    if(target==='products')return shell?.openProducts?.();
    if(target==='suppliers')return shell?.openSuppliers?.();
    if(target==='containers')return section('containersSection');
    if(target==='warehouse')return shell?.openWarehouse?.();
    if(target==='loads')return shell?.openLoads?.();
    if(target==='inventory')return shell?.openInventory?.();
    if(target==='tasks')return section('tasksSection');
    if(target==='alerts'){section('notificationsSection');return window.loadOperationalAlertCenter?.();}
    if(target==='sales')return shell?.openSales?.();
    if(target==='purchases')return shell?.openPurchases?.();
    if(target==='invoices')return shell?.openInvoices?.();
    if(target==='payables')return shell?.openPayables?.();
    if(target==='costs')return shell?.openCosts?.();
    return false;
  }

  function bind() {
    $('dashboardApplyFilters')?.addEventListener('click',()=>reloadDashboard());
    $('dashboardResetFilters')?.addEventListener('click',()=>reloadDashboard({start_date:'',end_date:'',currency:'',client_id:'',supplier_id:'',product_id:''}));
    document.querySelectorAll('#dashboardSection [data-dashboard-open]').forEach(button=>button.addEventListener('click',()=>openTarget(button.dataset.dashboardOpen)));
    document.querySelectorAll('#dashboardSection [data-dashboard-shipment]').forEach(button=>button.addEventListener('click',async()=>{
      try { await window.OperationalNavigation?.openEntity?.({type:'shipment',id:button.dataset.dashboardShipment}); }
      catch(error){ console.error('[dashboard shipment navigation]',error); }
    }));
  }

  function initializeOperationalDashboard() {
    if(state.data)bind();
    else renderLoading();
    return true;
  }

  window.renderDashboardDetails = () => state.data ? renderDashboard(state.data) : false;
  window.renderStats=renderDashboard;
  window.initializeOperationalDashboard=initializeOperationalDashboard;
  window.ExecutiveDashboard=Object.freeze({refresh:reloadDashboard,getState:()=>({...state}),owner:'dashboard-operational-state.js'});
})();