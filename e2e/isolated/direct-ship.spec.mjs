import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createOperatorAcceptanceDb } from '../../scripts/lib/operator-acceptance-db.mjs';
import { operatorFixture } from '../../scripts/lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer, root } from './server.mjs';

// All commercial writes originate in the native UI. SQL only seeds the isolated
// catalogues/identities and verifies results. No production URLs or credentials.
test('direct ship: purchase to corrected physical dispatch without WR or stock', async ({ browser }, info) => {
  test.setTimeout(300_000);
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
      grant usage on sequence purchase_order_number_seq, sales_orders_so_serial_seq to service_role;
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
    const permissions=['procurement.read','procurement.write','sales.read','sales.write','logistics.read','logistics.write','warehouse.read'];
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

    const module=name=>page.frameLocator(`#${name}Section iframe`);
    const navigate=async name=>{
      const button=page.locator(`[data-section="${name}Section"]`).first();
      if(use.isMobile&&!await page.locator('#sidebar').evaluate(el=>el.classList.contains('mobile-open'))){
        await page.locator('#mobileMenuBtn').click();await expect(page.locator('#sidebar')).toHaveClass(/mobile-open/);
      }
      if(!await button.isVisible()){
        const group=button.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," nav-group ")]');
        await group.locator('.nav-group-btn').click();
      }
      await button.click();await expect(page.locator(`#${name}Section`)).toBeVisible();return module(name);
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
      await sales.locator('.lPallets').fill('10');await sales.locator('.lTotal').fill('3360');
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
    expect(evidence.checkpoints).toHaveLength(13);
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
