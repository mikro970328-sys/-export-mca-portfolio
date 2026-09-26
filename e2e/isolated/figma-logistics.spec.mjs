import { test,expect } from '@playwright/test';
import { logisticsFixture } from '../../scripts/lib/figma-logistics-fixture.mjs';
async function open(page,options={}){
  const url='https://erp-visual.invalid/?embedded=1',html=logisticsFixture(options);
  await page.route('**/*',route=>route.request().url()===url?route.fulfill({contentType:'text/html',body:html}):route.abort());
  await page.goto(url);await page.evaluate(()=>document.fonts.ready);
  if(options.module==='tracking')await page.waitForFunction(()=>window.ContainersModule);
  else if(!options.failRead)await expect(page.locator('#loadCount')).toHaveText('4 cargues');
}
const writes=page=>page.evaluate(()=>window.__fixtureCalls.filter(c=>c.method!=='GET'));
const loadRows=page=>page.locator(page.viewportSize().width>840?'#loadRows tr':'#loadCards .load-card');
const shipmentRows=page=>page.locator(page.viewportSize().width>900?'.tracking-table tbody tr':'.tracking-card');
async function shot(page,info,name,fullPage=false){const path=info.outputPath(name+'.png');await page.screenshot({path,fullPage,scale:'css',animations:'disabled'});await info.attach(name,{path,contentType:'image/png'});}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
async function hit(page,selector){const target=page.locator(selector);await target.scrollIntoViewIfNeeded();expect(await target.evaluate(el=>{const r=el.getBoundingClientRect();return r.y>=0&&r.bottom<=innerHeight+1&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;})).toBe(true);}

test('Cargues: filtered stages, detail, WR allocation and nested container form',async({page},info)=>{
  await page.emulateMedia({colorScheme:'dark'});await open(page);await noOverflow(page);
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');await shot(page,info,'cargues',true);
  await page.locator('#statusFilter').selectOption('draft');await expect(loadRows(page)).toHaveCount(1);
  await page.locator('#clearFilters').click();await expect(page.locator('#search')).toBeFocused();
  await page.locator('#search').fill('CG-DEMO-018');await expect(loadRows(page)).toHaveCount(1);
  const trigger=page.locator('[data-open-load="fixture-load-0"]:visible').first();await trigger.click();
  await expect(page.locator('#drawerTitle')).toHaveText('CG-DEMO-018');await expect(page.locator('#drawerModal [data-close]')).toBeFocused();
  await expect(page.locator('#drawerBody')).toContainText('WR-DEMO-042');await expect(page.locator('#drawerBody')).toContainText('80 paneles · 2 pallets');
  await shot(page,info,'detalle-cargue');
  await page.locator('[data-action="container"]').click();await expect(page.locator('#containerModal [data-close]')).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(page.locator('#assignExisting')).toBeFocused();await page.keyboard.press('Tab');await expect(page.locator('#containerModal [data-close]')).toBeFocused();
  await page.locator('#containerNumber').fill('MCA-NUEVO-019');await page.locator('#containerClient').selectOption('fixture-client');await page.locator('#containerImporter').selectOption('fixture-importer');
  await shot(page,info,'asignar-contenedor');await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#createContainer').click();
  await expect(page.locator('#containerMsg')).toContainText('No se pudo completar');await expect(page.locator('#containerNumber')).toHaveValue('MCA-NUEVO-019');
  await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#createContainer').click();await expect(page.locator('#containerModal')).toBeHidden();
  await expect(page.locator('#drawerBody')).toContainText('MCA-NUEVO-019');expect((await writes(page)).at(-1).body).toMatchObject({action:'create_container',load_id:'fixture-load-0',container_number:'MCA-NUEVO-019',client_id:'fixture-client',importer_id:'fixture-importer'});
});

for(const viewport of [{width:1440,height:700},{width:390,height:500}]){
  test(`Cargues: WR quantities, limits, focus and safe retry at ${viewport.width}`,async({page},info)=>{
    await page.setViewportSize(viewport);await open(page);await page.locator('#newLoad').click();await expect(page.locator('#planModal [data-close]').first()).toBeFocused();
    await page.locator('#savePlan').click();await expect(page.locator('#planMsg')).toHaveText('Selecciona un almacén.');expect(await writes(page)).toEqual([]);
    await page.locator('#planWarehouse').selectOption('fixture-warehouse');await page.locator('#planNotes').fill('Conservar esta planificación.');
    const q=page.locator('[data-q]'),p=page.locator('[data-p]');await q.first().fill('41');await page.locator('#savePlan').click();
    await expect(page.locator('#planMsg')).toContainText('supera el saldo disponible de 40');expect(await writes(page)).toEqual([]);
    await q.first().fill('13');await p.first().fill('1');await p.nth(1).fill('1');
    expect(await page.locator('#sourceGroups input').evaluateAll(nodes=>nodes.every(n=>n.labels.length===1))).toBe(true);
    await hit(page,'#planNotes');await shot(page,info,'plan-por-wr');await noOverflow(page);
    await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#savePlan').click();await expect(page.locator('#planMsg')).toContainText('No se pudo completar');
    await expect(page.locator('#planNotes')).toHaveValue('Conservar esta planificación.');await expect(q.first()).toHaveValue('13');await expect(page.locator('#savePlan')).toBeEnabled();
    await hit(page,'#planNotes');await page.locator('#planMsg').scrollIntoViewIfNeeded();await shot(page,info,'plan-error-recuperable');
    await page.locator('#savePlan').focus();await page.keyboard.press('Tab');await expect(page.locator('#planModal [data-close]').first()).toBeFocused();
    await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#savePlan').click();await expect(page.locator('#planModal')).toBeHidden();
    await expect(page.locator('#drawerTitle')).toHaveText('CG-DEMO-019');const sent=(await writes(page)).at(-1).body;
    expect(sent).toMatchObject({action:'create_plan',warehouse_id:'fixture-warehouse',notes:'Conservar esta planificación.'});
    expect(sent.lines).toEqual([{product_id:'fixture-product',unit:'paneles',planned_quantity:13,planned_pallets:2,allocations:[{receipt_item_id:'fixture-source-0',allocated_quantity:13,allocated_pallets:1},{receipt_item_id:'fixture-source-1',allocated_quantity:0,allocated_pallets:1}]}]);
  });
}

test('Cargues: unavailable data and read-only capabilities',async({page})=>{
  await open(page,{writable:false,failRead:true});await expect(page.locator('#pageMsg')).toContainText('No se pudieron cargar');await expect(page.locator('body')).not.toContainText('Internal fixture');
  await page.evaluate(()=>window.__fixtureReadError=false);await page.locator('#loadsRetry').click();await expect(page.locator('#newLoad')).toBeHidden();await expect(page.locator('[data-quick-action]')).toHaveCount(0);
  await page.locator('[data-open-load="fixture-load-0"]:visible').first().click();await expect(page.locator('#drawerBody [data-action="start_loading"]')).toBeDisabled();
  await expect(page.locator('#drawerBody [data-action="container"]')).toHaveCount(0);await page.keyboard.press('Escape');await expect(page.locator('#drawerModal')).toBeHidden();expect(await writes(page)).toEqual([]);
});

for(const width of [1440,390]){
  test(`Tracking: list, search, documents and history at ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:'dark'});await open(page,{module:'tracking'});await noOverflow(page);
    await expect(shipmentRows(page)).toHaveCount(3);await expect(page.locator('#trackingDocumentsReadyCount')).toHaveText('1');await expect(page.locator('#trackingDocumentsPendingCount')).toHaveText('1');
    await shot(page,info,'tracking',true);await page.locator('#shipmentSearch').fill('Importadora de ejemplo');await expect(shipmentRows(page)).toHaveCount(2);
    await page.locator('#trackingClearFilters').click();await expect(page.locator('#shipmentSearch')).toBeFocused();await page.locator('[data-container-filter="delivered"]').click();await expect(page.locator('.tracking-empty')).toBeVisible();
    await page.locator('[data-container-filter="active"]').click();await shipmentRows(page).first().click();await expect(page.locator('.container-customs')).toBeVisible();
    await expect(page.locator('.container-customs')).toContainText('packing-list-cuba.pdf');await expect(page.locator('.container-customs-versions')).toContainText('packing-list-original.pdf');
    await expect(page.locator('[data-customs-open]')).toHaveCount(2);await expect(page.locator('[data-customs-upload]')).toHaveCount(2);await expect(page.locator('[data-customs-delete]')).toHaveCount(1);
    await page.locator('.container-customs').scrollIntoViewIfNeeded();await shot(page,info,'documentos-cuba');await noOverflow(page);
    await page.locator('#closeModal').click();await shipmentRows(page).first().locator('[data-container-menu]').click();await page.locator('[data-container-action="history"]').click();
    await expect(page.locator('.tracking-history')).toContainText('Reserva registrada');await shot(page,info,'historial-tracking');expect(await writes(page)).toEqual([]);
  });
}

for(const viewport of [{width:1440,height:700},{width:390,height:500}]){
  test(`Tracking: registration and editor retain data on failure at ${viewport.width}`,async({page},info)=>{
    await page.setViewportSize(viewport);await open(page,{module:'tracking'});await page.locator('#trackingRegisterShortcut').click();
    await page.locator('#saveShipment').click();await expect(page.locator('#shipmentMsg')).toContainText('4 letras y 7 números');expect(await writes(page)).toEqual([]);
    await page.locator('#shipmentContainer').fill('ABCD1234567');await page.locator('#shipmentClient').selectOption('fixture-client');await page.locator('#shipmentImporter').fill('Importadora de ejemplo');await page.locator('#shipmentProduct').fill('Panel solar 620W');await page.locator('#shipmentQuantity').fill('80');await page.locator('#shipmentQuantityUnit').fill('paneles');
    await page.locator('#shipmentContainer').scrollIntoViewIfNeeded();await shot(page,info,'registro-contenedor');await noOverflow(page);
    await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#saveShipment').click();await expect(page.locator('#shipmentMsg')).toContainText('No se pudo registrar');await expect(page.locator('#shipmentContainer')).toHaveValue('ABCD1234567');
    await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#saveShipment').click();await expect(page.locator('#shipmentMsg')).toContainText('registrado correctamente');
    expect((await writes(page)).filter(c=>c.method==='POST').at(-1).body).toMatchObject({container_number:'ABCD1234567',client_id:'fixture-client',quantity:'80',quantity_unit:'paneles'});
    await page.evaluate(()=>window.showSection('containersSection'));await page.locator('[data-container-menu="fixture-created-shipment"]:visible').click();await page.locator('[data-container-action="edit"]').click();
    await expect(page.locator('#editorContainer')).toBeFocused();await page.locator('#editorContainer').fill('PROVISIONAL-019');await page.locator('#editorProduct').fill('Panel actualizado');
    await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#shipmentEditorSave').click();await expect(page.locator('#shipmentEditorMessage')).toContainText('No se pudieron guardar');await expect(page.locator('#editorContainer')).toHaveValue('PROVISIONAL-019');
    await hit(page,'#editorContainer');await shot(page,info,'editar-contenedor');await expect(page.locator('#shipmentEditorSave')).toBeEnabled();await noOverflow(page);
    await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#shipmentEditorSave').click();await expect(page.locator('#modal')).toBeHidden();
    expect((await writes(page)).filter(c=>c.path==='/api/shipments'&&c.method==='PATCH').at(-1).body).toMatchObject({id:'fixture-created-shipment',container_number:'PROVISIONAL-019',product:'Panel actualizado'});
  });
}

test('Tracking: manual event uses visible radios, keyboard and safe retry',async({page},info)=>{
  await open(page,{module:'tracking'});await shipmentRows(page).first().locator('[data-container-menu]').click();await page.locator('[data-container-action="manual_update"]').click();
  await expect(page.locator('.manual-track-close')).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(page.locator('.manual-track-confirm')).toBeFocused();await page.keyboard.press('Tab');await expect(page.locator('.manual-track-close')).toBeFocused();
  const radio=page.locator('input[name="manualTrackingEvent"][value="departed"]');await radio.focus();await page.keyboard.press('ArrowRight');
  await expect(page.locator('input[value="arrived"]')).toBeChecked();await expect(page.locator('#manualTrackingNotice')).toContainText('no envía WhatsApp');
  await page.locator('input[value="released"]').check();await expect(page.locator('#manualTrackingNotice')).toContainText('enviará WhatsApp automáticamente');
  await page.locator('input[value="arrived"]').check();await page.locator('#manualTrackingLocation').fill('Puerto de prueba');await shot(page,info,'actualizar-seguimiento');
  await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('.manual-track-confirm').click();await expect(page.locator('#manualTrackingNotice')).toContainText('No se pudo actualizar');await expect(page.locator('#manualTrackingLocation')).toHaveValue('Puerto de prueba');
  await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('.manual-track-confirm').click();await expect(page.locator('[data-manual-track]')).toHaveCount(0);expect((await writes(page)).at(-1).body).toEqual({id:'fixture-shipment-0',event:'arrived',location:'Puerto de prueba'});
});

test('Tracking: reader can consult versions without mutations',async({page})=>{
  await open(page,{module:'tracking',writable:false});await expect(page.locator('#trackingRegisterShortcut')).toBeHidden();await shipmentRows(page).first().click();
  await expect(page.locator('[data-customs-open]')).toHaveCount(2);await expect(page.locator('[data-customs-upload],[data-customs-delete]')).toHaveCount(0);await page.locator('#closeModal').click();
  await shipmentRows(page).first().locator('[data-container-menu]').click();await expect(page.locator('[data-container-action]')).toHaveCount(3);await expect(page.locator('[data-container-action="edit"],[data-container-action="manual_update"]')).toHaveCount(0);expect(await writes(page)).toEqual([]);
});
