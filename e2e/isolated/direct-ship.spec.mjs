import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createOperatorAcceptanceDb } from '../../scripts/lib/operator-acceptance-db.mjs';
import { operatorFixture } from '../../scripts/lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer, root } from './server.mjs';

test('direct ship: purchase to container dispatch without WR or stock', async ({ browser }, info) => {
  test.setTimeout(300_000);
  process.chdir(root);
  const db=await createOperatorAcceptanceDb();
  const nativeFetch=globalThis.fetch;
  const contexts=[];
  const evidence={checkpoints:[],api:[],errors:[],crashes:[],external:[],documents:{}};
  let api;
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
      grant select,insert on shipment_history to service_role;`);
    await db.exec(fs.readFileSync('supabase/migrations/20260831235500_ux5_shipment_action_capabilities.sql','utf8'));
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
    const page=await context.newPage();
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
    const mutation=async(path,click,status=200)=>{
      const pending=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/${path}`&&r.request().method()==='POST');
      await click();const response=await pending;const body=await response.json();
      expect(response.status(),JSON.stringify({path,error:body.error,details:body.details})).toBe(status);return body;
    };
    const step=async(name,fn)=>test.step(name,async()=>{await fn();evidence.checkpoints.push(name);console.log(`PASS ${info.project.name} ${name}`);});

    const purchases=await navigate('purchases');
    let po,so,shipment;
    await step('DS-01 Direct Ship purchase does not create WR or inventory',async()=>{
      await purchases.locator('[data-view="all"]').click();
      await purchases.locator('#newOrder').click();
      await purchases.locator('#oSupplier').selectOption(f.supplier);
      await purchases.locator('#oDestinationMode').selectOption('direct');
      await expect(purchases.locator('#oWarehouseField')).toBeHidden();
      await purchases.locator('.lProduct').selectOption(f.product);
      await purchases.locator('.lQty').fill('100');await purchases.locator('.lPallets').fill('10');
      await purchases.locator('.lPriceValue').fill('2.5');
      await mutation('purchases',()=>purchases.locator('#saveOrder').click());
      po=await f.one('select * from purchase_orders');evidence.documents.purchase=po.po_number;
      expect(po.warehouse_id).toBeNull();
      expect((await f.rows('select id from warehouse_receipts')).length).toBe(0);
      expect((await f.rows('select * from inventory_summary')).length).toBe(0);
    });
    const purchaseTransition=async action=>{
      await purchases.locator(`[data-view-order="${po.id}"]`).click();
      await purchases.locator(`[data-detail-action="${action}"]`).click();
      await mutation('purchases',()=>purchases.locator('#purchaseDecisionAccept').click());
    };
    await step('DS-02 issue and confirm Direct Ship purchase',async()=>{
      await purchaseTransition('issue');await purchaseTransition('confirm');
      expect((await f.one('select status,warehouse_id from purchase_orders where id=$1',[po.id])).status).toBe('confirmed');
    });

    const sales=await navigate('sales');
    await step('DS-03 create and confirm sale',async()=>{
      await sales.locator('[data-view="all"]').click();await sales.locator('#newOrder').click();
      await sales.locator('#oClientPickerButton').click();await sales.locator(`[data-client-id="${f.client}"]`).click();
      await sales.locator('#oImporter').selectOption(f.importer);
      await sales.locator('.lProduct').selectOption(f.product);await sales.locator('.lQty').fill('100');await sales.locator('.lTotal').fill('400');
      await mutation('sales-order-ux',()=>sales.locator('#saveOrder').click());
      so=await f.one('select * from sales_orders');evidence.documents.sale=so.so_number;
      await sales.locator(`[data-view-order="${so.id}"]`).click();
      await sales.locator('[data-ws-action="confirm"]').first().click();
      await mutation('sales',()=>sales.locator('[data-sales-workspace-accept]').click());
      expect((await f.one('select status from sales_orders where id=$1',[so.id])).status).toBe('confirmed');
    });

    await step('DS-04 choose confirmed Direct Ship purchase from the sale',async()=>{
      await sales.locator('[data-close="detail"]').click();
      await sales.locator(`[data-supply-order="${so.id}"]`).click();
      await expect(sales.locator('#salesSupplyModal')).toBeVisible();
      await sales.locator('[data-supply-action="quick-direct"]').click();
      const poItem=await f.one('select id from purchase_order_items where purchase_order_id=$1',[po.id]);
      await sales.locator('#quickDirectPo').selectOption(poItem.id);
      await mutation('sales-supply',()=>sales.locator('#salesSupplyFormSave').click());
      await expect(sales.locator('#salesSupplyBody')).toContainText('Paso 1 listo');
      expect((await f.rows('select id from warehouse_receipts')).length).toBe(0);
      expect((await f.rows('select * from inventory_summary')).length).toBe(0);
    });

    await step('DS-05 register and link the Direct Ship container',async()=>{
      await sales.locator('[data-supply-action="new-direct"]').click();
      await sales.locator('#supplyNewContainer').fill('QA-DIRECT-001');
      await sales.locator('#supplyNewCarrier').fill('QA Carrier');
      await sales.locator('#supplyNewBooking').fill('QA-BOOK-001');
      await sales.locator('#supplyNewBol').fill('QA-BOL-001');
      await mutation('direct-shipment-dispatch',()=>sales.locator('#salesSupplyFormSave').click());
      await page.waitForResponse(r=>new URL(r.url()).pathname==='/api/sales-supply'&&r.request().method()==='POST');
      shipment=await f.one("select * from shipments where container_number='QA-DIRECT-001'");evidence.documents.container=shipment.container_number;
      const direct=await f.one('select * from direct_shipment_allocations where shipment_id=$1',[shipment.id]);
      expect(Number(direct.allocated_sales_quantity)).toBe(100);
      expect((await f.rows('select id from loads')).length).toBe(0);
      expect((await f.rows('select id from warehouse_receipts')).length).toBe(0);
    });

    await step('DS-06 dispatch Direct Ship and fulfill sale without stock movement',async()=>{
      await sales.locator(`[data-supply-action="dispatch-direct"][data-shipment-id="${shipment.id}"]`).click();
      await mutation('direct-shipment-dispatch',()=>sales.locator('#salesSupplyFormSave').click());
      const dispatch=await f.one('select * from direct_shipment_dispatches where shipment_id=$1',[shipment.id]);
      expect(dispatch.shipment_id).toBe(shipment.id);
      const progress=await f.one('select fulfillment_status from sales_order_progress where sales_order_id=$1',[so.id]);
      expect(progress.fulfillment_status).toBe('dispatched');
      expect((await f.rows('select id from inventory_movements')).length).toBe(0);
      expect((await f.rows('select id from warehouse_receipts')).length).toBe(0);
      await expect(sales.locator('#salesSupplyBody')).toContainText('Despachado');
    });

    expect(evidence.checkpoints).toHaveLength(6);
    expect(evidence.errors).toEqual([]);expect(evidence.crashes).toEqual([]);expect(evidence.external).toEqual([]);
    await info.attach('direct-ship-evidence',{body:Buffer.from(JSON.stringify(evidence,null,2)),contentType:'application/json'});
  } finally {
    globalThis.fetch=nativeFetch;
    await Promise.allSettled(contexts.map(context=>context.close()));
    await api?.close?.();
    await db.close();
  }
});
