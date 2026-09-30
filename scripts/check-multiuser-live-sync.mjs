import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { normalizeLiveUpdateState } from '../api/live-updates.js';

const read = file => fs.readFileSync(file, 'utf8');
const migrationPath = 'supabase/migrations/20260909125237_multiuser_live_sync.sql';
const migration = read(migrationPath);
const endpoint = read('api/live-updates.js');
const refresh = read('admin/embedded-auto-refresh.js');
const failures = [];

const requireText = (source, text, label = text) => {
  if (!source.includes(text)) failures.push(`falta ${label}`);
};

for (const text of [
  'create table if not exists public.erp_change_state',
  'alter table public.erp_change_state enable row level security',
  'revoke all privileges on table public.erp_change_state from public, anon, authenticated',
  'grant select on table public.erp_change_state to service_role',
  'create or replace function private.bump_erp_change_state()',
  'security definer',
  'set search_path = pg_catalog, public, pg_temp',
  'for each statement execute function private.bump_erp_change_state',
  "('shipments','shipments')",
  "('purchase_orders','purchases')",
  "('operational_tasks','tasks')",
  "('notification_inbox_items','notifications')",
  "('admin_users','account')",
  "('workers','workers')"
]) requireText(migration, text, `${migrationPath}: ${text}`);

for (const text of [
  'authenticateAdmin(req, res)',
  "req.method !== 'GET'",
  "supabase('erp_change_state'",
  'normalizeLiveUpdateState(rows)',
  "query:'?select=scope,version,changed_at&order=scope.asc'"
]) requireText(endpoint, text, `endpoint protegido: ${text}`);

for (const text of [
  "const LIVE_SYNC_PATH = '/api/live-updates'",
  'function frameSectionVisible(frame)',
  "if(frame?.dataset?.moduleLoaded==='true'&&current?.stale)",
  'const LIVE_SYNC_VISIBLE_MS = 10000',
  'const LIVE_SYNC_HIDDEN_MS = 120000',
  'function applyLiveSnapshot(payload)',
  "queueExternalScopes(external,'multiuser-change')",
  "window.TasksWorkspace?.load?.()",
  "window.OperationalAlertCenter?.load?.()",
  "window.WorkersModule?.load?.()",
  "window.ExportMcaAccessControl?.initialize?.()",
  "window.ExportMcaAdminShellRuntime?.transitionExpiredSession?.('live_sync_unauthorized')"
]) requireText(refresh, text, `cliente multiusuario: ${text}`);

if (/SUPABASE_(?:SERVICE_ROLE|SECRET|ANON|PUBLISHABLE)|createClient\s*\(/.test(refresh)) {
  failures.push('el navegador no debe recibir claves ni crear un cliente Supabase directo');
}

for (const name of fs.readdirSync('admin').filter(name => name.endsWith('.html'))) {
  const html = read(`admin/${name}`);
  if (html.includes('/admin/embedded-auto-refresh.js') && !html.includes('/admin/embedded-auto-refresh.js?v=')) {
    failures.push(`admin/${name}: conserva una versión anterior del runtime de sincronización`);
  }
}

const normalized = normalizeLiveUpdateState([
  { scope:'products', version:4, changed_at:'2026-09-09T12:00:00Z' },
  { scope:'unknown', version:9, changed_at:'2026-09-09T12:00:01Z' },
  { scope:'sales', version:-1, changed_at:'2026-09-09T12:00:02Z' }
]);
assert.deepEqual(normalized.versions, { products:4 });
assert.deepEqual(normalized.changed_at, { products:'2026-09-09T12:00:00Z' });

const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create table public.products(id bigint generated always as identity primary key, name text);
  create table public.sales_orders(id bigint generated always as identity primary key);
  create table public.operational_tasks(id bigint generated always as identity primary key);
  create table public.notifications(id bigint generated always as identity primary key);
  create table public.admin_users(id bigint generated always as identity primary key);
  create table public.workers(id bigint generated always as identity primary key);
  create table public.audit_log(id bigint generated always as identity primary key);
`);
await db.exec(migration);

const initial = await db.query('select scope, version from public.erp_change_state order by scope');
assert.equal(initial.rows.length, 17, 'la migración debe iniciar todas las versiones de módulo');
assert(initial.rows.every(row => Number(row.version) === 0), 'las versiones iniciales deben ser cero');

await db.exec("insert into public.products(name) values ('A'),('B')");
let product = await db.query("select version from public.erp_change_state where scope='products'");
assert.equal(Number(product.rows[0].version), 1, 'una sentencia multirregistro debe generar un solo cambio');

await db.exec("update public.products set name=name || '-actualizado'");
product = await db.query("select version from public.erp_change_state where scope='products'");
assert.equal(Number(product.rows[0].version), 2, 'una actualización debe incrementar la versión');

await db.exec('insert into public.operational_tasks default values');
const tasks = await db.query("select version from public.erp_change_state where scope='tasks'");
assert.equal(Number(tasks.rows[0].version), 1, 'las tareas deben usar su propio ámbito');

await db.exec('grant insert on table public.products to service_role');
await db.exec("set role service_role; insert into public.products(name) values ('C'); reset role;");
product = await db.query("select version from public.erp_change_state where scope='products'");
assert.equal(Number(product.rows[0].version), 3, 'el trigger protegido debe funcionar en escrituras service_role');

const security = await db.query(`
  select
    has_table_privilege('anon','public.erp_change_state','select') as anon_select,
    has_table_privilege('authenticated','public.erp_change_state','select') as authenticated_select,
    has_table_privilege('service_role','public.erp_change_state','select') as service_select,
    has_table_privilege('service_role','public.erp_change_state','insert') as service_insert,
    has_schema_privilege('anon','private','usage') as anon_private_usage,
    has_function_privilege('service_role','private.bump_erp_change_state()','execute') as service_execute
`);
assert.equal(security.rows[0].anon_select, false);
assert.equal(security.rows[0].authenticated_select, false);
assert.equal(security.rows[0].service_select, true);
assert.equal(security.rows[0].service_insert, false);
assert.equal(security.rows[0].anon_private_usage, false);
assert.equal(security.rows[0].service_execute, false);

const triggerCount = await db.query(`
  select count(*)::int as total
  from pg_trigger
  where tgname='erp_change_state_bump' and not tgisinternal
`);
assert.equal(Number(triggerCount.rows[0].total), 6, 'solo las seis tablas operativas disponibles deben recibir trigger');

const auditTrigger = await db.query(`
  select count(*)::int as total
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  where t.tgname='erp_change_state_bump' and c.relname='audit_log'
`);
assert.equal(Number(auditTrigger.rows[0].total), 0, 'el log de auditoría no debe producir ciclos de sincronización');
await db.close();

const listeners = new Map();
let modalOpen = false;
let coreRefreshes = 0;
let dashboardRefreshes = 0;
let taskRefreshes = 0;
let activeSection = 'salesSection';
const workspaceRefreshes = { sales:0, purchases:0 };
class FixtureObserver { observe() {} disconnect() {} }
class FixtureEvent { constructor(type, options={}) { this.type=type; this.detail=options.detail; } }
function workspaceFrame(sectionId, name) {
  const section={id:sectionId,classList:{contains:value=>value==='hidden'&&activeSection!==sectionId}};
  const moduleKey=name==='sales'?'SalesModule':'PurchasesModule';
  const win={
    [`${moduleKey}`]:{async refresh(){workspaceRefreshes[name]+=1;}},
    fetch:async()=>({ok:true}),
    dispatchEvent(){},
    CustomEvent:FixtureEvent
  };
  const doc={readyState:'complete',body:{},querySelectorAll:()=>[]};
  return {
    title:sectionId,
    dataset:{moduleStarted:'true',moduleLoaded:'true'},
    contentWindow:win,
    contentDocument:doc,
    closest:selector=>selector==='.app-section'?section:null,
    addEventListener(){},
    section
  };
}
const workspaceFrames=[workspaceFrame('salesSection','sales'),workspaceFrame('purchasesSection','purchases')];
const sections=new Map(workspaceFrames.map(frame=>[frame.section.id,frame.section]));
const fixtureWindow = {
  addEventListener(type, handler) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
  },
  dispatchEvent(event) { for (const handler of listeners.get(event.type) || []) handler(event); },
  fetch:async()=>({ok:true,json:async()=>({versions:{}})}),
  TasksWorkspace:{ async load(){taskRefreshes+=1;} },
  ExportMcaAdminData:{
    async loadCore(){coreRefreshes+=1;},
    async loadDashboard(){dashboardRefreshes+=1;}
  }
};
fixtureWindow.parent=fixtureWindow;
fixtureWindow.top=fixtureWindow;
const fixtureDocument = {
  readyState:'complete',
  body:{},
  hidden:false,
  addEventListener(){},
  querySelector(selector){
    if(selector==='.app-section:not(.hidden)')return {id:activeSection};
    const frameMatch=selector.match(/^#([^ ]+) iframe$/);
    if(frameMatch)return workspaceFrames.find(frame=>frame.section.id===frameMatch[1])||null;
    return selector.startsWith('.modal')&&modalOpen?{}:null;
  },
  querySelectorAll(selector){
    if(selector==='.app-section iframe')return workspaceFrames;
    return selector.startsWith('.modal')&&modalOpen?[{getClientRects:()=>[{}]}]:[];
  },
  getElementById(id){return sections.get(id)||null;}
};
const fixtureStorage = {
  getItem(){return '';},
  setItem(){},
  removeItem(){}
};
vm.runInNewContext(refresh, {
  window:fixtureWindow,
  document:fixtureDocument,
  location:{href:'https://erp.example/admin/index.html',hash:'',pathname:'/admin/index.html',search:''},
  history:{state:null,replaceState(){}},
  localStorage:fixtureStorage,
  MutationObserver:FixtureObserver,
  CustomEvent:FixtureEvent,
  CSS:{escape:value=>String(value)},
  URL,
  Date,
  JSON,
  Object,
  Number,
  console,
  setTimeout,
  clearTimeout
}, { filename:'admin/embedded-auto-refresh.js' });

const live = fixtureWindow.ExportMcaEmbeddedAutoRefresh;
assert.equal([...live.applyLiveSnapshot({versions:{tasks:0,products:0}})].join(','), '');
assert.equal([...live.applyLiveSnapshot({versions:{tasks:1,products:0}})].join(','), 'tasks');
await new Promise(resolve=>setTimeout(resolve,220));
assert.equal(taskRefreshes,1,'un cambio externo de tareas debe recargar la cola');
assert.equal(coreRefreshes,0,'un cambio externo de tareas no debe recargar todo el núcleo ERP');
assert.equal(dashboardRefreshes,0,'un cambio externo fuera de Inicio no debe cargar el dashboard oculto');

activeSection='dashboardSection';
modalOpen=true;
assert.equal([...live.applyLiveSnapshot({versions:{tasks:1,products:1}})].join(','), 'products');
await new Promise(resolve=>setTimeout(resolve,180));
assert.equal(coreRefreshes,0,'un cambio de productos dentro del formulario no debe recargar el núcleo ERP');
modalOpen=false;
live.queueExternalScopes([], 'modal-closed-test');
await new Promise(resolve=>setTimeout(resolve,220));
assert.equal(coreRefreshes,0,'al cerrar el formulario se aplica la actualización selectiva pendiente');
assert.equal(dashboardRefreshes,1,'el cambio aplazado debe actualizar Inicio si está visible');

activeSection='salesSection';
live.onSectionOpened('salesSection');
await new Promise(resolve=>setTimeout(resolve,180));
assert.equal(workspaceRefreshes.sales,1,'el módulo visible se actualiza por el cambio externo');
assert.equal(workspaceRefreshes.purchases,0,'un módulo oculto no genera consultas de actualización');
activeSection='purchasesSection';
live.onSectionOpened('purchasesSection');
await new Promise(resolve=>setTimeout(resolve,180));
assert.equal(workspaceRefreshes.purchases,1,'un módulo oculto se pone al día al volver a abrirlo');

live.announceMutation('sales',null);
await new Promise(resolve=>setTimeout(resolve,220));
assert.equal(coreRefreshes,0,'un cambio local de ventas no debe recargar todo el núcleo ERP');
assert.equal([...live.applyLiveSnapshot({versions:{tasks:1,products:1,sales:1}})].join(','),'','el eco del cambio local no debe disparar otra recarga');
await new Promise(resolve=>setTimeout(resolve,220));
assert.equal(coreRefreshes,0,'el eco del cambio local no debe causar recargas del núcleo ERP');

if (failures.length) {
  console.error('Multiuser live sync check failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}

console.log('Multiuser live sync check passed.');
