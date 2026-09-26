import { test,expect } from '@playwright/test';
import { warehouseFixture } from '../../scripts/lib/figma-warehouse-fixture.mjs';

async function open(page,{embedded=true,...options}={}){
  const url='https://erp-visual.invalid/'+(embedded?'?embedded=1':'');
  const html=warehouseFixture(options);
  await page.route('**/*',route=>route.request().url()===url?route.fulfill({contentType:'text/html',body:html}):route.abort());
  await page.goto(url);await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.warehouse-list-count')).toHaveText('3 recepciones');
}
async function writes(page){return page.evaluate(()=>window.__fixtureCalls.filter(c=>c.method!=='GET').map(c=>c.body));}
function records(page){return page.viewportSize().width>1100?page.locator('.desktop-table tbody tr'):page.locator('.receipt-card');}
async function shot(page,info,name){const path=info.outputPath(name+'.png');await page.screenshot({path,fullPage:name==='recepciones',scale:'css'});await info.attach(name,{path,contentType:'image/png'});}
async function fill(page){
  await page.locator('#rWarehouse').selectOption('fixture-warehouse');await page.locator('#rSupplier').selectOption('fixture-supplier');
  await page.locator('#rReference').fill('A-041');await page.locator('#rTruck').fill('TRK-104');
  await page.locator('.line-product').selectOption('fixture-product');await page.locator('.line-pallets').fill('2');
  await page.locator('.line-lot').fill('LOTE-026');await page.locator('.line-cost').fill('30');
}

test('Figma receipts: list, search, states, permitted actions and detail keyboard focus',async({page},info)=>{
  await page.emulateMedia({colorScheme:'dark'});await open(page);
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const rows=records(page);await expect(rows).toHaveCount(3);await expect(page.locator('#productsTab')).toBeHidden();
  await expect(rows.last().locator('[data-cancel-receipt]')).toHaveCount(0);
  await shot(page,info,'recepciones');
  const view=rows.first().locator('[data-view-receipt]');await view.click();
  await expect(page.locator('#detailTitle')).toHaveText('WR-DEMO-042');await expect(page.locator('#closeDetail')).toBeFocused();
  await expect(page.locator('#detailBody')).toContainText('80 paneles');
  await page.keyboard.press('Shift+Tab');await expect(page.locator('#closeDetailFooter')).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('#closeDetail')).toBeFocused();
  await shot(page,info,'detalle-recepcion');await page.keyboard.press('Escape');await expect(view).toBeFocused();
  await page.locator('#receiptSearch').fill('LOTE-025');await expect(records(page)).toHaveCount(1);
  await page.locator('#receiptSearch').fill('inexistente');await expect(page.locator('.warehouse-empty')).toContainText('No se encontraron');
  await page.locator('#receiptSearch').fill('');await page.locator('[data-receipt-view="cancelled"]').click();
  await expect(records(page)).toHaveCount(1);await expect(records(page).locator('[data-cancel-receipt]')).toHaveCount(0);
  await records(page).locator('[data-view-receipt]').click();await expect(page.locator('#detailBody > .pill')).toHaveText('Anulado');
  await page.locator('#closeDetailFooter').click();expect(await writes(page)).toEqual([]);
});

for(const viewport of [{width:390,height:500},{width:1440,height:700}]){
  test(`Receipt form: quantities, accessible fields, retry identity and visible save at ${viewport.width}`,async({page},info)=>{
    await page.setViewportSize(viewport);await open(page);await page.locator('#newReceipt').click();
    await expect(page.locator('#rWarehouse')).toBeFocused();await fill(page);
    await expect(page.locator('.line-upp')).toHaveValue('40');await expect(page.locator('.line-total')).toHaveValue('80 paneles');
    await expect(page.locator('.unit-fields')).toBeHidden();
    await page.locator('#receiptModalTitle').scrollIntoViewIfNeeded();await shot(page,info,'nueva-recepcion');
    await page.locator('[data-mode="units"]').click();await expect(page.locator('.pallet-fields')).toBeHidden();
    await page.getByLabel('Cantidad de unidades *',{exact:true}).fill('12');await expect(page.locator('.line-total')).toHaveValue('12 paneles');
    await page.locator('[data-mode="units"]').scrollIntoViewIfNeeded();await shot(page,info,'recepcion-unidades');
    expect(await page.locator('#receiptModal .modalbox').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    const asset=await page.locator('#rWarehouse').evaluate(async el=>{const css=getComputedStyle(el),image=new Image();image.src=css.backgroundImage.slice(5,-2);await image.decode();return {width:image.naturalWidth,height:image.naturalHeight,size:css.backgroundSize};});
    expect(asset).toEqual({width:18,height:18,size:'18px 18px'});
    const badFields=await page.locator('#receiptLines input,#receiptLines select').evaluateAll(nodes=>nodes.filter(n=>!n.labels?.length).map(n=>n.className));expect(badFields).toEqual([]);
    await page.locator('#saveReceipt').scrollIntoViewIfNeeded();
    const box=await page.locator('#saveReceipt').boundingBox();expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height+1);
    await shot(page,info,'guardar-wr-visible');await page.locator('#saveReceipt').focus();await page.keyboard.press('Tab');await expect(page.locator('#closeReceipt')).toBeFocused();
    await page.evaluate(()=>{window.__fixtureRejectWrites=true});await page.locator('#saveReceipt').click();
    await expect(page.locator('#rMsg')).toContainText('Reintenta sin cambiar los datos');await expect(page.locator('#saveReceipt')).toBeEnabled();
    await expect(page.locator('.line-quantity')).toHaveValue('12');await page.evaluate(()=>{window.__fixtureRejectWrites=false});
    await page.locator('#saveReceipt').click();await expect(page.locator('#receiptModal')).toBeHidden();
    const sent=await writes(page);expect(sent).toHaveLength(2);expect(sent[0].registration_request_id).toBe(sent[1].registration_request_id);
    expect(sent[1]).toMatchObject({action:'create_receipt',warehouse_id:'fixture-warehouse',supplier_id:'fixture-supplier',items:[{entry_mode:'units',quantity:'12',pallets:'',units_per_pallet:'',unit_cost:'30',currency:'USD'}]});
  });
}

test('Receipt cancellation requires explicit confirmation and only its dialog captures focus',async({page})=>{
  await open(page);const cancel=records(page).first().locator('[data-cancel-receipt]');await cancel.click();
  await expect(page.locator('#warehouseDecisionInput')).toBeFocused();await expect(page.locator('#warehouseDecisionConfirm')).toBeDisabled();
  await page.keyboard.press('Escape');await expect(cancel).toBeFocused();expect(await writes(page)).toEqual([]);
  await cancel.click();await page.locator('#warehouseDecisionInput').fill('ANULAR');await expect(page.locator('#warehouseDecisionConfirm')).toBeEnabled();
  await page.locator('#warehouseDecisionConfirm').click();await expect(records(page)).toHaveCount(2);
  expect(await writes(page)).toEqual([{action:'cancel_receipt',id:'fixture-wr-0'}]);
});

test('Read-only receipt operators can consult warehouses and detail without write controls',async({page})=>{
  await open(page,{writable:false});await expect(page.locator('#newReceipt')).toBeDisabled();
  await expect(page.locator('#warehouseReadOnlyNote')).toBeVisible();await expect(page.locator('[data-cancel-receipt]')).toHaveCount(0);
  await page.locator('#warehousesTab').click();await expect(page.locator('#warehousesPane')).toBeVisible();
  await expect(page.locator('#saveWarehouse')).toBeDisabled();await expect(page.locator('[data-toggle-warehouse]')).toHaveCount(0);
  await page.locator('#receiptsTab').click();await records(page).first().locator('[data-view-receipt]').click();
  await expect(page.locator('#detailModal')).toBeVisible();expect(await writes(page)).toEqual([]);
});

test('Standalone receipt catalog: nested dialog restores focus and lines keep unique labels',async({page})=>{
  await open(page,{embedded:false});await expect(page.locator('#productsTab')).toBeVisible();
  await page.locator('#newReceipt').click();await page.locator('[data-new-product]').click();
  await expect(page.locator('#qpName')).toBeFocused();await page.locator('#saveQuickProduct').focus();await page.keyboard.press('Tab');
  await expect(page.locator('#closeQuickProduct')).toBeFocused();await page.keyboard.press('Escape');
  await expect(page.locator('[data-new-product]')).toBeFocused();await expect(page.locator('#receiptModal')).toBeVisible();
  await page.locator('#addLine').click();await page.locator('[data-remove-line]').first().click();
  await expect(page.locator('#receiptLines .line-head b')).toHaveText('Línea 1');
  const ids=await page.locator('#receiptLines [id]').evaluateAll(nodes=>nodes.map(n=>n.id));expect(new Set(ids).size).toBe(ids.length);
  await page.keyboard.press('Escape');await expect(page.locator('#newReceipt')).toBeFocused();expect(await writes(page)).toEqual([]);
});
