import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';

// Deterministic DOM tests, NOT visual/browser or database acceptance.
// No resources, network, credentials, service workers or real business data.
const fixture = spawnSync(process.execPath, ['scripts/preview-ux8-dashboard-navigation.mjs'], {encoding:'utf8'});
assert.equal(fixture.status, 0, fixture.stderr);
const {desktop} = JSON.parse(fixture.stdout);
const sources = ['scripts/lib/ux8-browser-harness.js','admin/ui-icon-system.js','admin/dashboard-operational-state.js','admin/navigation-shell.js'].map(path => fs.readFileSync(path,'utf8'));
let checks = 0;
const check = (label, assertion) => { try { assertion(); checks++; } catch(error) { error.message = `${label}: ${error.message}`; throw error; } };

for (const width of [1280,390]) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(desktop, {url:`https://erp-ux8.invalid/${width}/`,runScripts:'outside-only',virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window,'innerWidth',{value:width});
      window.matchMedia = () => ({matches:width>900});
      window.scrollTo = () => {};
      // Explicitly prohibit outbound traffic even if fixture code regresses.
      window.fetch = () => {throw Error('Network forbidden in UX8 unit tests');};
    }
  });
  const {window} = dom, {document} = window;
  const $ = id => document.getElementById(id);
  const all = selector => [...document.querySelectorAll(selector)];
  const search = value => {
    $('navigationSearch').value=value;
    $('navigationSearch').dispatchEvent(new window.Event('input',{bubbles:true}));
  };
  const searchResults = () => all('.sidebar-nav [data-section]').filter(button => {
    const group=button.closest('.nav-group');
    return !button.hidden && !button.disabled && !button.classList.contains('hidden') && !button.classList.contains('nav-search-miss') && (!group || (!group.classList.contains('hidden') && !group.classList.contains('nav-search-miss') && group.classList.contains('open')));
  });
  const detail = key => all('[data-dashboard-detail]').find(node=>node.dataset.dashboardDetail===key);
  try {
    const loaded = new Promise(resolve=>window.addEventListener('load',resolve,{once:true}));
    sources.forEach(source => window.eval(source));
    await loaded;
    check(`${width}: owners mount without JS errors`,()=>assert.deepEqual(errors,[]));
    check('dashboard initial render',()=>assert.ok(document.querySelector('.executive-dashboard')));
    check('every rebuilt navigation entry has its semantic icon',()=>assert.deepEqual(all('.sidebar-nav [data-icon-missing]').map(node=>node.closest('[data-nav-label]').dataset.navLabel),[]));
    const originalNodes = all('.sidebar-nav [data-section]');
    const originalGroups = all('.nav-group').map(group=>[group,group.classList.contains('open')]);
    const savedGroups = window.localStorage.getItem('export_mca_nav_groups');
    search('  FACTURACION  ');
    check('accent/case/whitespace insensitive',()=>assert.deepEqual(searchResults().map(node=>node.dataset.section),['invoicesSection']));
    check('search keeps the original DOM controls',()=>assert.deepEqual(all('.sidebar-nav [data-section]'),originalNodes));
    check('search never persists expanded groups',()=>assert.equal(window.localStorage.getItem('export_mca_nav_groups'),savedGroups));
    search('logistica');
    check('group search',()=>assert.deepEqual(searchResults().map(node=>node.dataset.section),['loadsSection','containersSection','registerContainerSection']));
    search('cuentas finanzas');
    check('multiword label and group search',()=>assert.deepEqual(searchResults().map(node=>node.dataset.section),['payablesSection']));
    search('Administradores');
    check('permission-hidden section excluded',()=>assert.equal(searchResults().length,0));
    check('permissions remain untouched',()=>assert.ok(document.querySelector('[data-section="adminsSection"]').classList.contains('hidden')));
    check('no results copy',()=>assert.match($('navigationSearchStatus').textContent,/No hay secciones disponibles/));
    // A revoked permission is excluded even before its CSS visibility is updated.
    window.ExportMcaAccessControl.sectionAllowed = id=>!['adminsSection','invoicesSection'].includes(id);
    search('Facturación');
    check('permission callback checked separately',()=>assert.equal(searchResults().length,0));
    window.ExportMcaAccessControl.sectionAllowed = id=>id!=='adminsSection';
    search('');
    check('clear restores group state',()=>assert.deepEqual(all('.nav-group').map(group=>[group,group.classList.contains('open')]),originalGroups));
    check('clear removes only search visibility',()=>assert.equal(all('.nav-search-miss').length,0));
    check('blank search hides status',()=>assert.equal($('navigationSearchStatus').hidden,true));
    if(width<=900)window.NavigationShell.toggle();
    search('Ventas');
    $('navigationSearch').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    check('Escape clears query',()=>assert.equal($('navigationSearch').value,''));
    if(width<=900) {
      check('first Escape leaves mobile open',()=>assert.ok($('sidebar').classList.contains('mobile-open')));
      window.dispatchEvent(new window.CustomEvent('export-mca:section-changed',{detail:{id:'dashboardSection',source:'startup'}}));
      check('startup preserves open menu',()=>assert.ok($('sidebar').classList.contains('mobile-open')));
    }
    search('Ventas');
    searchResults()[0].click();
    check('result uses original navigation handler',()=>assert.equal($('salesSection').classList.contains('hidden'),false));
    check('navigation clears search',()=>assert.equal($('navigationSearch').value,''));
    check('active section context',()=>assert.equal($('pageContext').textContent,'Comercial'));
    check('exactly one aria-current',()=>assert.deepEqual(all('[aria-current="page"]').map(node=>node.dataset.section),['salesSection']));
    if(width<=900)check('navigation closes mobile',()=>assert.equal($('sidebar').classList.contains('mobile-open'),false));
    else {
      search('compras');
      window.NavigationShell.collapse();
      check('collapse clears filter',()=>assert.equal(all('.nav-search-miss').length,0));
      window.NavigationShell.expand();
    }
    window.showSection('dashboardSection');
    check('priority precedes operation',()=>assert.ok(document.querySelector('.executive-priority-grid').compareDocumentPosition(document.querySelector('.executive-operation')) & window.Node.DOCUMENT_POSITION_FOLLOWING));
    check('all metrics retained per currency',()=>assert.equal(all('.executive-metric').length,24));
    check('two currencies kept separate',()=>assert.deepEqual(all('.executive-currency-head h3').map(node=>node.textContent),['EUR','USD']));
    check('four summary metrics per currency',()=>assert.equal(all('.executive-currency-panel > .executive-finance-grid > .executive-metric').length,8));
    check('details initially closed',()=>assert.ok(all('[data-dashboard-detail]').every(node=>!node.open)));
    const originalApi=window.api;
    let request;
    window.api=path=>{request=path;return originalApi(path);};
    detail('filters').open=true;
    detail('finance:USD').open=true;
    $('dashboardStartDate').value='2026-09-01';
    $('dashboardEndDate').value='2026-09-21';
    $('dashboardCurrency').value='USD';
    $('dashboardClient').value='qa-client';
    $('dashboardSupplier').value='qa-supplier';
    $('dashboardProduct').value='qa-product';
    await window.ExecutiveDashboard.refresh();
    check('all filters sent to existing API',()=>assert.deepEqual(Object.fromEntries(new URL(request,'https://fixture.invalid').searchParams),{start_date:'2026-09-01',end_date:'2026-09-21',currency:'USD',client_id:'qa-client',supplier_id:'qa-supplier',product_id:'qa-product'}));
    check('selects preserved after refresh',()=>assert.equal($('dashboardClient').value,'qa-client'));
    check('response currency controls presentation',()=>assert.equal(all('.executive-currency-panel').length,1));
    check('open state survives refresh',()=>assert.ok(detail('finance:USD').open && detail('filters').open));
    check('active filters apparent in summary',()=>assert.match(detail('filters').querySelector('summary').textContent,/6 filtro\(s\) activo\(s\).*USD/));
    detail('finance:USD').open=false;
    window.renderDashboardDetails();
    check('closed state also survives render',()=>assert.equal(detail('finance:USD').open,false));
    detail('finance:USD').open=true;
    let resolveRequest;
    window.api=()=>new Promise(resolve=>{resolveRequest=resolve;});
    const pending=window.ExecutiveDashboard.refresh();
    const duplicate=await window.ExecutiveDashboard.refresh();
    check('duplicate refresh suppressed',()=>assert.equal(duplicate,false));
    check('filter apply disabled while loading',()=>assert.equal($('dashboardApplyFilters').disabled,true));
    resolveRequest(await originalApi('/api/dashboard'));
    await pending;
    window.api=async()=>{throw Error('TEST_ONLY database diagnostic must not render');};
    await window.ExecutiveDashboard.refresh();
    check('friendly error without internal details',()=>{
      assert.match($('dashboardSection').textContent,/No pudimos actualizar/);
      assert.doesNotMatch($('dashboardSection').textContent,/TEST_ONLY/);
    });
    window.api=originalApi;
    await window.ExecutiveDashboard.refresh({});
    check('disclosures survive error and retry',()=>assert.ok(detail('finance:USD').open));
    const eur=all('.executive-currency-panel').find(node=>node.querySelector('h3').textContent==='EUR');
    check('negative cash flow comes from API',()=>assert.match(eur.querySelector('.negative strong').textContent,/-.*150/));
    check('ineligible margin stays unavailable',()=>assert.match(eur.textContent,/No disponible/));
    const payload=await originalApi('/api/dashboard');
    const before=JSON.stringify(payload);
    window.renderStats(payload);
    check('render does not mutate payload',()=>assert.equal(JSON.stringify(payload),before));
    let entity;
    window.OperationalNavigation.openEntity=value=>{entity=value;};
    document.querySelector('[data-dashboard-shipment]').click();
    check('tracking delegation preserved',()=>assert.equal(JSON.stringify(entity),JSON.stringify({type:'shipment',id:'qa-shipment-1'})));
    window.renderStats({executive:{},filter_options:{}});
    check('empty finance state',()=>assert.match($('dashboardSection').textContent,/No hay movimientos financieros/));
    check('filter permissions retained',()=>assert.equal($('dashboardClient'),null));
    payload.recent_activity[0].client_name='<img src=x onerror=alert(1)>';
    window.renderStats(payload);
    check('untrusted labels escaped',()=>assert.equal(document.querySelector('.executive-activity-list img'),null));
    check('no runtime errors at finish',()=>assert.deepEqual(errors,[]));
  } finally {window.close();}
}
console.log(`UX8 dashboard/navigation DOM: ${checks} checks passed. No browser layout or backend acceptance claimed.`);
