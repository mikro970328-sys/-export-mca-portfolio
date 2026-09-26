import { test,expect } from '@playwright/test';
import { directoriesFixture } from '../../scripts/lib/figma-directories-fixture.mjs';
async function open(page,module,options={}){
 const url='https://erp-visual.invalid/?embedded=1',html=directoriesFixture({module,...options});
 await page.route('**/*',route=>route.request().url()===url?route.fulfill({contentType:'text/html',body:html}):route.abort());
 await page.goto(url);await page.evaluate(()=>document.fonts.ready);
 if(!options.failRead)await expect(page.locator(module==='clients'?'#clientTotal':'#supplierTotalMetric')).toHaveText(module==='clients'?'2':'3');
}
const writes=page=>page.evaluate(()=>window.__fixtureCalls.filter(c=>c.method!=='GET'));
async function shot(page,info,name,fullPage=false){const path=info.outputPath(name+'.png');await page.screenshot({path,fullPage,animations:'disabled',scale:'css'});await info.attach(name,{path,contentType:'image/png'});}
async function fits(page){const sizes=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.right>innerWidth+1&&!el.closest('.clients-table-wrap,.suppliers-table-wrap')}).slice(0,12).map(el=>({tag:el.tagName,id:el.id,class:el.className,width:el.getBoundingClientRect().width}))}));expect(sizes.width,JSON.stringify(sizes)).toBeLessThanOrEqual(sizes.viewport);}
async function hit(page,selector){const n=page.locator(selector);await n.scrollIntoViewIfNeeded();expect(await n.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;})).toBe(true);}
const clientMenu=async page=>{await page.locator('[data-client-id="fixture-client-0"] [data-client-menu]').click();await expect(page.locator('.client-actions-popover')).toBeVisible();};
for(const width of [1440,390]){
 test(`Clients: directory, importer search, information and editing at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:'dark'});await open(page,'clients');await fits(page);await shot(page,info,'clientes',true);
  await page.locator('#clientSearch').fill('Importadora de ejemplo');await expect(page.locator('[data-client-id]')).toHaveCount(1);await page.locator('#clearClientSearch').click();await expect(page.locator('#clientSearch')).toBeFocused();await expect(page.locator('[data-client-id]')).toHaveCount(2);
  await clientMenu(page);await page.locator('[data-client-action="information"]').click();await expect(page.locator('.client-information-grid')).toContainText('Importadora de ejemplo');await expect(page.locator('#closeModal')).toBeFocused();await shot(page,info,'informacion-cliente');await page.locator('#closeModal').click();
  await clientMenu(page);await page.locator('[data-client-action="edit"]').click();await expect(page.locator('#clientEditName')).toBeFocused();await page.locator('#clientEditCompany').fill('Comercial del Caribe revisada');await page.locator('#clientEditImporters').fill('Importadora de ejemplo, Nueva importadora, nueva importadora');await shot(page,info,'editar-cliente');
  await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#saveClientEdit').click();await expect(page.locator('#clientEditMsg')).toContainText('Intenta nuevamente');await expect(page.locator('#clientEditCompany')).toHaveValue('Comercial del Caribe revisada');
  await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#saveClientEdit').click();await expect(page.locator('#modal')).toBeHidden();await expect(page.locator('[data-client-id="fixture-client-0"]')).toContainText('Comercial del Caribe revisada');
  const sent=await writes(page);expect(sent.filter(c=>c.path==='/api/clients')).toHaveLength(2);expect(sent.find(c=>c.path==='/api/importers').body).toMatchObject({action:'sync_client',client_id:'fixture-client-0',importer_names:['Importadora de ejemplo','nueva importadora']});expect(sent.some(c=>c.body?.action==='resend_welcome')).toBe(false);
 });
}
for(const viewport of [{width:1440,height:700},{width:390,height:500}]){
 test(`Client creation: direct focus and failed save retain entered work at ${viewport.width}`,async({page},info)=>{
  await page.setViewportSize(viewport);await open(page,'clients');await page.locator('#newClient').click();await expect(page.locator('#clientName')).toBeFocused();
  await page.locator('#clientName').fill('María de ejemplo');await page.locator('#clientCompany').fill('Empresa nueva');await page.locator('#clientPhone').fill('+530000000002');await page.locator('#clientEmail').fill('nuevo@example.test');await page.locator('#clientImporters').fill('Importadora nueva');await hit(page,'#clientEmail');await fits(page);
  await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#saveClient').click();await expect(page.locator('#clientCreateMsg')).toContainText('No se pudo guardar');await expect(page.locator('#clientName')).toHaveValue('María de ejemplo');await hit(page,'#clientEmail');await shot(page,info,'nuevo-cliente-error');
  await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#saveClient').click();await expect(page.locator('#clientCreateMsg')).toContainText('Cliente guardado');await expect(page.locator('#clientName')).toHaveValue('');await expect(page.locator('#clientTotal')).toHaveText('3');
  const sent=await writes(page);expect(sent.filter(c=>c.path==='/api/clients'&&c.method==='POST')).toHaveLength(2);expect(sent[1].body).toMatchObject({name:'María de ejemplo',company:'Empresa nueva',phone:'+530000000002',email:'nuevo@example.test'});expect(sent.some(c=>c.body?.action==='resend_welcome')).toBe(false);
 });
}
test('Clients: read-only directory exposes only information and history',async({page})=>{
 await open(page,'clients',{writable:false});await expect(page.locator('#newClient')).toBeHidden();await expect(page.locator('#clientCreatePanel')).toBeHidden();await clientMenu(page);await expect(page.locator('[data-client-action]')).toHaveCount(2);await page.locator('[data-client-action="history"]').click();await expect(page.locator('.client-dialog-root')).toContainText('Cliente registrado');expect(await writes(page)).toEqual([]);
});
test('Clients: declining deletion preserves the client and returns focus',async({page},info)=>{
 await open(page,'clients');await clientMenu(page);await page.locator('[data-client-action="delete"]').click();await expect(page.locator('[data-client-decision-cancel]')).toBeFocused();await shot(page,info,'confirmar-cliente');await page.locator('[data-client-decision-cancel]').click();await expect(page.locator('[data-client-id="fixture-client-0"]')).toBeVisible();await expect(page.locator('[data-client-id="fixture-client-0"] [data-client-menu]')).toBeFocused();expect(await writes(page)).toEqual([]);
});
for(const width of [1440,390]){
 test(`Suppliers: keyboard states, search and detail at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:'dark'});await open(page,'suppliers');await fits(page);await shot(page,info,'proveedores',true);await expect(page.locator('[data-supplier-row]')).toHaveCount(2);
  await page.locator('[data-view="active"]').focus();await page.keyboard.press('End');await expect(page.locator('[data-view="all"]')).toBeFocused();await expect(page.locator('[data-supplier-row]')).toHaveCount(3);await page.keyboard.press('ArrowLeft');await expect(page.locator('[data-view="inactive"]')).toBeFocused();await expect(page.locator('[data-supplier-row]')).toHaveCount(1);await page.keyboard.press('Home');
  await page.locator('#supplierSearch').fill('Panamá');await expect(page.locator('[data-supplier-row]')).toHaveCount(1);await page.locator('#clearSupplierSearch').click();await expect(page.locator('#supplierSearch')).toBeFocused();
  await page.locator('[data-supplier-action="detail"][data-supplier-id="fixture-supplier-0"]').click();await expect(page.locator('#supplierDetailBody')).toContainText('ID-DEMO-018');await shot(page,info,'detalle-proveedor');await page.locator('#supplierDetailModal [data-close]').first().click();expect(await writes(page)).toEqual([]);
 });
}
for(const viewport of [{width:1440,height:700},{width:390,height:500}]){
 test(`Supplier creation: validation, long address and safe recovery at ${viewport.width}`,async({page},info)=>{
  await page.setViewportSize(viewport);await open(page,'suppliers');await page.locator('#newSupplier').click();await expect(page.locator('#supplierName')).toBeFocused();await page.locator('#saveSupplier').click();await expect(page.locator('#supplierFormMessage')).toContainText('Completa el nombre');expect(await writes(page)).toEqual([]);
  await page.locator('#supplierName').fill('Proveedor nuevo');await page.locator('#supplierEmail').fill('nuevo@example.test');await page.locator('#supplierAddress').fill('Dirección de ejemplo\nEdificio 2, oficina 18');await page.locator('#supplierNotes').fill('Conservar condiciones de compra.');await hit(page,'#supplierNotes');await shot(page,info,'nuevo-proveedor');await fits(page);
  await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#saveSupplier').click();await expect(page.locator('#supplierFormMessage')).not.toBeEmpty();await expect(page.locator('#supplierNotes')).toHaveValue('Conservar condiciones de compra.');await hit(page,'#supplierNotes');
  await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#saveSupplier').click();await expect(page.locator('#supplierModal')).toBeHidden();await expect(page.locator('#supplierTotalMetric')).toHaveText('4');const sent=await writes(page);expect(sent).toHaveLength(2);expect(sent[0].body).toEqual(sent[1].body);expect(sent[1].body.address).toBe('Dirección de ejemplo\nEdificio 2, oficina 18');
 });
}
test('Supplier editing keeps the original ID and all commercial fields',async({page})=>{
 await open(page,'suppliers');await page.locator('[data-supplier-action="detail"][data-supplier-id="fixture-supplier-0"]').click();await page.locator('#editSupplierFromDetail').click();await expect(page.locator('#supplierName')).toBeFocused();await expect(page.locator('#supplierCountry')).toHaveValue('China');await page.locator('#supplierNotes').fill('Datos revisados');await page.locator('#saveSupplier').click();await expect(page.locator('#supplierModal')).toBeHidden();expect((await writes(page))[0]).toMatchObject({method:'PATCH',body:{id:'fixture-supplier-0',action:'update',notes:'Datos revisados',tax_id:'ID-DEMO-018'}});
});
test('Supplier activation uses explicit confirmation and preserves history fields',async({page},info)=>{
 await open(page,'suppliers');const toggle=page.locator('[data-supplier-action="toggle"][data-supplier-id="fixture-supplier-0"]');await toggle.click();await expect(page.locator('#supplierDecisionCancel')).toBeFocused();await shot(page,info,'desactivar-proveedor');await page.locator('#supplierDecisionCancel').click();expect(await writes(page)).toEqual([]);await toggle.click();await page.locator('#supplierDecisionConfirm').click();await expect(page.locator('[data-supplier-row="fixture-supplier-0"]')).toHaveCount(0);await page.locator('[data-view="inactive"]').click();await expect(page.locator('[data-supplier-row="fixture-supplier-0"]')).toContainText('ventas@example.test');expect((await writes(page))[0].method).toBe('PATCH');
});
test('Suppliers: consultation capabilities hide mutations',async({page})=>{
 await open(page,'suppliers',{writable:false});await expect(page.locator('#newSupplier')).toBeHidden();await expect(page.locator('[data-supplier-action="edit"],[data-supplier-action="toggle"]')).toHaveCount(0);await page.locator('[data-supplier-action="detail"]').first().click();await expect(page.locator('#editSupplierFromDetail')).toBeHidden();expect(await writes(page)).toEqual([]);
});
test('Suppliers: failed reads provide a safe retry',async({page})=>{
 await open(page,'suppliers',{failRead:true});await expect(page.locator('[data-empty-action="retry"]')).toBeVisible();await expect(page.locator('body')).not.toContainText('Internal fixture');await page.evaluate(()=>window.__fixtureReadError=false);await page.locator('[data-empty-action="retry"]').click();await expect(page.locator('[data-supplier-row]')).toHaveCount(2);expect(await writes(page)).toEqual([]);
});
