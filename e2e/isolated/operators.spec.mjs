import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createOperatorAcceptanceDb } from '../../scripts/lib/operator-acceptance-db.mjs';
import { operatorFixture } from '../../scripts/lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer, root } from './server.mjs';

// This suite runs in disposable CI containers. It never accepts a remote ERP
// URL, a production credential, an auth mock or a fabricated API response.
test('two operators: rendered collections, forms, permissions, recovery and PWA entry', async ({ browser }, info) => {
  test.setTimeout(360_000);
  process.chdir(root);
  const db = await createOperatorAcceptanceDb();
  let api;
  const contexts = [];
  const nativeFetch = globalThis.fetch;
  const diagnostics = { api:[], errors:[], blockedExternal:[], checkpoints:[], clicks:[], lifecycle:[] };
  const lifecycle = (operator,event,detail={}) => diagnostics.lifecycle.push({operator,event,...detail});
  browser.on('disconnected',()=>lifecycle('all','browser-disconnected'));
  try {
    const { f, users } = await operatorFixture(db);
    const invoice = await f.invoice(await f.sale());
    const paymentFault={armed:false,droppedId:null,expectFailure:false};
    api = await startBrowserAcceptanceServer({dropApiResponse:(req,url,body)=>{
      if(!paymentFault.armed||req.method!=='POST'||url.pathname!=='/api/invoice-payments')return false;
      let result;try{result=JSON.parse(String(body));}catch{return false;}
      if(!result.payment?.id)return false;
      if(!paymentFault.keepDropping)paymentFault.armed=false;
      paymentFault.droppedId=result.payment.id;return true;
    }});
    const localOrigins = new Set([api.base, new URL(process.env.ERP_TEST_POSTGREST_URL).origin]);
    globalThis.fetch = (input,options) => {
      const url = new URL(typeof input==='string' || input instanceof URL ? input : input.url);
      if (!localOrigins.has(url.origin)) throw Error('QA refuses external backend traffic');
      return nativeFetch(input,options);
    };
    await api.ready(db);
    const masterLogin = await api.request('login', { method:'POST',
      body:{ username:users.master.username, password:users.master.password } });
    expect(masterLogin.status).toBe(200);
    const masterToken = masterLogin.body.token;
    const role = async permissions => {
      const result = await api.request('access-control?resource=roles', { method:'PATCH', token:masterToken,
        body:{ id:users.b.access_role_id, permission_keys:permissions } });
      expect(result.status).toBe(200);
    };
    const writeKeys = ['finance.read','finance.write','reports.read'];
    const readKeys = ['finance.read','reports.read'];
    const sessions = {};
    for (const key of ['a','b']) {
      const use = info.project.use;
      const context = await browser.newContext({ viewport:use.viewport, userAgent:use.userAgent,
        isMobile:use.isMobile, hasTouch:use.hasTouch, deviceScaleFactor:use.deviceScaleFactor,
        locale:'es-US', timezoneId:'America/New_York', serviceWorkers:'allow' });
      contexts.push(context);
      context.setDefaultTimeout(15_000);
      context.setDefaultNavigationTimeout(20_000);
      await context.addInitScript(() => {
        document.addEventListener('click', event => {
          const button = event.target?.closest?.('button');
          if (!button || !location.pathname.endsWith('/invoices.html')) return;
          const target = { id:button.id, close:button.dataset.close,action:button.dataset.invoiceAction };
          setTimeout(()=>console.debug('QA_UI_CLICK '+JSON.stringify({ target,
            modals:[...document.querySelectorAll('.modal:not(.hidden)')].map(el=>el.id) })),0);
        },true);
      });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin===api.base || ['data:','blob:','about:'].includes(url.protocol)) return route.continue();
        diagnostics.blockedExternal.push(url.origin + url.pathname);
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      page.on('close',()=>lifecycle(key,'page-close'));
      page.on('crash',()=>lifecycle(key,'page-crash'));
      context.on('close',()=>lifecycle(key,'context-close'));
      const state = { context, page, liveVersion:-1, navigations:0, framesNavigated:0, liveResponses:0 };
      sessions[key] = state;
      page.on('framenavigated', frame => {
        if (frame===page.mainFrame()) {
          state.navigations++;
          lifecycle(key,'navigation',{path:new URL(frame.url()).pathname});
        }
        else if (frame.url().includes('/admin/invoices.html')) state.framesNavigated++;
      });
      page.on('pageerror', error => diagnostics.errors.push({ operator:key, message:error.message }));
      page.on('console', message => {
        if (message.text().startsWith('QA_UI_CLICK ')) {
          diagnostics.clicks.push({ operator:key,...JSON.parse(message.text().slice(12)) });
        }
      });
      page.on('response', async response => {
        const url = new URL(response.url());
        if (url.origin!==api.base || !url.pathname.startsWith('/api/')) return;
        diagnostics.api.push({ operator:key, path:url.pathname, status:response.status(), method:response.request().method(), injected:paymentFault.expectFailure&&Boolean(paymentFault.droppedId)&&url.pathname==='/api/invoice-payments'&&response.status()===503 });
        if (url.pathname==='/api/live-updates' && response.status()===200) {
          try { state.liveVersion = Number((await response.json()).versions.invoices);state.liveResponses++; } catch {}
        }
      });
    }
    const a = sessions.a, b = sessions.b;
    const frame = session => session.page.frameLocator('#invoicesSection iframe');
    const row = session => frame(session).locator(`[data-invoice-row="${invoice.id}"]`);
    const balance = (session,amount) => expect(row(session).locator('.balance')).toHaveText(`USD ${amount.toFixed(2)}`);
    const screenshot = async (session,name) => {
      const path = info.outputPath(`${name}.png`);
      await session.page.screenshot({ path,fullPage:false,timeout:5000 });
      await info.attach(name, { path,contentType:'image/png' });
    };
    const login = async (session,key) => {
      await session.page.locator('#username').fill(users[key].username);
      await session.page.locator('#password').fill(users[key].password);
      const response = session.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/login' && r.request().method()==='POST');
      await session.page.locator('#login').click();
      expect((await response).status()).toBe(200);
      await expect(session.page.locator('#loginPage')).toBeHidden();
      await expect(session.page.locator('#invoicesSection')).toBeVisible();
      await expect(session.page.locator('[data-section="tasksSection"]')).toHaveCount(1);
      await expect(session.page.locator('[data-section="tasksSection"]')).toBeHidden();
      await balance(session,Number((await f.financial(invoice)).balance_due));
    };
    const openPayment = async session => {
      await row(session).locator('[data-invoice-action="detail"]').click();
      await frame(session).locator('#detailActions [data-invoice-action="payment"]').click();
      await expect(frame(session).locator('#paymentModal')).toBeVisible();
    };
    const assertWorkspaceFits = async session => {
      const header = await session.page.locator('.topbar').boundingBox();
      const workspace = await session.page.locator('#invoicesSection iframe').boundingBox();
      expect(workspace.y).toBeGreaterThanOrEqual(header.y+header.height);
      expect(workspace.y+workspace.height).toBeLessThanOrEqual(session.page.viewportSize().height);
    };
    const collect = async (session,amount) => {
      await openPayment(session);
      await frame(session).locator('#pAmount').fill(String(amount));
      const response = session.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/invoice-payments' && r.request().method()==='POST');
      await frame(session).locator('#savePayment').click();
      expect((await response).status()).toBe(200);
      await expect(frame(session).locator('#paymentModal')).toBeHidden();
      await expect(frame(session).locator('#detailModal')).toBeVisible();
      await assertWorkspaceFits(session);
      const close = await frame(session).locator('[data-close="detail"]').boundingBox();
      const header = await session.page.locator('.topbar').boundingBox();
      expect(close.y).toBeGreaterThanOrEqual(header.y+header.height);
      if(amount===120) await screenshot(session,'02-payment-detail-controls');
      await frame(session).locator('[data-close="detail"]').click();
      await expect(frame(session).locator('#detailModal')).toBeHidden();
    };
    const step = async (name,action) => test.step(name, async()=> {
      await action();diagnostics.checkpoints.push(name);console.log(`PASS ${info.project.name} ${name}`);
    });
    await step('UI-01 distinct real logins through PWA entry', async()=> {
      for (const [key,session] of Object.entries(sessions)) {
        await session.page.goto(`${api.base}/admin/pwa.html`);
        await expect(session.page).toHaveURL(/\/admin\/index\.html$/);
        await login(session,key);
        await expect.poll(()=>session.liveResponses).toBeGreaterThan(0);
      }
      const loginActors = (await f.rows("select actor_admin_id from audit_log where action='login'")).map(r=>r.actor_admin_id);
      expect(loginActors).toEqual(expect.arrayContaining([users.a.id,users.b.id]));
      await row(b).scrollIntoViewIfNeeded();
      await screenshot(b,'01-two-operators-initial-balance');
    });
    const nav = { a:a.navigations, b:b.navigations, af:a.framesNavigated, bf:b.framesNavigated };
    await step('UI-02 collection repaints the other operator without navigation', async()=> {
      await collect(a,120);
      await balanc