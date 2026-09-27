import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');
const index=read('admin/index.html');
const navigation=read('admin/navigation-shell.js');
const loader=read('admin/erp.js');

assert.doesNotMatch(index,/data-section=["']helpSection["']/,'Help is not present in the ERP menu');
assert.doesNotMatch(index,/id=["']helpSection["']/,'Help is not part of the ERP page');
assert.doesNotMatch(index,/\bAyuda\b/,'The ERP shell does not show a Help label');
assert.doesNotMatch(navigation,/helpSection|label:\s*["']Ayuda["']|key:\s*["']help["']/i,'The navigation shell has no Help destination');
for(const asset of ['help-content.js','help-center.js','help-center.css']){
  assert.ok(!loader.includes('/admin/'+asset),'The ERP loader must not request '+asset);
}
assert.doesNotMatch(loader,/No se pudo cargar la ayuda/i,'The ERP loader has no Help-specific loading notice');
console.log('ERP Help removal: no menu item, page section, module loading or Help-only error notice.');
