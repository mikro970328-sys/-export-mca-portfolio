import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  owner:'admin/access-control-administration.js',
  styles:'admin/access-control.css',
  loader:'admin/erp.js',
  shell:'admin/index.html',
  adminsApi:'api/admins.js',
  accessApi:'api/access-control.js',
  browserstack:'e2e/browserstack/ux7-production-readonly.spec.cjs',
  browserstackGate:'scripts/check-browserstack-ios-readonly.mjs',
  workflow:'.github/workflows/ux7-access-visual-owner.yml'
};

const failures = [];
const read = file => fs.existsSync(file) ? fs.readFileSync(file,'utf8') : '';
const requireText = (source, value, label = value) => {
  if (!source.includes(value)) failures.push(`falta ${label}`);
};
const forbid = (source, pattern, label) => {
  if (pattern.test(source)) failures.push(label);
};

Object.values(files).forEach(file => {
  if (!fs.existsSync(file)) failures.push(`falta ${file}`);
});

const owner = read(files.owner);
const styles = read(files.styles);
const loader = read(files.loader);
const shell = read(files.shell);
const adminsApi = read(files.adminsApi);
const accessApi = read(files.accessApi);
const browserstack = read(files.browserstack);
const browserstackGate = read(files.browserstackGate);
const workflow = read(files.workflow);

[
  "section.dataset.accessOwner = 'access-control-administration.js'",
  'section.innerHTML = workspaceMarkup();',
  'class="access-header native-workspace-hero"',
  'class="access-hero-state"',
  'id="accessLastUpdated"',
  'class="access-summary native-workspace-summary"',
  'id="accessUsersMetric"',
  'id="accessActiveMetric"',
  'id="accessRolesMetric"',
  'id="accessTeamsMetric"',
  'class="access-command"',
  'role="tablist" aria-label="Áreas de acceso"',
  'id="accessCreateButton"',
  'id="accessWorkspaceBody" class="access-workspace-body"',
  'id="accessSearch" type="search"',
  'data-access-view="all"',
  'data-access-view="active"',
  'data-access-view="inactive"',
  'id="accessDirectoryList"',
  'class="access-card"',
  'function visibleRecords(',
  'function renderMetrics()',
  'function renderUsersDirectory()',
  'function renderRolesDirectory()',
  'function renderTeamsDirectory()',
  'function openCreateUser()',
  'function openCreateRole()',
  'function openCreateTeam()',
  'const ROLE_TEMPLATES = Object.freeze([',
  'data-role-template=',
  'function bindRoleSelection(',
  'function bindRoleComposer()',
  'roleTemplates:ROLE_TEMPLATES',
  'function renderLoadError()',
  'function handleWorkspaceInput(',
  "owner:'access-control-administration.js'"
].forEach(value => requireText(owner,value,`owner visual ${value}`));

[
  "can('administration.users.manage')",
  "can('administration.roles.manage')",
  "can('administration.teams.manage')",
  'state.permissions.has(permission)',
  "request('/api/admins'",
  "request('/api/access-control?resource=roles'",
  "request('/api/access-control?resource=teams'",
  'const SAFE_ACCESS_ERRORS = new Set([',
  'function safeAccessMessage(',
  'ACCESS_CONTROL_UI_FAILED',
  "context = 'operation'",
  "'create_user'",
  "'create_role'",
  "'create_team'",
  "'load_tab'",
  "button.dataset.accessBusy === '1'",
  "event.key === 'Escape'",
  "setAttribute('aria-hidden','false')",
  "setAttribute('aria-selected',String(selected))"
].forEach(value => requireText(owner,value,`límite seguro ${value}`));

if ((owner.match(/error\?\.message/g) || []).length !== 1) failures.push('error?.message solo puede leerse dentro del traductor seguro');
forbid(owner,/\berror\.message\b|\be\.message\b/,'Usuarios y acceso renderiza mensajes técnicos directamente');
forbid(owner,/\b(?:prompt|alert|confirm)\s*\(/,'Usuarios y acceso usa diálogos nativos');
forbid(owner,/document\.createElement\(['"]style['"]\)|style\.textContent/,'Usuarios y acceso inyecta CSS desde JavaScript');
forbid(owner,/\bMutationObserver\b|\bResizeObserver\b/,'Usuarios y acceso observa y recompone el DOM');
forbid(owner,/\.style(?:\.|\[)/,'Usuarios y acceso muta estilos inline');
forbid(owner,/method\s*:\s*['"]DELETE['"]/i,'Usuarios y acceso introduce eliminación física');
forbid(shell,/id=["'](?:saveAdmin|adminName|adminUsername|adminPassword)["']/,'index.html reintroduce controles de administración duplicados');

[
  '#adminsSection',
  '.access-header.native-workspace-hero',
  '.access-hero-state',
  '.access-summary.native-workspace-summary',
  '.access-command',
  '.access-tabs',
  '.access-toolbar',
  '.access-search',
  '.access-view-tabs',
  '.access-directory-panel',
  '.access-card',
  '.access-card-main',
  '.access-row-actions',
  '.access-status',
  '.access-empty',
  '.access-loading',
  '.access-modal',
  '.access-dialog',
  '.access-form-grid',
  '.access-role-selection',
  '.access-role-templates',
  '.access-role-template[aria-pressed="true"]',
  '.access-role-permission-summary',
  '.access-permission-groups',
  '@media(max-width:1180px)',
  '@media(max-width:900px)',
  '@media(max-width:720px)',
  '@media(max-width:560px)',
  '@media(max-width:390px)',
  '@media(prefers-reduced-motion:reduce)'
].forEach(value => requireText(styles,value,`CSS propietario ${value}`));

requireText(styles,'overflow-x:hidden;','protección contra desbordamiento del owner');
requireText(styles,'body.access-notifications-readonly [data-alert-action]:not([data-alert-action="mark_read"])','límite visual de notificaciones conservado');
forbid(styles,/@import|font-family\s*:\s*Arial|linear-gradient/i,'access-control.css conserva importación tardía o estética legacy');

[
  "/admin/access-control.css?v=20260905-accessflow1",
  "/admin/access-control-administration.js?v=20260905-accessflow1",
  'await window.ExportMcaAccessControl.initialize()'
].forEach(value => requireText(loader,value,`loader canónico ${value}`));

[
  "authorizeAdmin(req, res, permission)",
  "'administration.users.manage'",
  "'administration.workers.write'",
  "rpc('create_admin_account_with_audit'",
  "rpc('update_admin_account_with_audit'"
].forEach(value => requireText(adminsApi,value,`API de usuarios ${value}`));

[
  "'administration.roles.manage'",
  "'administration.teams.manage'",
  "rpc('create_access_role_with_audit'",
  "rpc('update_access_role_with_audit'",
  "rpc('create_team_with_audit'",
  "rpc('update_team_with_audit'",
  "console.error('[api/access-control]', error)",
  "return fail(res, 500, 'No se pudo completar la operación');"
].forEach(value => requireText(accessApi,value,`API de acceso ${value}`));
forbid(accessApi,/return fail\(res,\s*500,[^\n]*error\.message/,'api/access-control.js filtra detalles inesperados al cliente');

[
  "openSection(page, 'adminsSection')",
  'Access control has one visual owner and a responsive directory',
  'access-control-iphone-safari',
  "accessState.owner !== 'access-control-administration.js'",
  'accessState.metricCount !== 4',
  'submitted:false',
  'ACCESS_CONTROL_UI_FAILED'
].forEach(value => requireText(browserstack,value,`certificación iPhone ${value}`));
[
  "openSection(page, 'adminsSection')",
  'Access control has one visual owner and a responsive directory',
  'ACCESS_CONTROL_UI_FAILED'
].forEach(value => requireText(browserstackGate,value,`gate BrowserStack ${value}`));
requireText(workflow,'node scripts/check-ux7-access-visual-owner.mjs','workflow del owner de acceso');
requireText(workflow,'npm install --ignore-scripts --no-audit --no-fund','instalación reproducible de dependencias del workflow');

const openBraces = (styles.match(/{/g) || []).length;
const closeBraces = (styles.match(/}/g) || []).length;
if (openBraces !== closeBraces) failures.push(`access-control.css tiene llaves desbalanceadas: ${openBraces}/${closeBraces}`);

class FakeElement {
  constructor(id) { this.id=id; this.textContent=''; }
}

const metricIds = ['accessUsersMetric','accessActiveMetric','accessRolesMetric','accessTeamsMetric'];
const metricNodes = new Map(metricIds.map(id => [id,new FakeElement(id)]));
const context = vm.createContext({
  window:{},
  document:{ getElementById:id => metricNodes.get(id) || null },
  localStorage:{ getItem:()=>'', setItem:()=>{} },
  console,
  fetch:async()=>({ ok:true, json:async()=>({}) }),
  FormData:class {},
  URL,
  Set,
  Map,
  Date,
  queueMicrotask
});
context.window.window = context.window;

try {
  vm.runInContext(owner,context,{filename:files.owner});
  const api = context.window.ExportMcaAccessControl;
  if (!api || api.owner !== 'access-control-administration.js') {
    failures.push('fixture: el owner canónico no quedó expuesto');
  } else {
    const templates = [...(api.roleTemplates || [])];
    const templateMap = new Map(templates.map(template => [template.key,template]));
    for (const key of ['sales','procurement','logistics','finance','readonly','custom']) {
      if (!templateMap.has(key)) failures.push(`fixture: falta plantilla de rol ${key}`);
    }
    const logistics = templateMap.get('logistics');
    for (const key of ['warehouse.read','warehouse.write','logistics.read','logistics.write','documents.read','documents.write']) {
      if (!logistics?.permissionKeys?.includes(key)) failures.push(`fixture: Logística no incluye ${key}`);
    }
    const readonly = templateMap.get('readonly');
    if ((readonly?.permissionKeys || []).some(key => key.endsWith('.write') || key.endsWith('.manage'))) {
      failures.push('fixture: Supervisor de consulta incluye permisos de escritura o gestión');
    }
    for (const template of templates.filter(item => item.key !== 'custom')) {
      if ((template.permissionKeys || []).some(key => key.startsWith('administration.users.') || key.startsWith('administration.roles.') || key.startsWith('administration.teams.'))) {
        failures.push(`fixture: la plantilla ${template.key} concede administración de accesos`);
      }
    }

    Object.assign(api.state,{
      activeTab:'users',
      statusView:'active',
      search:'ana',
      usersData:{
        admins:[
          {id:'u1',full_name:'Ana Rivera',username:'ana',role:'admin',is_active:true,access_roles:{name:'Operaciones'},teams:[{id:'t1',name:'Logística'}]},
          {id:'u2',full_name:'Luis Pérez',username:'luis',role:'admin',is_active:false,access_roles:{name:'Finanzas'},teams:[]}
        ],
        roles:[{id:'r1',name:'Operaciones',is_active:true},{id:'r2',name:'Archivo',is_active:false}],
        teams:[{id:'t1',name:'Logística',is_active:true}]
      }
    });
    api.state.loaded.users = true;
    const visibleUsers = api.visibleRecords('users');
    if (visibleUsers.length !== 1 || visibleUsers[0].id !== 'u1') failures.push('fixture: búsqueda y estado no filtran usuarios correctamente');
    api.renderMetrics();
    const values = metricIds.map(id => metricNodes.get(id).textContent);
    if (values.join(',') !== '2,1,1,1') failures.push(`fixture: métricas inesperadas ${values.join(',')}`);

    api.state.activeTab='roles';
    api.state.roles=[{id:'r1',name:'Operaciones',description:'Gestión logística',permission_keys:['logistics.read'],is_active:true},{id:'r2',name:'Finanzas',description:'Cobros',permission_keys:['finance.read'],is_active:true}];
    api.state.search='logística';
    api.state.statusView='all';
    const visibleRoles = api.visibleRecords('roles');
    if (visibleRoles.length !== 1 || visibleRoles[0].id !== 'r1') failures.push('fixture: búsqueda de roles no incluye la descripción');

    api.state.activeTab='teams';
    api.state.teamUsers=[{id:'u1',full_name:'Ana Rivera',username:'ana'}];
    api.state.teams=[{id:'t1',name:'Despacho',description:'Equipo norte',member_ids:['u1'],is_active:true}];
    api.state.search='ana';
    const visibleTeams = api.visibleRecords('teams');
    if (visibleTeams.length !== 1 || visibleTeams[0].id !== 't1') failures.push('fixture: búsqueda de equipos no incluye miembros');
  }
} catch (error) {
  failures.push(`fixture runtime: ${error?.stack || error}`);
}

if (failures.length) {
  console.error(`UX-7 Access visual owner gate failed:\n${failures.map(failure => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX-7 Access visual owner gate passed.');
console.log('- Usuarios, roles y equipos share one responsive directory with search, status views and four summary metrics.');
console.log('- Runtime fixtures verify filtering, metrics and the canonical owner without sending mutations.');
console.log('- Backend permissions, audited RPCs and safe error boundaries remain authoritative.');
