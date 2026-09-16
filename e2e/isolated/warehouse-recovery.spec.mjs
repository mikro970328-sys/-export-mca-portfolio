import { test,expect } from '@playwright/test';
import fs from 'node:fs';
import { createOperatorAcceptanceDb } from '../../scripts/lib/operator-acceptance-db.mjs';
import { operatorFixture } from '../../scripts/lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer,root } from './server.mjs';

// Actual UI, password login, current permissions, local HTTP/PostgREST and SQL.
// Only network delivery is interrupted. No response bodies or auth are fabricated.
test('manual receipt: offline, lost confirmation, refresh failure and current permissions',async({browser},info)=>{
  test.setTimeout(240_000);process.chdir(root);
  const db=await createOperatorAcceptanceDb(),nativeFetch=globalThis.fetch,contexts=[];
  const evidence={checkpoints:[],requests:[],errors:[],external:[]};
  const fault={drop:false,droppedId:null,hold:false,release:null,held:null};
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
      grant usage on sequence purchase_order_number_seq, sales_orders_so_serial_seq,
        invoices_invoice_serial_seq to service_role;
      grant select on load_expediente_documents, documents, load_traceability_sources,
        load_traceability_summary to service_role;
      grant select,insert on shipment_history to service_role;`);
    await db.exec(fs.readFileSync('supabase/migrations/20260831235500_ux5_shipment_action_capabilities.sql','utf8'));

    const {f,users}=await operatorFixture(db);
    api=await startBrowserAcceptanceServer({
      dropApiResponse:(req,url,body)=>{
        if(!fault.drop||req.method!=='POST'||url.pathname!=='/api/warehouse')return false;
        let result;try{result=JSON.parse(String(body));}catch{return false;}
        if(!result.receipt?.id)return false;
        fault.droppedId=result.receipt.id;return true;
      },
      beforeApiResponse:async(req,url,body)=>{
        if(!fault.hold||req.method!=='POST'||url.pathname!=='/api/warehouse')return;
        let result;try{result=JSON.parse(String(body));}catch{return;}
        if(!result.receipt?.id)return;
        fault.held=result.receipt.id;
        await new Promise(resolve=>{fault.release=resolve;});
      }
    });
    const origins=new Set([api.base,new URL(process.env.ERP_TEST_POSTGREST_URL).origin]);
    globalThis.fetch=(input,options)=>{
      const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
      if(!origins.has(url.origin))throw Error('QA refuses external backend traffic');
      return nativeFetch(input,options);
    };
    await api.ready(db);
    const master=await api.request('login',{method:'POST',body:{username:users.master.username,password:users.master.password}});
    expect(master.status).toBe(200);
    const roles=async(key,permissions)=>{
      const r=await api.request('access-control?resource=roles',{method:'PATCH',token:master.body.token,
        body:{id:users[key].access_role_id,permission_keys:permissions}});
      expect(r.status).toBe(200);
    };
    await roles('a',['warehouse.read','warehouse.write']);await roles('b',['warehouse.read']);
    const sessions={};
    for(const key of ['a','b']){
      const use=info.project.use;
      const context=await browser.newContext({viewport:use.viewport,userAgent:use.userAgent,isMobile:use.isMobile,
        hasTouch:use.hasTouch,deviceScaleFactor:use.deviceScaleFactor,locale:'es-US',timezoneId:'America/New_York'});
      contexts.push(context);
      const network={blockRefresh:false};
      await context.route('**/*',route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin===api.base){
          if(network.blockRefresh&&url.pathname==='/api/warehouse'&&request.method()==='GET')return route.abort('failed');
          return route.continue();
        }
        if(['data:','blob:','about:'].includes(url.protocol))return route.continue();
        evidence.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');
      });
      const page=await context.newPage();page.setDefaultTimeout(15_000);
      sessions[key]={page,context,network,navigations:0,frames:0};
      page.on('pageerror',e=>evidence.errors.push({operator:key,message:e.message}));
      page.on('framenavigated',frame=>{
        if(frame===page.mainFrame())sessions[key].navigations++;
        else if(frame.url().includes('/admin/inventory.html'))sessions[key].frames++;
      });
      page.on('request',request=>{
        const url=new URL(request.url());
        if(url.pathname==='/api/warehouse'&&request.method()==='POST'){
          const body=request.postDataJSON();
          if(body.action==='create_receipt')evidence.requests.push({operator:key,id:body.registration_request_id,reference:body.reference_number});
        }
      });
      await page.goto(api.base+'/admin/pwa.html');
      await page.locator('#username').fill(users[key].username);await page.locator('#password').fill(users[key].password);
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/login'&&r.request().method()==='POST');
      await page.locator('#login').click();expect((await response).status()).toBe(200);
      await expect(page.locator('#loginPage')).toBeHidden();
      await page.waitForFunction(()=>window.NavigationShell?.owner==='navigation-shell.js');
    }
    const {a,b}=sessions;
    const navigate=async(session,name)=>{
      const page=session.page,button=page.locator('[data-section="'+name+'Section"]').first();
      if(info.project.use.isMobile&&!await page.locator('#sidebar').evaluate(el=>el.classList.contains('mobile-open'))){
        await page.locator('#mobileMenuBtn').click();await expect(page.locator('#sidebar')).toHaveClass(/mobile-open/);
      }
      if(!await button.isVisible()){
        const group=button.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," nav-group ")]');
        await group.locator('.nav-group-btn').click();
      }
      await button.click();await expect(page.locator('#'+name+'Section')).toBeVisible();
      return page.frameLocator('#'+name+'Section iframe');
    };
    const warehouse=await navigate(a,'warehouse'),stock=await navigate(b,'inventory');
    await expect(warehouse.locator('#newReceipt')).toBeEnabled();
    const bNavigation={navigations:b.navigations,frames:b.frames};
    const open=async(reference,quantity)=>{
      await warehouse.locator('#newReceipt').click();await expect(warehouse.locator('#receiptModal')).toBeVisible();
      await warehouse.locator('#rWarehouse').selectOption(f.warehouse);
      await warehouse.locator('#rSupplier').selectOption(f.supplier);
      await warehouse.locator('#rReference').fill(reference);
      await warehouse.locator('.line-product').selectOption(f.product);
      await warehouse.locator('[data-mode="units"]').click();
      await warehouse.locator('.line-quantity').fill(String(quantity));await warehouse.locator('.line-cost').fill('2.5');
    };
    const stockTotal=async quantity=>{
      await expect(stock.locator('.inventory-row .inventory-metric').first().locator('b')).toContainText(quantity+' cajas');
      const row=await f.one('select sum(physical_quantity)::numeric as physical from inventory_summary where product_id=$1',[f.product]);
      expect(Number(row.physical)).toBe(quantity);
      expect({navigations:b.navigations,frames:b.frames}).toEqual(bNavigation);
    };
    const step=async(name,fn)=>test.step(name,async()=>{await fn();evidence.checkpoints.push(name);console.log('PASS '+info.project.name+' '+name);});

    await step('WR-01 offline retains the form and makes no stock',async()=>{
      await open('QA-WR-LOST',12);await a.context.setOffline(true);
      await warehouse.locator('#saveReceipt').click();
      await expect(warehouse.locator('#rMsg')).toContainText('No se pudo confirmar');
      await expect(warehouse.locator('.line-quantity')).toHaveValue('12');
      expect((await f.rows('select id from warehouse_receipts')).length).toBe(0);
      await a.context.setOffline(false);
    });
    await step('WR-02 dropped confirmations and retry preserve one receipt and one inventory entry',async()=>{
      fault.drop=true;await warehouse.locator('#saveReceipt').click();
      await expect.poll(()=>fault.droppedId).toBeTruthy();
      await expect(warehouse.locator('#rMsg')).toContainText('No se pudo confirmar');
      await expect(warehouse.locator('#saveReceipt')).toBeEnabled();
      expect(fault.droppedId).toBeTruthy();
      expect((await f.rows('select id from warehouse_receipts')).length).toBe(1);
      await stockTotal(12);
      fault.drop=false;
      const pending=a.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/warehouse'&&r.request().method()==='POST');
      await warehouse.locator('#saveReceipt').click();
      const response=await pending;expect(response.status()).toBe(200);
      expect((await response.json()).receipt.id).toBe(fault.droppedId);
      await expect(warehouse.locator('#receiptModal')).toBeHidden();await stockTotal(12);
      const requests=evidence.requests.filter(x=>x.reference==='QA-WR-LOST');
      expect(requests.length).toBeGreaterThanOrEqual(2);
      expect(new Set(requests.map(x=>x.id)).size).toBe(1);
      expect(requests[0].id).toMatch(/^[0-9a-f-]{36}$/i);
      expect((await f.rows("select id from audit_log where action='warehouse_receipt_created'")).length).toBe(1);
    });
    await step('WR-03 saved receipt remains saved when refreshing the list fails',async()=>{
      await open('QA-WR-REFRESH',5);a.network.blockRefresh=true;
      await warehouse.locator('#saveReceipt').click();
      await expect(warehouse.locator('#rMsg')).toContainText('ya está registrada');
      await expect(warehouse.locator('#saveReceipt')).toBeDisabled();
      await stockTotal(17);expect((await f.rows('select id from warehouse_receipts')).length).toBe(2);
      a.network.blockRefresh=false;await warehouse.locator('#closeReceipt').click();
    });
    await step('WR-04 in-flight receipt blocks a second save and close',async()=>{
      await open('QA-WR-INFLIGHT',3);fault.hold=true;
      await warehouse.locator('#saveReceipt').click();await expect.poll(()=>fault.held).toBeTruthy();
      await expect(warehouse.locator('#saveReceipt')).toBeDisabled();
      await warehouse.locator('#closeReceipt').click();await expect(warehouse.locator('#receiptModal')).toBeVisible();
      fault.hold=false;fault.release();fault.release=null;
      await expect(warehouse.locator('#receiptModal')).toBeHidden();await stockTotal(20);
      expect(evidence.requests.filter(x=>x.reference==='QA-WR-INFLIGHT')).toHaveLength(1);
    });
    await step('WR-05 revoking write access while the form is open prevents inventory mutation',async()=>{
      await open('QA-WR-REVOKED',4);await roles('a',['warehouse.read']);
      const before=(await f.rows('select id from warehouse_receipts')).length;
      const pending=a.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/warehouse'&&r.request().method()==='POST');
      await warehouse.locator('#saveReceipt').click();expect((await pending).status()).toBe(403);
      await expect(warehouse.locator('#rMsg')).toContainText('No tienes permiso');
      expect((await f.rows('select id from warehouse_receipts')).length).toBe(before);await stockTotal(20);
      await roles('a',['warehouse.read','warehouse.write']);
      const recovery=a.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/warehouse'&&r.request().method()==='POST');
      await warehouse.locator('#saveReceipt').click();expect((await recovery).status()).toBe(200);
      await expect(warehouse.locator('#receiptModal')).toBeHidden();await stockTotal(24);
    });
    await step('WR-06 replay of a receipt cancelled by another operator never reports fresh stock',async()=>{
      await open('QA-WR-CANCELLED',6);fault.drop=true;fault.droppedId=null;
      await warehouse.locator('#saveReceipt').click();
      await expect.poll(()=>fault.droppedId).toBeTruthy();
      await expect(warehouse.locator('#saveReceipt')).toBeEnabled();
      // Intervening authorized operator uses the real API, not a SQL state edit.
      const cancelled=await api.request('warehouse',{method:'PATCH',token:master.body.token,
        body:{action:'cancel_receipt',id:fault.droppedId}});
      expect(cancelled.status).toBe(200);
      fault.drop=false;
      const replay=a.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/warehouse'&&r.request().method()==='POST');
      await warehouse.locator('#saveReceipt').click();expect((await replay).status()).toBe(200);
      await expect(warehouse.locator('#rMsg')).toContainText('ya está anulada');
      await expect(warehouse.locator('#saveReceipt')).toBeDisabled();
      await stockTotal(24);
      expect((await f.rows("select id from warehouse_receipts where status='cancelled'")).length).toBe(1);
      await warehouse.locator('#closeReceipt').click();
    });
    expect(evidence.errors).toEqual([]);
    expect(new Set(evidence.requests.map(x=>x.id)).size).toBe(5);
    const audits=await f.rows("select actor_admin_id from audit_log where action='warehouse_receipt_created'");
    expect(audits).toHaveLength(5);expect(audits.every(x=>x.actor_admin_id===users.a.id)).toBe(true);
    const screenshot=info.outputPath('manual-receipt-recovery.png');await a.page.screenshot({path:screenshot});
    await info.attach('manual receipt recovery',{path:screenshot,contentType:'image/png'});
  }finally{
    fault.release?.();
    const path=info.outputPath('manual-receipt-evidence.json');fs.mkdirSync(info.outputDir,{recursive:true});
    fs.writeFileSync(path,JSON.stringify(evidence,null,2));await info.attach('manual receipt evidence',{path,contentType:'application/json'});
    for(const context of contexts)await context.close();
    globalThis.fetch=nativeFetch;if(api)await api.close();await db.end();
  }
});
