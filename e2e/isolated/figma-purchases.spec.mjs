import { test, expect } from '@playwright/test';
import { purchasesFixture } from '../../scripts/lib/figma-purchases-fixture.mjs';

async function open(page,options){
  const html=purchasesFixture(options);
  await page.route('**/*',route=>route.request().url()==='https://erp-visual.invalid/'
    ?route.fulfill({contentType:'text/html',body:html}):route.abort());
  await page.goto('https://erp-visual.invalid/');await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.purchase-order-row')).toHaveCount(3);
}
async function posts(page){return page.evaluate(()=>window.__fixtureCalls.filter(call=>call.method==='POST').map(call=>call.body));}
async function shot(page,info,name){const path=info.outputPath(`${name}.png`);await page.screenshot({path,fullPage:name==='compras',scale:'css'});await info.attach(name,{path,contentType:'image/png'});}
async function fillOrder(page){
  await page.locator('#oSupplier').selectOption('fixture-supplier');
  await page.locator('#oWarehouse').selectOption('fixture-warehouse');
  await page.locator('.lProduct').selectOption('fixture-product');
  await page.locator('.lQty').fill('100');await page.locator('.lPallets').fill('10');
  await page.locator('.lPriceValue').fill('24');
}

test('Figma purchases: white list, search, views, actions and keyboard menus',async({page},info)=>{
  await page.emulateMedia({colorScheme:'dark'});await open(page);
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const mobile=page.viewportSize().width<=650;
  await expect(page.locator('.purchase-metric-mobile-label')).toBeVisible({visible:mobile});
  await expect(page.locator('.purchase-metric-desktop-label')).toBeVisible({visible:!mobile});
  await expect(page.locator('#metrics .metric:visible')).toHaveCount(mobile?3:5);
  const first=page.locator('.purchase-order-row').first();
  expect(await first.locator('[data-view-order]').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await shot(page,info,'compras');
  await first.locator('summary').click();await expect(first.locator('[data-edit-order]')).toBeVisible();
  await first.locator('[data-edit-order]').click();
  await expect(page.locator('[data-destination="direct"]')).toBeDisabled();
  await expect(page.locator('#oSupplier')).toBeDisabled();await expect(page.locator('.lProduct')).toBeDisabled();
  await expect(page.locator('#oDestinationHelp')).toContainText('protegido');
  await page.keyboard.press('Escape');await expect(first.locator('summary')).toBeFocused();
  await first.locator('summary').click();await page.keyboard.press('Escape');
  await expect(first.locator('details')).not.toHaveAttribute('open');
  await page.locator('#search').fill('REF-DEMO-47');await expect(page.locator('.purchase-order-row')).toHaveCount(1);
  await expect(page.locator('[data-direct-sale-order]')).toBeVisible();await expect(page.locator('[data-receive-order]')).toHaveCount(0);
  await page.locator('#search').fill('inexistente');await expect(page.locator('.empty')).toBeVisible();await expect(page.locator('#purchasesColumns')).not.toBeVisible();
  await page.locator('#search').fill('');
  for(const [view,count] of [['draft',1],['closed',1],['all',5],['open',3]]){
    await page.locator(`[data-view="${view}"]`).click();await expect(page.locator('.purchase-order-row')).toHaveCount(count);
    await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute('aria-pressed','true');
  }
  expect(await posts(page)).toEqual([]);
});

for(const viewport of [{width:390,height:500},{width:1440,height:700}]){
  test(`Purchase forms: destination, pricing, scroll and save at ${viewport.width}`,async({page},info)=>{
    await page.setViewportSize(viewport);await open(page);await page.locator('#newOrder').click();
    await expect(page.locator('#oSupplier')).toBeFocused();await fillOrder(page);
    await expect(page.locator('#orderTotalPreview')).toHaveText('USD 2,400.00');
    await page.locator('.lPriceMode').selectOption('total');await expect(page.locator('.lPriceValue')).toHaveValue('2400.00');
    await page.locator('.lPriceValue').fill('2500');await expect(page.locator('#orderTotalPreview')).toHaveText('USD 2,500.00');
    await page.locator('#orderTitle').scrollIntoViewIfNeeded();await shot(page,info,'compra-almacen');
    const dialog=page.locator('#orderModal .dialog');
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    const chevron=await page.locator('#oSupplier').evaluate(async el=>{
      const css=getComputedStyle(el),image=new Image();image.src=css.backgroundImage.slice(5,-2);await image.decode();
      return {width:image.naturalWidth,height:image.naturalHeight,size:css.backgroundSize};
    });
    expect(chevron).toEqual({width:18,height:18,size:'18px 18px'});
    await page.locator('[data-destination="direct"]').click();await expect(page.locator('#oWarehouseField')).not.toBeVisible();
    await expect(page.locator('#oWarehouse')).toHaveValue('');await expect(page.locator('#oDestinationHelp')).toContainText('Proveedor → cliente');
    await page.locator('#purchaseDestinationTitle').scrollIntoViewIfNeeded();await shot(page,info,'compra-direct-ship');
    await page.locator('#saveOrder').scrollIntoViewIfNeeded();
    const box=await page.locator('#saveOrder').boundingBox();expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height+1);
    await shot(page,info,'guardar-compra-visible');
    await page.locator('#saveOrder').focus();await page.keyboard.press('Tab');
    await expect(page.locator('[data-close="order"]').first()).toBeFocused();
    await page.locator('#saveOrder').click();await expect(page.locator('#orderModal')).not.toBeVisible();
    expect((await posts(page))[0]).toMatchObject({action:'create_plan',supplier_id:'fixture-supplier',warehouse_id:null,currency:'USD',lines:[{product_id:'fixture-product',ordered_quantity:'100',ordered_pallets:'10',units_per_pallet:'10',unit_cost:'',line_total:'2500'}]});
  });
}

test('Purchase drafts, line totals, validation and failed save preserve entered work',async({page})=>{
  await open(page);await page.locator('#newOrder').click();await fillOrder(page);
  await page.locator('#oReference').fill('Recuperar este borrador');await page.locator('[data-destination="direct"]').click();
  await page.keyboard.press('Escape');await page.locator('#newOrder').click();
  await expect(page.locator('#oReference')).toHaveValue('Recuperar este borrador');
  await expect(page.locator('[data-destination="direct"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#orderTotalPreview')).toHaveText('USD 2,400.00');
  await page.locator('#addOrderLine').click();await page.locator('.lPriceMode').last().selectOption('total');
  await page.locator('.lPriceValue').last().fill('100');await expect(page.locator('#orderTotalPreview')).toHaveText('USD 2,500.00');
  await page.locator('[data-remove-line]').last().click();await expect(page.locator('#orderTotalPreview')).toHaveText('USD 2,400.00');
  await page.locator('#oCurrency').fill('E');await expect(page.locator('#orderTotalPreview')).toHaveText('USD 2,400.00');
  await page.locator('#oCurrency').fill('EUR');await expect(page.locator('#orderTotalPreview')).toHaveText('EUR 2,400.00');
  await page.locator('.lQty').fill('90');await page.locator('#saveOrder').click();
  await expect(page.locator('#orderMsg')).toContainText('pallets');expect(await posts(page)).toEqual([]);
  await page.locator('.lQty').fill('100');await page.locator('[data-destination="warehouse"]').click();
  await page.locator('#oWarehouse').selectOption('fixture-warehouse');
  await page.evaluate(()=>{window.__fixtureRejectWrites=true});await page.locator('#saveOrder').click();
  await expect(page.locator('#orderMsg')).not.toBeEmpty();await expect(page.locator('#saveOrder')).toBeEnabled();
  await expect(page.locator('#oReference')).toHaveValue('Recuperar este borrador');
  await page.evaluate(()=>{window.__fixtureRejectWrites=false});await page.locator('#saveOrder').click();
  await expect(page.locator('#orderModal')).not.toBeVisible();
  expect((await posts(page)).at(-1)).toMatchObject({action:'create_plan',warehouse_id:'fixture-warehouse',currency:'EUR',lines:[{unit_cost:'24',line_total:''}]});
  await page.locator('#newOrder').click();await expect(page.locator('#oReference')).toHaveValue('');
});

test('Purchase rows obey backend capabilities for read-only operators',async({page})=>{
  await open(page,{writable:false});
  await expect(page.locator('.purchase-more,[data-receive-order],[data-direct-sale-order]')).toHaveCount(0);
  await page.locator('[data-view-order]').first().click();await expect(page.locator('#detailModal')).toBeVisible();
  await expect(page.locator('#detailActions button')).toHaveCount(0);expect(await posts(page)).toEqual([]);
});
