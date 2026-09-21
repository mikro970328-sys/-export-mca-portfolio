// Test scaffolding only. This file is never loaded by the production shell.
(() => {
  const blocked = new Set(['adminsSection']);
  const sample = {
    generated_at:'2026-09-21T14:30:00Z',
    stats:{clients:24,products:36,suppliers:12,active:8,in_transit:5},
    warehouse_receipts:{received:14,total:29},loads:{active:4,dispatched:9},
    inventory:{products_with_stock:18,available_quantity:1240,available_pallets:32,reserved_pallets:6},
    work_attention:{tasks:{open:7,blocked:1,overdue:0,routing:0},alerts:{active:2,critical:0}},
    recent_activity:[
      {id:'qa-shipment-1',container_number:'DEMO 000001',client_name:'Cliente ficticio A',operational_status:'En tránsito',updated_at:'2026-09-21T13:45:00Z'},
      {id:'qa-shipment-2',container_number:'DEMO 000002',client_name:'Cliente ficticio B',operational_status:'Preparando carga',updated_at:'2026-09-21T12:30:00Z'}
    ],
    executive:{period:{},exceptions:{overdue_ar_count:2},activity_by_currency:[
      {currency:'USD',issued_sales:12500,issued_invoice_count:5,booked_sales_order_value:15400,so_confirmed_count:6,po_committed_value:8700,po_committed_count:3,cash_collected:9800,cash_paid:6200,net_cash_flow:3600,customer_payment_count:3,supplier_payment_count:2,margin_eligible_invoice_count:4,gross_margin:3200,gross_margin_pct:25.6,recognized_cogs:9300,contribution_eligible_order_count:4,contribution_margin:2700,contribution_margin_pct:21.6,contribution_direct_cost:500},
      {currency:'EUR',issued_sales:2400,issued_invoice_count:2,net_cash_flow:-150,margin_incomplete_invoice_count:2,contribution_incomplete_order_count:2}
    ],balances_by_currency:[{currency:'USD',ar_balance:2700,ap_balance:2500,open_ar_invoice_count:2,overdue_ar_count:2,open_ap_bill_count:1},{currency:'EUR',ar_balance:800,ap_balance:950,open_ar_invoice_count:1,open_ap_bill_count:1}]},
    filter_options:{currencies:['USD','EUR'],capabilities:{clients:true,suppliers:true,products:true},clients:[{id:'qa-client',name:'Cliente ficticio A'}],suppliers:[{id:'qa-supplier',name:'Proveedor ficticio'}],products:[{id:'qa-product',name:'Producto ficticio',sku:'DEMO-1'}]}
  };
  let lastRequest = '';
  let lastEntity = null;
  const copy = () => JSON.parse(JSON.stringify(sample));
  const byId = id => document.getElementById(id);
  const all = selector => [...document.querySelectorAll(selector)];
  const search = value => {
    byId('navigationSearch').value = value;
    byId('navigationSearch').dispatchEvent(new Event('input', {bubbles:true}));
  };
  const visibleSections = () => all('.sidebar-nav [data-section]').filter(button => button.getClientRects().length > 0);
  const applyPermissions = () => {
    all('[data-section]').forEach(button => button.classList.toggle('hidden', blocked.has(button.dataset.section)));
    all('.nav-group').forEach(group => group.classList.toggle('hidden', !group.querySelector('[data-section]:not(.hidden)')));
  };
  // All simulations are confined to this fixture; no production API is called.
  window.ExportMcaAccessControl = {can:()=>true,sectionAllowed:id=>!blocked.has(id)};
  window.api = async path => {
    if (!path.startsWith('/api/dashboard')) throw Error('Fixture refuses non-dashboard calls');
    lastRequest = path;
    const data = copy();
    data.executive.period = Object.fromEntries(new URL(path, 'https://fixture.invalid').searchParams);
    const currency = data.executive.period.currency;
    if (currency) for (const key of ['activity_by_currency','balances_by_currency']) data.executive[key] = data.executive[key].filter(row => row.currency === currency);
    return data;
  };
  window.showSection = id => {
    if (blocked.has(id)) return false;
    all('.app-section').forEach(section => section.classList.toggle('hidden', section.id !== id));
    all('[data-section]').forEach(button => button.classList.toggle('active', button.dataset.section === id));
    byId('pageTitle').textContent = document.querySelector(`[data-section="${id}"]`)?.dataset.navLabel || id;
    window.dispatchEvent(new CustomEvent('export-mca:section-changed', {detail:{id}}));
    window.scrollTo({top:0});
    return true;
  };
  window.OperationalNavigation = {openEntity:entity=>{lastEntity=entity;}};

  async function runChecks() {
    const results = [];
    const check = (condition, label) => { if (!condition) throw Error(label); results.push(`✓ ${label}`); };
    try {
      reset();
      if (innerWidth <= 900) window.NavigationShell.toggle();
      const beforeGroups = localStorage.getItem('export_mca_nav_groups');
      search('  FACTURACION  ');
      check(visibleSections().length === 1 && visibleSections()[0].dataset.section === 'invoicesSection', 'Búsqueda sin acentos, mayúsculas ni espacios exteriores');
      check(localStorage.getItem('export_mca_nav_groups') === beforeGroups, 'Buscar no altera grupos guardados');
      search('logistica');
      check(visibleSections().length === 3, 'Buscar por grupo encuentra sus tres secciones');
      search('Administradores');
      check(visibleSections().length === 0 && byId('navigationSearchStatus').textContent.startsWith('No hay'), 'Una sección restringida nunca aparece como resultado');
      check(document.querySelector('[data-section="adminsSection"]').classList.contains('hidden'), 'Se conserva la clase de permisos del owner de Accesos');
      search('ninguna-coincidencia');
      byId('navigationSearch').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
      check(byId('navigationSearch').value === '' && !document.querySelector('.nav-search-miss'), 'Escape limpia la búsqueda');
      if (innerWidth <= 900) {
        check(byId('sidebar').classList.contains('mobile-open'), 'Primer Escape conserva el menú móvil abierto');
        window.dispatchEvent(new CustomEvent('export-mca:section-changed', {detail:{id:'dashboardSection',source:'startup'}}));
        check(byId('sidebar').classList.contains('mobile-open'), 'La restauración inicial no cierra el menú móvil');
      }
      search('Ventas');
      visibleSections()[0].click();
      check(!byId('salesSection').classList.contains('hidden'), 'El resultado abre el destino original Ventas');
      check(byId('navigationSearch').value === '', 'Navegar restaura el menú completo');
      check(byId('pageContext').textContent === 'Comercial', 'El encabezado muestra el grupo activo');
      check(document.querySelectorAll('[aria-current="page"]').length === 1, 'Solo una sección está marcada como actual');
      if (innerWidth <= 900) check(!byId('sidebar').classList.contains('mobile-open'), 'Navegar cierra el menú móvil');
      else {
        search('compras');
        window.NavigationShell.collapse();
        check(byId('navigationSearch').value === '' && !document.querySelector('.nav-search-miss'), 'Contraer no deja resultados ocultando el menú');
        window.NavigationShell.expand();
      }
      window.showSection('dashboardSection');
      check(document.querySelector('.executive-priority-grid').compareDocumentPosition(document.querySelector('.executive-operation')) & Node.DOCUMENT_POSITION_FOLLOWING, 'Prioridades antes de los indicadores de catálogo');
      check(all('.executive-currency-panel').length === 2 && all('.executive-metric').length === 24, 'Se conservan 12 indicadores por moneda, sin sumarlas');
      const details = all('[data-dashboard-detail]');
      check(details.every(node => !node.open), 'Filtros y desglose financiero están cerrados inicialmente');
      const usd = document.querySelector('[data-dashboard-detail="finance:USD"]');
      usd.open = true;
      byId('dashboardCurrency').value = 'USD';
      byId('dashboardClient').value = 'qa-client';
      document.querySelector('[data-dashboard-detail="filters"]').open = true;
      await window.ExecutiveDashboard.refresh();
      check(lastRequest.includes('currency=USD') && lastRequest.includes('client_id=qa-client'), 'Se envían los filtros al endpoint existente');
      check(all('.executive-currency-panel').length === 1 && all('.executive-metric').length === 12, 'Se presenta la moneda devuelta por la API simulada');
      check(document.querySelector('[data-dashboard-detail="finance:USD"]').open && document.querySelector('[data-dashboard-detail="filters"]').open, 'Actualizar conserva los desplegables abiertos');
      check(byId('dashboardClient').value === 'qa-client', 'Actualizar conserva el cliente seleccionado');
      document.querySelector('[data-dashboard-detail="finance:USD"]').open = false;
      window.renderDashboardDetails();
      check(!document.querySelector('[data-dashboard-detail="finance:USD"]').open, 'Actualizar también conserva los desplegables cerrados');
      await window.ExecutiveDashboard.refresh({});
      const eur = all('.executive-currency-panel').find(panel => panel.querySelector('h3').textContent === 'EUR');
      check(eur.querySelector('.negative strong').textContent.includes('150'), 'Flujo negativo mantiene el importe del backend');
      check(eur.textContent.includes('No disponible'), 'Sin rentabilidad elegible no se inventa margen');
      document.querySelector('[data-dashboard-shipment]').click();
      check(lastEntity?.type === 'shipment' && lastEntity.id === 'qa-shipment-1', 'Tracking conserva su navegación por entidad');
      const payload = copy(), before = JSON.stringify(payload);
      window.renderStats(payload);
      check(JSON.stringify(payload) === before, 'Presentar no modifica el payload financiero');
      window.renderStats({executive:{},filter_options:{}});
      check(byId('dashboardSection').textContent.includes('No hay movimientos financieros') && !byId('dashboardClient'), 'Estados vacíos y capacidades de filtros restringidas');
      const unsafe = copy();
      unsafe.recent_activity[0].client_name = '<img src=x onerror=alert(1)>';
      window.renderStats(unsafe);
      check(!document.querySelector('.executive-activity-list img'), 'El contenido del cliente se escapa como texto');
      reset();
      check(document.documentElement.scrollWidth <= innerWidth, `Sin desbordamiento horizontal (${innerWidth} px)`);
      byId('qaResults').textContent = `${results.length} comprobaciones aprobadas\n${results.join('\n')}`;
      byId('qaResults').dataset.result = 'passed';
    } catch(error) {
      byId('qaResults').textContent = `${results.join('\n')}\n✗ ${error.message}`;
      byId('qaResults').dataset.result = 'failed';
    }
  }

  function reset() {
    search('');
    all('[data-dashboard-detail]').forEach(node => {node.open=false;});
    window.renderStats(copy());
    window.showSection('dashboardSection');
    window.NavigationShell.expand();
    byId('qaResults').textContent = '';
    delete byId('qaResults').dataset.result;
  }

  window.addEventListener('load', () => {
      applyPermissions();
      all('.sidebar-nav [data-section]').forEach(button => {
        if (!button.onclick) button.addEventListener('click', () => window.showSection(button.dataset.section));
      });
      window.ExportMcaIcons.hydrate(document);
      byId('currentUser').textContent = 'Operador de prueba';
      byId('currentRole').textContent = 'Datos simulados';
      byId('exportCsv')?.remove();
      byId('logout')?.remove();
      byId('refresh').addEventListener('click', () => window.ExecutiveDashboard.refresh());
      byId('qaRun').addEventListener('click', runChecks);
      byId('qaReset').addEventListener('click', reset);
      reset();
  });
})();
