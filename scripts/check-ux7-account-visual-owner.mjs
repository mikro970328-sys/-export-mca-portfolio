import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  owner:'admin/account-administration.js',
  styles:'admin/account-administration.css',
  loader:'admin/erp.js',
  api:'api/account.js',
  browserstack:'e2e/browserstack/ux7-production-readonly.spec.cjs',
  browserstackGate:'scripts/check-browserstack-ios-readonly.mjs',
  workflow:'.github/workflows/ux7-account-visual-owner.yml'
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
const api = read(files.api);
const browserstack = read(files.browserstack);
const browserstackGate = read(files.browserstackGate);
const workflow = read(files.workflow);

[
  "section.dataset.accountOwner = 'account-administration.js'",
  'section.innerHTML = workspaceMarkup();',
  'class="account-header native-workspace-hero"',
  'class="account-hero-state"',
  'id="accountLastUpdated"',
  'class="account-summary native-workspace-summary"',
  'id="accountRoleMetric"',
  'id="accountPermissionMetric"',
  'id="accountTeamMetric"',
  'id="accountPasswordMetric"',
  'class="account-panel account-card account-profile-panel"',
  'class="account-panel account-card account-security-panel"',
  'id="accountProfile"',
  'id="accountPasswordForm"',
  'id="accountPasswordChecklist"',
  'data-account-check="minimum"',
  'data-account-check="different"',
  'data-account-check="confirmation"',
  'id="accountSessionAdminCard"',
  'id="accountSessionRevokeForm"',
  'id="accountConfirmDialog"',
  'role="dialog" aria-modal="true"',
  'data-account-action="confirm-revocation"',
  'function accountSnapshot(',
  'function passwordChecks(',
  'function renderMetrics(',
  'function renderPasswordChecks(',
  'function openRevocationDialog(',
  'function closeRevocationDialog(',
  "owner:'account-administration.js'"
].forEach(value => requireText(owner,value,`owner visual ${value}`));

[
  "return access.can('administration.users.manage')",
  "request('/api/account'",
  "request('/api/admins'",
  'const SAFE_ACCOUNT_ERRORS = new Set([',
  'function safeAccountMessage(error, fallback)',
  "const context = arguments[2] || 'operation'",
  'ACCOUNT_UI_FAILED',
  'ACCOUNT_LOAD_FAILED',
  'ACCOUNT_PASSWORD_UPDATE_FAILED',
  'ACCOUNT_SESSION_REVOCATION_FAILED',
  'ACCOUNT_SECTION_REFRESH_FAILED',
  "localStorage.setItem('export_mca_token', result.token)",
  'body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })',
  'body: JSON.stringify({ id: userId, revoke_sessions: true, revoke_reason: reason })',
  'state.passwordBusy',
  'state.revocationBusy',
  "button.dataset.accountBusy = state.revocationBusy ? '1' : '0'",
  "event.key === 'Escape'",
  "event.key !== 'Tab'",
  "dialog.setAttribute('aria-hidden','false')",
  "dialog.setAttribute('aria-hidden','true')"
].forEach(value => requireText(owner,value,`límite seguro ${value}`));

if ((owner.match(/error\?\.message/g) || []).length !== 1) failures.push('error?.message solo puede leerse dentro del traductor seguro');
forbid(owner,/\berror\.message\b|\be\.message\b/,'Mi cuenta renderiza mensajes técnicos directamente');
forbid(owner,/\b(?:prompt|alert|confirm)\s*\(/,'Mi cuenta usa diálogos nativos');
forbid(owner,/document\.createElement\(['"]style['"]\)|style\.textContent/,'Mi cuenta inyecta CSS desde JavaScript');
forbid(owner,/\bMutationObserver\b|\bResizeObserver\b/,'Mi cuenta observa y recompone el DOM');
forbid(owner,/\.style(?:\.|\[)/,'Mi cuenta muta estilos inline');
forbid(owner,/method\s*:\s*['"]DELETE['"]/i,'Mi cuenta introduce eliminación física');
forbid(owner,/\sstyle\s*=/i,'Mi cuenta conserva atributos de estilo inline');

[
  '#accountSection',
  '.account-header.native-workspace-hero',
  '.account-hero-state',
  '.account-summary.native-workspace-summary',
  '.account-layout',
  '.account-panel.account-card',
  '.account-panel-head',
  '.account-profile',
  '.account-identity',
  '.account-profile-grid',
  '.account-role-pill',
  '.account-security-form',
  '.account-password-grid',
  '.account-password-checklist',
  '.account-security-status',
  '.account-session-grid',
  '.account-modal',
  '.account-dialog',
  '@media(max-width:1180px)',
  '@media(max-width:900px)',
  '@media(max-width:720px)',
  '@media(max-width:560px)',
  '@media(max-width:390px)',
  '@media(prefers-reduced-motion:reduce)'
].forEach(value => requireText(styles,value,`CSS propietario ${value}`));

requireText(styles,'overflow-x:hidden;','protección contra desbordamiento del owner');
forbid(styles,/@import|font-family\s*:\s*Arial|(?:linear|radial)-gradient/i,'account-administration.css conserva importación tardía o estética legacy');

[
  "/admin/account-administration.css?v=20260903-ux7account1",
  "/admin/account-administration.js?v=20260903-ux7account1"
].forEach(value => requireText(loader,value,`loader canónico ${value}`));

[
  'authenticateAdmin(req, res)',
  'rpc/change_own_admin_password',
  'const token = createToken(',
  "console.error('[api/account]', error)",
  "return fail(res, 500, 'No se pudo actualizar la cuenta');"
].forEach(value => requireText(api,value,`API de cuenta ${value}`));
forbid(api,/return fail\(res,\s*500,[^\n]*error\.message/,'api/account.js filtra detalles inesperados al cliente');

[
  "openSection(page, 'accountSection')",
  'My account has one visual owner and a responsive security workspace',
  'account-security-iphone-safari',
  "accountState.owner !== 'account-administration.js'",
  'accountState.metricCount !== 4',
  'accountState.passwordInputCount !== 3',
  'accountState.passwordChecklistCount !== 3',
  "item.path === '/api/account'",
  "checkpoint('account-security-readonly'",
  'submitted:false',
  'ACCOUNT_UI_FAILED'
].forEach(value => requireText(browserstack,value,`certificación iPhone ${value}`));
[
  "openSection(page, 'accountSection')",
  'My account has one visual owner and a responsive security workspace',
  'ACCOUNT_UI_FAILED'
].forEach(value => requireText(browserstackGate,value,`gate BrowserStack ${value}`));
requireText(workflow,'node scripts/check-ux7-account-visual-owner.mjs','workflow del owner de cuenta');
requireText(workflow,'npm install --ignore-scripts --no-audit --no-fund','instalación reproducible de dependencias del workflow');

const openBraces = (styles.match(/{/g) || []).length;
const closeBraces = (styles.match(/}/g) || []).length;
if (openBraces !== closeBraces) failures.push(`account-administration.css tiene llaves desbalanceadas: ${openBraces}/${closeBraces}`);

class FakeElement {
  constructor(id) { this.id=id; this.textContent=''; }
}

const metricIds = [
  'accountRoleMetric',
  'accountRoleDetail',
  'accountPermissionMetric',
  'accountTeamMetric',
  'accountPasswordMetric',
  'accountPasswordDetail',
  'accountOperationalState'
];
const metricNodes = new Map(metricIds.map(id => [id,new FakeElement(id)]));
const context = vm.createContext({
  window:{},
  document:{
    readyState:'loading',
    addEventListener:()=>{},
    getElementById:id => metricNodes.get(id) || null
  },
  localStorage:{ getItem:()=>'', setItem:()=>{} },
  console,
  fetch:async()=>({ ok:true, json:async()=>({}) }),
  FormData:class {},
  URL,
  Set,
  Map,
  Date,
  Intl,
  queueMicrotask
});
context.window.window = context.window;

try {
  vm.runInContext(owner,context,{filename:files.owner});
  const accountOwner = context.window.ExportMcaAccountAdministration;
  if (!accountOwner || accountOwner.owner !== 'account-administration.js') {
    failures.push('fixture: el owner canónico no quedó expuesto');
  } else {
    const sample = {
      id:'u1',
      full_name:'Ana Rivera López',
      username:'ana',
      role:'admin',
      is_active:true,
      access_role:{ name:'Operaciones' },
      permissions:['logistics.read','logistics.write','clients.read'],
      teams:[{team_name:'Logística'},{name:'Miami'}],
      last_login_at:'2026-09-03T12:00:00.000Z',
      password_changed_at:'2026-09-02T12:00:00.000Z',
      created_at:'2026-01-01T12:00:00.000Z'
    };
    const snapshot = accountOwner.accountSnapshot(sample);
    if (snapshot.initials !== 'AR' || snapshot.role !== 'Operaciones' || snapshot.permissionCount !== 3 || snapshot.teams.join(',') !== 'Logística,Miami') {
      failures.push(`fixture: resumen de cuenta inesperado ${JSON.stringify(snapshot)}`);
    }
    accountOwner.renderMetrics(sample);
    const values = ['accountRoleMetric','accountPermissionMetric','accountTeamMetric','accountPasswordMetric'].map(id => metricNodes.get(id).textContent);
    if (values.join(',') !== 'Operaciones,3,2,Actualizada') failures.push(`fixture: métricas inesperadas ${values.join(',')}`);

    const valid = accountOwner.passwordChecks('anterior-segura','nueva-segura-2026','nueva-segura-2026');
    if (!valid.minimum || !valid.different || !valid.confirmation) failures.push('fixture: una contraseña válida no completa la guía');
    const invalid = accountOwner.passwordChecks('misma-clave','misma-clave','otra-clave');
    if (!invalid.minimum || invalid.different || invalid.confirmation) failures.push('fixture: la guía no detecta contraseña repetida o confirmación distinta');

    const master = accountOwner.accountSnapshot({full_name:'Master Admin',role:'master_admin',permissions:[],teams:[]});
    if (!master.master || master.permissionMetric !== 'Total' || master.role !== 'Administrador maestro') failures.push('fixture: la cuenta maestra perdió su acceso efectivo');
  }
} catch (error) {
  failures.push(`fixture runtime: ${error?.stack || error}`);
}

if (failures.length) {
  console.error(`UX-7 Account visual owner gate failed:\n${failures.map(failure => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX-7 Account visual owner gate passed.');
console.log('- Identity, effective access, password guidance and audited session revocation share one responsive owner.');
console.log('- Runtime fixtures verify derived profile data, four metrics and password checks without sending mutations.');
console.log('- Atomic password rotation, dynamic permissions and safe backend boundaries remain authoritative.');
