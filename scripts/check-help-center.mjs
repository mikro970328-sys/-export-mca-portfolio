import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const read=p=>readFileSync(p,'utf8');
const context={window:{}};vm.runInNewContext(read('admin/help-content.js'),context);
const articles=context.window.ExportMcaHelpContent.articles;
const ids=new Set(articles.map(a=>a.id));
assert.equal(ids.size,articles.length,'Duplicate article id');
const validSections=new Set(['accountSection','adminsSection','clientsSection','salesSection','publicationsSection','productsSection','suppliersSection','purchasesSection','warehouseSection','inventorySection','loadsSection','containersSection','invoicesSection','payablesSection','costsSection','reportsSection','tasksSection','workersSection','notificationsSection']);
for(const article of articles){
  assert.match(article.id,/^[a-z][a-z-]+$/);
  assert.ok(article.title&&article.summary&&article.result&&article.steps.length>=3,article.id);
  assert.ok(!article.section||validSections.has(article.section),article.id+' section');
  for(const id of article.related)assert.ok(ids.has(id),article.id+' broken related: '+id);
}
for(const section of validSections)assert.ok(articles.some(a=>a.section===section),'Missing guide for '+section);

// UI behavior with no transport: finding help must not write operational data.
const dom=new JSDOM('<section id="helpSection" class="app-section"><div id="helpRoot"></div></section><section id="invoicesSection" class="app-section"></section>',{url:'https://help-qa.invalid/',runScripts:'outside-only'});
const w=dom.window;let allowed=false,opened=[];
w.ExportMcaAccessControl={sectionAllowed:()=>allowed};w.showSection=id=>opened.push(id);
w.fetch=()=>{throw Error('Help must not call a business API');};
w.eval(read('admin/help-content.js'));w.eval(read('admin/help-center.js'));
const q=s=>w.document.querySelector(s);
assert.equal(w.document.querySelectorAll('.help-card').length,articles.length);
q('#helpSearch').value='¿Cómo crear una factura?';q('#helpSearch').dispatchEvent(new w.Event('input'));
assert.ok(q('.help-card[data-help-article="facturas"]'),'A normal question finds the invoice guide');
q('#helpSearch').value='COSTO INCOMPLETO';q('#helpSearch').dispatchEvent(new w.Event('input'));
assert.ok(q('.help-card[data-help-article="margen"]'),'Search finds problem by its wording');
w.ExportMcaHelpCenter.openArticle('facturas');assert.ok(q('[data-help-module]').disabled,'No module bypass for reader');
allowed=true;w.ExportMcaHelpCenter.openArticle('facturas');assert.equal(q('[data-help-module]').disabled,false);
allowed=false;q('[data-help-module]').click();assert.deepEqual(opened,[],'Permission revoked before navigation');
w.ExportMcaHelpCenter.showIndex();assert.equal(q('#helpSearch').value,'COSTO INCOMPLETO','Back preserves search');
q('#helpClear').click();assert.equal(w.document.querySelectorAll('.help-card').length,articles.length);
q('#helpSearch').value='<script>unknown</script>';q('#helpSearch').dispatchEvent(new w.Event('input'));assert.equal(q('#helpEmpty').hidden,false);
assert.equal(q('#helpResults script'),null,'Search input is not rendered as HTML');
w.ExportMcaHelpCenter.openArticle('reportar');q('[data-help-copy]').click();await new Promise(resolve=>setTimeout(resolve,0));
assert.match(q('#helpCopyStatus').textContent,/seleccionada/,'Clipboard denial has a manual fallback');
assert.equal(q('#helpReportTemplate').selectionEnd,q('#helpReportTemplate').value.length);
dom.window.close();

const index=read('admin/index.html'),loader=read('admin/erp.js'),navigation=read('admin/navigation-shell.js');
assert.ok(index.includes('data-section="helpSection"')&&index.includes('id="helpSection"'));
assert.ok(navigation.includes("sections:['helpSection']"));
for(const path of ['help-content.js','help-center.js','help-center.css'])assert.ok(loader.includes('/admin/'+path));
assert.ok(loader.includes('No se pudo cargar la ayuda.'),'Help loading failure must leave an actionable message');
console.log(`Help center: ${articles.length} guides; module coverage, related links, search, reader access, revocation and clipboard fallback passed; no business traffic.`);
