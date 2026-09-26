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

for(const width of [1440,390]){
  test(`Invoices: list, filters, detail and reversal controls at ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:'dark'});await open(page);await fits(page);
    await expect(page.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');await expect(page.locator('.invoice-row')).toHaveCount(2);
    await page.locator('[data-view="all"]').click();await expect(page.locator('.invoice-row')).toHaveCount(3);await shot(page,info,'facturacion',true);
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
    await page.setViewportSize(viewport);await open(page);await action(page,'payment').click();await expect(page.locator('#pAmount')).toBeFocused();
    await page.locator('#pAmount').fill('0');await page.locator('#savePayment').click();await expect(page.locator('#paymentMsg')).toContainText('mayor que cero');expect(await writes(page)).toEqual([]);
    await page.locator('#pAmount').fill('400');await page.locator('#pReference').fill('REF-019');await page.locator('#pNotes').fill('Cobro parcial.');await hit(page,'#pAmount');await shot(page,info,'registrar-cobro');
    await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#savePayment').click();await expect(page.locator('#paymentMsg')).toContainText('vuelve a intentar');await expect(page.locator('#pAmount')).toHaveValue('400');await expect(page.locator('#pNotes')).toHaveValue('Cobro parcial.');await hit(page,'#pNotes');await shot(page,info,'cobro-error-recuperable');await fits(page);
    await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#savePayment').click();await expect(page.locator('#paymentModal')).toBeHidden();const sent=await writes(page);expect(sent).toHaveLength(2);expect(sent[0].body).toEqual(sent[1].body);expect(sent[1].body).toMatchObject({action:'register',invoice_id:'fixture-invoice-0',amount:400,reference_number:'REF-019'});expect(sent[1].body.request_id).toBeTruthy();
  });
}

test('Invoice credits, application and refund preserve reasons and retry identity',async({page},info)=>{
  await open(page);await action(page,'credit').click();await page.locator('[data-credit-qty]').fill('10');await page.locator('#creditReason').fill('Se entregaron diez unidades menos.');await expect(page.locator('#creditSummary')).toContainText('300.00');await shot(page,info,'nota-credito');
  await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#saveCredit').click();await expect(page.locator('#creditMsg')).not.toBeEmpty();await expect(page.locator('[data-credit-qty]')).toHaveValue('10');await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#saveCredit').click();await expect(page.locator('#creditModal')).toBeHidden();
  let sent=await writes(page);expect(sent[0].body).toEqual(sent[1].body);expect(sent[1].body).toMatchObject({action:'credit_quantity',invoice_id:'fixture-invoice-0',reason:'Se entregaron diez unidades menos.'});await page.locator('#detailModal [data-close]').click();await page.locator('[data-view="all"]').click();
  for(const kind of ['apply_credit','refund_credit']){
    await action(page,kind,'fixture-invoice-2').click();await page.locator('#balanceReason').fill('Movimiento documentado.');await page.locator('#balanceAmount').fill('200');
    await expect(page.locator('#balanceTargetWrap')).toBeVisible({visible:kind==='apply_credit'});await expect(page.locator('#balanceRefundWrap')).toBeVisible({visible:kind==='refund_credit'});await shot(page,info,kind==='apply_credit'?'aplicar-saldo':'registrar-devolucion');
    const before=(await writes(page)).length;await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#saveBalance').click();await expect(page.locator('#balanceMsg')).not.toBeEmpty();await expect(page.locator('#balanceReason')).toHaveValue('Movimiento documentado.');await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#saveBalance').click();await expect(page.locator('#balanceModal')).toBeHidden();sent=(await writes(page)).slice(before);expect(sent[0].body).toEqual(sent[1].body);expect(sent[1].body).toMatchObject({action:'credit_settlement',movement_type:kind==='apply_credit'?'application':'refund',invoice_id:'fixture-invoice-2',amount:'200'});await page.locator('#detailModal [data-close]').click();
  }
});

test('Payables: lists, bill and payment detail preserve capabilities',async({page},info)=>{
  await open(page,'payables');await fits(page);await shot(page,info,'cuentas-por-pagar',true);await page.locator('[data-bill-action="detail"][data-bill-id="fixture-bill-0"]').click();await expect(page.locator('#detailBody')).toContainText('1,200.00');await shot(page,info,'detalle-proveedor');await page.locator('#detailModal [data-close]').click();
  await page.locator('[data-entity="payments"]').click();await expect(page.locator('.payable-row')).toHaveCount(1);await shot(page,info,'pagos-proveedor',true);await page.locator('[data-payment-action="detail"]').click();await expect(page.locator('#detailBody')).toContainText('SB-DEMO-018');await page.locator('#detailModal [data-close]').click();expect(await writes(page)).toEqual([]);
});

for(const viewport of [{width:1440,height:700},{width:390,height:500}]){
  test(`Supplier bill: exact total pricing, labels and safe recovery at ${viewport.width}`,async({page},info)=>{
    await page.setViewportSize(viewport);await open(page,'payables');await page.locator('#newBill').click();await page.locator('#bPO').selectOption('fixture-po');await page.locator('#bSupplierInvoice').fill('REF-PROV-019');await page.locator('[data-qty]').fill('13');await page.locator('[data-cost]').fill('30');await expect(page.locator('#billCalculatedTotal')).toContainText('390.00');
    await page.locator('[data-total]').fill('499.99');await page.locator('[data-note]').fill('Importe exacto de la factura.');await expect(page.locator('#billCalculatedTotal')).toContainText('499.99');expect(await page.locator('#billLines input').evaluateAll(ns=>ns.every(n=>n.labels.length===1))).toBe(true);await hit(page,'[data-total]');await shot(page,info,'factura-proveedor');await fits(page);
    await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#saveBill').click();await expect(page.locator('#billMsg')).not.toBeEmpty();await expect(page.locator('[data-total]')).toHaveValue('499.99');await expect(page.locator('[data-note]')).toHaveValue('Importe exacto de la factura.');await hit(page,'[data-total]');
    await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#saveBill').click();await expect(page.locator('#billModal')).toBeHidden();expect((await writes(page)).at(-1).body).toMatchObject({action:'create_plan',purchase_order_id:'fixture-po',lines:[{purchase_order_item_id:'fixture-po-line',billed_quantity:'13',unit_cost:'',line_total:'499.99',notes:'Importe exacto de la factura.'}]});
  });
}

test('Supplier payment modes preserve application and stable retry',async({page},info)=>{
  await page.setViewportSize({width:390,height:500});await open(page,'payables');await page.locator('#newAdvancePayment').click();await expect(page.locator('#paymentTitle')).toHaveText('Registrar anticipo');await expect(page.locator('#paymentSubtitle')).toContainText('sin aplicar');await page.locator('#paymentModal [data-close]').first().click();
  await page.locator('#newPayment').click();await expect(page.locator('#paymentTitle')).toHaveText('Registrar pago manual');await page.locator('#paymentModal [data-close]').first().click();
  await page.locator('[data-bill-action="pay"]').click();await expect(page.locator('#pPO')).toBeDisabled();await expect(page.locator('#paymentSubtitle')).toContainText('automáticamente');await page.locator('#pAmount').fill('200');await page.locator('#pNotes').fill('Pago parcial documentado.');await hit(page,'#pAmount');await shot(page,info,'pago-proveedor');
  await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#savePayment').click();await expect(page.locator('#paymentMsg')).toContainText('vuelve a intentar');await expect(page.locator('#pNotes')).toHaveValue('Pago parcial documentado.');await hit(page,'#pNotes');await fits(page);
  await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#savePayment').click();await expect(page.locator('#paymentModal')).toBeHidden();const sent=await writes(page);expect(sent).toHaveLength(2);expect(sent[0].body).toEqual(sent[1].body);expect(sent[1].body).toMatchObject({action:'pay_bill',supplier_bill_id:'fixture-bill-0',amount:200});
});

test('Supplier allocation and reversal keep values and reasons visible',async({page},info)=>{
  await open(page,'payables');await page.locator('[data-entity="payments"]').click();await page.locator('[data-payment-action="allocate"]').click();await page.locator('[data-amount]').fill('800');await expect(page.locator('.payable-allocation-field')).toContainText('Monto a aplicar');await shot(page,info,'aplicar-pago');
  await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#saveAllocation').click();await expect(page.locator('#allocationMsg')).not.toBeEmpty();await expect(page.locator('[data-amount]')).toHaveValue('800');await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#saveAllocation').click();await expect(page.locator('#allocationModal')).toBeHidden();expect((await writes(page)).at(-1).body).toMatchObject({action:'replace_applications',supplier_payment_id:'fixture-supplier-payment',applications:[{supplier_bill_id:'fixture-bill-0',amount:'800'}]});
  await page.locator('[data-payment-action="reverse"]').click();await page.locator('#saveReverse').click();await expect(page.locator('#reverseMsg')).not.toBeEmpty();await page.locator('#rReason').fill('Reverso documentado.');await shot(page,info,'revertir-pago');await page.locator('#reverseModal [data-close]').click();
});

for(const module of ['invoices','payables']){
  test(`${module}: read-only capabilities allow consultation only`,async({page})=>{
    await open(page,module,{writable:false});const create=module==='invoices'?'#newInvoice':'#newBill,#newPayment,#newAdvancePayment';for(const el of await page.locator(create).all())await expect(el).toBeHidden();
    const buttons=page.locator(module==='invoices'?'#invoiceList [data-invoice-action]':'#list [data-bill-action]');expect(await buttons.evaluateAll(ns=>ns.every(n=>(n.dataset.invoiceAction||n.dataset.billAction)==='detail'))).toBe(true);await buttons.first().click();await expect(page.locator('#detailActions button')).toHaveCount(0);expect(await writes(page)).toEqual([]);
  });
}

for(const width of [1440,390]){
  test(`Reports: keyboard datasets, snapshot filters, full columns and CSV at ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:1000});await open(page,'reports');await fits(page);await expect(page.locator('.report-table th')).toHaveCount(20);await shot(page,info,'reportes-ventas',true);
    await page.locator('[data-dataset="sales"]').focus();await page.keyboard.press('End');await expect(page.locator('[data-dataset="inventory"]')).toBeFocused();await expect(page.locator('#reportBasisMetric')).toHaveText('Actual');await expect(page.locator('[data-filter-dimension="period"]').first()).toBeHidden();await expect(page.locator('[data-filter-dimension="currency"]')).toBeHidden();await expect(page.locator('.report-table th')).toHaveCount(15);await shot(page,info,'reportes-inventario',true);
    await page.keyboard.press('Home');await expect(page.locator('[data-dataset="sales"]')).toBeFocused();await expect(page.locator('#reportBasisMetric')).toHaveText('Período');await page.locator('#currency').selectOption('EUR');await page.locator('#applyFilters').click();await expect(page.locator('#reportCurrencyMetric')).toHaveText('EUR');await expect(page.locator('.report-table tbody tr')).toHaveCount(1);
    const downloaded=page.waitForEvent('download');await page.locator('#exportReport').click();const download=await downloaded;expect(download.suggestedFilename()).toBe('sales.csv');const csv=await readFile(await download.path(),'utf8');expect(csv).toContain('SO-DEMO-019');expect(csv).toContain('EUR');expect(csv).toContain('Estado contribución');
    const calls=await page.evaluate(()=>window.__fixtureCalls);const exported=calls.find(c=>c.query.includes('format=csv'));expect(exported.query).toContain('currency=EUR');expect(exported.query).not.toContain('token');expect(await writes(page)).toEqual([]);
  });
}

for(const module of ['invoices','payables','reports']){
  test(`${module}: failed reads recover without exposing internal errors`,async({page})=>{
    await open(page,module,{failRead:true});const retry=module==='invoices'?'#invoiceRetry':module==='payables'?'#payablesRetry':'#reportsRetry';await expect(page.locator(retry)).toBeVisible();await expect(page.locator('body')).not.toContainText('Internal fixture');await page.evaluate(()=>window.__fixtureReadError=false);await page.locator(retry).click();await expect(page.locator(retry)).toHaveCount(0);expect(await writes(page)).toEqual([]);
  });
}
