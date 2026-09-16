import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createOperatorAcceptanceDb } from '../../scripts/lib/operator-acceptance-db.mjs';
import { operatorFixture } from '../../scripts/lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer, root } from './server.mjs';

// All commercial mutations below originate in the real UI and use real HTTP,
// PostgREST and SQL. Only master data and disposable identities are seeded.
// No external ERP URL, production secret, response mock or auth injection.
test('one commercial chain: purchase, receipt, stock, load, sale, collection and reports', async ({ browser }, info) => {
  test.setTimeout(300_000);
  process.chdir(root);
  const db = await createOperatorAcceptanceDb();
  const nativeFetch = globalThis.fetch;
  const contexts = [];
  const evidence = { checkpoints:[], api:[], errors:[], crashes:[], external:[], documents:{} };
  let api;
  try {
    // Legacy table shape required by the native shell's shipment read. Business
    // capabilities come from the unchanged real migration, never a QA mock.
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
    const { f,users } = await operatorFixture(db);
    const paymentFault={armed:false,droppedId:null};
    const supplierFault={armed:false,droppedId:null};
    api = await startBrowserAcceptanceServer({dropApiResponse:(req,url,body)=>{
      if(supplierFault.armed&&req.method==='POST'&&url.pathname==='/api/supplier-payments'){
        let result;try{result=JSON.parse(String(body));}catch{return false;}
        if(!result.payment?.id)return false;
        supplierFault.droppedId=result.payment.id;return true;
      }
      if(!paymentFault.armed||req.method!=='POST'||url.pathname!=='/api/invoice-payments')return false;
      let result;try{result=JSON.parse(String(body));}catch{return false;}
      if(!result.payment?.id)return false;
      paymentFault.droppedId=result.payment.id;return true;
    }});
    const origins = new Set([api.base,new URL(process.env.ERP_TEST_POSTGREST_URL).origin]);
    globalThis.fetch = (input,options) => {
      const url = new URL(typeof input==='string' || input instanceof URL ? input : input.url);
      if (!origins.has(url.origin)) throw Error('QA refuses external backend traffic');
      return nativeFetch(input,options);
    };
    await api.ready(db);
    const master = await api.request('login',{method:'POST',body:{username:users.master.username,password:users.master.password}});
    expect(master.status).toBe(200);
    const permissions = ['procurement.read','procurement.write','warehouse.read','warehouse.write',
      'sales.read','sales.write','logistics.read','logistics.write','finance.read','finance.write','reports.read'];
    for (const [key,keys] of [['a',permissions],['b',['warehouse.read','finance.read','reports.read']]]) {
      const result = await api.request('access-control?resource=roles',{method:'PATCH',token:master.body.token,
        body:{id:users[key].access_role_id,permission_keys:keys}});
      expect(result.status).toBe(200);
    }
    const sessions = {};
    for (const key of ['a','b']) {
      const use = info.project.use;
      const context = await browser.newContext({viewport:use.viewport,userAgent:use.userAgent,
        isMobile:use.isMobile,hasTouch:use.hasTouch,deviceScaleFactor:use.deviceScaleFactor,
        locale:'es-US',timezoneId:'America/New_York',serviceWorkers:'allow'});
      contexts.push(context);
      await context.route('**/*',route => {
        const url = new URL(route.request().url());
        if (url.origin===api.base || ['data:','blob:','about:'].includes(url.protocol)) return route.continue();
        evidence.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      const session = {page,navigations:0,frames:0};
      sessions[key]=session;
      page.on('framenavigated',frame => {
        if (frame===page.mainFrame()) session.navigations++;
        else if (frame.url().includes('/admin/inventory.html')) session.frames++;
      });
      page.on('pageerror',error=>evidence.errors.push({operator:key,message:error.message}));
      page.on('crash',()=>evidence.crashes.push(key));
      page.on('response',response=>{
        const url=new URL(response.url());
        if (url.origin===api.base && url.pathname.startsWith('/api/')) evidence.api.push({
          operator:key,path:url.pathname,status:response.status(),method:response.request().method()});
      });
      await page.goto(`${api.base}/admin/pwa.html`);
      await page.locator('#username').fill(users[key].username);
      await page.locator('#password').fill(users[key].password);
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/login' && r.request().method()==='POST');
      await page.locator('#login').click();
      expect((await response).status()).toBe(200);
      await expect(page.locator('#loginPage')).toBeHidden();
      // The shell is revealed before its lazy navigation owner has mounted.
      // Observe readiness only; navigation itself still uses real UI clicks.
      await page.waitForFunction(()=>window.NavigationShell?.owner==='navigation-shell.js');
    }
    const {a,b}=sessions;
    const module = (session,name)=>session.page.frameLocator(`#${name}Section iframe`);
    const navigate = async (session,name)=>{
      const page=session.page,button=page.locator(`[data-section="${name}Section"]`).first();
      if (info.project.use.isMobile && !await page.locator('#sidebar').evaluate(el=>el.classList.contains('mobile-open'))) {
        // The inner sidebar toggle has geometry even when translated offscreen.
        // Wait for and click the actual header control, not an isVisible snapshot
        // taken while the authenticated shell is still being initialized.
        await page.locator('#mobileMenuBtn').click();
        await expect(page.locator('#sidebar')).toHaveClass(/mobile-open/);
      }
      if (!await button.isVisible()) {
        const group=button.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," nav-group ")]');
        await group.locator('.nav-group-btn').click();
      }
      await button.click();
      await expect(page.locator(`#${name}Section`)).toBeVisible();
      return module(session,name);
    };
    const mutation = async (session,path,click,status=200)=>{
      const pending=session.page.waitForResponse(r=>new URL(r.url()).pathname===`/api/${path}` && r.request().method()==='POST');
      await click();
      const response=await pending;
      const body=await response.json();
      expect(response.status(),JSON.stringify({path,error:body.error,details:body.details})).toBe(status);
      return body;
    };
    const screenshot=async (session,name)=>{
      const path=info.outputPath(`${name}.png`);
      await session.page.screenshot({path,timeout:5000});
      await info.attach(name,{path,contentType:'image/png'});
    };
    const step=async (name,action)=>test.step(name,async()=>{
      await action();evidence.checkpoints.push(name);console.log(`PASS ${info.project.name} ${name}`);
    });
    const purchase=module(a,'purchases'),sales=module(a,'sales'),loads=module(a,'loads');
    const stock=module(b,'inventory');
    const inventoryValues=async (physical,reserved,available)=>{
      const row=stock.locator('.inventory-row');
      if (physical===0) {
        await expect(stock.locator('#inventoryList')).toContainText('Aún no hay existencias');
      } else {
        await expect(row).toHaveCount(1);
        const metrics=row.locator('.inventory-metric');
        for (const [index,quantity] of [physical,reserved,available].entries()) {
          if (quantity===0) await expect(metrics.nth(index).locator('b')).toHaveText('0');
          else await expect(metrics.nth(index).locator('b')).toContainText(`${quantity} cajas`);
        }
      }
      const rows=await f.rows('select physical_quantity,reserved_quantity,available_quantity from inventory_summary where product_id=$1',[f.product]);
      const totals=rows.reduce((sum,row)=>sum.map((n,i)=>n+Number(row[['physical_quantity','reserved_quantity','available_quantity'][i]])),[0,0,0]);
      expect(totals).toEqual([physical,reserved,available]);
    };
    let po,so,load,invoice;
    await step('COM-01 PWA logins and purchase creation do not create stock',async()=>{
      await navigate(b,'inventory');await inventoryValues(0,0,0);
      await navigate(a,'purchases');await purchase.locator('[data-view="all"]').click();
      await purchase.locator('#newOrder').click();
      await expect(purchase.locator('#oSupplier')).toBeFocused();
      await purchase.locator('#oSupplier').selectOption(f.supplier);
      await purchase.locator('#oWarehouse').selectOption(f.warehouse);
      await purchase.locator('#oReference').fill('QA commercial chain');
      await purchase.locator('.lProduct').selectOption(f.product);
      await purchase.locator('.lQty').fill('100');await purchase.locator('.lPallets').fill('10');
      await purchase.locator('.lPriceValue').fill('2.5');
      await purchase.locator('.lPriceValue').press('Tab');
      await expect(purchase.locator('.lQty')).toHaveValue('100');
      await expect(purchase.locator('.lPallets')).toHaveValue('10');
      await expect(purchase.locator('.lPriceValue')).toHaveValue('2.5');
      await expect(purchase.locator('.lPricingHelp')).toContainText('$250.00');
      await mutation(a,'purchases',()=>purchase.locator('#saveOrder').click());
      await expect(purchase.locator('#orderModal')).toBeHidden();
      po=await f.one('select * from purchase_orders');evidence.documents.purchase=po.po_number;
      await expect(purchase.locator('.purchase-order-total')).toHaveText('$250.00');
      await inventoryValues(0,0,0);
    });
    const nav={a:a.navigations,b:b.navigations,bf:b.frames};
    const transitionPurchase=async action=>{
      await purchase.locator(`[data-view-order="${po.id}"]`).click();
      await purchase.locator(`[data-detail-action="${action}"]`).click();
      await mutation(a,'purchases',()=>purchase.locator('#purchaseDecisionAccept').click());
      await expect(purchase.locator('#detailModal')).toBeHidden();
    };
    await step('COM-02 issue and confirm the same purchase',async()=>{
      for (const action of ['issue','confirm']) await transitionPurchase(action);
      expect((await f.one('select status from purchase_orders where id=$1',[po.id])).status).toBe('confirmed');
      await expect(purchase.locator('.purchase-order-row')).toContainText('Confirmada');
    });
    const receive=async (quantity,pallets,lot,status=200)=>{
      await purchase.locator(`[data-receive-order="${po.id}"]`).click();
      // The native modal schedules its initial focus on the next animation frame.
      // Wait for that focus before typing so WebKit cannot send the first fill to it.
      await expect(purchase.locator('#rWarehouse')).toBeFocused();
      await purchase.locator('.rrQty').fill(String(quantity));
      await purchase.locator('.rrPallets').fill(String(pallets));
      await purchase.locator('.rrLot').fill(lot);
      await expect(purchase.locator('.rrQty')).toHaveValue(String(quantity));
      await expect(purchase.locator('.rrPallets')).toHaveValue(String(pallets));
      await expect(purchase.locator('#rWarehouse')).toHaveValue(f.warehouse);
      const result=await mutation(a,'purchases',()=>purchase.locator('#saveReceipt').click(),status);
      if (status===200) await expect(purchase.locator('#receiveModal')).toBeHidden();
      return result;
    };
    await step('COM-03 partial receipt repaints the other operator without reload',async()=>{
      await receive(40,4,'QA-LOT-A');await inventoryValues(40,0,40);
      await expect(purchase.locator('.purchase-order-row')).toContainText('Parcial');
      await screenshot(b,'03-partial-stock');
    });
    await step('COM-04 declining excessive receipt leaves all ledgers unchanged',async()=>{
      await receive(80,8,'QA-NOT-RECEIVED',409);
      await expect(purchase.locator('#purchaseDecisionModal')).toBeVisible();
      await purchase.locator('#purchaseDecisionCancel').click();
      await purchase.locator('[data-close="receive"]').first().click();
      expect((await f.rows('select id from warehouse_receipts')).length).toBe(1);
      await inventoryValues(40,0,40);
    });
    await step('COM-05 complete receipt retains two source lots and the purchase link',async()=>{
      await receive(60,6,'QA-LOT-B');await inventoryValues(100,0,100);
      await expect(purchase.locator('.purchase-order-row')).toContainText('Recibida');
      const links=await f.rows('select received_quantity from purchase_receipt_allocations');
      expect(links.map(row=>Number(row.received_quantity)).sort((x,y)=>x-y)).toEqual([40,60]);
      await screenshot(b,'05-complete-stock');
    });
    await step('COM-06 create and confirm sale with the received product',async()=>{
      await navigate(a,'sales');await sales.locator('[data-view="all"]').click();
      await sales.locator('#newOrder').click();
      await sales.locator('#oClientPickerButton').click();
      await sales.locator(`[data-client-id="${f.client}"]`).click();
      await sales.locator('#oImporter').selectOption(f.importer);
      await sales.locator('.lProduct').selectOption(f.product);
      await sales.locator('.lQty').fill('100');await sales.locator('.lTotal').fill('400');
      await mutation(a,'sales-order-ux',()=>sales.locator('#saveOrder').click());
      await expect(sales.locator('#orderModal')).toBeHidden();
      so=await f.one('select * from sales_orders');evidence.documents.sale=so.so_number;
      await sales.locator(`[data-view-order="${so.id}"]`).click();
      await sales.locator('[data-ws-action="confirm"]').first().click();
      await mutation(a,'sales',()=>sales.locator('[data-sales-workspace-accept]').click());
      await expect(sales.locator('#detailSubtitle')).toContainText('Confirmada');
      await inventoryValues(100,0,100);
    });
    await step('COM-07 allocate both WR sources; excessive quantity is rejected visibly',async()=>{
      await sales.locator('[data-ws-action="create_load"]').first().click();
      const sources=await f.rows('select id,quantity from warehouse_receipt_items order by quantity');
      const first=sales.locator(`[data-wr="${sources[0].id}"]`);
      await first.locator('.wrQty').fill('41');
      await sales.locator('#saveLoad').click();
      await expect(sales.locator('#loadMsg')).toContainText(/saldo disponible/i);
      expect((await f.rows('select id from loads')).length).toBe(0);
      for (const source of sources) {
        const row=sales.locator(`[data-wr="${source.id}"]`);
        await row.locator('.wrQty').fill(String(source.quantity));
        await row.locator('.wrPallets').fill(String(Number(source.quantity)/10));
      }
      await mutation(a,'sales-loads',()=>sales.locator('#saveLoad').click());
      await expect(sales.locator('#loadModal')).toBeHidden();
      load=await f.one('select * from loads');evidence.documents.load=load.load_number;
      await sales.locator('[data-close="detail"]').click();
      await navigate(a,'loads');
      await loads.locator(`[data-open-load="${load.id}"]:visible`).first().click();
      await expect(loads.locator('#drawerModal')).toBeVisible();
    });
    const loadAction=async action=>{
      const click=()=>loads.locator(`#drawerBody [data-action="${action}"]`).first().click();
      if (action==='dispatch') {
        await click();return mutation(a,'loads',()=>loads.locator('#decisionAccept').click());
      }
      return mutation(a,'loads',click);
    };
    await step('COM-08 reserve, release and reserve without changing physical stock',async()=>{
      await loadAction('reserve');await inventoryValues(100,100,0);
      await loadAction('release');await inventoryValues(100,0,100);
      await loadAction('reserve');await inventoryValues(100,100,0);
      await screenshot(b,'08-reserved-stock');
    });
    await step('COM-09 load, require a container and dispatch once',async()=>{
      await loadAction('start_loading');await loadAction('mark_loaded');
      await expect(loads.locator('[data-action="dispatch"]')).toBeDisabled();
      await loads.locator('[data-action="container"]').click();
      await loads.locator('#containerNumber').fill('QA-COMMERCIAL-01');
      await mutation(a,'loads',()=>loads.locator('#createContainer').click());
      await expect(loads.locator('#containerModal')).toBeHidden();
      await loadAction('dispatch');await inventoryValues(0,0,0);
      await expect(loads.locator('.load-detail-hero')).toContainText('Despachado');
      await expect(loads.locator('[data-action="dispatch"]')).toHaveCount(0);
      const shipment=await f.one('select * from shipments');
      expect(Number(shipment.quantity)).toBe(100);expect(shipment.client_id).toBe(f.client);
      evidence.documents.container=shipment.container_number;
      await screenshot(a,'09-dispatched-load');
      await loads.locator('#drawerModal [data-close]').click();
    });
    await step('COM-10 invoice and issue the same sale for USD 400',async()=>{
      await navigate(a,'sales');await sales.locator(`[data-view-order="${so.id}"]`).click();
      await sales.locator('[data-ws-tab="billing"]').click();
      await sales.locator('[data-ws-action="new_invoice"]').first().click();
      await mutation(a,'invoices',()=>sales.locator('#wsSaveInvoice').click());
      await expect(sales.locator('#salesWorkspaceInvoiceModal')).toBeHidden();
      invoice=await f.one('select * from invoices');evidence.documents.invoice=invoice.invoice_number;
      await sales.locator('[data-ws-action="issue_invoice"]').first().click();
      await mutation(a,'invoices',()=>sales.locator('[data-sales-workspace-accept]').click());
      await expect(sales.locator('[data-ws-action="payment"]').first()).toBeVisible();
      expect(Number((await f.financial(invoice)).balance_due)).toBe(400);
    });
    await step('COM-11 partial and final collections reconcile without duplicate payments',async()=>{
      for (const amount of [150,250]) {
        await sales.locator('[data-ws-action="payment"]').first().click();
        await sales.locator('#wsPaymentAmount').fill(String(amount));
        if(amount===150){
          await sales.locator('#wsPaymentReference').fill('QA-SALES-LOST-CONFIRMATION');
          paymentFault.armed=true;
          await sales.locator('#wsSavePayment').click();
          await expect.poll(()=>paymentFault.droppedId).toBeTruthy();
          await expect(sales.locator('#wsSavePayment')).toBeEnabled();
          await expect(sales.locator('#wsPaymentMsg')).toContainText(/confirmar|intentar/i);
          await expect(sales.locator('#wsPaymentAmount')).toHaveValue('150');
          expect(Number((await f.financial(invoice)).balance_due)).toBe(250);
          paymentFault.armed=false;
        }
        await mutation(a,'invoice-payments',()=>sales.locator('#wsSavePayment').click());
        if(amount===150){
          const receipts=await f.rows("select id from payments where invoice_id=$1 and reference_number='QA-SALES-LOST-CONFIRMATION'",[invoice.id]);
          expect(receipts).toHaveLength(1);expect(receipts[0].id).toBe(paymentFault.droppedId);
        }
        await expect(sales.locator('#salesWorkspacePaymentModal')).toBeHidden();
        await expect(sales.locator('#detailMsg')).toContainText('Cobro registrado');
      }
      const financial=await f.financial(invoice);
      expect([financial.total,financial.paid_amount,financial.balance_due].map(Number)).toEqual([400,400,0]);
      expect((await f.rows('select id from payments')).length).toBe(2);
      await expect(sales.locator('[data-ws-action="payment"]')).toHaveCount(0);
      await screenshot(a,'11-invoice-paid');
    });
    await step('COM-12 direct cost and reports reconcile revenue, COGS, cash and stock',async()=>{
      await sales.locator('[data-ws-tab="costs"]').click();
      await sales.locator('[data-ws-action="new_cost"]').first().click();
      await sales.locator('#wsCostAmount').fill('50');
      await mutation(a,'costs',()=>sales.locator('#wsSaveCost').click());
      await expect(sales.locator('#salesWorkspaceCostModal')).toBeHidden();
      await sales.locator('[data-close="detail"]').click();
      const reports=await navigate(a,'reports');
      await expect(reports.locator('#reportTable')).toContainText(so.so_number);
      const login=await api.request('login',{method:'POST',body:{username:users.a.username,password:users.a.password}});
      expect(login.status).toBe(200);
      const report=async dataset=>{
        const result=await api.request(`reports?dataset=${dataset}&include_options=0`,{token:login.body.token});
        expect(result.status).toBe(200);return result.body.rows;
      };
      const saleRow=(await report('sales')).find(row=>row.sales_order_id===so.id || row.so_number===so.so_number);
      expect([saleRow.order_total,saleRow.recognized_merchandise_cogs,saleRow.direct_cost_amount,saleRow.contribution_margin].map(Number)).toEqual([400,250,50,100]);
      expect(saleRow.merchandise_cost_coverage).toBe('estimated');
      const invoiceRow=(await report('invoices'))[0];
      expect([invoiceRow.invoice_total,invoiceRow.paid_amount,invoiceRow.balance_due].map(Number)).toEqual([400,400,0]);
      const cash=await report('cash');
      expect(cash.reduce((sum,row)=>sum+Number(row.amount),0)).toBe(400);
      const stockRows=await report('inventory');
      expect(stockRows.reduce((sum,row)=>sum+Number(row.physical_quantity),0)).toBe(0);
      const actors=await f.rows("select distinct actor_admin_id from audit_log where entity_id in ($1,$2,$3,$4) and action<>'login'",[po.id,so.id,load.id,invoice.id]);
      expect(actors.length).toBeGreaterThan(0);expect(actors.every(row=>row.actor_admin_id===users.a.id)).toBe(true);
      evidence.reconciliation={sale:400,purchase:250,collected:400,receivable:0,directCost:50,contribution:100,physicalStock:0,costCoverage:'estimated'};
      await screenshot(a,'12-reconciled-report');
    });
    let supplierBill;
    const ap=module(a,'payables');
    await step('COM-13 the supplier bill closes the same purchase at actual cost',async()=>{
      await navigate(a,'payables');await ap.locator('#newBill').click();
      await ap.locator('#bPO').selectOption(po.id);
      await ap.locator('#bSupplierInvoice').fill('QA-WORKDAY-SUPPLIER');
      await ap.locator('[data-bill-line] [data-total]').fill('250');
      supplierBill=(await mutation(a,'payables',()=>ap.locator('#saveBill').click())).bill;
      await expect(ap.locator('#billModal')).toBeHidden();
      await ap.locator('[data-bill-action="post"][data-bill-id="'+supplierBill.id+'"]').click();
      await mutation(a,'payables',()=>ap.locator('#decisionAccept').click());
      await expect(ap.locator('#decisionModal')).toBeHidden();
      expect(Number((await f.ap(supplierBill)).bill_total)).toBe(250);
      expect(supplierBill.purchase_order_id).toBe(po.id);
      evidence.documents.supplierBill=supplierBill.bill_number;
    });
    await step('COM-14 a lost supplier payment confirmation is recovered without a second payment',async()=>{
      await ap.locator('[data-bill-action="pay"][data-bill-id="'+supplierBill.id+'"]').click();
      await expect(ap.locator('#pAmount')).toBeFocused();
      await ap.locator('#pAmount').fill('40');
      await ap.locator('#pReference').fill('QA-SUPPLIER-LOST-CONFIRMATION');
      await expect(ap.locator('#pAmount')).toHaveValue('40');
      supplierFault.armed=true;await ap.locator('#savePayment').click();
      await expect.poll(()=>supplierFault.droppedId).toBeTruthy();
      await expect(ap.locator('#savePayment')).toBeEnabled();
      const committed=await f.rows("select id,amount from supplier_payments where reference='QA-SUPPLIER-LOST-CONFIRMATION'");
      evidence.supplierLostResponse={rows:committed.map(row=>({id:row.id,amount:Number(row.amount)})),balance:Number((await f.ap(supplierBill)).balance_due)};
      console.log('SUPPLIER_LOST_RESPONSE '+JSON.stringify(evidence.supplierLostResponse));
      expect(committed,'a lost confirmation cannot multiply the committed payment').toHaveLength(1);
      await expect(ap.locator('#paymentMsg')).toContainText(/registrar|confirmar|intenta/i);
      await expect(ap.locator('#pAmount')).toHaveValue('40');
      expect(Number((await f.ap(supplierBill)).balance_due)).toBe(210);
      supplierFault.armed=false;
      await mutation(a,'supplier-payments',()=>ap.locator('#savePayment').click());
      const rows=await f.rows("select id,amount from supplier_payments where reference='QA-SUPPLIER-LOST-CONFIRMATION'");
      evidence.supplierRetry={committedId:supplierFault.droppedId,rows:rows.map(row=>({id:row.id,amount:Number(row.amount)}))};
      console.log('SUPPLIER_RETRY_AFTER_COMMIT '+JSON.stringify(evidence.supplierRetry));
      expect(rows,'one payment intent must never become two cash outflows').toHaveLength(1);
      expect(rows[0].id).toBe(supplierFault.droppedId);
      expect(Number((await f.ap(supplierBill)).balance_due)).toBe(210);
      await expect(ap.locator('#paymentModal')).toBeHidden();
      await screenshot(a,'14-supplier-payment-recovered');
    });

    let supplierAdvance,observerReports;
    const observedAP=async()=>{
      const value=await observerReports.locator('#reportTable tbody tr').filter({hasText:supplierBill.bill_number}).locator('[data-label="AP actual"]').textContent();
      return Number(value.replace(/[^0-9.-]/g,''));
    };
    await step('COM-15 offline entry and lost advance confirmation preserve one unapplied payment',async()=>{
      await ap.locator('#newAdvancePayment').click();
      await ap.locator('#pPO').selectOption(po.id);await ap.locator('#pAmount').fill('35');
      await ap.locator('#pReference').fill('QA-SUPPLIER-ADVANCE-RECOVERY');
      await a.page.context().setOffline(true);await ap.locator('#savePayment').click();
      await expect(ap.locator('#savePayment')).toBeEnabled();
      await expect(ap.locator('#paymentMsg')).toContainText(/confirmar|intentar/i);
      expect(await f.rows("select id from supplier_payments where reference='QA-SUPPLIER-ADVANCE-RECOVERY'")).toHaveLength(0);
      await expect(ap.locator('#pAmount')).toHaveValue('35');
      await a.page.context().setOffline(false);
      supplierFault.droppedId=null;supplierFault.armed=true;await ap.locator('#savePayment').click();
      await expect.poll(()=>supplierFault.droppedId).toBeTruthy();await expect(ap.locator('#savePayment')).toBeEnabled();
      await expect(ap.locator('#paymentMsg')).toContainText(/confirmar|intentar/i);
      expect(await f.rows("select id from supplier_payments where reference='QA-SUPPLIER-ADVANCE-RECOVERY'")).toHaveLength(1);
      expect(Number((await f.ap(supplierBill)).balance_due)).toBe(210);
      supplierFault.armed=false;
      supplierAdvance=(await mutation(a,'supplier-payments',()=>ap.locator('#savePayment').click())).payment;
      expect(supplierAdvance.id).toBe(supplierFault.droppedId);expect(Number(supplierAdvance.progress.unapplied_amount)).toBe(35);
      await expect(ap.locator('#paymentModal')).toBeHidden();
    });
    await step('COM-16 a reader sees allocation change AP without another cash movement or page reload',async()=>{
      const readAp=await navigate(b,'payables');
      await expect(readAp.locator('#payablesReadOnlyNote')).toBeVisible();
      await expect(readAp.locator('[data-bill-action="pay"]')).toHaveCount(0);
      await expect(readAp.locator('#newAdvancePayment')).toBeHidden();
      observerReports=await navigate(b,'reports');
      await observerReports.locator('[data-dataset="supplier_bills"]').click();
      await expect.poll(observedAP,{timeout:45_000}).toBe(210);
      const cashBefore=await f.report('cash');
      await ap.locator('[data-payment-action="allocate"][data-payment-id="'+supplierAdvance.id+'"]').click();
      await ap.locator('[data-allocation-bill="'+supplierBill.id+'"] [data-amount]').fill('35');
      await mutation(a,'supplier-payments',()=>ap.locator('#saveAllocation').click());
      await expect(ap.locator('#allocationModal')).toBeHidden();
      await expect.poll(observedAP,{timeout:45_000}).toBe(175);
      expect(await f.report('cash')).toEqual(cashBefore);
    });
    await step('COM-17 a revoked write preserves the form and restored permission safely settles after lost confirmation',async()=>{
      await ap.locator('[data-entity="bills"]').click();
      await ap.locator('[data-bill-action="pay"][data-bill-id="'+supplierBill.id+'"]').click();
      await expect(ap.locator('#pAmount')).toBeFocused();await expect(ap.locator('#pAmount')).toHaveValue('175');
      await ap.locator('#pReference').fill('QA-SUPPLIER-FINAL-RECOVERY');
      const role=async keys=>{
        const result=await api.request('access-control?resource=roles',{method:'PATCH',token:master.body.token,
          body:{id:users.a.access_role_id,permission_keys:keys}});
        expect(result.status).toBe(200);
      };
      await role(permissions.filter(key=>key!=='finance.write'));
      await mutation(a,'supplier-payments',()=>ap.locator('#savePayment').click(),403);
      await expect(ap.locator('#paymentMsg')).toContainText(/permiso/i);
      await expect(ap.locator('#pReference')).toHaveValue('QA-SUPPLIER-FINAL-RECOVERY');
      expect(await f.rows("select id from supplier_payments where reference='QA-SUPPLIER-FINAL-RECOVERY'")).toHaveLength(0);
      expect(Number((await f.ap(supplierBill)).balance_due)).toBe(175);
      await role(permissions);
      supplierFault.droppedId=null;supplierFault.armed=true;await ap.locator('#savePayment').click();
      await expect.poll(()=>supplierFault.droppedId).toBeTruthy();await expect(ap.locator('#savePayment')).toBeEnabled();
      await expect(ap.locator('#paymentMsg')).toContainText(/confirmar|intentar/i);
      expect(Number((await f.ap(supplierBill)).balance_due)).toBe(0);
      await expect(ap.locator('#pAmount')).toHaveValue('175');
      supplierFault.armed=false;
      const payment=(await mutation(a,'supplier-payments',()=>ap.locator('#savePayment').click())).payment;
      expect(payment.id).toBe(supplierFault.droppedId);await expect(ap.locator('#paymentModal')).toBeHidden();
      expect(await f.rows("select id from supplier_payments where reference='QA-SUPPLIER-FINAL-RECOVERY'")).toHaveLength(1);
      await expect.poll(observedAP,{timeout:45_000}).toBe(0);
    });
    await step('COM-18 both operators close one reconciled workday with actual cost and attributable payments',async()=>{
      const login=await api.request('login',{method:'POST',body:{username:users.b.username,password:users.b.password}});
      expect(login.status).toBe(200);
      const report=async dataset=>{
        const result=await api.request('reports?dataset='+dataset+'&include_options=0',{token:login.body.token});
        expect(result.status).toBe(200);return result.body.rows;
      };
      const sale=(await report('sales')).find(row=>row.sales_order_id===so.id||row.so_number===so.so_number);
      expect([sale.order_total,sale.recognized_merchandise_cogs,sale.direct_cost_amount,sale.contribution_margin].map(Number)).toEqual([400,250,50,100]);
      expect(sale.merchandise_cost_coverage).toBe('actual');
      const customer=(await report('invoices'))[0],supplier=(await report('supplier_bills'))[0];
      expect(Number(customer.balance_due)).toBe(0);expect(Number(supplier.balance_due)).toBe(0);
      const cash=await report('cash'),incoming=cash.filter(row=>row.direction==='in').reduce((sum,row)=>sum+Number(row.amount),0),
        outgoing=cash.filter(row=>row.direction==='out').reduce((sum,row)=>sum+Number(row.amount),0);
      expect([incoming,outgoing,incoming-outgoing]).toEqual([400,250,150]);
      expect((await report('inventory')).reduce((sum,row)=>sum+Number(row.physical_quantity),0)).toBe(0);
      const payments=await f.rows('select id,amount,created_by from supplier_payments where purchase_order_id=$1',[po.id]);
      expect(payments).toHaveLength(3);expect(payments.map(row=>Number(row.amount)).sort((a,b)=>a-b)).toEqual([35,40,175]);
      for(const p of payments){
        const audit=await f.rows("select actor_admin_id from audit_log where entity_id=$1 and action in ('supplier_bill_paid','supplier_payment_registered')",[p.id]);
        expect(audit).toHaveLength(1);expect(audit[0].actor_admin_id).toBe(users.a.id);expect(p.created_by).toBe(users.a.id);
      }
      const denied=await api.request('supplier-payments',{method:'POST',token:login.body.token,
        body:{action:'register',purchase_order_id:po.id,amount:10}});
      expect(denied.status).toBe(403);expect((await f.rows('select id from supplier_payments where purchase_order_id=$1',[po.id])).length).toBe(3);
      evidence.reconciliation={sale:400,purchase:250,collected:400,paidSupplier:250,receivable:0,payable:0,
        netCash:150,directCost:50,contribution:100,physicalStock:0,costCoverage:'actual',supplierPayments:3,supplierPaymentAudits:3};
      console.log('WORKDAY_RECONCILED '+JSON.stringify(evidence.reconciliation));
      await screenshot(b,'18-workday-supplier-settled');
    });

    expect({a:a.navigations,b:b.navigations,bf:b.frames}).toEqual(nav);
    expect(evidence.errors).toEqual([]);expect(evidence.crashes).toEqual([]);expect(evidence.external).toEqual([]);
    expect(evidence.api.filter(row=>row.status===404 || row.status>=500)).toEqual([]);
    expect(evidence.checkpoints).toHaveLength(18);
  } finally {
    const path=info.outputPath('commercial-evidence.json');
    fs.mkdirSync(info.outputDir,{recursive:true});fs.writeFileSync(path,JSON.stringify(evidence,null,2));
    await info.attach('commercial-evidence',{path,contentType:'application/json'});
    for (const [index,context] of contexts.entries()) {
      for (const page of context.pages()) {
        try { await page.screenshot({path:info.outputPath(`final-${index}.png`),timeout:5000}); } catch {}
      }
      await context.close().catch(()=>{});
    }
    globalThis.fetch=nativeFetch;
    if (api) await api.close();
    await db.end();
  }
});
