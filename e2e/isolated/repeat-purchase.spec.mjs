import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createOperatorAcceptanceDb } from '../../scripts/lib/operator-acceptance-db.mjs';
import { operatorFixture } from '../../scripts/lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer, root } from './server.mjs';

// Existing purchases are disposable fixtures with real SQL receipts and AP.
// Every repetition goes through the original UI, HTTP handler and PostgREST.
test('repeat purchase creates an independent draft with current permissions', async ({ browser }, info) => {
  test.setTimeout(240_000);
  process.chdir(root);
  const db=await createOperatorAcceptanceDb(),nativeFetch=globalThis.fetch,contexts=[];
  const evidence={checkpoints:[],errors:[],external:[],requests:[],serverErrors:[]};
  let api;
  try {
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
      grant usage on sequence purchase_order_number_seq to service_role;`);
    await db.exec(fs.readFileSync('supabase/migrations/20260831235500_ux5_shipment_action_capabilities.sql','utf8'));
    const {f,users}=await operatorFixture(db);
    const source=await f.purchase({lines:[
      {...f.baseLine,ordered_quantity:30,ordered_pallets:3,unit_cost:null,line_total:100,notes:'Keep refrigerated'},
      {...f.baseLine,product_id:f.productB,ordered_quantity:20,ordered_pallets:2,unit_cost:0}
    ]});
    const pricedLine=source.items.find(item=>item.product_id===f.product);
    await db.query("update purchase_orders set order_date='2020-01-01',expected_at='2020-01-05T15:00:00Z',supplier_reference='OLD-REFERENCE',notes='Original purchase' where id=$1",[source.id]);
    await f.one('select * from receive_purchase_order_lines($1,$2::jsonb)',[f.warehouse,f.json([
      {purchase_order_item_id:pricedLine.id,received_quantity:30,received_pallets:3}
    ])]);
    const bill=await f.bill({...source,items:[pricedLine]},{quantity:30,total:100});await f.payBill(bill,40);
    const direct=await f.one('select * from create_purchase_order_plan(p_supplier_id=>$1,p_lines=>$2::jsonb,p_warehouse_id=>null)',[f.supplier,f.json([f.baseLine])]);
    await f.one("select * from transition_purchase_order($1,'cancel')",[direct.id]);
    const snapshot=async()=>({
      source:await f.rows('select * from purchase_orders where id in ($1,$2) order by id',[source.id,direct.id]),
      items:await f.rows('select * from purchase_order_items where purchase_order_id in ($1,$2) order by id',[source.id,direct.id]),
      receipts:await f.rows('select * from warehouse_receipts order by id'),
      receiptItems:await f.rows('select * from warehouse_receipt_items order by id'),
      allocations:await f.rows('select * from purchase_receipt_allocations order by id'),
      movements:await f.rows('select * from inventory_movements order by id'),
      bills:await f.rows('select * from supplier_bills order by id'),
      billItems:await f.rows('select * from supplier_bill_items order by id'),
      payments:await f.rows('select * from supplier_payments order by id'),
      applications:await f.rows('select * from supplier_payment_applications order by id')
    });
    const before=await snapshot();
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
    const role=async(key,permissions)=>{
      const result=await api.request('access-control?resource=roles',{method:'PATCH',token:master.body.token,
        body:{id:users[key].access_role_id,permission_keys:permissions}});
      expect(result.status).toBe(200);
    };
    await role('a',['procurement.read','procurement.write','warehouse.read']);
    await role('b',['procurement.read']);
    const enter=async key=>{
      const use=info.project.use;
      const context=await browser.newContext({viewport:use.viewport,userAgent:use.userAgent,isMobile:use.isMobile,
        hasTouch:use.hasTouch,deviceScaleFactor:use.deviceScaleFactor,locale:'es-US',timezoneId:'America/New_York'});
      contexts.push(context);
      await context.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.origin===api.base||['data:','blob:','about:'].includes(url.protocol))return route.continue();
        evidence.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');
      });
      const page=await context.newPage();
      page.on('pageerror',error=>evidence.errors.push(error.message));
      page.on('response',response=>{
        const url=new URL(response.url());
        if(url.origin===api.base&&url.pathname.startsWith('/api/')&&response.status()>=500)
          evidence.serverErrors.push({path:url.pathname,status:response.status()});
      });
      page.on('request',request=>{
        if(new URL(request.url()).pathname==='/api/purchases'&&request.method()==='POST')evidence.requests.push(request.postDataJSON());
      });
      await page.goto(`${api.base}/admin/pwa.html`);
      await page.locator('#username').fill(users[key].username);await page.locator('#password').fill(users[key].password);
      const logged=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/login'&&r.request().method()==='POST');
      await page.locator('#login').click();expect((await logged).status()).toBe(200);
      await expect(page.locator('#loginPage')).toBeHidden();
      await page.waitForFunction(()=>window.NavigationShell?.owner==='navigation-shell.js');
      if(key==='b'){
        // This identity has only procurement.read: the native shell selects
        // Compras as its first permitted section. Observe that real startup;
        // toggling its already-opening submenu races the automatic selection.
        await expect(page.locator('#purchasesSection')).toBeVisible();
      }else{
        if(use.isMobile){await page.locator('#mobileMenuBtn').click();await expect(page.locator('#sidebar')).toHaveClass(/mobile-open/);}
        const button=page.locator('[data-section="purchasesSection"]').first();
        if(!await button.isVisible())await button.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," nav-group ")]').locator('.nav-group-btn').click();
        await button.click();
      }
      const ui=page.frameLocator('#purchasesSection iframe');
      await expect(ui.locator('#newOrder')).toBeVisible();await ui.locator('[data-view="all"]').click();
      await expect(ui.locator(`[data-view-order="${source.id}"]`)).toBeVisible();
      return {page,ui};
    };
    const {page,ui}=await enter('a');
    const close=async()=>{await ui.locator('[data-close="order"]').first().click();await expect(ui.locator('#orderModal')).toBeHidden();};
    const repeat=async id=>{
      await ui.locator('[data-view="all"]').click();await ui.locator(`[data-repeat-order="${id}"]`).click();
      await expect(ui.locator('#orderModal')).toBeVisible();
    };
    const save=async(status=200)=>{
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/purchases'&&r.request().method()==='POST');
      await ui.locator('#saveOrder').click();const result=await response;
      expect(result.status()).toBe(status);const body=await result.json();
      if(status!==200)return body.order;
      await expect(ui.locator('#orderModal')).toBeHidden();
      const detail=await page.evaluate(async id=>{
        const response=await fetch(`/api/purchases?id=${encodeURIComponent(id)}`);
        return {status:response.status,body:await response.json()};
      },body.order.id);
      expect(detail.status).toBe(200);
      return detail.body.order;
    };
    const count=async()=>Number((await f.one('select count(*) from purchase_orders')).count);
    const step=async(name,run)=>test.step(name,async()=>{await run();evidence.checkpoints.push(name);});
    await step('RP-01 repeat prefills both pricing modes and clears old dates, reference and IDs',async()=>{
      await ui.locator('#newOrder').click();await ui.locator('#oNotes').fill('Unfinished ordinary purchase');await close();
      await repeat(source.id);
      await expect(ui.locator('#oSupplier')).toHaveValue(f.supplier);await expect(ui.locator('#oWarehouse')).toHaveValue(f.warehouse);
      await expect(ui.locator('#oReference')).toHaveValue('');await expect(ui.locator('#oExpected')).toHaveValue('');
      const today=await ui.locator('#oDate').evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
      await expect(ui.locator('#oDate')).toHaveValue(today);
      const lines=ui.locator('#orderLines [data-line]');await expect(lines).toHaveCount(2);
      const first=ui.locator(`#orderLines [data-line]:has(.lProduct option[value="${f.product}"]:checked)`);
      await expect(first.locator('.lPriceMode')).toHaveValue('total');await expect(first.locator('.lPriceValue')).toHaveValue('100');
      const free=ui.locator(`#orderLines [data-line]:has(.lProduct option[value="${f.productB}"]:checked)`);
      await expect(free.locator('.lPriceMode')).toHaveValue('unit');await expect(free.locator('.lPriceValue')).toHaveValue('0');
      expect(await lines.evaluateAll(rows=>rows.every(row=>row.dataset.itemId===''))).toBe(true);
      await expect(ui.locator('#oSupplier')).toBeEnabled();await expect(ui.locator('#addOrderLine')).toBeEnabled();
      expect(await count()).toBe(2);expect(evidence.requests).toEqual([]);
      await close();await ui.locator('#newOrder').click();
      await expect(ui.locator('#oNotes')).toHaveValue('Unfinished ordinary purchase');await expect(ui.locator('#orderRepeatHelp')).toBeHidden();await close();
    });
    await step('RP-02 save creates a distinct draft without copying receipts, bills or payments',async()=>{
      await repeat(source.id);await ui.locator('#oNotes').fill('New repeated purchase');
      await page.screenshot({path:info.outputPath('repeat-form.png'),fullPage:true});
      const created=await save();
      expect(created.id).not.toBe(source.id);expect(created.po_number).not.toBe(source.po_number);expect(created.status).toBe('draft');
      expect(created.notes).toBe('New repeated purchase');expect(created.supplier_reference).toBeNull();expect(created.expected_at).toBeNull();
      expect(created.items).toHaveLength(2);expect(created.items.every(item=>!source.items.some(old=>old.id===item.id)&&item.allocations.length===0)).toBe(true);
      const item=created.items.find(item=>item.product_id===f.product);
      expect([item.ordered_quantity,item.ordered_pallets,item.entered_line_total].map(Number)).toEqual([30,3,100]);
      expect(Number(created.items.find(item=>item.product_id===f.productB).unit_cost)).toBe(0);
      expect(evidence.requests.at(-1).action).toBe('create_plan');expect(evidence.requests.at(-1).purchase_order_id).toBeUndefined();
      expect(evidence.requests.at(-1).lines.every(line=>line.id===null)).toBe(true);
      await expect(ui.locator('[data-view="draft"]')).toHaveAttribute('aria-pressed','true');
      await expect(ui.locator(`[data-view-order="${created.id}"]`)).toBeVisible();
      expect(await snapshot()).toEqual(before);expect(await count()).toBe(3);
      expect((await f.one("select actor_admin_id from audit_log where action='purchase_order_created' and entity_id=$1",[created.id])).actor_admin_id).toBe(users.a.id);
    });
    await step('RP-03 a cancelled Direct Ship purchase can be repeated from its detail',async()=>{
      await ui.locator('[data-view="all"]').click();await ui.locator(`[data-view-order="${direct.id}"]`).click();
      await expect(ui.locator('[data-detail-action="edit"]')).toHaveCount(0);await ui.locator('[data-detail-action="repeat"]').click();
      await expect(ui.locator('#detailModal')).toBeHidden();await expect(ui.locator('#orderModal')).toBeVisible();
      await expect(ui.locator('#oDestinationMode')).toHaveValue('direct');await expect(ui.locator('#oWarehouseField')).toBeHidden();
      await expect(ui.locator('.lPriceMode')).toHaveValue('unit');await expect(ui.locator('.lPriceValue')).toHaveValue('2.5');
      const created=await save();expect(created.warehouse_id).toBeNull();expect(created.status).toBe('draft');expect(created.id).not.toBe(direct.id);
      expect(await snapshot()).toEqual(before);expect(await count()).toBe(4);
    });
    await step('RP-04 repeat drafts are separate per source and clear after a successful save',async()=>{
      await repeat(source.id);await expect(ui.locator('#oNotes')).toHaveValue('Original purchase');
      await ui.locator('#oNotes').fill('Pending source A');await close();
      await repeat(direct.id);await expect(ui.locator('#oNotes')).toHaveValue('');await ui.locator('#oNotes').fill('Pending source B');await close();
      await repeat(source.id);await expect(ui.locator('#oNotes')).toHaveValue('Pending source A');
      await ui.locator('[data-form-draft-discard]').click();await expect(ui.locator('#oNotes')).toHaveValue('Original purchase');await close();
      expect(await count()).toBe(4);
    });
    await step('RP-05 inactive masters are refreshed and require replacements',async()=>{
      await db.query('update suppliers set active=false where id=$1',[f.supplier]);
      await db.query('update warehouses set active=false where id=$1',[f.warehouse]);
      await db.query('update products set active=false where id=$1',[f.productB]);
      await repeat(source.id);await expect(ui.locator('#orderRepeatHelp')).toContainText('ya no están activos');
      await expect(ui.locator('#oSupplier')).toHaveValue('');await expect(ui.locator('#oWarehouse')).toHaveValue('');
      await expect(ui.locator('#oDestinationMode')).toHaveValue('warehouse');
      expect(await ui.locator('.lProduct').evaluateAll(selects=>selects.filter(select=>select.value==='').length)).toBe(1);
      await ui.locator('#saveOrder').click();await expect(ui.locator('#orderMsg')).toContainText('Selecciona el almacén');
      await expect(ui.locator('#orderModal')).toBeVisible();expect(await count()).toBe(4);await close();
      await db.query('update suppliers set active=true where id=$1',[f.supplier]);
      await db.query('update warehouses set active=true where id=$1',[f.warehouse]);
      await db.query('update products set active=true where id=$1',[f.productB]);
    });
    await step('RP-06 read-only users do not receive repeat actions',async()=>{
      const reader=await enter('b');await expect(reader.ui.locator('[data-repeat-order]')).toHaveCount(0);
      await reader.ui.locator(`[data-view-order="${source.id}"]`).click();await expect(reader.ui.locator('[data-detail-action="repeat"]')).toHaveCount(0);
    });
    await step('RP-07 revoked permission rejects a prepared copy without losing its values',async()=>{
      await repeat(source.id);await ui.locator('#oNotes').fill('Retain on denied save');
      await role('a',['procurement.read','warehouse.read']);await save(403);
      await expect(ui.locator('#orderModal')).toBeVisible();await expect(ui.locator('#oNotes')).toHaveValue('Retain on denied save');
      await expect(ui.locator('#orderMsg')).toContainText('No tienes permiso');expect(await count()).toBe(4);expect(await snapshot()).toEqual(before);
    });
    expect(evidence.errors).toEqual([]);expect(evidence.external).toEqual([]);expect(evidence.serverErrors).toEqual([]);
  } finally {
    fs.mkdirSync(info.outputDir,{recursive:true});const path=info.outputPath('repeat-purchase-evidence.json');
    fs.writeFileSync(path,JSON.stringify(evidence,null,2));await info.attach('repeat-purchase-evidence',{path,contentType:'application/json'});
    for(const context of contexts){for(const page of context.pages()){try{await page.screenshot({path:info.outputPath(`final-${contexts.indexOf(context)}.png`),timeout:5000});}catch{}}await context.close().catch(()=>{});}
    globalThis.fetch=nativeFetch;if(api)await api.close();await db.end();
  }
});
