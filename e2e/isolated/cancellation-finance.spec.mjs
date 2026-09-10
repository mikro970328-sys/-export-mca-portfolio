import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createOperatorAcceptanceDb } from '../../scripts/lib/operator-acceptance-db.mjs';
import { operatorFixture } from '../../scripts/lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer, root } from './server.mjs';

// First executable slice of CF-01..CF-12. Every business write below starts in
// the native browser UI. SQL only verifies the disposable database afterwards.
test('customer advance cancellation cycle preserves balances and history', async ({ browser }, info) => {
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
      grant usage on sequence sales_orders_so_serial_seq to service_role;`);
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
    const permissions=['sales.read','sales.write','finance.read','finance.write'];
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
    page=await context.newPage();page.setDefaultTimeout(15_000);
    page.on('pageerror',error=>evidence.errors.push(error.message));
    page.on('crash',()=>evidence.crashes.push('page'));
    page.on('response',response=>{const url=new URL(response.url());if(url.origin===api.base&&url.pathname.startsWith('/api/'))evidence.api.push({path:url.pathname,status:response.status(),method:response.request().method()});});
    await page.goto(`${api.base}/admin/pwa.html`);
    await page.locator('#username').fill(users.a.username);await page.locator('#password').fill(users.a.password);
    const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/login'&&r.request().method()==='POST');
    await page.locator('#login').click();expect((await login).status()).toBe(200);await expect(page.locator('#loginPage')).toBeHidden();loggedIn=true;
    await page.waitForFunction(()=>window.NavigationShell?.owner==='navigation-shell.js');

    const sales=page.frameLocator('#salesSection iframe');
    const navigate=async()=>{
      const button=page.locator('[data-section="salesSection"]').first();
      if(use.isMobile&&!await page.locator('#sidebar').evaluate(el=>el.classList.contains('mobile-open'))){await page.locator('#mobileMenuBtn').click();await expect(page.locator('#sidebar')).toHaveClass(/mobile-open/);}
      if(!await button.isVisible()){const group=button.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," nav-group ")]');await group.locator('.nav-group-btn').click();}
      await button.click();await expect(page.locator('#salesSection')).toBeVisible();
    };
    const responseFor=path=>page.waitForResponse(r=>new URL(r.url()).pathname===`/api/${path}`&&r.request().method()==='POST');
    const mutation=async(path,click,status=200)=>{const pending=responseFor(path);await click();const response=await pending,body=await response.json();expect(response.status(),JSON.stringify({path,error:body.error,details:body.details})).toBe(status);return body;};
    const progress=async soId=>await f.one('select * from sales_order_customer_financial_progress where sales_order_id=$1',[soId]);
    const cashRows=()=>f.rows("select amount,movement_type,source_id from executive_cash_movement_source order by movement_date,source_id");
    const step=async(name,fn)=>test.step(name,async()=>{await fn();evidence.checkpoints.push(name);console.log(`PASS ${info.project.name} ${name}`);});

    await navigate();await sales.locator('[data-view="all"]').click();
    await sales.locator('#newOrder').click();await sales.locator('#oClientPickerButton').click();await sales.locator(`[data-client-id="${f.client}"]`).click();
    await sales.locator('#oImporter').selectOption(f.importer);await sales.locator('.lProduct').selectOption(f.product);await sales.locator('.lQty').fill('100');await sales.locator('.lTotal').fill('400');
    await mutation('sales-order-ux',()=>sales.locator('#saveOrder').click());await expect(sales.locator('#orderModal')).toBeHidden();
    const so=await f.one('select * from sales_orders');evidence.documents.sale=so.so_number;
    await sales.locator(`[data-view-order="${so.id}"]`).click();await sales.locator('[data-ws-action="confirm"]').first().click();
    await mutation('sales',()=>sales.locator('[data-sales-workspace-accept]').click());await expect(sales.locator('#detailSubtitle')).toContainText('Confirmada');

    await step('CF-01 register customer advance from sale UI',async()=>{
      await sales.locator('#openCustomerFinance').click();await expect(sales.locator('#salesFinanceModal')).toBeVisible();
      await sales.locator('[data-cf-register]').click();await sales.locator('#cfAdvanceAmount').fill('100');await sales.locator('#cfAdvanceMethod').fill('Wire');await sales.locator('#cfAdvanceReference').fill('QA-CF-ADV');
      await mutation('customer-advances',()=>sales.locator('#salesFinanceFormSave').click());await expect(sales.locator('#salesFinanceFormModal')).toBeHidden();
      const row=await f.one('select * from customer_advance_progress where sales_order_id=$1',[so.id]);
      expect([row.amount,row.available_amount].map(Number)).toEqual([100,100]);
      const p=await progress(so.id);expect([p.advance_cash_received,p.advance_available_amount,p.cash_received_net].map(Number)).toEqual([100,100,100]);
      const cash=await cashRows();expect(cash.reduce((sum,row)=>sum+Number(row.amount),0)).toBe(100);
      evidence.documents.advance=row.advance_number;
    });

    await step('CF-02 refund part of advance records one cash outflow',async()=>{
      const advance=await f.one('select customer_advance_id from customer_advance_progress where sales_order_id=$1',[so.id]);
      await sales.locator(`[data-cf-refund="${advance.customer_advance_id}"]`).click();await sales.locator('#cfRefundAmount').fill('20');await sales.locator('#cfRefundMethod').fill('Wire');await sales.locator('#cfRefundReference').fill('QA-CF-REFUND');
      await mutation('customer-advances',()=>sales.locator('#salesFinanceFormSave').click());await expect(sales.locator('#salesFinanceFormModal')).toBeHidden();
      const row=await f.one('select * from customer_advance_progress where customer_advance_id=$1',[advance.customer_advance_id]);
      expect([row.refunded_amount,row.available_amount].map(Number)).toEqual([20,80]);
      const cash=await cashRows();expect(cash.reduce((sum,item)=>sum+Number(item.amount),0)).toBe(80);
      expect(cash.length).toBe(2);
    });

    await step('CF-03 reverse refund restores balance without deleting history',async()=>{
      const refund=await f.one("select id from customer_advance_refunds where status='posted'");
      await sales.locator(`[data-cf-reverse-refund="${refund.id}"]`).click();await sales.locator('#cfReason').fill('QA correction: refund entered by mistake');
      await mutation('customer-advances',()=>sales.locator('#salesFinanceFormSave').click());await expect(sales.locator('#salesFinanceFormModal')).toBeHidden();
      const saved=await f.one('select status,reversal_reason from customer_advance_refunds where id=$1',[refund.id]);expect(saved.status).toBe('reversed');expect(saved.reversal_reason).toContain('QA correction');
      const row=await f.one('select * from customer_advance_progress where sales_order_id=$1',[so.id]);expect([row.refunded_amount,row.available_amount].map(Number)).toEqual([0,100]);
      const cash=await cashRows();expect(cash.reduce((sum,item)=>sum+Number(item.amount),0)).toBe(100);
    });

    await step('CF-04 reverse advance preserves row and removes active cash',async()=>{
      const advance=await f.one('select customer_advance_id from customer_advance_progress where sales_order_id=$1',[so.id]);
      await sales.locator(`[data-cf-reverse="${advance.customer_advance_id}"]`).click();await sales.locator('#cfReason').fill('QA correction: advance entered by mistake');
      await mutation('customer-advances',()=>sales.locator('#salesFinanceFormSave').click());await expect(sales.locator('#salesFinanceFormModal')).toBeHidden();
      const saved=await f.one('select status,reversal_reason from customer_advances where id=$1',[advance.customer_advance_id]);expect(saved.status).toBe('reversed');expect(saved.reversal_reason).toContain('QA correction');
      const p=await progress(so.id);expect([p.advance_cash_received,p.advance_available_amount,p.cash_received_net].map(Number)).toEqual([0,0,0]);
      expect((await f.rows('select id from customer_advances where sales_order_id=$1',[so.id])).length).toBe(1);
    });

    expect(evidence.checkpoints).toHaveLength(4);expect(evidence.errors).toEqual([]);expect(evidence.crashes).toEqual([]);expect(evidence.external).toEqual([]);
    expect(evidence.api.filter(row=>row.status===404||row.status>=500)).toEqual([]);
  } finally {
    const path=info.outputPath('cancellation-finance-evidence.json');fs.mkdirSync(info.outputDir,{recursive:true});fs.writeFileSync(path,JSON.stringify(evidence,null,2));await info.attach('cancellation-finance-evidence',{path,contentType:'application/json'});
    if(loggedIn&&page&&!page.isClosed()){const shot=info.outputPath('final-state.png');await page.screenshot({path:shot,timeout:5000}).then(()=>info.attach('final-state',{path:shot,contentType:'image/png'})).catch(()=>{});}
    globalThis.fetch=nativeFetch;await Promise.allSettled(contexts.map(context=>context.close()));try{await api?.close?.();}finally{await db.end();}
  }
});
