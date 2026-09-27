import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { financeFixture } from '../../scripts/lib/figma-finance-fixture.mjs';

async function open(page,module='invoices',options={}){
  const url='https://erp-visual.invalid/?embedded=1',html=financeFixture({module,...options});
  await page.route('**/*',route=>route.request().url()===url?route.fulfill({contentType:'text/html',body:html}):route.abort());
  await page.goto(url);await page.evaluate(()=>document.fonts.ready);
  if(!options.failRead)await expect(page.locator(module==='invoices'?'#invoiceResultCount':module==='payables'?'#payablesResultCount':'#reportResultCount')).not.toContainText('Consultando');
}
const writes=page=>page.evaluate(()=>window.__fixtureCalls.filter(c=>c.method!=='GET'));
async function shot(page,info,name,fullPage=false){const path=info.outputPath(name+'.png');await page.screenshot({path,fullPage,scale:'css',animations:'disabled'});await info.attach(name,{path,contentType:'image/png'});}
async function fits(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
async function hit(page,selector){const target=page.locator(selector);await target.scrollIntoViewIfNeeded();expect(await target.evaluate(el=>{const r=el.getBoundingClientRect();return r.y>=0&&r.bottom<=innerHeight+1&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;})).toBe(true);}
const action=(page,a,id='fixture-invoice-0')=>page.locator(`#invoiceList [data-invoice-action="${a}"][data-invoice-id="${id}"]`);
async function detailAction(page,a,id='fixture-invoice-0'){
  const row=page.locator(`#invoiceList [data-invoice-row="${id}"]`),number=(await row.locator('.invoice-number').innerText()).trim();
  const modal=page.locator('#detailModal');
  if(await modal.isVisible()&&(await page.locator('#detailTitle').innerText()).trim()!==number)await page.locator('[data-close="detail"]').click();
  if(!await modal.isVisible())await action(page,'detail',id).click();
  const button=page.locator(`#detailActions [data-invoice-action="${a}"][data-invoice-id="${id}"]`);
  if(!await button.isVisible())await page.locator('#detailActions .invoice-more-actions summary').click();
  return button;
}

for(const width of [1440,390]){
  test(`Invoices: list, filters, detail and reversal controls at ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:'dark'});await open(page);await fits(page);
    await expect(page.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');await expect(page.locator('.invoice-row')).toHaveCount(1);await expect(page.locator('#invoiceView')).toHaveCSS('min-height','44px');
    await expect(page.locator('#invoiceList [data-invoice-action]')).toHaveCount(1);await expect(page.locator('#clearInvoiceFilters')).toBeHidden();
    await page.locator('#invoiceView').selectOption('all');await expect(page.locator('.invoice-row')).toHaveCount(3);await shot(page,info,'facturacion',true);
    await page.locator('#search').fill('INV-DEMO-019');await expect(page.locator('.invoice-row')).toHaveCount(1);
    await page.locator('#clearInvoiceFilters').click();await expect(page.locator('#search')).toBeFocused();await action(page,'detail').click();
    await expect(page.locator('#detailBody')).toContainText('1,400.00');await expect(page.locator('[data-reverse-payment]')).toHaveCount(1);await shot(page,info,'detalle-factura');
    await page.locator('[data-reverse-payment]').click();await expect(page.locator('#decisionReason')).toBeVisible();await page.locator('#decisionReason').fill('Corrección documentada.');await shot(page,info,'confirmacion-financiera');
    await page.locator('#decisionModal [data-close]').click();expect(await writes(page)).toEqual([]);
  });
}

for(const viewport of [{width:1440,height:700},{width:390,height:500}]){
  test(`Invoice draft: labeled quantities and failed save preserve data at ${viewport.width}`,async({page},info)=>{
    await page.setViewportSize(viewport);await open(page);await page.locator('#newInvoice').click();await expect(page.locator('#iSalesOrder')).toBeFocused();
    await page.locator('#iSalesOrder').selectOption('');await page.locator('#saveInvoice').click();await expect(page.locator('#invoiceMsg')).toHaveText('Selecciona una venta.');expect(await writes(page)).toEqual([]);
    await page.locator('#iSalesOrder').selectOption('fixture-so');await page.locator('[data-qty]').fill('13');await page.locator('[data-note]').fill('Entrega parcial.');await page.locator('#iNotes').fill('Conservar condiciones.');
    expect(await page.locator('#invoiceLines input').evaluateAll(nodes=>nodes.every(n=>n.labels.length===1))).toBe(true);await hit(page,'#iNotes');await shot(page,info,'nueva-factura');await fits(page);
    await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#saveInvoice').click();await expect(page.locator('#invoiceMsg')).not.toBeEmpty();await expect(page.locator('[data-qty]')).toHaveValue('13');await expect(page.locator('#iNotes')).toHaveValue('Conservar condiciones.');await hit(page,'#iNotes');
    await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#saveInvoice').click();await expect(page.locator('#invoiceModal')).toBeHidden();
    expect((await writes(page)).at(-1).body).toMatchObject({action:'create_plan',sales_order_id:'fixture-so',notes:'Conservar condiciones.',lines:[{sales_order_item_id:'fixture-so-line',quantity:'13',notes:'Entrega parcial.'}]});
  });
  test(`Collection: stable retry and reachable fields at ${viewport.width}`,async({page},info)=>{
    await page.setViewportSize(viewport);await open(page);await (await detailAction(page,'payment')).click();await expect(page.locator('#pAmount')).toBeFocused();
    await page.locator('#pAmount').fill('0');await page.locator('#savePayment').click();await expect(page.locator('#paymentMsg')).toContainText('mayor que cero');expect(await writes(page)).toEqual([]);
    await page.locator('#pAmount').fill('400');await page.locator('#pReference').fill('REF-019');await page.locator('#pNotes').fill('Cobro parcial.');await hit(page,'#pAmount');await shot(page,info,'registrar-cobro');
    await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#savePayment').click();await expect(page.locator('#paymentMsg')).toContainText('vuelve a intentar');await expect(page.locator('#pAmount')).toHaveValue('400');await expect(page.locator('#pNotes')).toHaveValue('Cobro parcial.');await hit(page,'#pNotes');await shot(page,info,'cobro-error-recuperable');await fits(page);
    await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#savePayment').click();await expect(page.locator('#paymentModal')).toBeHidden();const sent=await writes(page);expect(sent).toHaveLength(2);expect(sent[0].body).toEqual(sent[1].body);expect(sent[1].body).toMatchObject({action:'register',invoice_id:'fixture-invoice-0',amount:400,reference_number:'REF-019'});expect(sent[1].body.request_id).toBeTruthy();
  });
}

test('Invoice credits, application and refund preserve reasons and retry identity',async({page},info)=>{
  await open(page);await (await detailAction(page,'credit')).click();await page.locator('[data-credit-qty]').fill('10');await page.locator('#creditReason').fill('Se entregaron diez unidades menos.');await expect(page.locator('#creditSummary')).toContainText('300.00');await shot(page,info,'nota-credito');
  await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#saveCredit').click();await expect(page.locator('#creditMsg')).not.toBeEmpty();await expect(page.locator('[data-credit-qty]')).toHaveValue('10');await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#saveCredit').click();await expect(page.locator('#creditModal')).toBeHidden();
  let sent=await writes(page);expect(sent[0].body).toEqual(sent[1].body);expect(sent[1].body).toMatchObject({action:'credit_quantity',invoice_id:'fixture-invoice-0',reason:'Se entregaron diez unidades menos.'});await page.locator('#detailModal [data-close]').click();await page.locator('#invoiceView').selectOption('all');
  for(const kind of ['apply_credit','refund_credit']){
    await (await detailAction(page,kind,'fixture-invoice-2')).click();await page.locator('#balanceReason').fill('Movimiento documentado.');await page.locator('#balanceAmount').fill('200');
    await expect(page.locator('#balanceTargetWrap')).toBeVisible({visible:kind==='apply_credit'});await expect(page.locator('#balanceRefundWrap')).toBeVisible({visible:kind==='refund_credit'});await shot(page,info,kind==='apply_credit'?'aplicar-saldo':'registrar-devolucion');
    const before=(await writes(page)).length;await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#saveBalance').click();await expect(page.locator('#balanceMsg')).not.toBeEmpty();await expect(page.locator('#balanceReason')).toHaveValue('Movimiento documentado.');await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#saveBalance').click();await expect(page.locator('#balanceModal')).toBeHidden();sent=(await writes(page)).slice(before);expect(sent[0].body).toEqual(sent[1].body);expect(sent[1].body).toMatchObject({action:'credit_settlement',movement_type:kind==='apply_credit'?'application':'refund',invoice_id:'fixture-invoice-2',amount:'200'});await page.locator('#detailModal [data-close]').click();
  }
});

test('Payables: lists, bill and payment detail preserve capabilities',async({page},info)=>{
  await open(page,'payables');await fits(page);await expect(page.locator('[data-entity="bills"]')).toHaveCSS('min-height','44px');await shot(page,info,'cuentas-por-pagar',true);await page.locator('[data-bill-action="detail"][data-bill-id="fixture-bill-0"]').click();await expect(page.locator('#detailBody')).toContainText('1,200.00');await shot(page,info,'detalle-proveedor');await page.locator('#detailModal [data-