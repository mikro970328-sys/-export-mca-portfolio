import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import { createOperatorAcceptanceDb } from '../../scripts/lib/operator-acceptance-db.mjs';
import { operatorFixture } from '../../scripts/lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer, root } from './server.mjs';

// The commercial flow uses native UI; the final concurrency checks use its real API.
// SQL only seeds isolated catalogues/identities and verifies results.
test('direct ship: purchase to corrected physical dispatch without WR or stock', async ({ browser }, info) => {
  test.setTimeout(480_000);
  process.chdir(root);
  const db=await createOperatorAcceptanceDb();
  const nativeFetch=globalThis.fetch;
  const contexts=[];
  const evidence={checkpoints:[],api:[],errors:[],crashes:[],external:[],documents:{}};
  let api,page,loggedIn=false;
  try{
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
      grant usage on sequence purchase_order_number_seq, sales_orders_so_serial_seq, invoices_invoice_serial_seq to service_role;
      grant select on load_expediente_documents, documents, load_traceability_sources,
        load_traceability_summary to service_role;
      grant select,insert on shipment_history to service_role;
      grant insert on shipments to service_role;`);
    await db.exec(fs.readFileSync('supabase/migrations/20260831235500_ux5_shipment_action_capabilities.sql','utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20260910123500_direct_ship_quantity_corrections.sql','utf8'));
    const {f,users}=await operatorFixture(db);
    api=await startBrowserAcceptanceServer();
    const origins=new Set([api.base,new URL(process.env.ERP_TEST_POSTGREST_URL).origin]);
    globalThis.fetch=(input,options)=>{
      const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
      if(!origins.has(url.origin))throw Error('QA refuses external backend traffic');
      return nativeFetch(input,options);
    };
    await api.ready(db);
    const master=await api.request('login',{method:'POST',body:{username:users.master.username,password:users.master.password}});
    expect(master.status).toBe(200);
    const permissions=['procurement.read','procurement.write','sales.read','sales.write','logistics.read','logistics.write','warehouse.read','finance.read','finance.write','reports.read'];
    const role=await api.request('access-control?resource=roles',{method:'PATCH',token:master.body.token,
      body:{id:users.a.access_role_id,permission_keys:permissions}});
    expect(role.status).toBe(200);

    const use=info.project.use;
    const context=await browser.newContext({viewport:use.viewport,userAgent:use.userAgent,isMobile:use.isMobile,
      hasTouch:use.hasTouch,deviceScaleFactor:use.deviceScaleFactor,locale:'es-US',timezoneId:'America/New_York',serviceWorkers:'allow'});
    contexts.push(context);
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin===api.base||['data:','blob:','about:'].includes(url.protocol))return route.continue();
      evidence.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');
    });
    page=await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror',error=>evidence.errors.push(error.message));
    page.on('crash',()=>evidence.crashes.push('page'));
    page.on('response',response=>{
      const url=new URL(response.url());
      if(url.origin===api.base&&url.pathname.startsWith('/api/'))evidence.api.push({path:url.pathname,status:response.status(),method:response.request().method()});
    });
    await page.goto(`${api.base}/admin/pwa.html`);
    await page.locator('#username').fill(users.a.username);
    await page.locator('#password').fill(users.a.password);
    const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/login'&&r.request().method()==='POST');
    await page.locator('#login').click();expect((await login).status()).toBe(200);
    await expect(page.locator('#loginPage')).toBeHidden();
    loggedIn=true;
    await page.waitForFunction(()=>window.NavigationShell?.owner==='navigation-shell.js');

    const module=(name,target=page)=>target.frameLocator(`#${name}Section iframe`);
    const navigate=async(name,target=page)=>{
      const button=target.locator(`[data-section="${name}Section"]`).first();
      if(use.isMobile&&!await target.locator('#sidebar').evaluate(el=>el.classList.contains('mobile-open'))){
        await target.locator('#mobileMenuBtn').click();await expect(target.locator('#sidebar')).toHaveClass(/mobile-open/);
      }
      if(!await button.isVisible()){
        const group=button.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," nav-group ")]');
        await group.locator('.nav-group-btn').click();
      }
      await button.click();await expect(target.locator(`#${name}Section`)).toBeVisible();return module(name,target);
    };
    const responseFor=path=>page.waitForResponse(r=>new URL(r.url()).pathname===`/api/${path}`&&r.request().method()==='POST')
      .then(response=>({response}),error=>({error}));
    const checked=async(pending,path,status=200)=>{
      const result=await pending;if(result.error)throw result.error;
      const response=result.response,body=await response.json();
      expect(response.status(),JSON.stringify({path,error:body.error,details:body.details})).toBe(status);return body;
    };
    const mutation=async(path,click,status=200)=>{
      const pending=responseFor(path);
      await click();return checked(pending,path,status);
    };
    const noStock=async()=>{
      for(const table of ['warehouse_receipts','loads','inventory_movements','inventory_summary']){
        expect(Number((await f.one(`select count(*) as count from ${table}`)).count),table).toBe(0);
      }
    };
    const shot=async name=>{
      const path=info.outputPath(`${name}.png`);
      await page.screenshot({path,timeout:5000});await info.attach(name,{path,contentType:'image/png'});
    };
    const step=async(name,fn)=>test.step(name,async()=>{await fn();await noStock();evidence.checkpoints.push(name);console.log(`PASS ${info.project.name} ${name}`);});

    const purchases=await navigate('purchases');
    let po,so,shipment,procurement,direct;
    await step('DS-01 Direct Ship purchase 840 does not create WR or inventory',async()=>{
      await purchases.locator('[data-view="all"]').click();await purchases.locator('#newOrder').click();
      await purchases.locator('#oSupplier').selectOption(f.supplier);
      await purchases.locator('#oDestinationMode').selectOption('direct');
      await expect(purchases.locator('#oWarehouseField')).toBeHidden();
      await purchases.locator('.lProduct').selectOption(f.product);
      await purchases.locator('.lQty').fill('840');
      await purchases.locator('.lPallets').fill('10');
      await purchases.locator('.lUpp').fill('84');
      await purchases.locator('.lPriceValue').fill('2.5');
      await mutation('purchases',()=>purchases.locator('#saveOrder').click());
      await expect(purchases.locator('#orderModal')).toBeHidden();
      po=await f.one('select * from purchase_orders');evidence.documents.purchase=po.po_number;
      expect(po.warehouse_id).toBeNull();
      expect(Number((await f.one('select ordered_quantity from purchase_order_items')).ordered_quantity)).toBe(840);
    });
    const purchaseTransition=async action=>{
      await purchases.locator(`[data-view-order="${po.id}"]`).click();
      await purchases.locator(`[data-detail-action="${action}"]`).click();
      await mutation('purchases',()=>purchases.locator('#purchaseDecisionAccept').click());
      await expect(purchases.locator('#detailModal')).toBeHidden();
    };
    await step('DS-02 issue and confirm Direct Ship purchase without receipt action',async()=>{
      await purchaseTransition('issue');await purchaseTransition('confirm');
      expect((await f.one('select status from purchase_orders where id=$1',[po.id])).status).toBe('confirmed');
      await expect(purchases.locator(`[data-receive-order="${po.id}"]`)).toHaveCount(0);
    });

    const sales=await navigate('sales');
    await step('DS-03 create and confirm sale for 840',async()=>{
      await sales.locator('[data-view="all"]').click();await sales.locator('#newOrder').click();
      await sales.locator('#oClientPickerButton').click();await sales.locator(`[data-client-id="${f.client}"]`).click();
      await sales.locator('#oImporter').selectOption(f.importer);
      await sales.locator('.lProduct').selectOption(f.product);await sales.locator('.lQty').fill('840');
      await sales.locator('.lPallets').fill('10');await sales.locator('.lUpp').fill('84');await sales.locator('.lTotal').fill('3360');
      await mutation('sales-order-ux',()=>sales.locator('#saveOrder').click());
      await expect(sales.locator('#orderModal')).toBeHidden();
      so=await f.one('select * from sales_orders');evidence.documents.sale=so.so_number;
      const item=await f.one('select ordered_quantity,ordered_pallets from sales_order_items');
      expect(Number(item.ordered_quantity)).toBe(840);expect(Number(item.ordered_pallets)).toBe(10);
      evidence.saleQuantities=item;
      await sales.locator(`[data-view-order="${so.id}"]`).click();
      await sales.locator('[data-ws-action="confirm"]').first().click();
      await mutation('sales',()=>sales.locator('[data-sales-workspace-accept]').click());
      await expect(sales.locator('#detailSubtitle')).toContainText('Confirmada');
    });
    await step('DS-04 choose confirmed Direct Ship purchase from the sale',async()=>{
      await sales.locator('[data-close="detail"]').click();
      await sales.locator(`[data-supply-order="${so.id}"]`).click();
      await expect(sales.locator('#salesSupplyModal')).toBeVisible();
      await sales.locator('[data-supply-action="quick-direct"]').click();
      const poItem=await f.one('select id from purchase_order_items where purchase_order_id=$1',[po.id]);
      await sales.locator('#quickDirectPo').selectOption(poItem.id);
      await sales.locator('#quickDirectSalesPallets').fill('10');
      await sales.locator('#quickDirectPurchasePallets').fill('10');
      await mutation('sales-supply',()=>sales.locator('#salesSupplyFormSave').click());
      await expect(sales.locator('#salesSupplyFormModal')).toBeHidden();
      await expect(sales.locator('#salesSupplyBody')).toContainText('Paso 1 listo');
      procurement=await f.one('select * from sales_procurement_allocations');
      expect(Number(procurement.allocated_sales_quantity)).toBe(840);
      expect(Number(procurement.allocated_purchase_quantity)).toBe(840);
    });
    await step('DS-05 register and link the Direct Ship container',async()=>{
      await sales.locator('[data-supply-action="new-direct"]').click();
      await sales.locator('#supplyNewContainer').fill('QA-DIRECT-840');
      await sales.locator('#supplyNewCarrier').fill('QA Carrier');
      await sales.locator('#supplyNewBooking').fill('QA-BOOK-840');
      await sales.locator('#supplyNewBol').fill('QA-BOL-840');
      const creation=responseFor('direct-shipment-dispatch'),linkage=responseFor('sales-supply');
      await sales.locator('#salesSupplyFormSave').click();
      await checked(creation,'direct-shipment-dispatch');await checked(linkage,'sales-supply');
      await expect(sales.locator('#salesSupplyFormModal')).toBeHidden();
      await expect(sales.locator('#salesSupplyBody')).toContainText('QA-DIRECT-840');
      shipment=await f.one("select * from shipments where container_number='QA-DIRECT-840'");
      evidence.documents.container=shipment.container_number;
      direct=await f.one('select * from direct_shipment_allocations where shipment_id=$1',[shipment.id]);
      expect(Number(direct.allocated_sales_quantity)).toBe(840);expect(Number(direct.allocated_sales_pallets)).toBe(10);
      await shot('05-direct-linked');
    });
    await step('DS-06 declining unlink preserves the container allocation',async()=>{
      await sales.locator(`[data-supply-action="unlink-direct"][data-direct-id="${direct.id}"]`).click();
      await expect(sales.locator('#salesSupplyDecisionModal')).toBeVisible();
      await sales.locator('[data-supply-decision-close]').last().click();
      await expect(sales.locator('#salesSupplyDecisionModal')).toBeHidden();
      expect((await f.one('select id from direct_shipment_allocations')).id).toBe(direct.id);
    });
    await step('DS-07 unlink and reuse the same container before dispatch',async()=>{
      await sales.locator(`[data-supply-action="unlink-direct"][data-direct-id="${direct.id}"]`).click();
      await mutation('sales-supply',()=>sales.locator('#salesSupplyDecisionAccept').click());
      await expect(sales.locator('#salesSupplyDecisionModal')).toBeHidden();
      await expect(sales.locator('[data-supply-action="unlink-direct"]')).toHaveCount(0);
      expect((await f.rows('select id from direct_shipment_allocations')).length).toBe(0);
      expect((await f.rows('select id from shipments')).length).toBe(1);
      await sales.locator('[data-supply-action="link-direct"]').click();
      await sales.locator('#supplyDirectShipment').selectOption(shipment.id);
      await sales.locator('#supplyDirectSalesQty').fill('840');await sales.locator('#supplyDirectPurchaseQty').fill('840');
      await sales.locator('#supplyDirectSalesPallets').fill(String(procurement.allocated_sales_pallets));
      await sales.locator('#supplyDirectPurchasePallets').fill(String(procurement.allocated_purchase_pallets));
      await mutation('sales-supply',()=>sales.locator('#salesSupplyFormSave').click());
      await expect(sales.locator('#salesSupplyFormModal')).toBeHidden();
      direct=await f.one('select * from direct_shipment_allocations');
      expect(direct.shipment_id).toBe(shipment.id);
      expect(Number(direct.allocated_sales_quantity)).toBe(840);
    });
    await step('DS-08 cancelled or empty dispatch form does not record a departure',async()=>{
      await sales.locator(`[data-supply-action="dispatch-direct"][data-shipment-id="${shipment.id}"]`).click();
      await sales.locator('[data-supply-form-close]').last().click();
      await expect(sales.locator('#salesSupplyFormModal')).toBeHidden();
      expect((await f.rows('select * from direct_shipment_dispatches')).length).toBe(0);
      await sales.locator(`[data-supply-action="dispatch-direct"][data-shipment-id="${shipment.id}"]`).click();
      await sales.locator('#supplyDispatchAt').fill('');
      const writes=evidence.api.filter(row=>row.method==='POST'&&row.path==='/api/direct-shipment-dispatch').length;
      await sales.locator('#salesSupplyFormSave').click();
      await expect(sales.locator('#salesSupplyFormMsg')).toContainText('Indica una fecha y hora válida');
      expect(evidence.api.filter(row=>row.method==='POST'&&row.path==='/api/direct-shipment-dispatch').length).toBe(writes);
      expect((await f.rows('select * from direct_shipment_dispatches')).length).toBe(0);
      await sales.locator('[data-supply-form-close]').last().click();
    });
    await step('DS-09 dispatch initially fulfills the 840 plan',async()=>{
      await sales.locator(`[data-supply-action="dispatch-direct"][data-shipment-id="${shipment.id}"]`).click();
      await sales.locator('#supplyDispatchAt').fill('2026-09-09T10:15');
      await mutation('direct-shipment-dispatch',()=>sales.locator('#salesSupplyFormSave').click());
      await expect(sales.locator('#salesSupplyFormModal')).toBeHidden();
      const dispatch=await f.one('select * from direct_shipment_dispatches where shipment_id=$1',[shipment.id]);
      expect(new Date(dispatch.dispatched_at).toISOString()).toBe('2026-09-09T14:15:00.000Z');
      evidence.documents.dispatchedAt=new Date(dispatch.dispatched_at).toISOString();
      expect((await f.one('select fulfillment_status from sales_order_progress where sales_order_id=$1',[so.id])).fulfillment_status).toBe('dispatched');
      await expect(sales.locator('#salesSupplyBody')).toContainText('Despachado');
    });
    // Keep an independent reader on Reports while the writer changes operations.
    const readRole=await api.request('access-control?resource=roles',{method:'PATCH',token:master.body.token,body:{id:users.b.access_role_id,permission_keys:['reports.read','sales.read','finance.read','procurement.read']}});expect(readRole.status).toBe(200);
    const observerContext=await browser.newContext({viewport:use.viewport,userAgent:use.userAgent,isMobile:use.isMobile,hasTouch:use.hasTouch,deviceScaleFactor:use.deviceScaleFactor,locale:'es-US',timezoneId:'America/New_York'});contexts.push(observerContext);
    await observerContext.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===api.base||['data:','blob:','about:'].includes(u.protocol))return route.continue();evidence.external.push(u.origin+u.pathname);return route.abort();});
    const observer=await observerContext.newPage();observer.setDefaultTimeout(25_000);
    observer.on('pageerror',e=>evidence.errors.push(e.message));
    observer.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))evidence.api.push({path:u.pathname,status:r.status(),method:r.request().method()});});
    let reportNavigations=0;observer.on('framenavigated',()=>reportNavigations++);
    await observer.goto(`${api.base}/admin/pwa.html`);await observer.locator('#username').fill(users.b.username);await observer.locator('#password').fill(users.b.password);await observer.locator('#login').click();await expect(observer.locator('#loginPage')).toBeHidden();
    await observer.waitForFunction(()=>window.NavigationShell?.owner==='navigation-shell.js');
    const reports=await navigate('reports',observer);
    const reportNumber=async label=>{const text=await reports.locator(`#reportTable tbody tr:first-child [data-label="${label}"]`).textContent();return /[0-9]/.test(text)?Number(text.replace(/[^0-9.-]/g,'')):null;};
    await expect.poll(()=>reportNumber('COGS reconocido'),{timeout:45_000}).toBe(2100);
    const reportNavBaseline=reportNavigations;
    const reportShot=async name=>{const path=info.outputPath(`${name}.png`);await observer.screenshot({path,timeout:5000});await info.attach(name,{path,contentType:'image/png'});};
    await step('DS-10 raw dispatched allocation remains protected',async()=>{
      await expect(sales.locator('[data-supply-action="unlink-direct"]')).toHaveCount(0);
      await expect(sales.locator('[data-supply-action="dispatch-direct"]')).toHaveCount(0);
      await sales.locator(`[data-supply-action="edit-purchase"][data-proc-id="${procurement.id}"]`).click();
      await sales.locator('#supplySalesQty').fill('839');
      await mutation('sales-supply',()=>sales.locator('#salesSupplyFormSave').click(),400);
      await expect(sales.locator('#salesSupplyFormMsg')).toContainText('no puede quedar por debajo');
      expect(Number((await f.one('select allocated_sales_quantity from sales_procurement_allocations')).allocated_sales_quantity)).toBe(840);
      expect(Number((await f.one('select allocated_sales_quantity from direct_shipment_allocations')).allocated_sales_quantity)).toBe(840);
      await sales.locator('[data-supply-form-close]').last().click();
    });
    await step('DS-11 correct actual physical shipment from 840 to 810',async()=>{
      await expect(sales.locator(`[data-supply-action="correct-direct"][data-direct-id="${direct.id}"]`)).toBeVisible();
      await sales.locator(`[data-supply-action="correct-direct"][data-direct-id="${direct.id}"]`).click();
      await expect(sales.locator('#salesSupplyFormTitle')).toContainText('Corregir cantidades físicas');
      await sales.locator('#directCorrectSalesQty').fill('810');
      await sales.locator('#directCorrectPurchaseQty').fill('810');
      await sales.locator('#directCorrectReason').fill('El proveedor redujo 30 unidades por límite de peso.');
      await mutation('direct-shipment-dispatch',()=>sales.locator('#salesSupplyFormSave').click());
      await expect(sales.locator('#salesSupplyFormModal')).toBeHidden();
      const raw=await f.one('select allocated_sales_quantity,allocated_purchase_quantity from direct_shipment_allocations where id=$1',[direct.id]);
      expect(Number(raw.allocated_sales_quantity)).toBe(840);expect(Number(raw.allocated_purchase_quantity)).toBe(840);
      const correction=await f.one('select * from direct_shipment_quantity_corrections where direct_shipment_allocation_id=$1',[direct.id]);
      expect(Number(correction.previous_sales_quantity)).toBe(840);expect(Number(correction.corrected_sales_quantity)).toBe(810);
      expect(Number(correction.previous_purchase_quantity)).toBe(840);expect(Number(correction.corrected_purchase_quantity)).toBe(810);
      expect(correction.reason).toContain('límite de peso');
      const effective=await f.one('select * from direct_shipment_effective_allocations where id=$1',[direct.id]);
      expect(Number(effective.planned_sales_quantity)).toBe(840);expect(Number(effective.allocated_sales_quantity)).toBe(810);
      expect(Number(effective.planned_purchase_quantity)).toBe(840);expect(Number(effective.allocated_purchase_quantity)).toBe(810);
      const itemProgress=await f.one('select dispatched_quantity,remaining_to_dispatch_quantity,is_fully_dispatched,has_partial_dispatch from sales_order_item_progress where sales_order_id=$1',[so.id]);
      expect(Number(itemProgress.dispatched_quantity)).toBe(810);expect(Number(itemProgress.remaining_to_dispatch_quantity)).toBe(30);
      expect(itemProgress.is_fully_dispatched).toBe(false);expect(itemProgress.has_partial_dispatch).toBe(true);
      expect((await f.one('select fulfillment_status from sales_order_progress where sales_order_id=$1',[so.id])).fulfillment_status).toBe('partial');
      expect(Number((await f.one('select ordered_quantity from purchase_order_items where purchase_order_id=$1',[po.id])).ordered_quantity)).toBe(840);
      await expect(sales.locator('#salesSupplyBody')).toContainText('Enviado real:');
      await expect(sales.locator('#salesSupplyBody')).toContainText('810');
      await expect(sales.locator('#salesSupplyBody')).toContainText('Diferencia: 30');
      await expect.poll(()=>reportNumber('COGS reconocido'),{timeout:45_000}).toBe(2025);
      await expect.poll(()=>reportNumber('Venta atribuida')).toBe(3240);
      await expect.poll(()=>reportNumber('Valor no atribuido')).toBe(120);
      await reportShot('11-observer-corrected-report');
      evidence.physicalCorrection={planned:840,shipped:810,difference:30};
      await shot('11-direct-corrected-810');
    });
    await step('DS-12 correction cannot exceed original plan and no-op is rejected',async()=>{
      await sales.locator(`[data-supply-action="correct-direct"][data-direct-id="${direct.id}"]`).click();
      await sales.locator('#directCorrectSalesQty').fill('841');
      await sales.locator('#directCorrectPurchaseQty').fill('841');
      await sales.locator('#directCorrectReason').fill('Prueba de límite QA');
      await mutation('direct-shipment-dispatch',()=>sales.locator('#salesSupplyFormSave').click(),400);
      await expect(sales.locator('#salesSupplyFormMsg')).toContainText('no puede superar');
      expect(Number((await f.one('select allocated_sales_quantity from direct_shipment_effective_allocations where id=$1',[direct.id])).allocated_sales_quantity)).toBe(810);
      await sales.locator('#directCorrectSalesQty').fill('810');
      await sales.locator('#directCorrectPurchaseQty').fill('810');
      await sales.locator('#directCorrectReason').fill('Misma cantidad');
      await mutation('direct-shipment-dispatch',()=>sales.locator('#salesSupplyFormSave').click(),400);
      await expect(sales.locator('#salesSupplyFormMsg')).toContainText('iguales');
      expect((await f.rows('select id from direct_shipment_quantity_corrections')).length).toBe(1);
      await sales.locator('[data-supply-form-close]').last().click();
    });
    await step('DS-13 correction is auditable and still creates no warehouse stock',async()=>{
      const history=await f.one("select * from shipment_history where shipment_id=$1 and event_type='direct_shipment_quantity_corrected'",[shipment.id]);
      expect(history.details).toContain('840');expect(history.details).toContain('810');
      const audits=await f.rows("select * from audit_log where action='direct_shipment_quantity_corrected'");
      expect(audits).toHaveLength(1);
      const contents=await f.one('select * from shipment_direct_supply_contents where direct_shipment_allocation_id=$1',[direct.id]);
      expect(Number(contents.allocated_sales_quantity)).toBe(810);expect(Number(contents.planned_sales_quantity)).toBe(840);
      await shot('13-correction-audit');
    });
    await step('DS-14 direct sale invoice and collection appear live in reader reports',async()=>{
      await sales.locator('[data-supply-close="main"]').click();await sales.locator(`[data-view-order="${so.id}"]`).click();await sales.locator('[data-ws-tab="billing"]').click();
      await sales.locator('[data-ws-action="new_invoice"]').first().click();await mutation('invoices',()=>sales.locator('#wsSaveInvoice').click());await expect(sales.locator('#salesWorkspaceInvoiceModal')).toBeHidden();
      await sales.locator('[data-ws-action="issue_invoice"]').first().click();await mutation('invoices',()=>sales.locator('[data-sales-workspace-accept]').click());
      await reports.locator('[data-dataset="invoices"]').click();await expect.poll(()=>reportNumber('Total'),{timeout:45_000}).toBe(3360);
      await sales.locator('[data-ws-action="payment"]').first().click();await sales.locator('#wsPaymentAmount').fill('1000');await mutation('invoice-payments',()=>sales.locator('#wsSavePayment').click());await expect(sales.locator('#salesWorkspacePaymentModal')).toBeHidden();
      await expect.poll(()=>reportNumber('AR actual'),{timeout:45_000}).toBe(2360);await expect.poll(()=>reportNumber('Cobrado aplicado')).toBe(1000);
      expect(await reportNumber('COGS reconocido')).toBeNull();
      const invoice=await f.one('select * from invoices');expect([...(await f.rows('select total,paid_amount,balance_due from invoice_financial_progress where invoice_id=$1',[invoice.id]))].map(r=>[r.total,r.paid_amount,r.balance_due].map(Number))).toEqual([[3360,1000,2360]]);
      await sales.locator('[data-ws-tab="costs"]').click();await sales.locator('[data-ws-action="new_cost"]').first().click();await sales.locator('#wsCostAmount').fill('50');await mutation('costs',()=>sales.locator('#wsSaveCost').click());await expect(sales.locator('#salesWorkspaceCostModal')).toBeHidden();await sales.locator('[data-close="detail"]').click();
      await reports.locator('[data-dataset="sales"]').click();await expect.poll(()=>reportNumber('Contribución'),{timeout:45_000}).toBe(1165);
    });
    await step('DS-15 supplier bill payment and reversal preserve direct shipment and update AP',async()=>{
      const ap=await navigate('payables');await ap.locator('#newBill').click();await ap.locator('#bPO').selectOption(po.id);await ap.locator('#bSupplierInvoice').fill('QA-DIRECT-BILL');await ap.locator('[data-bill-line] [data-total]').fill('2100');
      const created=await mutation('payables',()=>ap.locator('#saveBill').click());await expect(ap.locator('#billModal')).toBeHidden();const bill=created.bill;
      await ap.locator(`[data-bill-action="post"][data-bill-id="${bill.id}"]`).click();await mutation('payables',()=>ap.locator('#decisionAccept').click());await expect(ap.locator('#decisionModal')).toBeHidden();
      await reports.locator('[data-dataset="supplier_bills"]').click();await expect.poll(()=>reportNumber('AP actual'),{timeout:45_000}).toBe(2100);
      await ap.locator(`[data-bill-action="pay"][data-bill-id="${bill.id}"]`).click();await ap.locator('#pAmount').fill('600');const paid=await mutation('supplier-payments',()=>ap.locator('#savePayment').click());await expect(ap.locator('#paymentModal')).toBeHidden();
      await expect.poll(()=>reportNumber('AP actual'),{timeout:45_000}).toBe(1500);
      await ap.locator('[data-entity="payments"]').click();await ap.locator(`[data-payment-action="reverse"][data-payment-id="${paid.payment.id}"]`).click();await ap.locator('#rReason').fill('QA payment entered by mistake');await mutation('supplier-payments',()=>ap.locator('#saveReverse').click());await expect(ap.locator('#reverseModal')).toBeHidden();
      await expect.poll(()=>reportNumber('AP actual'),{timeout:45_000}).toBe(2100);
      await reports.locator('[data-dataset="sales"]').click();await expect.poll(()=>reportNumber('COGS reconocido'),{timeout:45_000}).toBe(2025);await expect.poll(()=>reportNumber('Contribución')).toBe(1165);
      await expect(reports.locator('#reportTable [data-label="Cobertura COGS"]')).toHaveText('actual');
      expect(Number((await f.one('select allocated_sales_quantity from direct_shipment_effective_allocations where id=$1',[direct.id])).allocated_sales_quantity)).toBe(810);
      await reportShot('15-observer-financial-report');
    });
    const billing=await navigate('invoices');
    const creditedInvoice=await f.one('select * from invoices');
    let lastCreditBody;
    await step('DS-16 quantity credit preserves original invoice and cash, updates reader AR and margin',async()=>{
      await reports.locator('[data-dataset="invoices"]').click();
      await billing.locator(`[data-invoice-action="credit"][data-invoice-id="${creditedInvoice.id}"]`).click();
      await billing.locator('#saveCredit').click();await expect(billing.locator('#creditMsg')).toContainText('cantidad válida');
      await billing.locator('[data-credit-qty]').fill('841');await billing.locator('#saveCredit').click();await expect(billing.locator('#creditMsg')).toContainText('cantidad válida');
      await billing.locator('[data-credit-qty]').fill('30');await billing.locator('#creditReason').fill('El proveedor entregó 810 de las 840 unidades facturadas.');
      await expect(billing.locator('#creditSummary')).toContainText('USD 120.00');
      const capture=r=>{if(new URL(r.url()).pathname==='/api/invoices'&&r.method()==='POST')lastCreditBody=r.postDataJSON();};page.on('request',capture);
      await mutation('invoices',()=>billing.locator('#saveCredit').click());page.off('request',capture);
      await expect(billing.locator('#creditModal')).toBeHidden();await expect(billing.locator('#detailBody')).toContainText('NC-');await expect(billing.locator('#detailBody')).toContainText('USD 3,360.00');
      await expect(billing.locator('#detailBody')).toContainText('USD 3,240.00');await expect(billing.locator('#detailBody')).toContainText('30 cajas descontadas');
      await expect.poll(()=>reportNumber('Total'),{timeout:45_000}).toBe(3240);await expect.poll(()=>reportNumber('AR actual')).toBe(2240);
      await expect.poll(()=>reportNumber('Notas de crédito')).toBe(120);await expect.poll(()=>reportNumber('COGS reconocido')).toBe(2025);await expect.poll(()=>reportNumber('Margen bruto')).toBe(1215);
      expect(Number((await f.one('select quantity from invoice_items where invoice_id=$1',[creditedInvoice.id])).quantity)).toBe(840);
      expect(Number((await f.one('select amount from payments where invoice_id=$1',[creditedInvoice.id])).amount)).toBe(1000);
      evidence.creditCorrection={original:3360,credit:120,net:3240,paid:1000,receivable:2240,cogs:2025,margin:1215};await shot('16-credit-note-detail');
    });
    await step('DS-17 paid invoice credit shows customer balance without moving cash',async()=>{
      await billing.locator('#detailActions [data-invoice-action="payment"]').click();await expect(billing.locator('#pAmount')).toHaveValue('2240');
      await mutation('invoice-payments',()=>billing.locator('#savePayment').click());await expect(billing.locator('#paymentModal')).toBeHidden();
      await billing.locator('#detailActions [data-invoice-action="credit"]').click();await billing.locator('[data-credit-qty]').fill('10');await billing.locator('#creditReason').fill('QA ajuste adicional de diez unidades.');
      await expect(billing.locator('#creditSummary')).toContainText('Saldo a favor: USD 40.00');
      await mutation('invoices',()=>billing.locator('#saveCredit').click());await expect(billing.locator('#creditModal')).toBeHidden();
      await expect(billing.locator('#detailBody')).toContainText('Saldo a favor del cliente');await expect(billing.locator('#detailBody')).toContainText('USD 40.00');
      await expect.poll(()=>reportNumber('Saldo a favor'),{timeout:45_000}).toBe(40);await expect.poll(()=>reportNumber('AR actual')).toBe(0);await expect.poll(()=>reportNumber('Cobrado aplicado')).toBe(3240);
      expect(Number((await f.one("select sum(amount) as total from payments where invoice_id=$1 and status='posted'",[creditedInvoice.id])).total)).toBe(3240);
      await shot('17-customer-credit-balance');
    });
    await step('DS-18 API retries, concurrent writers and reader permissions prevent duplicate credits',async()=>{
      const login=await api.request('login',{method:'POST',body:{username:users.a.username,password:users.a.password}});expect(login.status).toBe(200);
      const retry=await Promise.all([1,2].map(()=>api.request('invoices',{method:'POST',token:login.body.token,body:lastCreditBody})));expect(retry.map(r=>r.status)).toEqual([200,200]);expect(retry[0].body.credit_note.id).toBe(retry[1].body.credit_note.id);
      expect(Number((await f.one('select count(*) as n from invoice_credit_notes')).n)).toBe(2);
      const body={...lastCreditBody,reason:'QA concurrent operator adjustment',lines:[{...lastCreditBody.lines[0],quantity:'1',expected_credited_quantity:'40'}]};
      const results=await Promise.all([login.body.token,master.body.token].map(token=>api.request('invoices',{method:'POST',token,body:{...body,request_id:randomUUID()}})));
      expect(results.map(r=>r.status).sort()).toEqual([200,400]);expect(results.find(r=>r.status===400).body.details.code).toBe('INVOICE_CREDIT_STALE');
      const reader=await api.request('login',{method:'POST',body:{username:users.b.username,password:users.b.password}});
      expect((await api.request('invoices',{method:'POST',token:reader.body.token,body:{...body,request_id:randomUUID()}})).status).toBe(403);
      expect(Number((await f.one('select count(*) as n from invoice_credit_notes')).n)).toBe(3);
      await expect.poll(()=>reportNumber('Saldo a favor'),{timeout:45_000}).toBe(44);await expect.poll(()=>reportNumber('Total')).toBe(3196);
      expect(Number((await f.one('select quantity from invoice_items where invoice_id=$1',[creditedInvoice.id])).quantity)).toBe(840);
      evidence.creditConcurrency={retries:[200,200],writers:[200,400],reader:403,notes:3,creditBalance:44};
    });
    let settlementTarget,applicationMovement,refundMovement;
    const reportInvoiceValue=async(number,label)=>{
      const row=reports.locator('#reportTable tbody tr').filter({hasText:number});
      const value=await row.locator(`[data-label="${label}"]`).textContent();return Number(value.replace(/[^0-9.-]/g,''));
    };
    await step('DS-19 apply credit to another invoice without another cash receipt',async()=>{
      await billing.locator('[data-close="detail"]').click();await billing.locator('[data-view="all"]').click();
      await billing.locator('#newInvoice').click();await billing.locator('#iSalesOrder').selectOption(so.id);await billing.locator('[data-invoice-line] [data-qty]').fill('10');
      const result=await mutation('invoices',()=>billing.locator('#saveInvoice').click());settlementTarget=result.invoice;await expect(billing.locator('#invoiceModal')).toBeHidden();
      await billing.locator(`#invoiceList [data-invoice-action="issue"][data-invoice-id="${settlementTarget.id}"]`).click();await mutation('invoices',()=>billing.locator('#decisionAccept').click());await expect(billing.locator('#decisionModal')).toBeHidden();
      const before=await f.report('cash');
      await billing.locator(`#invoiceList [data-invoice-action="apply_credit"][data-invoice-id="${creditedInvoice.id}"]`).click();await expect(billing.locator('#balanceRefundWrap')).toBeHidden();
      await billing.locator('#balanceTarget').selectOption(settlementTarget.id);await expect(billing.locator('#balanceAmount')).toHaveValue('40');await billing.locator('#balanceReason').fill('Aplicar saldo a la siguiente factura del cliente.');
      applicationMovement=(await mutation('invoices',()=>billing.locator('#saveBalance').click())).movement;await expect(billing.locator('#balanceModal')).toBeHidden();
      await expect(billing.locator('#detailBody')).toContainText('Aplicación entre facturas');await expect(billing.locator('#detailBody')).toContainText('USD 4.00');
      await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'Saldo a favor'),{timeout:45_000}).toBe(4);
      await expect.poll(()=>reportInvoiceValue(settlementTarget.invoice_number,'AR actual')).toBe(0);await expect.poll(()=>reportInvoiceValue(settlementTarget.invoice_number,'Crédito recibido')).toBe(40);
      expect(await f.report('cash')).toEqual(before);expect(Number((await f.one('select sum(paid_amount) as amount from invoice_financial_progress')).amount)).toBe(3240);
      await shot('19-applied-credit');
    });
    await step('DS-20 record actual refund in cash and in the other operators reports',async()=>{
      // Choose another field before the opening frame: deferred autofocus must not steal it.
      const keepsChosenField=await billing.locator('#detailActions [data-invoice-action="refund_credit"]').evaluate(async button=>{
        const doc=button.ownerDocument;button.click();const reference=doc.getElementById('balanceReference');reference.focus();
        await new Promise(resolve=>doc.defaultView.requestAnimationFrame(resolve));return doc.activeElement===reference;
      });
      expect(keepsChosenField,'opening the refund must preserve the field selected by the operator').toBe(true);
      await billing.locator('#balanceModal [data-close="balance"]').first().click();
      await billing.locator('#invoiceList [data-invoice-action="detail"][data-invoice-id="'+creditedInvoice.id+'"]').click();
      await billing.locator('#detailActions [data-invoice-action="refund_credit"]').click();await expect(billing.locator('#balanceTargetWrap')).toBeHidden();await expect(billing.locator('#balanceCopy')).toContainText('ya realizaste');
      await expect(billing.locator('#balanceAmount')).toHaveValue('4');await billing.locator('#balanceReference').fill('QA-REFUND-004');await billing.locator('#balanceReason').fill('Devolución del saldo restante realizada al cliente.');
      await expect(billing.locator('#balanceReference')).toHaveValue('QA-REFUND-004');await expect(billing.locator('#balanceAmount')).toHaveValue('4');
      refundMovement=(await mutation('invoices',()=>billing.locator('#saveBalance').click())).movement;await expect(billing.locator('#balanceModal')).toBeHidden();
      await expect(billing.locator('#detailBody')).toContainText('QA-REFUND-004');await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'Saldo a favor'),{timeout:45_000}).toBe(0);await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'Saldo devuelto')).toBe(4);
      await reports.locator('[data-dataset="cash"]').click();await expect(reports.locator('#reportTable tbody')).toContainText('Devolución de saldo a favor');await expect(reports.locator('#reportTable tbody')).toContainText('QA-REFUND-004');
      const cash=await f.report('cash');expect(cash.rows.filter(r=>r.event_type==='invoice_credit_refund')).toHaveLength(1);expect(cash.rows.reduce((n,r)=>n+Number(r.amount)*(r.direction==='in'?1:-1),0)).toBe(3236);
      expect(Number((await f.financial(creditedInvoice)).customer_credit_balance)).toBe(0);await shot('20-credit-refund-history');
    });
    await step('DS-21 reverse application and refund without removing their history',async()=>{
      for(const movement of [refundMovement,applicationMovement]){
        await billing.locator(`[data-reverse-credit-movement="${movement.id}"]`).click();await billing.locator('#decisionReason').fill('QA corrección de registro, conservar historial.');await mutation('invoices',()=>billing.locator('#decisionAccept').click());await expect(billing.locator('#decisionModal')).toBeHidden();
      }
      await expect(billing.locator('#detailBody')).toContainText('Revertido');await expect.poll(()=>reports.locator('#reportTable tbody').textContent(),{timeout:45_000}).not.toContain('QA-REFUND-004');
      await reports.locator('[data-dataset="invoices"]').click();await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'Saldo a favor'),{timeout:45_000}).toBe(44);await expect.poll(()=>reportInvoiceValue(settlementTarget.invoice_number,'AR actual')).toBe(40);
      expect((await f.rows('select id from invoice_credit_movements')).length).toBe(4);expect((await f.rows("select id from invoice_credit_movement_state where status='reversed'")).length).toBe(2);
      await shot('21-credit-reversals');
    });
    await step('DS-22 competing application and refund consume available credit only once',async()=>{
      const login=await api.request('login',{method:'POST',body:{username:users.a.username,password:users.a.password}});
      const base={action:'credit_settlement',invoice_id:creditedInvoice.id,amount:'30',expected_available:'44',effective_date:new Date().toISOString().slice(0,10),reason:'QA concurrent use of same balance',method:'wire',reference:'QA-RACE-030'};
      const intents=[{...base,movement_type:'application',target_invoice_id:settlementTarget.id,request_id:randomUUID()},{...base,movement_type:'refund',request_id:randomUUID()}],tokens=[login.body.token,master.body.token];
      const results=await Promise.all(intents.map((body,i)=>api.request('invoices',{method:'POST',body,token:tokens[i]})));expect(results.map(r=>r.status).sort()).toEqual([200,400]);expect(results.find(r=>r.status===400).body.details.code).toBe('INVOICE_CREDIT_BALANCE_STALE');
      const winner=results.findIndex(r=>r.status===200),retries=await Promise.all([1,2].map(()=>api.request('invoices',{method:'POST',body:intents[winner],token:tokens[winner]})));expect(retries.map(r=>r.status)).toEqual([200,200]);expect(retries[0].body.movement.id).toBe(retries[1].body.movement.id);
      const readLogin=await api.request('login',{method:'POST',body:{username:users.b.username,password:users.b.password}});expect((await api.request('invoices',{method:'POST',token:readLogin.body.token,body:{...base,movement_type:'refund',request_id:randomUUID()}})).status).toBe(403);
      await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'Saldo a favor'),{timeout:45_000}).toBe(14);await expect.poll(()=>reportInvoiceValue(settlementTarget.invoice_number,'AR actual')).toBe(winner===0?10:40);
      expect((await f.rows('select id from invoice_active_credit_movements')).length).toBe(1);expect(Number((await f.one("select sum(amount) as amount from payments where status='posted'")).amount)).toBe(3240);
      evidence.creditSettlement={applied:40,refunded:4,reversedBoth:true,concurrentStatuses:[200,400],winner:intents[winner].movement_type,remainingCredit:14,retries:[200,200],reader:403};
    });
    let creditNotesForReversal,cashBeforeNoteReversal;
    const noteReversalBody=note=>({action:'reverse_credit_note',credit_note_id:note.id,request_id:randomUUID(),reason:'QA note entered in error; preserve original history.'});
    const masterInvoice=async body=>{const r=await api.request('invoices',{method:'POST',body,token:master.body.token});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;};
    const reverseNoteUi=async note=>{
      await billing.locator('[data-reverse-credit-note="'+note.id+'"]').click();
      await billing.locator('#decisionReason').fill('QA corrección de nota, conservar historial y cobros.');
      const result=await mutation('invoices',()=>billing.locator('#decisionAccept').click());await expect(billing.locator('#decisionModal')).toBeHidden();return result;
    };
    await step('DS-23 reverse latest quantity note in UI while preserving cash and showing dependencies',async()=>{
      const active=await f.one('select * from invoice_active_credit_movements');
      await masterInvoice({action:'credit_settlement',movement_type:'reversal',movement_id:active.id,request_id:randomUUID(),reason:'QA remove race winner before note reversals'});
      await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'Saldo a favor'),{timeout:45_000}).toBe(44);
      cashBeforeNoteReversal=await f.report('cash');
      creditNotesForReversal=await f.rows('select n.*,l.quantity from invoice_credit_notes n join invoice_credit_note_lines l on l.credit_note_id=n.id where n.invoice_id=$1 order by l.quantity',[creditedInvoice.id]);
      await billing.locator('[data-close="detail"]').click();await billing.locator('#invoiceList [data-invoice-action="detail"][data-invoice-id="'+creditedInvoice.id+'"]').click();
      await expect(billing.locator('[data-credit-note-id="'+creditNotesForReversal[2].id+'"]')).toContainText('notas posteriores');
      await expect(billing.locator('[data-reverse-credit-note="'+creditNotesForReversal[2].id+'"]')).toHaveCount(0);
      const result=await reverseNoteUi(creditNotesForReversal[0]);expect(result.reversal.reversal_number).toMatch(/^RC-/);
      const row=billing.locator('[data-credit-note-id="'+creditNotesForReversal[0].id+'"]');await expect(row).toContainText('Revertida');await expect(row).toContainText('restauradas');await expect(row).toContainText('conservar historial');
      await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'Total'),{timeout:45_000}).toBe(3200);await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'Saldo a favor')).toBe(40);
      expect(await f.report('cash')).toEqual(cashBeforeNoteReversal);await row.scrollIntoViewIfNeeded();await shot('23-credit-note-reversed');
    });
    await step('DS-24 reused units block reversal until the replacement invoice is voided',async()=>{
      await reverseNoteUi(creditNotesForReversal[1]);const last=creditNotesForReversal[2],row=billing.locator('[data-credit-note-id="'+last.id+'"]');
      await expect(row).toContainText('ya se usaron en otra factura');await expect(row.locator('[data-reverse-credit-note]')).toHaveCount(0);
      const blocked=await api.request('invoices',{method:'POST',token:master.body.token,body:noteReversalBody(last)});expect(blocked.status).toBe(400);expect(blocked.body.details.code).toBe('INVOICE_CREDIT_QUANTITY_REUSED');
      await billing.locator('[data-close="detail"]').click();await billing.locator('#invoiceList [data-invoice-action="void"][data-invoice-id="'+settlementTarget.id+'"]').click();await mutation('invoices',()=>billing.locator('#decisionAccept').click());await expect(billing.locator('#decisionModal')).toBeHidden();
      await billing.locator('#invoiceList [data-invoice-action="detail"][data-invoice-id="'+creditedInvoice.id+'"]').click();await reverseNoteUi(last);
      await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'Total'),{timeout:45_000}).toBe(3360);await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'Notas de crédito')).toBe(0);await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'AR actual')).toBe(120);
      expect(await f.report('cash')).toEqual(cashBeforeNoteReversal);expect(Number((await f.one('select quantity from invoice_items where invoice_id=$1',[creditedInvoice.id])).quantity)).toBe(840);
      expect(Number((await f.one('select allocated_sales_quantity from direct_shipment_effective_allocations where id=$1',[direct.id])).allocated_sales_quantity)).toBe(810);
      expect((await f.rows("select id from invoice_credit_note_state where status='reversed'")).length).toBe(3);await row.scrollIntoViewIfNeeded();await shot('24-reversal-restores-ar');
    });
    await step('DS-25 reversing a note competes atomically with rebilling its released unit',async()=>{
      await billing.locator('[data-close="detail"]').click();
      const body={...lastCreditBody,request_id:randomUUID(),reason:'QA one unit for rebilling race',lines:[{...lastCreditBody.lines[0],quantity:'1',expected_credited_quantity:'0'}]};
      const note=(await masterInvoice(body)).credit_note,undo=noteReversalBody(note),item=await f.one('select sales_order_item_id from invoice_items where invoice_id=$1',[creditedInvoice.id]);
      const login=await api.request('login',{method:'POST',body:{username:users.a.username,password:users.a.password}});
      const create={action:'create_plan',sales_order_id:so.id,lines:[{sales_order_item_id:item.sales_order_item_id,quantity:'1'}]};
      const results=await Promise.all([api.request('invoices',{method:'POST',token:master.body.token,body:undo}),api.request('invoices',{method:'POST',token:login.body.token,body:create})]);
      expect(results.map(r=>r.status).sort()).toEqual([200,400]);
      expect(results.find(r=>r.status===400).body.details.code).toBe(results[0].status===200?'INVOICE_QUANTITY_EXCEEDS_SALES_ORDER':'INVOICE_CREDIT_QUANTITY_REUSED');
      if(results[1].status===200){await masterInvoice({action:'void',invoice_id:results[1].body.invoice.id});await masterInvoice(undo);}
      const retried=await Promise.all([masterInvoice(undo),masterInvoice(undo)]);expect(retried[0].reversal.id).toBe(retried[1].reversal.id);
      expect(Number((await f.one('select allocated_invoice_quantity from sales_order_item_invoice_progress where sales_order_item_id=$1',[item.sales_order_item_id])).allocated_invoice_quantity)).toBe(840);
      await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'AR actual'),{timeout:45_000}).toBe(120);
      evidence.creditNoteRebillRace={statuses:[200,400],winner:results[0].status===200?'reversal':'rebilling',allocatedQuantity:840,retries:[200,200]};
    });
    await step('DS-26 concurrent note reversals and read-only operator preserve one immutable reversal',async()=>{
      const note=(await masterInvoice({...lastCreditBody,request_id:randomUUID(),reason:'QA competing note reversals',lines:[{...lastCreditBody.lines[0],quantity:'1',expected_credited_quantity:'0'}]})).credit_note;
      const login=await api.request('login',{method:'POST',body:{username:users.a.username,password:users.a.password}}),readLogin=await api.request('login',{method:'POST',body:{username:users.b.username,password:users.b.password}});
      const intents=[noteReversalBody(note),noteReversalBody(note)],tokens=[master.body.token,login.body.token];
      const results=await Promise.all(intents.map((body,i)=>api.request('invoices',{method:'POST',body,token:tokens[i]})));
      expect(results.map(r=>r.status).sort()).toEqual([200,400]);expect(results.find(r=>r.status===400).body.details.code).toBe('INVOICE_CREDIT_NOTE_REVERSED');
      const winner=results.findIndex(r=>r.status===200),retry=await api.request('invoices',{method:'POST',body:intents[winner],token:tokens[winner]});expect(retry.status).toBe(200);expect(retry.body.reversal.id).toBe(results[winner].body.reversal.id);
      expect((await api.request('invoices',{method:'POST',body:noteReversalBody(note),token:readLogin.body.token})).status).toBe(403);
      expect((await f.rows('select id from invoice_credit_note_reversals where credit_note_id=$1',[note.id])).length).toBe(1);
      await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'Notas de crédito'),{timeout:45_000}).toBe(0);await expect.poll(()=>reportInvoiceValue(creditedInvoice.invoice_number,'AR actual')).toBe(120);
      expect(await f.report('cash')).toEqual(cashBeforeNoteReversal);
      evidence.creditNoteReversals={reversedNotes:5,concurrentStatuses:[200,400],retry:200,reader:403,originalInvoice:3360,originalCash:3240,remainingAR:120,physicalQuantity:810};
    });
    const supplierAp=await navigate('payables');
    let supplierAdvance,partialBillA,partialBillB,supplierFinalPayment,supplierCashBaseline;
    const supplierReportValue=async(bill,label)=>{
      const value=await reports.locator('#reportTable tbody tr').filter({hasText:bill.bill_number}).locator('[data-label="'+label+'"]').textContent();
      return Number(value.replace(/[^0-9.-]/g,''));
    };
    const activeSupplierCash=async()=>Number((await f.one("select coalesce(sum(amount),0) total from supplier_payments where status='posted'")).total);
    const supplierApplicationRows=()=>f.rows('select * from supplier_payment_applications where supplier_payment_id=$1 order by id',[supplierAdvance.id]);
    const openSupplierAllocation=async()=>{
      await supplierAp.locator('[data-entity="payments"]').click();
      await supplierAp.locator('[data-payment-action="allocate"][data-payment-id="'+supplierAdvance.id+'"]').click();
    };
    const setSupplierAllocation=async(a,b)=>{
      await supplierAp.locator('[data-allocation-bill="'+partialBillA.id+'"] [data-amount]').fill(a);
      await supplierAp.locator('[data-allocation-bill="'+partialBillB.id+'"] [data-amount]').fill(b);
    };
    await step('DS-27 supplier advance before partial bills preserves the selected field and records cash once',async()=>{
      await supplierAp.locator('[data-entity="bills"]').click();
      const old=await f.one("select * from supplier_bills where purchase_order_id=$1 and status='posted'",[po.id]);
      await supplierAp.locator('[data-bill-action="void"][data-bill-id="'+old.id+'"]').click();
      await mutation('payables',()=>supplierAp.locator('#decisionAccept').click());await expect(supplierAp.locator('#decisionModal')).toBeHidden();
      supplierCashBaseline=await f.report('cash');expect(await activeSupplierCash()).toBe(0);
      const keepsField=await supplierAp.locator('#newAdvancePayment').evaluate(async button=>{
        const doc=button.ownerDocument;button.click();const input=doc.getElementById('pReference');input.focus();
        await new Promise(resolve=>doc.defaultView.requestAnimationFrame(resolve));return doc.activeElement===input;
      });
      expect(keepsField).toBe(true);await supplierAp.locator('#paymentModal [data-close="payment"]').first().click();
      await supplierAp.locator('#newAdvancePayment').click();await supplierAp.locator('#pPO').selectOption(po.id);await supplierAp.locator('#pAmount').fill('1600');
      await supplierAp.locator('#pReference').fill('QA-SUPPLIER-ADVANCE');await expect(supplierAp.locator('#pAmount')).toHaveValue('1600');
      supplierAdvance=(await mutation('supplier-payments',()=>supplierAp.locator('#savePayment').click())).payment;
      await expect(supplierAp.locator('#paymentModal')).toBeHidden();expect(Number(supplierAdvance.progress.unapplied_amount)).toBe(1600);
      expect(await activeSupplierCash()).toBe(1600);expect((await f.report('cash')).row_count).toBe(supplierCashBaseline.row_count+1);
      expect(Number((await f.one('select coalesce(sum(balance_due),0) amount from supplier_bill_financial_progress')).amount)).toBe(0);
    });
    await step('DS-28 partial supplier bills use displayed cents on either side of a rounding boundary',async()=>{
      const make=async(rate,reference,invalidFirst=false)=>{
        await supplierAp.locator('#newBill').click();await supplierAp.locator('#bPO').selectOption(po.id);
        await supplierAp.locator('#bSupplierInvoice').fill(reference);await supplierAp.locator('[data-bill-line] [data-qty]').fill('420');
        if(invalidFirst){
          const before=await f.rows('select id from supplier_bills order by id');
          await supplierAp.locator('[data-bill-line] [data-total]').fill('1050.001');
          await mutation('payables',()=>supplierAp.locator('#saveBill').click(),400);await expect(supplierAp.locator('#billMsg')).toContainText('2 decimales');
          expect(await f.rows('select id from supplier_bills order by id')).toEqual(before);
        }
        await supplierAp.locator('[data-bill-line] [data-cost]').fill(rate);
        await expect(supplierAp.locator('[data-bill-line] [data-total]')).toHaveValue('1050');
        await expect(supplierAp.locator('#billCalculatedTotal')).toContainText('USD 1,050.00');
        const bill=(await mutation('payables',()=>supplierAp.locator('#saveBill').click())).bill;await expect(supplierAp.locator('#billModal')).toBeHidden();
        await expect(supplierAp.locator('[data-entity="bills"]')).toHaveAttribute('aria-pressed','true');
        await expect(supplierAp.locator('[data-view="open"]')).toHaveAttribute('aria-pressed','true');
        await supplierAp.locator('[data-bill-action="post"][data-bill-id="'+bill.id+'"]').click();await mutation('payables',()=>supplierAp.locator('#decisionAccept').click());await expect(supplierAp.locator('#decisionModal')).toBeHidden();
        expect(Number((await f.ap(bill)).bill_total)).toBe(1050);return bill;
      };
      partialBillA=await make('2.50000001','QA-PARTIAL-A',true);partialBillB=await make('2.49999999','QA-PARTIAL-B');
      await reports.locator('[data-dataset="supplier_bills"]').click();
      for(const bill of [partialBillA,partialBillB])await expect.poll(()=>supplierReportValue(bill,'AP actual'),{timeout:45_000}).toBe(1050);
      expect(await activeSupplierCash()).toBe(1600);await shot('28-supplier-rounded-bills');
    });
    await step('DS-29 advance distributes across two partial bills and updates another operator without more cash',async()=>{
      const cash=await f.report('cash');await openSupplierAllocation();await setSupplierAllocation('1000','500');
      await mutation('supplier-payments',()=>supplierAp.locator('#saveAllocation').click());await expect(supplierAp.locator('#allocationModal')).toBeHidden();
      await expect.poll(()=>supplierReportValue(partialBillA,'AP actual'),{timeout:45_000}).toBe(50);
      await expect.poll(()=>supplierReportValue(partialBillB,'AP actual'),{timeout:45_000}).toBe(550);
      expect(Number((await f.one('select unapplied_amount from supplier_payment_progress where supplier_payment_id=$1',[supplierAdvance.id])).unapplied_amount)).toBe(100);
      expect(await f.report('cash')).toEqual(cash);
    });
    await step('DS-30 rejected over-allocation preserves prior rows before a valid redistribution',async()=>{
      const apps=await supplierApplicationRows(),cash=await f.report('cash');await openSupplierAllocation();await setSupplierAllocation('1050','550.01');
      await mutation('supplier-payments',()=>supplierAp.locator('#saveAllocation').click(),400);
      await expect(supplierAp.locator('#allocationMsg')).not.toBeEmpty();expect(await supplierApplicationRows()).toEqual(apps);
      await setSupplierAllocation('1050','550');await mutation('supplier-payments',()=>supplierAp.locator('#saveAllocation').click());await expect(supplierAp.locator('#allocationModal')).toBeHidden();
      await expect.poll(()=>supplierReportValue(partialBillA,'AP actual'),{timeout:45_000}).toBe(0);
      await expect.poll(()=>supplierReportValue(partialBillB,'AP actual'),{timeout:45_000}).toBe(500);
      expect((await f.ap(partialBillA)).payment_status).toBe('paid');expect(await f.report('cash')).toEqual(cash);
    });
    await step('DS-31 paying the displayed remainder fully settles the supplier bill at cents',async()=>{
      await supplierAp.locator('[data-entity="bills"]').click();
      await supplierAp.locator('[data-bill-action="pay"][data-bill-id="'+partialBillB.id+'"]').click();
      await expect(supplierAp.locator('#pAmount')).toHaveValue('500');await supplierAp.locator('#pAmount').fill('500.00');
      supplierFinalPayment=(await mutation('supplier-payments',()=>supplierAp.locator('#savePayment').click())).payment;
      await expect(supplierAp.locator('#paymentModal')).toBeHidden();await expect.poll(()=>supplierReportValue(partialBillB,'AP actual'),{timeout:45_000}).toBe(0);
      expect((await f.ap(partialBillB)).payment_status).toBe('paid');expect(await activeSupplierCash()).toBe(2100);
      expect(Number((await f.one('select recognized_unit_cost from purchase_order_item_merchandise_cost_basis where purchase_order_id=$1',[po.id])).recognized_unit_cost)).toBe(2.5);
      expect(Number((await f.financial(creditedInvoice)).balance_due)).toBe(120);await reportShot('31-supplier-paid-report');
    });
    await step('DS-32 reversing the advance reopens both supplier balances and preserves application history',async()=>{
      const apps=await supplierApplicationRows();
      await supplierAp.locator('[data-payment-action="reverse"][data-payment-id="'+supplierAdvance.id+'"]').click();await supplierAp.locator('#rReason').fill('QA anticipo registrado por error, conservar aplicaciones históricas.');
      await mutation('supplier-payments',()=>supplierAp.locator('#saveReverse').click());await expect(supplierAp.locator('#reverseModal')).toBeHidden();
      await expect.poll(()=>supplierReportValue(partialBillA,'AP actual'),{timeout:45_000}).toBe(1050);
      await expect.poll(()=>supplierReportValue(partialBillB,'AP actual'),{timeout:45_000}).toBe(550);
      expect(await supplierApplicationRows()).toEqual(apps);expect(await activeSupplierCash()).toBe(500);
      expect((await f.one('select status from supplier_payments where id=$1',[supplierAdvance.id])).status).toBe('reversed');
    });
    await step('DS-33 competing supplier payments respect one balance and deny the reader',async()=>{
      const writer=await api.request('login',{method:'POST',body:{username:users.a.username,password:users.a.password}}),reader=await api.request('login',{method:'POST',body:{username:users.b.username,password:users.b.password}});
      const body={action:'pay_bill',supplier_bill_id:partialBillB.id,amount:'550.00',reference:'QA competing final settlement'};
      const results=await Promise.all([writer.body.token,master.body.token].map(token=>api.request('supplier-payments',{method:'POST',token,body})));
      expect(results.map(r=>r.status).sort()).toEqual([200,400]);expect(results.find(r=>r.status===400).body.error).toMatch(/completamente pagada|supera/i);
      expect((await api.request('supplier-payments',{method:'POST',token:reader.body.token,body})).status).toBe(403);
      await expect.poll(()=>supplierReportValue(partialBillB,'AP actual'),{timeout:45_000}).toBe(0);
      expect(Number((await f.ap(partialBillA)).balance_due)).toBe(1050);expect(await activeSupplierCash()).toBe(1050);
      expect(Number((await f.one('select allocated_sales_quantity from direct_shipment_effective_allocations where id=$1',[direct.id])).allocated_sales_quantity)).toBe(810);
      expect(Number((await f.financial(creditedInvoice)).balance_due)).toBe(120);
      evidence.supplierVariants={advance:1600,partialBills:[1050,1050],initialDistribution:[1000,500],redistribution:[1050,550],displayedRemainderPaid:500,advanceReversed:true,concurrentStatuses:[200,400],reader:403,finalAP:1050,activeSupplierCash:1050,customerAR:120,physicalQuantity:810};
    });
    expect(reportNavigations).toBe(reportNavBaseline);evidence.reportNavigations={initial:reportNavBaseline,final:reportNavigations};
    expect(evidence.checkpoints).toHaveLength(33);
    expect(evidence.errors).toEqual([]);expect(evidence.crashes).toEqual([]);expect(evidence.external).toEqual([]);
    expect(evidence.api.filter(row=>row.status===404||row.status>=500)).toEqual([]);
  } finally {
    const evidencePath=info.outputPath('direct-ship-evidence.json');
    fs.mkdirSync(info.outputDir,{recursive:true});
    fs.writeFileSync(evidencePath,JSON.stringify(evidence,null,2));
    await info.attach('direct-ship-evidence',{path:evidencePath,contentType:'application/json'});
    if(loggedIn&&page&&!page.isClosed()&&await page.locator('#loginPage').isHidden().catch(()=>false)){
      const path=info.outputPath('final-state.png');
      await page.screenshot({path,timeout:5000}).then(()=>info.attach('final-state',{path,contentType:'image/png'})).catch(()=>{});
    }
    globalThis.fetch=nativeFetch;
    await Promise.allSettled(contexts.map(context=>context.close()));
    try{await api?.close?.();}finally{await db.end();}
  }
});
