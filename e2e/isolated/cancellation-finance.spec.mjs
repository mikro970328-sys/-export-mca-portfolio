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
      await navi