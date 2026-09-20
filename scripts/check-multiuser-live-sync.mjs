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
  'const LIVE_SYNC_VISIBLE_MS = 4000',
  'const LIVE_SYNC_HIDDEN_MS = 15000',
  'function applyLiveSnapshot(payload)',
  "queueExternalScopes(changed,'multiuser-change')",
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
  if (html.includes('/admin/embedded-auto-refresh.js?v=') && !html.includes('/admin/embedded-auto-refresh.js?v=20260909-live7')) {
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
class FixtureObserver { observe() {} disconnect() {} }
class FixtureEvent { constructor(type, options={}) { this.type=type; this.detail=options.detail; } }
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
  querySelector(selector){return selector.startsWith('.modal')&&modalOpen?{}:null;},
  querySelectorAll(selector){return selector.startsWith('.modal')&&modalOpen?[{getClientRects:()=>[{}]}]:[];}
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
assert.equal(coreRefreshes,1,'un cambio externo debe reconciliar los datos base');
assert.equal(dashboardRefreshes,1,'un cambio externo debe reconciliar el dashboard');

modalOpen=true;
assert.equal([...live.applyLiveSnapshot({versions:{tasks:1,products:1}})].join(','), 'products');
await new Promise(resolve=>setTimeout(resolve,180));
assert.equal(coreRefreshes,1,'un formulario abierto debe aplazar la reconciliación externa');
modalOpen=false;
live.queueExternalScopes([], 'modal-closed-test');
await new Promise(resolve=>setTimeout(resolve,220));
assert.equal(coreRefreshes,2,'el cambio aplazado debe aplicarse al cerrar el formulario');

if (failures.length) {
  console.error('Multiuser live sync check failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}

console.log('Multiuser live sync check passed.');
