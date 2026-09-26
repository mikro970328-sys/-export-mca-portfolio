import { test,expect } from '@playwright/test';
import { stockCatalogFixture } from '../../scripts/lib/figma-stock-catalog-fixture.mjs';

async function open(page,options={}) {
  const url='https://erp-visual.invalid/?embedded=1',html=stockCatalogFixture(options);
  await page.route('**/*',route=>route.request().url()===url?route.fulfill({contentType:'text/html',body:html}):route.abort());
  await page.goto(url);await page.evaluate(()=>document.fonts.ready);
  if(!options.failRead)await expect(page.locator(options.module==='products'?'.product-card':'.inventory-row')).toHaveCount(2);
}
const writes=page=>page.evaluate(()=>window.__fixtureCalls.filter(c=>c.method!=='GET'));
const sources=page=>page.locator(page.viewportSize().width>1100?'.inventory-source-desktop tbody tr':'.inventory-source-card');
const traces=page=>page.locator(page.viewportSize().width>820?'.inventory-trace-desktop tbody tr':'.inventory-trace-card');
async function shot(page,info,name,fullPage=false){const path=info.outputPath(name+'.png');await page.screenshot({path,fullPage,scale:'css'});await info.attach(name,{path,contentType:'image/png'});}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}

test('Stock: conserved balances, search, WR expansion, keyboard tabs and trace filter',async({page},info)=>{
  await page.emulateMedia({colorScheme:'dark'});await open(page);await noOverflow(page);
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.locator('#stats b')).toHaveText(['2','3','1','2']);
  await expect(page.locator('.inventory-list-summary')).toContainText('2 combinaciones');
  await shot(page,info,'existencias',true);
  const first=page.locator('[data-toggle-inventory]').first();await first.click();await expect(first).toHaveAttribute('aria-expanded','true');
  await expect(sources(page)).toHaveCount(3);await expect(sources(page).first()).toContainText('WR-DEMO-042');
  await expect(sources(page).first()).toContainText('40 paneles');await noOverflow(page);await shot(page,info,'saldo-wr',true);
  const asset=await page.locator('#warehouseFilter').evaluate(async el=>{const css=getComputedStyle(el),image=new Image();image.src=css.backgroundImage.slice(5,-2);await image.decode();return {width:image.naturalWidth,height:image.naturalHeight,size:css.backgroundSize};});
  expect(asset).toEqual({width:18,height:18,size:'18px 18px'});
  await sources(page).first().locator('[data-trace-wr]').click();
  await expect(page.locator('#traceTab')).toHaveAttribute('aria-selected','true');await expect(page.locator('#search')).toHaveValue('WR-DEMO-042');
  await expect(traces(page)).toHaveCount(2);await expect(traces(page).first()).toContainText('Reserva para cargue');
  await shot(page,info,'trazabilidad-wr',true);
  await page.locator('#traceTab').focus();await page.keyboard.press('ArrowLeft');await expect(page.locator('#stockTab')).toBeFocused();
  await expect(page.locator('#stockView')).toBeVisible();await page.locator('#clearFilters').click();await expect(page.locator('#search')).toBeFocused();
  await page.locator('#warehouseFilter').selectOption('fixture-other');await expect(page.locator('.inventory-row')).toHaveCount(1);
  await expect(page.locator('.inventory-product-name')).toHaveText('Aceite de soya 35 lb');
  await expect(page.locator('#stats b')).toHaveText(['1','1','0','1']);
  await page.locator('#search').fill('no-existe');await expect(page.locator('.inventory-empty')).toContainText('Sin coincidencias');
  expect(await writes(page)).toEqual([]);
});

test('Stock: unavailable data is safe and retry restores the list',async({page})=>{
  await open(page,{failRead:true});await expect(page.locator('#inventoryFeedback')).toContainText('No se pudo cargar Inventario');
  await expect(page.locator('body')).not.toContainText('Internal database');
  await page.evaluate(()=>{window.__fixtureReadError=false});await page.locator('#inventoryRetry').click();
  await expect(page.locator('.inventory-row')).toHaveCount(2);await expect(page.locator('#inventoryFeedback')).toBeHidden();expect(await writes(page)).toEqual([]);
});

test('Catalog: identity, states, search, detail focus and explicit activation confirmation',async({page},info)=>{
  await page.emulateMedia({colorScheme:'dark'});await open(page,{module:'products'});await noOverflow(page);
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.locator('#productsMetrics b')).toHaveText(['3','2','1','3','2']);await shot(page,info,'productos',true);
  const view=page.locator('[data-product-row="fixture-panel"] [data-product-action="detail"]');await view.click();
  await expect(page.locator('#productDetailTitle')).toContainText('Panel solar 620W');await expect(page.locator('#productDetailBody')).toContainText('0.08 m³');
  const close=page.locator('#productDetailModal .product-close');await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(page.locator('#editProductFromDetail')).toBeFocused();
  await page.keyboard.press('Tab');await expect(close).toBeFocused();await shot(page,info,'detalle-producto');
  await page.keyboard.press('Escape');await expect(view).toBeFocused();
  await page.locator('#productSearch').fill('1507');await expect(page.locator('.product-card')).toHaveCount(1);await expect(page.locator('.product-name')).toHaveText('Aceite de soya 35 lb');
  await page.locator('#productSearch').fill('');await page.locator('[data-view="active"]').focus();await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-view="inactive"]')).toBeFocused();await expect(page.locator('.product-name')).toHaveText('Producto histórico');
  await page.locator('[data-product-action="toggle"]').click();await expect(page.locator('#productDecisionCancel')).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(page.locator('#productDecisionConfirm')).toBeFocused();
  await page.keyboard.press('Escape');expect(await writes(page)).toEqual([]);
  await page.locator('[data-product-action="toggle"]').click();await page.locator('#productDecisionConfirm').click();
  await expect(page.locator('#productMessage')).toHaveText('Producto reactivado.');
  expect((await writes(page)).map(c=>c.body)).toEqual([{action:'set_active',id:'fixture-old',active:true}]);
});

for(const viewport of [{width:1440,height:700},{width:390,height:500}]){
  test(`Product form: create, edit, draft, validation and retained values after failure at ${viewport.width}`,async({page},info)=>{
    await page.setViewportSize(viewport);await open(page,{module:'products'});await page.locator('#newProduct').click();
    await expect(page.locator('#productName')).toBeFocused();await page.locator('#saveProduct').click();
    await expect(page.locator('#productFormMessage')).toContainText('Completa el nombre');expect(await writes(page)).toEqual([]);
    await page.locator('#productName').fill('Producto nuevo');await page.locator('#productSku').fill('NUEVO-001');await page.locator('#productUnit').fill('cajas');
    await page.locator('#productUnitsPallet').fill('20');await page.locator('#productNotes').fill('Conservar en seco.');
    await page.keyboard.press('Escape');await expect(page.locator('#newProduct')).toBeFocused();await page.locator('#newProduct').click();
    await expect(page.locator('#productName')).toHaveValue('Producto nuevo');await expect(page.locator('#productNotes')).toHaveValue('Conservar en seco.');
    const unlabeled=await page.locator('#productForm input,#productForm textarea').evaluateAll(nodes=>nodes.filter(n=>!n.labels?.length).map(n=>n.id));expect(unlabeled).toEqual([]);
    await page.locator('#productName').scrollIntoViewIfNeeded();await shot(page,info,'formulario-producto');
    expect(await page.locator('#productModal .product-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.locator('#saveProduct').scrollIntoViewIfNeeded();const box=await page.locator('#saveProduct').boundingBox();expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height+1);
    await page.locator('#saveProduct').focus();await page.keyboard.press('Tab');await expect(page.locator('#productModal .product-close')).toBeFocused();
    await page.evaluate(()=>{window.__fixtureRejectWrites=true});await page.locator('#saveProduct').click();
    await expect(page.locator('#productFormMessage')).toContainText('No se pudo guardar');await expect(page.locator('#productName')).toHaveValue('Producto nuevo');
    await expect(page.locator('#saveProduct')).toBeEnabled();await expect(page.locator('body')).not.toContainText('Internal write');
    await shot(page,info,'producto-error-recuperable');await page.evaluate(()=>{window.__fixtureRejectWrites=false});await page.locator('#saveProduct').click();
    await expect(page.locator('#productModal')).toBeHidden();await expect(page.locator('.product-card')).toHaveCount(3);
    const sent=await writes(page);expect(sent).toHaveLength(2);expect(sent[1].method).toBe('POST');expect(sent[1].body).toMatchObject({name:'Producto nuevo',sku:'NUEVO-001',unit:'cajas',default_units_per_pallet:'20',notes:'Conservar en seco.'});
    await page.locator('[data-product-row="fixture-created"] [data-product-action="edit"]').click();await page.locator('#productName').fill('Producto actualizado');await page.locator('#saveProduct').click();
    await expect(page.locator('[data-product-row="fixture-created"] .product-name')).toHaveText('Producto actualizado');
    const edited=(await writes(page)).at(-1);expect(edited.method).toBe('PATCH');expect(edited.body).toMatchObject({id:'fixture-created',action:'update',name:'Producto actualizado'});
  });
}

test('Catalog read-only permissions and failed read cannot expose mutations or raw errors',async({page})=>{
  await open(page,{module:'products',writable:false,failRead:true});await expect(page.locator('#productMessage')).toContainText('No se pudo cargar Productos');
  await expect(page.locator('body')).not.toContainText('Internal database');await page.evaluate(()=>{window.__fixtureReadError=false});await page.locator('[data-empty-action="retry"]').click();
  await expect(page.locator('.product-card')).toHaveCount(2);await expect(page.locator('#newProduct')).toBeHidden();await expect(page.locator('#productsReadOnlyNote')).toBeVisible();
  await expect(page.locator('[data-product-action="edit"],[data-product-action="toggle"]')).toHaveCount(0);
  await page.locator('[data-product-action="detail"]').first().click();await expect(page.locator('#editProductFromDetail')).toBeHidden();
  await page.keyboard.press('Shift+Tab');await expect(page.locator('#productDetailModal .product-dialog-actions [data-close]')).toBeFocused();
  await page.keyboard.press('Escape');await page.evaluate(()=>window.ProductsModule.openProduct());await expect(page.locator('#productModal')).toBeHidden();expect(await writes(page)).toEqual([]);
});
