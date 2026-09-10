import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createOperatorAcceptanceDb } from '../../scripts/lib/operator-acceptance-db.mjs';
import { operatorFixture } from '../../scripts/lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer, root } from './server.mjs';

// Positive business writes use native forms. Supplemental negative API probes
// use a real QA login and prove that hidden actions also fail at the server.
// No production connection, auth injection, response mock or ledger deletion.
test('financial cancellations preserve balances, permissions and history', async ({ browser }, info) => {
  test.setTimeout(300_000);
  process.chdir(root);
  const db=await createOperatorAcceptanceDb(), nativeFetch=globalThis.fetch;
  const sessions=[], evidence={checkpoints:[],api:[],errors:[],crashes:[],external:[],documents:{},cash:[],negative:[]};
  let api,controlSale,controlPO,controlBefore;
  try {
    // Same legacy shape/grants as the already validated commercial browser story.
    // These grants affect only the initializer's empty, loopback QA database.
    await db.exec(`alter table clients add column phone text, add column email text,
      add column welcome_status text default 'pending';
      alter table suppliers add column email text, add column phone text,
        add column address text, add column tax_id text, add column notes text;
      alter table importers add column address text, add column country text default 'Cuba',
        add column email text, add column phone text;
      alter table products add column if not exists description text,
        add column if not exists hs_code text, add column if not exists country_of_origin text,
        add column if not exists unit_weight_kg numeric, add column if not exists unit_volume_m3 numeric,
        add column if not exists currency text default 'USD',
        add column if not exists created_at timestamptz default now(),
        add column if not exists updated_at timestamptz default now();
      grant usage on sequence purchase_order_number_seq, sales_orders_so_serial_seq,
        invoices_invoice_serial_seq to service_role;
      grant select on load_expediente_documents, documents, load_traceability_sources,
        load_traceability_summary to service_role;
      grant select,insert on shipment_history to service_role;`);
    await db.exec(fs.readFileSync('supabase/migrations/20260831235500_ux5_shipment_action_capabilities.sql','utf8'));
    const {f,users}=await operatorFixture(db);
    const supplierB=(await f.one("insert into suppliers(name,country) values('QA control supplier','USA') returning id")).id;
    api=await startBrowserAcceptanceServer();
    const origins=new Set([api.base,new URL(process.env.ERP_TEST_POSTGREST_URL).origin]);
    globalThis.fetch=(input,options)=>{
      const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
      if(!origins.has(url.origin))throw Error('QA refuses external backend traffic');
      return nativeFetch(input,options);
    };
    await api.ready(db);
    const loginApi=async user=>{
      const result=await api.request('login',{method:'POST',body:{username:user.username,password:user.password}});
      expect(result.status).toBe(200);return result.body.token;
    };
    const masterToken=await loginApi(users.master);
    for(const [key,keys] of [
      ['a',['sales.read','sales.write','finance.read','finance.write','procurement.read','procurement.write','reports.read']],
      ['b',['sales.read','finance.read','procurement.read','reports.read']]
    ]) {
      const role=await api.request('access-control?resource=roles',{method:'PATCH',token:masterToken,
        body:{id:users[key].access_role_id,permission_keys:keys}});
      expect(role.status).toBe(200);
    }
    const use=info.project.use;
    const newSession=async key=>{
      const context=await browser.newContext({viewport:use.viewport,userAgent:use.userAgent,
        isMobile:use.isMobile,hasTouch:use.hasTouch,deviceScaleFactor:use.deviceScaleFactor,
        locale:'es-US',timezoneId:'America/New_York',serviceWorkers:'allow'});
      const s={key,context,page:null,loggedIn:false,navigations:0,frames:0};sessions.push(s);
      await context.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.origin===api.base||['data:','blob:','about:'].includes(url.protocol))return route.continue();
        evidence.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');
      });
      const page=s.page=await context.newPage();page.setDefaultTimeout(15_000);
      page.on('pageerror',e=>evidence.errors.push({operator:key,message:e.message}));
      page.on('crash',()=>evidence.crashes.push(key));
      page.on('framenavigated',frame=>{if(frame===page.mainFrame())s.navigations++;else if(frame.url().includes('/admin/'))s.frames++;});
      page.on('response',r=>{const u=new URL(r.url());if(u.origin===api.base&&u.pathname.startsWith('/api/'))evidence.api.push({operator:key,path:u.pathname,status:r.status(),method:r.request().method()});});
      await page.goto(`${api.base}/admin/pwa.html`);
      await page.locator('#username').fill(users[key].username);await page.locator('#password').fill(users[key].password);
      const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/login'&&r.request().method()==='POST');
      await page.locator('#login').click();expect((await pending).status()).toBe(200);
      await expect(page.locator('#loginPage')).toBeHidden();s.loggedIn=true;
      await page.waitForFunction(()=>window.NavigationShell?.owner==='navigation-shell.js');
      return s;
    };
    const a=await newSession('a'),b=await newSession('b');
    const writeToken=await loginApi(users.a),readToken=await loginApi(users.b);
    const module=(s,name)=>s.page.frameLocator(`#${name}Section iframe`);
    const navigate=async(s,name)=>{
      const page=s.page,button=page.locator(`[data-section="${name}Section"]`).first();
      if(use.isMobile&&!await page.locator('#sidebar').evaluate(el=>el.classList.contains('mobile-open'))){
        await page.locator('#mobileMenuBtn').click();await expect(page.locator('#sidebar')).toHaveClass(/mobile-open/);
      }
      if(!await button.isVisible()){
        const group=button.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," nav-group ")]');
        await group.locator('.nav-group-btn').click();
      }
      await button.click();await expect(page.locator(`#${name}Section`)).toBeVisible();return module(s,name);
    };
    const mutation=async(path,click,status=200)=>{
      const pending=a.page.waitForResponse(r=>new URL(r.url()).pathname===`/api/${path}`&&r.request().method()==='POST')
        .then(response=>({response}),error=>({error}));
      await click();const result=await pending;if(result.error)throw result.error;
      const body=await result.response.json();
      expect(result.response.status(),JSON.stringify({path,error:body.error,details:body.details})).toBe(status);return body;
    };
    const financialTables=['sales_orders','purchase_orders','invoices','invoice_items','payments','customer_advances',
      'customer_advance_applications','customer_advance_refunds','supplier_bills','supplier_bill_items',
      'supplier_payments','supplier_payment_applications','audit_log'];
    const snapshot=async()=>{
      const result={};for(const table of financialTables)result[table]=await f.rows(`select * from ${table} order by id`);
      return JSON.stringify(result);
    };
    const denied=async(path,body,pattern,status=400,token=writeToken)=>{
      const before=await snapshot();
      const result=await api.request(path,{method:'POST',token,body});
      expect(result.status,JSON.stringify(result.body)).toBe(status);
      expect(String(result.body.error||'')).toMatch(pattern);
      expect(await snapshot(),'Rejected action must not mutate ledgers or success audit').toBe(before);
      evidence.negative.push({path,action:body.action,status:result.status,error:result.body.error});
    };
    const cashRows=()=>f.rows('select event_type,direction,event_id,currency,amount from executive_cash_movement_source order by event_id');
    const cash=async(expected,label)=>{
      const row=await f.one("select coalesce(sum(case direction when 'in' then amount when 'out' then -amount end),0) as net from executive_cash_movement_source where currency='USD'");
      expect(Number(row.net),label).toBe(expected);
      const events=await cashRows();expect(events.every(row=>['in','out'].includes(row.direction))).toBe(true);
      evidence.cash.push({label,net:Number(row.net),events});return events;
    };
    const controls=async()=>JSON.stringify({
      sale:await f.rows('select * from sales_orders where id=$1',[controlSale.id]),
      saleItems:await f.rows('select * from sales_order_items where sales_order_id=$1 order by id',[controlSale.id]),
      purchase:await f.rows('select * from purchase_orders where id=$1',[controlPO.id]),
      purchaseItems:await f.rows('select * from purchase_order_items where purchase_order_id=$1 order by id',[controlPO.id])
    });
    const step=async(name,fn)=>test.step(name,async()=>{
      await fn();if(controlBefore)expect(await controls(),'Independent EUR control documents changed').toBe(controlBefore);
      for(const table of ['warehouse_receipts','loads','inventory_movements'])expect(Number((await f.one(`select count(*) as n from ${table}`)).n)).toBe(0);
      evidence.checkpoints.push(name);console.log(`PASS ${info.project.name} ${name}`);
    });
    const shot=async(name,s=a)=>{
      const path=info.outputPath(`${name}.png`);await s.page.screenshot({path,timeout:5000});await info.attach(name,{path,contentType:'image/png'});
    };
    const sales=module(a,'sales'),purchase=module(a,'purchases'),ap=module(a,'payables');
    const createSale=async(clientId,reference,currency='USD')=>{
      await navigate(a,'sales');await sales.locator('[data-view="all"]').click();await sales.locator('#newOrder').click();
      await sales.locator('#oClientPickerButton').click();await sales.locator(`[data-client-id="${clientId}"]`).click();
      await sales.locator('#oImporter').selectOption(f.importer);await sales.locator('#oCurrency').fill(currency);
      await sales.locator('#oReference').fill(reference);await sales.locator('.lProduct').selectOption(f.product);
      await sales.locator('.lQty').fill('100');await sales.locator('.lPallets').fill('10');await sales.locator('.lTotal').fill('400');
      await mutation('sales-order-ux',()=>sales.locator('#saveOrder').click());await expect(sales.locator('#orderModal')).toBeHidden();
      const so=await f.one('select * from sales_orders where customer_reference=$1',[reference]);
      await sales.locator(`[data-view-order="${so.id}"]`).click();await sales.locator('[data-ws-action="confirm"]').first().click();
      await mutation('sales',()=>sales.locator('[data-sales-workspace-accept]').click());
      await expect(sales.locator('#detailSubtitle')).toContainText('Confirmada');
      await sales.locator('[data-close="detail"]').click();return so;
    };
    const createPO=async(supplier,currency='USD')=>{
      await navigate(a,'purchases');await purchase.locator('[data-view="all"]').click();await purchase.locator('#newOrder').click();
      await purchase.locator('#oSupplier').selectOption(supplier);await purchase.locator('#oDestinationMode').selectOption('direct');
      await purchase.locator('#oCurrency').fill(currency);await purchase.locator('.lProduct').selectOption(f.product);
      await purchase.locator('.lQty').fill('100');await purchase.locator('.lPallets').fill('10');await purchase.locator('.lPriceValue').fill('2.5');
      await mutation('purchases',()=>purchase.locator('#saveOrder').click());await expect(purchase.locator('#orderModal')).toBeHidden();
      const po=await f.one('select * from purchase_orders where supplier_id=$1',[supplier]);
      for(const action of ['issue','confirm']){
        await purchase.locator(`[data-view-order="${po.id}"]`).click();await purchase.locator(`[data-detail-action="${action}"]`).click();
        await mutation('purchases',()=>purchase.locator('#purchaseDecisionAccept').click());await expect(purchase.locator('#detailModal')).toBeHidden();
      }
      return po;
    };
    controlSale=await createSale(f.clientB,'QA-CF-CONTROL','EUR');controlPO=await createPO(supplierB,'EUR');
    controlBefore=await controls();
    const po=await createPO(f.supplier),so=await createSale(f.client,'QA-CF-MAIN');
    evidence.documents={sale:so.so_number,purchase:po.po_number,controlSale:controlSale.so_number,controlPurchase:controlPO.po_number};
    await sales.locator(`[data-view-order="${so.id}"]`).click();
    let advance,invoice,application,refund,bill,payment;
    const openFinance=async()=>{await sales.locator('#openCustomerFinance').click();await expect(sales.locator('#salesFinanceModal')).toBeVisible();};
    const closeFinance=()=>sales.locator('[data-cf-close-main]').click();
    const metric=async(index,value)=>expect(sales.locator('.sales-finance-metric').nth(index).locator('b')).toHaveText(value);
    const savedFinance=async()=>{await expect(sales.locator('#salesFinanceFormModal')).toBeHidden();};

    await step('CF-01 active advance blocks sale cancellation without mutation',async()=>{
      await openFinance();await sales.locator('[data-cf-register]').click();await sales.locator('#cfAdvanceAmount').fill('100');
      await sales.locator('#cfAdvanceMethod').fill('Wire');await sales.locator('#cfAdvanceReference').fill('QA-CF-ADV');
      const result=await mutation('customer-advances',()=>sales.locator('#salesFinanceFormSave').click());await savedFinance();advance=result.advance;
      await metric(2,'$100.00');await metric(4,'$100.00');
      await cash(100,'advance registered');
      const caps=await f.one('select sales_order_action_state($1) as value',[so.id]);
      expect(caps.value.actions.cancel.allowed).toBe(false);expect(caps.value.actions.cancel.reason).toBe('SO_HAS_ACTIVE_CUSTOMER_ADVANCE');
      await denied('sales',{action:'cancel',sales_order_id:so.id},/anticipo de cliente activo/i);
    });
    await step('CF-02 applying advance settles invoice without creating cash; parent reversal is blocked',async()=>{
      await closeFinance();await sales.locator('[data-ws-tab="billing"]').click();await sales.locator('[data-ws-action="new_invoice"]').first().click();
      const result=await mutation('invoices',()=>sales.locator('#wsSaveInvoice').click());
      await expect(sales.locator('#salesWorkspaceInvoiceModal')).toBeHidden();
      invoice=await f.one('select * from invoices where sales_order_id=$1',[so.id]);
      await sales.locator('[data-ws-action="issue_invoice"]').first().click();
      await mutation('invoices',()=>sales.locator('[data-sales-workspace-accept]').click());
      await expect(sales.locator('#detailMsg')).toContainText('Factura emitida');
      await openFinance();const before=await cashRows();
      await sales.locator(`[data-cf-apply="${advance.id}"]`).click();await sales.locator('#cfApplyInvoice').selectOption(invoice.id);await sales.locator('#cfApplyAmount').fill('50');
      const applied=await mutation('customer-advances',()=>sales.locator('#salesFinanceFormSave').click());await savedFinance();application=applied.application;
      await metric(2,'$50.00');await metric(5,'$350.00');expect(await cashRows()).toEqual(before);
      await expect(sales.locator(`[data-cf-reverse="${advance.id}"]`)).toHaveCount(0);
      await denied('customer-advances',{action:'reverse',customer_advance_id:advance.id,reason:'QA rejected reversal'},/aplicaciones activas/i);
    });
    await step('CF-03 reverse application requires reason and restores both balances',async()=>{
      const before=await snapshot();await sales.locator(`[data-cf-reverse-app="${application.id}"]`).click();
      await sales.locator('#salesFinanceFormSave').click();await expect(sales.locator('#salesFinanceFormMsg')).toContainText('Indica el motivo');expect(await snapshot()).toBe(before);
      await sales.locator('#cfReason').fill('QA correction: application entered by mistake');
      await mutation('customer-advances',()=>sales.locator('#salesFinanceFormSave').click());await savedFinance();
      await metric(2,'$100.00');await metric(5,'$400.00');
      const saved=await f.one('select status,reversal_reason from customer_advance_applications where id=$1',[application.id]);
      expect(saved.status).toBe('reversed');expect(saved.reversal_reason).toContain('QA correction');await cash(100,'application reversed');
    });
    await step('CF-04 partial refund records one outflow and blocks reversing its parent',async()=>{
      await sales.locator(`[data-cf-refund="${advance.id}"]`).click();await sales.locator('#cfRefundAmount').fill('20');
      await sales.locator('#cfRefundReference').fill('QA-CF-REFUND');
      const result=await mutation('customer-advances',()=>sales.locator('#salesFinanceFormSave').click());await savedFinance();refund=result.refund;
      await metric(2,'$80.00');await metric(4,'$80.00');
      const rows=await cash(80,'refund registered');expect(rows).toHaveLength(2);
      expect(rows.find(row=>row.event_id===refund.id)).toMatchObject({direction:'out',event_type:'customer_advance_refund'});
      await denied('customer-advances',{action:'reverse',customer_advance_id:advance.id,reason:'QA rejected reversal'},/reembolsos activos/i);
    });
    await step('CF-05 reverse refund preserves its reason and restores available cash',async()=>{
      await sales.locator(`[data-cf-reverse-refund="${refund.id}"]`).click();await sales.locator('#cfReason').fill('QA correction: refund entered by mistake');
      await mutation('customer-advances',()=>sales.locator('#salesFinanceFormSave').click());await savedFinance();
      await metric(2,'$100.00');await metric(4,'$100.00');await cash(100,'refund reversed');
      const saved=await f.one('select status,reversal_reason from customer_advance_refunds where id=$1',[refund.id]);expect(saved.status).toBe('reversed');expect(saved.reversal_reason).toContain('QA correction');
      await shot('05-advance-history');await closeFinance();await sales.locator('[data-close="detail"]').click();
    });
    // Supplier cases execute before CF-06 so its final sale cancellation also
    // verifies that the independent PO/AP history survived the entire story.
    await step('CF-07 supplier payment blocks bill voiding without mutation',async()=>{
      await navigate(a,'payables');await ap.locator('#newBill').click();await ap.locator('#bPO').selectOption(po.id);
      await ap.locator('#bSupplierInvoice').fill('QA-CF-SUPPLIER-INVOICE');await ap.locator('[data-bill-line] [data-total]').fill('250');
      const created=await mutation('payables',()=>ap.locator('#saveBill').click());await expect(ap.locator('#billModal')).toBeHidden();bill=created.bill;
      await ap.locator(`[data-bill-action="post"][data-bill-id="${bill.id}"]`).click();
      await mutation('payables',()=>ap.locator('#decisionAccept').click());await expect(ap.locator('#decisionModal')).toBeHidden();
      await ap.locator(`[data-bill-action="pay"][data-bill-id="${bill.id}"]`).click();await ap.locator('#pAmount').fill('60');
      const paid=await mutation('supplier-payments',()=>ap.locator('#savePayment').click());await expect(ap.locator('#paymentModal')).toBeHidden();payment=paid.payment;
      expect([...(await f.rows('select bill_total,paid_amount,balance_due from supplier_bill_financial_progress where supplier_bill_id=$1',[bill.id]))].map(r=>[r.bill_total,r.paid_amount,r.balance_due].map(Number))).toEqual([[250,60,190]]);
      await cash(40,'supplier payment registered');
      await denied('payables',{action:'void',supplier_bill_id:bill.id},/pagos aplicados/i);
      await ap.locator('[data-entity="bills"]').click();await expect(ap.locator(`[data-bill-row="${bill.id}"] [data-bill-action="void"]`)).toHaveCount(0);
    });
    await step('CF-08 reverse supplier payment restores AP and preserves payment history',async()=>{
      await ap.locator('[data-entity="payments"]').click();await ap.locator(`[data-payment-action="reverse"][data-payment-id="${payment.id}"]`).click();
      await ap.locator('#saveReverse').click();await expect(ap.locator('#reverseMsg')).toContainText('Indica el motivo');
      await ap.locator('#rReason').fill('QA correction: supplier payment entered by mistake');
      await mutation('supplier-payments',()=>ap.locator('#saveReverse').click());await expect(ap.locator('#reverseModal')).toBeHidden();
      const saved=await f.one('select status,reversal_reason from supplier_payments where id=$1',[payment.id]);expect(saved.status).toBe('reversed');expect(saved.reversal_reason).toContain('QA correction');
      const progress=await f.ap(bill);expect([progress.paid_amount,progress.balance_due].map(Number)).toEqual([0,250]);await cash(100,'supplier payment reversed');
    });
    await step('CF-09 bill can be voided after payment reversal without deleting history',async()=>{
      await ap.locator('[data-entity="bills"]').click();await ap.locator(`[data-bill-action="void"][data-bill-id="${bill.id}"]`).click();
      await mutation('payables',()=>ap.locator('#decisionAccept').click());await expect(ap.locator('#decisionModal')).toBeHidden();
      await ap.locator('[data-view="all"]').click();await expect(ap.locator(`[data-bill-row="${bill.id}"]`)).toContainText('Anulada');
      expect((await f.one('select status from supplier_bills where id=$1',[bill.id])).status).toBe('void');
      expect((await f.rows('select id from supplier_bill_items where supplier_bill_id=$1',[bill.id])).length).toBeGreaterThan(0);
      await cash(100,'supplier bill voided');
    });
    await step('CF-10 cancel resolved purchase while preserving historical financial records',async()=>{
      await navigate(a,'purchases');await purchase.locator(`[data-view-order="${po.id}"]`).click();await purchase.locator('[data-detail-action="cancel"]').click();
      await mutation('purchases',()=>purchase.locator('#purchaseDecisionAccept').click());await expect(purchase.locator('#detailModal')).toBeHidden();
      expect((await f.one('select status from purchase_orders where id=$1',[po.id])).status).toBe('cancelled');
      expect((await f.one('select status from supplier_bills where id=$1',[bill.id])).status).toBe('void');
      expect((await f.one('select status from supplier_payments where id=$1',[payment.id])).status).toBe('reversed');
    });
    await step('CF-11 read-only operator cannot execute financial reversals',async()=>{
      const readSales=await navigate(b,'sales');await readSales.locator('[data-view="all"]').click();
      await readSales.locator(`[data-view-order="${so.id}"]`).click();await readSales.locator('#openCustomerFinance').click();
      await expect(readSales.locator('#salesFinanceBody')).toContainText(advance.advance_number);
      await expect(readSales.locator('[data-cf-register], [data-cf-refund], [data-cf-reverse], [data-cf-apply], [data-cf-reverse-app], [data-cf-reverse-refund]')).toHaveCount(0);
      await denied('customer-advances',{action:'reverse',customer_advance_id:advance.id,reason:'QA denied employee'},/permiso|autorizado/i,403,readToken);
      await denied('supplier-payments',{action:'reverse',supplier_payment_id:payment.id,reason:'QA denied employee'},/permiso|autorizado/i,403,readToken);
      await readSales.locator('[data-cf-close-main]').click();await readSales.locator('[data-close="detail"]').click();
    });
    await step('CF-12 invoice balance updates across operators without document reload',async()=>{
      const readerInvoices=await navigate(b,'invoices');await readerInvoices.locator('[data-view="all"]').click();
      const row=readerInvoices.locator(`[data-invoice-row="${invoice.id}"]`);
      await expect(row.locator('.invoice-money.balance')).toHaveText('USD 400.00');
      const before={n:b.navigations,f:b.frames};
      await navigate(a,'sales');await sales.locator(`[data-view-order="${so.id}"]`).click();await openFinance();
      await sales.locator(`[data-cf-apply="${advance.id}"]`).click();await sales.locator('#cfApplyInvoice').selectOption(invoice.id);await sales.locator('#cfApplyAmount').fill('25');
      const applied=await mutation('customer-advances',()=>sales.locator('#salesFinanceFormSave').click());await savedFinance();
      await expect(row.locator('.invoice-money.balance')).toHaveText('USD 375.00',{timeout:30_000});
      await sales.locator(`[data-cf-reverse-app="${applied.application.id}"]`).click();await sales.locator('#cfReason').fill('QA correction: second application entered by mistake');
      await mutation('customer-advances',()=>sales.locator('#salesFinanceFormSave').click());await savedFinance();
      await expect(row.locator('.invoice-money.balance')).toHaveText('USD 400.00',{timeout:30_000});
      expect({n:b.navigations,f:b.frames}).toEqual(before);await cash(100,'cross-operator applications do not create cash');
      await shot('12-reader-restored-balance',b);
    });
    await step('CF-06 clear finance then cancel sale through native UI with history intact',async()=>{
      await sales.locator(`[data-cf-reverse="${advance.id}"]`).click();await sales.locator('#cfReason').fill('QA correction: original advance entered by mistake');
      await mutation('customer-advances',()=>sales.locator('#salesFinanceFormSave').click());await savedFinance();
      await metric(1,'$0.00');await metric(2,'$0.00');await metric(4,'$0.00');await cash(0,'advance reversed');
      await closeFinance();await sales.locator('[data-close="detail"]').click();
      const invoices=await navigate(a,'invoices');await invoices.locator(`[data-invoice-action="void"][data-invoice-id="${invoice.id}"]`).click();
      await mutation('invoices',()=>invoices.locator('#decisionAccept').click());await expect(invoices.locator('#decisionModal')).toBeHidden();
      await navigate(a,'sales');await sales.locator(`[data-view-order="${so.id}"]`).click();
      const caps=await f.one('select sales_order_action_state($1) as value',[so.id]);expect(caps.value.actions.cancel.allowed).toBe(true);
      // Regression: a backend-allowed cancellation must have a native UI route.
      await sales.locator('[data-ws-action="cancel_sale"]').click();
      await sales.locator('[data-sales-workspace-cancel]').click();
      expect((await f.one('select status from sales_orders where id=$1',[so.id])).status).toBe('confirmed');
      await sales.locator('[data-ws-action="cancel_sale"]').click();
      await mutation('sales',()=>sales.locator('[data-sales-workspace-accept]').click());await expect(sales.locator('#detailSubtitle')).toContainText('Cancelada');
      expect((await f.one('select status from customer_advances where id=$1',[advance.id])).status).toBe('reversed');
      expect((await f.one('select status from invoices where id=$1',[invoice.id])).status).toBe('void');
      await cash(0,'sale cancelled');await shot('06-cancelled-sale');
    });
    expect(evidence.checkpoints).toHaveLength(12);expect(evidence.errors).toEqual([]);expect(evidence.crashes).toEqual([]);expect(evidence.external).toEqual([]);
    expect(evidence.api.filter(row=>row.status===404||row.status>=500)).toEqual([]);
  } finally {
    const path=info.outputPath('cancellation-finance-evidence.json');fs.mkdirSync(info.outputDir,{recursive:true});fs.writeFileSync(path,JSON.stringify(evidence,null,2));
    await info.attach('cancellation-finance-evidence',{path,contentType:'application/json'});
    for(const s of sessions)if(s.loggedIn&&s.page&&!s.page.isClosed()&&await s.page.locator('#loginPage').isHidden().catch(()=>false)){
      const path=info.outputPath(`final-${s.key}.png`);await s.page.screenshot({path,timeout:5000}).then(()=>info.attach(`final-${s.key}`,{path,contentType:'image/png'})).catch(()=>{});
    }
    globalThis.fetch=nativeFetch;await Promise.allSettled(sessions.map(s=>s.context.close()));try{await api?.close?.();}finally{await db.end();}
  }
});
