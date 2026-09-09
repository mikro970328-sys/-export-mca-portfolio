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
      grant select on load_expediente_documents, documents to service_role;
      grant select,insert on shipment_history to service_role;`);
    await db.exec(fs.readFileSync('supabase/migrations/20260831235500_ux5_shipment_action_capabilities.sql','utf8'));
    const { f,users } = await operatorFixture(db);
    api = await startBrowserAcceptanceServer();
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
    for (const [key,keys] of [['a',permissions],['b',['warehouse.read']]]) {
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
      await purchase.locator('#oSupplier').selectOption(f.supplier);
      await purchase.locator('#oWarehouse').selectOption(f.warehouse);
      await purchase.locator('#oReference').fill('QA commercial chain');
      await purchase.locator('.lProduct').selectOption(f.product);
      await purchase.locator('.lQty').fill('100');await purchase.locator('.lPallets').fill('10');
      await purchase.locator('.lPriceValue').fill('2.5');
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
      await purchase.locator('.rrQty').fill(String(quantity));
      await purchase.locator('.rrPallets').fill(String(pallets));
      await purchase.locator('.rrLot').fill(lot);
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
        await mutation(a,'invoice-payments',()=>sales.locator('#wsSavePayment').click());
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
    expect({a:a.navigations,b:b.navigations,bf:b.frames}).toEqual(nav);
    expect(evidence.errors).toEqual([]);expect(evidence.crashes).toEqual([]);expect(evidence.external).toEqual([]);
    expect(evidence.api.filter(row=>row.status===404 || row.status>=500)).toEqual([]);
    expect(evidence.checkpoints).toHaveLength(12);
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
