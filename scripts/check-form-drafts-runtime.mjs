import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const owner = fs.readFileSync('admin/form-drafts.js', 'utf8');
const dom = new JSDOM(`<!doctype html><html><body>
  <form id="recordForm">
    <input id="name" name="name" value="Inicial">
    <select id="status" name="status"><option value="open">Abierto</option><option value="closed">Cerrado</option></select>
    <input id="enabled" name="enabled" type="checkbox">
    <input id="password" name="password" type="password" value="no-guardar">
    <input id="token" name="api_token" value="no-guardar">
    <input id="hidden" name="hidden" type="hidden" value="no-guardar">
    <input id="ignored" name="ignored" data-draft-ignore value="no-guardar">
  </form>
  <div id="dynamicRoot"><div data-row><input value="Base"></div></div>
</body></html>`, {
  url:'https://erp.example.test/admin/runtime-test',
  runScripts:'outside-only'
});

const { window } = dom;
const wait = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));
const user = id => window.localStorage.setItem('export_mca_user', JSON.stringify({ id }));
const key = (id, scope) => `export_mca_form_draft_v1:${encodeURIComponent(id)}:${encodeURIComponent(scope)}`;
const form = window.document.getElementById('recordForm');

window.eval(owner);
assert.equal(window.ExportMcaDrafts.owner, 'form-drafts.js');

user('user-1');
let draft = window.ExportMcaDrafts.register({ root:form, key:'runtime:new', title:'prueba', debounceMs:0 });
assert.ok(draft);
await draft.ready;

window.document.getElementById('name').value = 'Cambio persistente';
window.document.getElementById('status').value = 'closed';
window.document.getElementById('enabled').checked = true;
window.document.getElementById('name').dispatchEvent(new window.Event('input', { bubbles:true }));
await wait(5);
draft.flush();

const firstRecord = JSON.parse(window.localStorage.getItem(key('user-1', 'runtime:new')));
assert.equal(firstRecord.version, 1);
assert.match(JSON.stringify(firstRecord.data), /Cambio persistente/);
assert.doesNotMatch(JSON.stringify(firstRecord.data), /no-guardar|password|api_token|hidden|ignored/);

draft.destroy({ flush:false });
form.reset();
draft = window.ExportMcaDrafts.register({ root:form, key:'runtime:new', title:'prueba', debounceMs:0 });
assert.equal(await draft.ready, true);
assert.equal(window.document.getElementById('name').value, 'Cambio persistente');
assert.equal(window.document.getElementById('status').value, 'closed');
assert.equal(window.document.getElementById('enabled').checked, true);
assert.equal(form.querySelector('[data-form-draft-status]').dataset.formDraftStatus, 'restored');

await draft.discard();
assert.equal(window.document.getElementById('name').value, 'Inicial');
assert.equal(window.document.getElementById('status').value, 'open');
assert.equal(window.document.getElementById('enabled').checked, false);
assert.equal(window.localStorage.getItem(key('user-1', 'runtime:new')), null);
draft.destroy({ flush:false });

draft = window.ExportMcaDrafts.register({ root:form, key:'runtime:isolation', debounceMs:0 });
window.document.getElementById('name').value = 'Solo usuario uno';
window.document.getElementById('name').dispatchEvent(new window.Event('input', { bubbles:true }));
draft.flush();
draft.destroy({ flush:false });
form.reset();
user('user-2');
draft = window.ExportMcaDrafts.register({ root:form, key:'runtime:isolation', debounceMs:0 });
assert.equal(await draft.ready, false);
assert.equal(window.document.getElementById('name').value, 'Inicial');
assert.ok(window.localStorage.getItem(key('user-1', 'runtime:isolation')));
assert.equal(window.localStorage.getItem(key('user-2', 'runtime:isolation')), null);
draft.destroy({ flush:false });

window.localStorage.setItem(key('user-2', 'runtime:expired'), JSON.stringify({
  version:1,
  scope:'runtime:expired',
  saved_at:Date.now() - (8 * 24 * 60 * 60 * 1000),
  data:{ fields:[] }
}));
draft = window.ExportMcaDrafts.register({ root:form, key:'runtime:expired', debounceMs:0 });
assert.equal(await draft.ready, false);
assert.equal(window.localStorage.getItem(key('user-2', 'runtime:expired')), null);
draft.destroy({ flush:false });

const dynamicRoot = window.document.getElementById('dynamicRoot');
const captureDynamic = () => ({
  rows:[...dynamicRoot.querySelectorAll('[data-row] input')].map(input => input.value)
});
const restoreDynamic = data => {
  dynamicRoot.querySelectorAll('[data-row]').forEach(row => row.remove());
  for (const value of Array.isArray(data.rows) ? data.rows : []) {
    const row = window.document.createElement('div');
    row.dataset.row = '';
    const input = window.document.createElement('input');
    input.value = value;
    row.append(input);
    dynamicRoot.append(row);
  }
};

draft = window.ExportMcaDrafts.register({
  root:dynamicRoot,
  key:'runtime:dynamic',
  capture:captureDynamic,
  restore:restoreDynamic,
  debounceMs:0
});
dynamicRoot.querySelector('input').value = 'Línea recuperada';
draft.touch();
draft.flush();
draft.destroy({ flush:false });
restoreDynamic({ rows:['Base'] });

draft = window.ExportMcaDrafts.register({
  root:dynamicRoot,
  key:'runtime:dynamic',
  capture:captureDynamic,
  restore:restoreDynamic,
  debounceMs:0
});
assert.equal(await draft.ready, true);
assert.deepEqual(captureDynamic().rows, ['Línea recuperada']);
draft.clear({ silent:true });
draft.destroy({ flush:false });
assert.equal(window.localStorage.getItem(key('user-2', 'runtime:dynamic')), null);

user('user-3');
let oversizeNote = '';
draft = window.ExportMcaDrafts.register({
  root:dynamicRoot,
  key:'runtime:oversize',
  capture:() => ({ note:oversizeNote }),
  debounceMs:0
});
oversizeNote = 'x'.repeat(180001);
assert.equal(draft.flush(), false);
assert.equal(window.localStorage.getItem(key('user-3', 'runtime:oversize')), null);
assert.equal(dynamicRoot.querySelector('[data-form-draft-status]').dataset.formDraftStatus, 'error');
draft.destroy({ flush:false });

window.localStorage.removeItem('export_mca_user');
draft = window.ExportMcaDrafts.register({ root:form, key:'runtime:anonymous', debounceMs:0 });
assert.equal(await draft.ready, false);
window.document.getElementById('name').value = 'Anónimo';
assert.equal(draft.flush(), false);
assert.equal(form.querySelector('[data-form-draft-status]').dataset.formDraftStatus, 'disabled');
draft.destroy({ flush:false });

dom.window.close();
console.log('Form draft runtime passed.');
console.log('- Restauración, descarte, expiración y líneas dinámicas funcionan en un DOM real.');
console.log('- Campos sensibles, sesiones anónimas, exceso de tamaño y cruces entre usuarios quedan bloqueados.');
