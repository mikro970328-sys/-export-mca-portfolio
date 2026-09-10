import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createOperatorAcceptanceDb } from '../../scripts/lib/operator-acceptance-db.mjs';
import { operatorFixture } from '../../scripts/lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer, root } from './server.mjs';

// Reproduce startup ordering, not timing luck. Pause an actual script request,
// click once while it is pending, then deliver its ORIGINAL bytes. No response
// fulfillment, forced clicks, fixed sleeps, retries, auth injection or UI mocks.
test('startup completion cannot discard an already opened mobile menu', async ({ browser }, info) => {
  test.setTimeout(180_000);
  process.chdir(root);
  const db=await createOperatorAcceptanceDb(),nativeFetch=globalThis.fetch;
  const contexts=[],releases=[],evidence={scenarios:[],errors:[],external:[],apiErrors:[]};
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
      grant select on load_expediente_documents, documents, load_traceability_sources,
        load_traceability_summary to service_role;`);
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
    for(const [key,permissions] of [['b',['warehouse.read']],['a',['warehouse.read','procurement.read','procurement.write','sales.read','sales.write','logistics.read','logistics.write','finance.read','finance.write','reports.read']]]){
      const result=await api.request('access-control?resource=roles',{method:'PATCH',token:master.body.token,
        body:{id:users[key].access_role_id,permission_keys:permissions}});
      expect(result.status).toBe(200);
    }
    for(const [key,script] of [['b','admin-data-loader.js'],['a','section-state.js']]){
      await test.step(`NAV-${key}: preserve a single menu click across delayed ${script}`,async()=>{
        // Both engines exercise a narrow touch viewport; other suites retain
        // their normal desktop/mobile project settings.
        const use=info.project.use;
        const context=await browser.newContext({viewport:{width:390,height:664},isMobile:true,hasTouch:true,
          userAgent:use.userAgent,deviceScaleFactor:use.deviceScaleFactor,locale:'es-US',timezoneId:'America/New_York',serviceWorkers:'allow'});
        contexts.push(context);
        await context.addInitScript(()=>{
          window.__qaModulesReady=false;
          window.addEventListener('export-mca:modules-ready',()=>{window.__qaModulesReady=true;},{once:true});
        });
        let release,blocked=false;
        const gate=new Promise(resolve=>{release=resolve;});releases.push(release);
        await context.route('**/*',async route=>{
          const url=new URL(route.request().url());
          if(url.origin!==api.base&&!['data:','blob:','about:'].includes(url.protocol)){
            evidence.external.push(url.origin+url.pathname);return route.abort('blockedbyclient');
          }
          if(url.origin===api.base&&url.pathname===`/admin/${script}`){blocked=true;await gate;}
          await route.continue().catch(()=>{});
        });
        const page=await context.newPage();page.setDefaultTimeout(15_000);
        page.on('pageerror',error=>evidence.errors.push(error.message));
        page.on('crash',()=>evidence.errors.push('page crash'));
        page.on('response',response=>{
          const url=new URL(response.url());
          if(url.origin===api.base&&url.pathname.startsWith('/api/')&&(response.status()===404||response.status()>=500))evidence.apiErrors.push({path:url.pathname,status:response.status()});
        });
        await page.goto(`${api.base}/admin/pwa.html`);
        await page.locator('#username').fill(users[key].username);await page.locator('#password').fill(users[key].password);
        const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/login'&&r.request().method()==='POST');
        await page.locator('#login').click();expect((await login).status()).toBe(200);
        await page.waitForFunction(()=>window.NavigationShell?.owner==='navigation-shell.js');
        await expect.poll(()=>blocked).toBe(true);
        await page.locator('#mobileMenuBtn').click();
        await expect(page.locator('#sidebar')).toHaveClass(/mobile-open/);
        await expect(page.locator('#mobileMenuBtn')).toHaveAttribute('aria-expanded','true');
        release();
        await page.waitForFunction(()=>window.__qaModulesReady===true);
        const state=await page.evaluate(()=>({
          sidebar:document.getElementById('sidebar').className,
          expanded:document.getElementById('mobileMenuBtn').getAttribute('aria-expanded'),
          active:document.querySelector('.app-section:not(.hidden)')?.id,
          width:innerWidth,height:innerHeight
        }));
        evidence.scenarios.push({operator:key,delayedScript:script,...state});
        const shot=info.outputPath(`navigation-${key}-after-startup.png`);
        await page.screenshot({path:shot});await info.attach(`navigation-${key}`,{path:shot,contentType:'image/png'});
        expect(state.sidebar,'Startup must not discard the user menu click').toContain('mobile-open');
        expect(state.expanded).toBe('true');
        if(key==='b')await expect(page.locator('#warehouseSection')).toBeVisible();
        const target=page.locator('[data-section="inventorySection"]').first();
        if(!await target.isVisible())await target.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," nav-group ")]').locator('.nav-group-btn').click();
        await target.click();await expect(page.locator('#inventorySection')).toBeVisible();
        await expect(page.locator('#sidebar')).not.toHaveClass(/mobile-open/);
        await expect(page.locator('#mobileMenuBtn')).toHaveAttribute('aria-expanded','false');
        await page.locator('#mobileMenuBtn').click();await expect(page.locator('#sidebar')).toHaveClass(/mobile-open/);
        await page.keyboard.press('Escape');await expect(page.locator('#sidebar')).not.toHaveClass(/mobile-open/);
        await context.close();
      });
    }
    for(const table of ['sales_orders','purchase_orders','customer_advances','payments','supplier_payments','inventory_movements']){
      expect(Number((await f.one(`select count(*) as n from ${table}`)).n),`${table}: no business writes in startup test`).toBe(0);
    }
    expect(evidence.scenarios).toHaveLength(2);
    expect(evidence.errors).toEqual([]);expect(evidence.external).toEqual([]);expect(evidence.apiErrors).toEqual([]);
  }finally{
    releases.forEach(release=>release());
    const path=info.outputPath('navigation-startup-evidence.json');fs.mkdirSync(info.outputDir,{recursive:true});
    fs.writeFileSync(path,JSON.stringify(evidence,null,2));await info.attach('navigation-startup-evidence',{path,contentType:'application/json'});
    await Promise.allSettled(contexts.map(context=>context.close()));
    globalThis.fetch=nativeFetch;try{await api?.close?.();}finally{await db.end();}
  }
});
