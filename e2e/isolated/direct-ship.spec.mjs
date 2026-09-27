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
  const reportGate={armed:false,held:null,release:null};
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
    api=await startBrowserAcceptanceServer({beforeApiResponse:async(req,url,body)=>{
      // Delay one completed real read, without replacing its status or payload.
      if(!reportGate.armed||req.method!=='GET'||url.pathname!=='/api/reports'||url.searchParams.get('dataset')!=='invoices')return;
      reportGate.armed=false;
      const data=JSON.parse(String(body));
      reportGate.held={query:url.search,report:data.report?.key,rows:data.row_count};
      await new Promise(resolve=>{reportGate.release=resolve;});
    }});
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
      await purchases.locator('[data-destination="direct"]').click();
      await expect(purchases.locator('#oWarehouseField')).toBeHidden();
      await purchases.locator('.lProduct').selectOption(f.product);
      await purchases.locator('.lQty').fill('840');
      await purchases.locator('.lPallets').fill('10');
      await purchases.locator('.lUpp').click();
      await purchases.locator('.lUpp').fill('');
      await purchases.locator('.lUpp').pressSequentially('84');
      await expect(purchases.locator('.lUpp')).toHaveValue('84');
      await purchases.locator('.lUpp').press('Tab');
      await expect(purchases.locator('.lUpp')).toHaveValue('84');
      await expect(purchases.locator('.lMeasurementHelp')).not.toHaveClass(/is-error/);
      await purchases.locator('.lPriceValue').fill('2.5');
      await expect(purchases.locator('#orderTotalPreview')).toHaveText('USD 2,100.00');
      await purchases.locator('#purchaseDestinationTitle').scrollIntoViewIfNeeded();
      await shot('01-direct-purchase-destination');
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
      // The detail closes before its follow-up read finishes. Continue only
      // when the canonical list presents the new commercial state.
      const refreshedRow=purchases.lo