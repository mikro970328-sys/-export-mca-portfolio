import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(path,'utf8');
const assert = (condition,message) => { if(!condition) throw new Error(message); };

const migration=read('supabase/migrations/20260830223000_p11_executive_dashboard_profitability.sql');
const snapshotMigration=read('supabase/migrations/20260928232500_admin_dashboard_snapshot.sql');
const api=read('api/dashboard.js');
const index=read('admin/index.html');
const executiveApi=read('api/_executive-dashboard.js');
const ui=read('admin/dashboard-operational-state.js');
const css=read('admin/dashboard-executive.css');
const erp=read('admin/erp.js');
const dataLoader=read('admin/admin-data-loader.js');
const sectionState=read('admin/section-state.js');
const shellRuntime=read('admin/admin-shell-runtime.js');
const autoRefresh=read('admin/embedded-auto-refresh.js');
const accessAdministration=read('admin/access-control-administration.js');

assert(migration.includes('profitability.direct_cost_currency'), 'P11: source B8 no expone direct_cost_currency');
assert(migration.includes('profitability.contribution_margin'), 'P11: source B8 no expone contribution_margin');
assert(migration.includes('recognized_cogs'), 'P11: falta COGS reconocido backend');
assert(migration.includes('net_cash_flow'), 'P11: falta cash flow neto backend');
assert(migration.includes('coalesce(cc.cash_collected,0) - coalesce(sc.cash_paid,0) as net_cash_flow'), 'P11: net cash flow debe calcularse en DB');
assert(migration.includes('contribution_margin_pct'), 'P11: falta porcentaje de contribución backend');
assert(migration.includes('sales_order_contribution_incomplete_count'), 'P11: falta excepción de contribución incompleta');
assert(migration.includes("'balance_basis', 'current_snapshot'"), 'P11: AR/AP deben conservar semántica snapshot en backend');
assert(migration.includes('create or replace view public.executive_operational_attention'), 'P11: falta read model de P8/P9');
assert(migration.includes('operational_task_attention'), 'P11: tasks deben derivarse de P8');
assert(migration.includes('operational_alert_conditions'), 'P11: alertas deben derivarse del registry P9');
assert(migration.includes("n.alert_status in ('pending','snoozed')"), 'P11: active alerts no respetan lifecycle P9');
assert(migration.includes('with (security_invoker = true)'), 'P11: views deben ser security_invoker');
assert(migration.includes('revoke all on public.executive_operational_attention from public, anon, authenticated'), 'P11: view de atención no está cerrada');
assert(migration.includes('grant select on public.executive_operational_attention to service_role'), 'P11: falta grant service_role');
assert(migration.includes('revoke all on function public.executive_dashboard_rollup'), 'P11: RPC debe seguir cerrado');
assert(migration.includes('grant execute on function public.executive_dashboard_rollup') && migration.includes('to service_role'), 'P11: RPC no está reservado a service_role');

assert(snapshotMigration.toLowerCase().includes('create or replace function public.admin_dashboard_snapshot'), 'P11: falta el snapshot de dashboard');
assert(snapshotMigration.toLowerCase().includes('revoke all on function public.admin_dashboard_snapshot'), 'P11: snapshot debe estar cerrado a clientes');
assert(snapshotMigration.toLowerCase().includes('grant execute on function public.admin_dashboard_snapshot') && snapshotMigration.toLowerCase().includes('to service_role'), 'P11: snapshot debe reservarse al servidor');
assert(api.includes("authorizeAdmin(req,res,'dashboard.read')"), 'P11: dashboard API debe revalidar dashboard.read');
assert(api.includes("supabase('admin_effective_permissions'"), 'P11: el dashboard debe leer permisos una sola vez');
assert(api.includes("can('clients.read')") && api.includes("can('procurement.read')"), 'P11: opciones de filtro deben respetar permisos');
assert(api.includes("can('tasks.read')") && api.includes("can('notifications.read')"), 'P11: atención debe respetar permisos');
assert(api.includes('rpc/admin_dashboard_snapshot'), 'P11: overview debe venir del snapshot consolidado');
assert(!/supabase\('(clients|products|suppliers|shipments|operations|warehouse_receipts|loads|warehouses|inventory_source_balances|documents|executive_operational_attention|executive_(invoice|sales_order|purchase_order|supplier_bill)_kpi_source)'/.test(api), 'P11: la ruta no debe descargar filas para agregarlas en JavaScript');
const financialApi=read('api/dashboard-financial.js');
assert(!api.includes('loadExecutiveDashboard('), 'P11: el resumen financiero no debe bloquear la ruta operativa');
assert(financialApi.includes("authorizeAdmin(req,res,'dashboard.read')"), 'P11: finanzas deben revalidar dashboard.read');
assert(financialApi.includes("rpc/executive_dashboard_rollup") || executiveApi.includes("rpc/executive_dashboard_rollup"), 'P11: finanzas deben conservar el RPC B8');
assert(ui.includes('/api/dashboard-financial'), 'P11: la UI debe cargar finanzas por la ruta asíncrona');
assert(ui.includes('const period=executive?.period||{};'), 'P11: filtros deben renderizar aunque finanzas sigan cargando');
assert(api.includes('...overview'), 'P11: el contrato del dashboard debe conservar los datos de overview');
assert(executiveApi.includes("rpc/executive_dashboard_rollup"), 'P11: finanzas no delegan al RPC B8');

const dashboardMarkup=index.slice(index.indexOf('<section id="dashboardSection"'),index.indexOf('</section>',index.indexOf('<section id="dashboardSection"')));
assert(dashboardMarkup.includes('role="status"') && dashboardMarkup.includes('Cargando dashboard'), 'P11: la carga del dashboard debe pintar estado inicial sin esperar JavaScript');
assert(!/expediente/i.test(ui), 'P11: Dashboard no puede reintroducir Expedientes');
assert(!ui.includes('newOperationsSection'), 'P11: Dashboard no puede navegar a legacy operations');
assert(!ui.includes('MutationObserver'), 'P11: Dashboard no puede usar MutationObserver');
assert(!ui.match(/\b(prompt|alert|confirm)\s*\(/), 'P11: Dashboard no puede usar prompt/alert/confirm');
assert(!ui.includes("document.createElement('style')") && !ui.includes('document.createElement("style")'), 'P11: estilos deben tener owner CSS, no inyección JS');
assert(ui.includes('a.net_cash_flow'), 'P11: UI no consume net_cash_flow backend');
assert(ui.includes('a.recognized_cogs'), 'P11: UI no consume COGS backend');
assert(ui.includes('a.contribution_margin'), 'P11: UI no consume contribución backend');
assert(!/cash_collected\s*[-+]\s*.*cash_paid|cash_paid\s*[-+]\s*.*cash_collected/.test(ui), 'P11: cash flow no puede recalcularse en frontend');
assert(!/gross_margin\s*\/|contribution_margin\s*\//.test(ui), 'P11: porcentajes financieros no pueden recalcularse en frontend');
assert(ui.includes('OperationalNavigation?.openEntity'), 'P11: tracking debe delegar navegación a P6');
assert(ui.includes('NavigationShell'), 'P11: módulos deben abrirse mediante owner de navegación');
assert(ui.includes('Saldos de cuentas: <b>actuales</b>'), 'P11: UI debe explicar que CxC/CxP usan saldos actuales');
assert(ui.includes('Conversión de moneda: <b>no aplicada</b>') && ui.includes('Sin conversión de moneda'), 'P11: UI debe explicar que no hay conversión de moneda');
assert(!ui.includes('public.executive_dashboard_rollup'), 'P11: UI no debe exponer nombres SQL internos');
assert(!ui.includes('Calculado por backend') && !ui.includes('cash posted'), 'P11: UI no debe exponer lenguaje de implementación financiera');
assert(!/error\?\.message/.test(ui), 'P11: dashboard no debe renderizar mensajes técnicos crudos');
assert(ui.includes('renderLoading()'), 'P11: dashboard debe tener estado loading explícito');
assert(ui.includes('renderError()'), 'P11: dashboard debe tener error recuperable explícito');
assert(ui.includes('dashboardRetry'), 'P11: dashboard debe ofrecer reintento sin bloquear el ERP');
assert(css.includes('.executive-finance-grid'), 'P11: stylesheet del dashboard incompleto');
assert(erp.includes("loadStylesheet('/admin/dashboard-executive.css?v=20260926-figma2'"), 'P11: bootstrap no carga stylesheet dashboard');
assert(erp.includes("loadScript('/admin/dashboard-operational-state.js?v=20260929-dashboard-split2'"), 'P11: bootstrap no carga owner P11');
assert(erp.includes("loadScript('/admin/admin-data-loader.js?v=20260928-dashboard-onview2'"), 'P11: bootstrap no carga owner de datos resiliente');
assert(dataLoader.includes("accessCan('dashboard.read')"), 'P11: owner de datos no respeta dashboard.read');
assert(dataLoader.includes('window.ExecutiveDashboard?.refresh'), 'P11: owner de datos no delega al owner visual P11');
assert(autoRefresh.includes("const coreRefreshScopes = new Set(String(scope || '').split(',').map(value => value.trim()));") && autoRefresh.includes("['erp','clients','shipments','account'].some(value => coreRefreshScopes.has(value))"), 'P11: cambios ajenos a clientes, contenedores y permisos no deben recargar datos núcleo');
assert(erp.includes("window.api('/api/dashboard')"), 'P11: dashboard debe empezar a cargar antes de completar los módulos secundarios');
const dashboardPrefetchAt=index.indexOf('__exportMcaEarlyDashboard');
const firstStylesheetAt=index.indexOf('<link rel="stylesheet"');
assert(dashboardPrefetchAt>=0 && dashboardPrefetchAt<firstStylesheetAt && index.includes("fetch('/api/dashboard'"), 'P11: dashboard debe iniciar datos antes de esperar los estilos');
assert(index.includes("if (hasSession) root.classList.add('admin-preparing');") && index.includes('html.admin-preparing body::before'), 'P11: una sesión guardada debe mostrar feedback antes de descargar módulos');
assert(erp.includes('Promise.all(['), 'P11: los assets visuales del dashboard deben cargar en paralelo');
assert(shellRuntime.includes("options?.source === 'startup'") && shellRuntime.includes('window.__exportMcaDashboardStartupPromise'), 'P11: al restaurar Inicio no debe pedir el mismo dashboard dos veces');
assert(accessAdministration.includes('original(sectionAllowed(id) ? id : firstAllowedSection(), options)'), 'P11: el guard de permisos debe preservar el origen startup de la sección');
assert(accessAdministration.includes('if (canAny(MANAGEMENT_KEYS) && state.activeTab) switchTab(state.activeTab);') && !accessAdministration.includes('if (canAny(MANAGEMENT_KEYS) && state.activeTab) await switchTab(state.activeTab);'), 'P11: cargar el directorio de acceso no debe bloquear el dashboard inicial');
assert(erp.includes('window.__exportMcaDashboardStartupPromise = dashboardPreloadPromise'), 'P11: la promesa inicial debe ser visible para evitar una segunda lectura');
assert(erp.indexOf('dashboardAssetsPromise = Promise.all([') < erp.indexOf('await accessStylesPromise;'), 'P11: CSS y JS de Inicio deben descargarse en paralelo con la validación de permisos');
assert(sectionState.includes('originalShowSection(id, { source })'), 'P11: section-state debe identificar la restauración de inicio');
const coreStart=dataLoader.indexOf('async function loadCore()');
const dashboardStart=dataLoader.indexOf('async function loadDashboard()');
const coreSource=coreStart>=0&&dashboardStart>coreStart?dataLoader.slice(coreStart,dashboardStart):'';
assert(coreSource && !coreSource.includes('/api/dashboard'), 'P11: dashboard no puede bloquear la carga núcleo del shell');

console.log('P11 executive dashboard B8.3: OK');

const dashboardPending=[];
const dashboardSection={innerHTML:''};
const dashboardWindow={
  __executiveDashboardInstalled:false,
  api(path){return new Promise(resolve=>dashboardPending.push({path,resolve}));},
  addEventListener(){},
  ExportMcaIcons:{svg:()=>''}
};
const dashboardDocument={
  getElementById:id=>id==='dashboardSection'?dashboardSection:null,
  querySelectorAll:()=>[],
  addEventListener(){}
};
const dashboardStorage={getItem:()=>null};
vm.runInNewContext(ui,{window:dashboardWindow,document:dashboardDocument,localStorage:dashboardStorage,Intl,Date,Map,Set,URLSearchParams,Promise,Number,String,Math,setTimeout:()=>1,clearTimeout(){}},{filename:'admin/dashboard-operational-state.js'});
const payload=generatedAt=>({generated_at:generatedAt,stats:{},work_attention:{},recent_activity:[],filter_options:{}});
const executivePayload=generatedAt=>({owner:'executive_dashboard_rollup',generated_at:generatedAt,period:{},activity_by_currency:[],balances_by_currency:[],exceptions:{}});
const firstRefresh=dashboardWindow.ExecutiveDashboard.refresh();
await Promise.resolve();
assert(dashboardPending.length===1&&dashboardPending[0].path==='/api/dashboard','el primer refresco debe empezar por el overview operativo');
const queuedRefresh=dashboardWindow.ExecutiveDashboard.refresh();
assert(typeof queuedRefresh?.then==='function','un refresco concurrente debe esperar su lectura en cola');
dashboardPending[0].resolve(payload('2026-09-28T12:00:00.000Z'));
await Promise.resolve();
await Promise.resolve();
assert(dashboardPending.length===2&&dashboardPending[1].path.startsWith('/api/dashboard-financial'),'el cálculo financiero debe salir por separado tras pintar el overview');
dashboardPending[1].resolve(executivePayload('2026-09-28T12:00:00.000Z'));
await firstRefresh;
await Promise.resolve();
assert(dashboardPending.length===3&&dashboardPending[2].path==='/api/dashboard','el refresco en cola debe releer el overview después de cerrar el activo');
dashboardPending[2].resolve(payload('2026-09-28T12:00:01.000Z'));
await Promise.resolve();
await Promise.resolve();
assert(dashboardPending.length===4&&dashboardPending[3].path.startsWith('/api/dashboard-financial'),'el refresco en cola también debe leer finanzas por separado');
dashboardPending[3].resolve(executivePayload('2026-09-28T12:00:01.000Z'));
await queuedRefresh;
await Promise.resolve();
assert(dashboardWindow.ExecutiveDashboard.getState().data.generated_at==='2026-09-28T12:00:01.000Z','la segunda lectura debe dejar visible la versión más reciente');
console.log('Dashboard concurrent refresh queue: OK');
