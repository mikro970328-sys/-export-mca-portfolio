import {test,expect} from '@playwright/test';
import {desktopIntegrationFixture,desktopSections} from '../../scripts/lib/figma-desktop-integration-fixture.mjs';
import {purchasesFixture} from '../../scripts/lib/figma-purchases-fixture.mjs';
async function route(page,html){
 await page.route('**/*',r=>r.request().url()==='https://erp-visual.invalid/'?r.fulfill({contentType:'text/html',body:html}):r.request().url().startsWith('https://erp-visual.invalid/admin/')?r.fulfill({contentType:'text/html',body:'<!doctype html><html><body><p>Vista aislada</p></body></html>'}):r.abort());
 await page.goto('https://erp-visual.invalid/');await page.evaluate(()=>document.fonts.ready);await page.emulateMedia({reducedMotion:'reduce'});
}
async function shot(page,info,name){const path=info.outputPath(name+'.png');await page.screenshot({path,scale:'css',animations:'disabled'});await info.attach(name,{path,contentType:'image/png'});}
for(const module of Object.keys(desktopSections))test(`Integrated shell: ${module} uses its available desktop width`,async({page},info)=>{
 await page.setViewportSize({width:1440,height:1000});await route(page,desktopIntegrationFixture(module));
 const section=page.locator('#'+desktopSections[module]);await expect(section).toBeVisible();await expect(section.locator('h1,h2').first()).toBeVisible();
 await expect(page.locator('#sidebar')).toHaveCSS('width','224px');const main=page.locator('.main-shell>main');await expect(main).toHaveCSS('margin','0px');
 const box=await main.boundingBox();expect(box.x).toBe(224);expect(box.y).toBe(60);expect(box.width).toBe(1216);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);await shot(page,info,'escritorio-'+module);
 await page.evaluate(()=>window.NavigationShell.collapse());await expect(main).toHaveCSS('width','1360px');
 await page.setViewportSize({width:1024,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
 expect(await page.evaluate(()=>window.__fixtureCalls.filter(c=>c.method!=='GET'))).toEqual([]);
});
for(const width of [1440,390])test(`Integrated navigation preserves native and embedded viewport at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:800});await route(page,desktopIntegrationFixture('dashboard'));await expect(page.locator('.executive-op-card')).toHaveCount(10);
 await page.evaluate(()=>window.NavigationShell.openPurchases());const frame=page.locator('#purchasesSection iframe');await expect(frame).toBeVisible();const rect=await frame.boundingBox();expect(rect.y).toBe(60);expect(rect.height).toBe(740);expect(rect.x+rect.width).toBe(width);
 await page.evaluate(()=>{window.showSection('dashboardSection');window.dispatchEvent(new CustomEvent('export-mca:section-changed',{detail:{id:'dashboardSection'}}));});await expect(page.locator('#dashboardSection')).toBeVisible();await expect(page.locator('#purchasesSection')).toBeHidden();
 await page.locator('#navigationSearch').isVisible().then(async visible=>{if(!visible)await page.locator('#mobileMenuBtn').click();});await page.locator('#navigationSearch').fill('compras');await expect(page.locator('[data-section="purchasesSection"]')).toBeVisible();await page.locator('[data-section="purchasesSection"]').click();await expect(frame).toBeVisible();if(width===390)await expect(page.locator('body')).not.toHaveClass(/mobile-menu-open/);await shot(page,info,'navegacion-'+width);
});
async function openPurchase(page){await route(page,purchasesFixture({related:true}));await expect(page.locator('.purchase-order-row')).toHaveCount(3);}
async function resolveRelated(page,index=0,many=false){await page.evaluate(({index,many})=>{
 const po='fixture-po-'+index,number='PO-DEMO-024'+(8-index),pending=window.__fixtureRelatedPending;
 pending['receipts:'+number].resolve({receipts:Array.from({length:many?24:1},(_,i)=>({receipt_number:'WR-DEMO-'+index+'-'+i,receipt_status:'received'}))});
 pending['bills:'+po].resolve(Array.from({length:many?12:1},(_,i)=>({bill_number:'BILL-DEMO-'+index+'-'+i,bill_status:'posted',supplier_bill_id:'bill-'+i})));
 pending['payments:'+po].resolve([{payment_number:'PAY-DEMO-'+index,payment_status:'posted',supplier_payment_id:'payment-0'}]);
 },{index,many});}
for(const width of [1440,390])test(`Purchase actions stay in place while related records load at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await openPurchase(page);await page.locator('[data-view-order="fixture-po-0"]').click();await expect(page.locator('#purchaseRelations')).not.toHaveAttribute('open');
 await page.locator('#purchaseRelations summary').click();const cancel=page.locator('[data-detail-action="cancel"]');await cancel.scrollIntoViewIfNeeded();const before=await cancel.boundingBox();
 await resolveRelated(page,0,true);await expect(page.locator('#purchaseAPContext [aria-busy]')).toHaveAttribute('aria-busy','false');await expect(page.locator('#purchaseOperationalContextReceipts button')).toHaveCount(24);
 const after=await cancel.boundingBox();expect(Math.abs(after.y-before.y)).toBeLessThanOrEqual(1);expect(Math.abs(after.x-before.x)).toBeLessThanOrEqual(1);await shot(page,info,'compra-relaciones-'+width);
 await page.mouse.click(before.x+before.width/2,before.y+before.height/2);await expect(page.locator('#purchaseDecisionTitle')).toHaveText('Cancelar compra');await page.keyboard.press('Escape');expect(await page.evaluate(()=>window.__fixtureCalls.filter(c=>c.method==='POST'))).toEqual([]);
});
test('Purchase relations ignore responses for a closed or replaced order',async({page})=>{
 await openPurchase(page);await page.locator('[data-view-order="fixture-po-0"]').click();await page.keyboard.press('Escape');await page.locator('[data-view-order="fixture-po-1"]').click();await resolveRelated(page,0);await page.locator('#purchaseRelations summary').click();await expect(page.locator('#purchaseRelations')).not.toContainText('WR-DEMO-0');await resolveRelated(page,1);await expect(page.locator('#purchaseOperationalContextReceipts')).toContainText('WR-DEMO-1-0');
 await page.locator('#purchaseOperationalContextSupplier button').click();await page.locator('#purchaseOperationalContextReceipts button').click();await page.locator('#purchaseAPContext button').first().click();expect(await page.evaluate(()=>window.__fixtureRelatedOpened)).toEqual([{supplier:{supplierId:'fixture-supplier'}},{receipt:{receiptNumber:'WR-DEMO-1-0'}},{bill:'bill-0'}]);
});
test('Purchase relationship errors retry safely and receipt navigation uses its owner',async({page})=>{
 await openPurchase(page);await page.locator('[data-view-order="fixture-po-0"]').click();await page.locator('#purchaseRelations summary').click();await page.evaluate(()=>window.__fixtureRelatedPending['receipts:PO-DEMO-0248'].reject(Error('PRIVATE_FAILURE')));await expect(page.locator('#purchaseOperationalContextReceipts')).not.toContainText('PRIVATE_FAILURE');await page.locator('#purchaseOperationalContextReceipts button').click();await resolveRelated(page);await expect(page.locator('#purchaseOperationalContextReceipts button')).toHaveText('WR-DEMO-0-0');await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>window.openOperationalPurchaseReceipt('fixture-po-0'))).toBe(true);await expect(page.locator('#receiveModal')).toBeVisible();expect(await page.evaluate(()=>window.openOperationalPurchaseReceipt('fixture-po-1'))).toBe(false);expect(await page.evaluate(()=>window.__fixtureCalls.filter(c=>c.method==='POST'))).toEqual([]);
});
