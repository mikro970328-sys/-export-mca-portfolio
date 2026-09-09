import { test, expect } from '@playwright/test';
import { createOperatorAcceptanceDb } from '../../scripts/lib/operator-acceptance-db.mjs';
import { operatorFixture } from '../../scripts/lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer, root } from './server.mjs';

// This suite runs in disposable CI containers. It never accepts a remote ERP
// URL, a production credential, an auth mock or a fabricated API response.
test('two operators: rendered collections, forms, permissions, recovery and PWA entry', async ({ browser }, info) => {
  process.chdir(root);
  const db = await createOperatorAcceptanceDb();
  let api;
  const contexts = [];
  const nativeFetch = globalThis.fetch;
  const diagnostics = { api:[], errors:[], blockedExternal:[], checkpoints:[] };
  try {
    const { f, users } = await operatorFixture(db);
    const invoice = await f.invoice(await f.sale());
    api = await startBrowserAcceptanceServer();
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
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin===api.base || ['data:','blob:','about:'].includes(url.protocol)) return route.continue();
        diagnostics.blockedExternal.push(url.origin + url.pathname);
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      const state = { context, page, liveVersion:-1, navigations:0, framesNavigated:0, liveResponses:0 };
      sessions[key] = state;
      page.on('framenavigated', frame => {
        if (frame===page.mainFrame()) state.navigations++;
        else if (frame.url().includes('/admin/invoices.html')) state.framesNavigated++;
      });
      page.on('pageerror', error => diagnostics.errors.push({ operator:key, message:error.message }));
      page.on('response', async response => {
        const url = new URL(response.url());
        if (url.origin!==api.base || !url.pathname.startsWith('/api/')) return;
        diagnostics.api.push({ operator:key, path:url.pathname, status:response.status(), method:response.request().method() });
        if (url.pathname==='/api/live-updates' && response.status()===200) {
          try { state.liveVersion = Number((await response.json()).versions.invoices);state.liveResponses++; } catch {}
        }
      });
    }
    const a = sessions.a, b = sessions.b;
    const frame = session => session.page.frameLocator('#invoicesSection iframe');
    const row = session => frame(session).locator(`[data-invoice-row="${invoice.id}"]`);
    const balance = (session,amount) => expect(row(session).locator('.balance')).toHaveText(`USD ${amount.toFixed(2)}`);
    const screenshot = async (session,name) => info.attach(name, {
      body:await session.page.screenshot({ fullPage:false }), contentType:'image/png'
    });
    const login = async (session,key) => {
      await session.page.locator('#username').fill(users[key].username);
      await session.page.locator('#password').fill(users[key].password);
      const response = session.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/login' && r.request().method()==='POST');
      await session.page.locator('#login').click();
      expect((await response).status()).toBe(200);
      await expect(session.page.locator('#loginPage')).toBeHidden();
      await expect(session.page.locator('#invoicesSection')).toBeVisible();
      await balance(session,Number((await f.financial(invoice)).balance_due));
    };
    const openPayment = async session => {
      await row(session).locator('[data-invoice-action="payment"]').click();
      await expect(frame(session).locator('#paymentModal')).toBeVisible();
    };
    const collect = async (session,amount) => {
      await openPayment(session);
      await frame(session).locator('#pAmount').fill(String(amount));
      const response = session.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/invoice-payments' && r.request().method()==='POST');
      await frame(session).locator('#savePayment').click();
      expect((await response).status()).toBe(200);
      await expect(frame(session).locator('#paymentModal')).toBeHidden();
      await expect(frame(session).locator('#detailModal')).toBeVisible();
      await frame(session).locator('[data-close="detail"]').click();
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
      await screenshot(b,'01-two-operators-initial-balance');
    });
    const nav = { a:a.navigations, b:b.navigations, af:a.framesNavigated, bf:b.framesNavigated };
    await step('UI-02 collection repaints the other operator without navigation', async()=> {
      await collect(a,120);
      await balance(a,280);await balance(b,280);
      const payment = await f.one('select id,amount from payments where invoice_id=$1',[invoice.id]);
      expect(Number(payment.amount)).toBe(120);
      const audit = await f.one("select actor_admin_id from audit_log where action='invoice_payment_registered' and entity_id=$1",[payment.id]);
      expect(audit.actor_admin_id).toBe(users.a.id);
      await screenshot(b,'02-other-operator-updated');
    });
    await step('UI-03 an open editor retains inputs and applies changes when closed', async()=> {
      await openPayment(b);
      await frame(b).locator('#pAmount').fill('75');
      await frame(b).locator('#pNotes').fill('QA unsaved collection details');
      const previous = b.liveVersion;
      await collect(a,60);
      await expect.poll(()=>b.liveVersion).toBeGreaterThan(previous);
      await expect(frame(b).locator('#pAmount')).toHaveValue('75');
      await expect(frame(b).locator('#pNotes')).toHaveValue('QA unsaved collection details');
      await balance(b,280);
      await screenshot(b,'03-open-form-preserved');
      await frame(b).locator('[data-close="payment"]').first().click();
      await balance(b,220);
    });
    await step('UI-04 excessive collection is rejected visibly without a ledger entry', async()=> {
      await openPayment(b);await frame(b).locator('#pAmount').fill('221');
      const response = b.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/invoice-payments' && r.request().method()==='POST');
      await frame(b).locator('#savePayment').click();
      expect((await response).status()).toBe(400);
      await expect(frame(b).locator('#paymentMsg')).toContainText(/saldo/i);
      expect(Number((await f.financial(invoice)).balance_due)).toBe(220);
      expect((await f.rows('select id from payments where invoice_id=$1',[invoice.id])).length).toBe(2);
      await frame(b).locator('[data-close="payment"]').first().click();
    });
    await step('UI-05 removing write permission updates existing screens', async()=> {
      await role(readKeys);
      await expect(frame(b).locator('#invoicesReadOnlyNote')).toBeVisible();
      await expect(row(b).locator('[data-invoice-action="payment"]')).toHaveCount(0);
      await expect(frame(b).locator('#newInvoice')).toBeHidden();
      await expect(row(a).locator('[data-invoice-action="payment"]')).toBeVisible();
      await screenshot(b,'05-current-read-only-permissions');
    });
    await step('UI-06 restoring write permission updates the same session', async()=> {
      await role(writeKeys);
      await expect(frame(b).locator('#invoicesReadOnlyNote')).toBeHidden();
      await expect(row(b).locator('[data-invoice-action="payment"]')).toBeVisible();
    });
    await step('UI-07 reconnecting restores the displayed balance without reload', async()=> {
      await b.context.setOffline(true);
      await collect(a,25);await balance(a,195);
      await balance(b,220);
      await b.context.setOffline(false);
      await balance(b,195);
      expect({ a:a.navigations,b:b.navigations,af:a.framesNavigated,bf:b.framesNavigated }).toEqual(nav);
    });
    await step('UI-08 refresh restores session and one responsive workspace', async()=> {
      await b.page.reload();
      await expect(b.page.locator('#loginPage')).toBeHidden();
      await expect(b.page.locator('.app-section:visible')).toHaveCount(1);
      await expect(b.page.locator('#invoicesSection')).toBeVisible();
      await balance(b,195);
      for (const locator of [b.page.locator('html'),frame(b).locator('html')]) {
        const geometry = await locator.evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth}));
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
      }
      await screenshot(b,'08-responsive-restored-workspace');
    });
    await step('UI-09 revoking B logs B out while A remains operational', async()=> {
      const result = await api.request('admins',{ method:'PATCH',token:masterToken,
        body:{ id:users.b.id,revoke_sessions:true,revoke_reason:'Isolated browser acceptance' } });
      expect(result.status).toBe(200);
      await expect(b.page.locator('#loginPage')).toBeVisible();
      await expect(a.page.locator('#loginPage')).toBeHidden();await balance(a,195);
    });
    await step('UI-10 fresh login restores current data without repeating a collection', async()=> {
      await login(b,'b');await balance(b,195);
      expect((await f.rows('select id from payments where invoice_id=$1',[invoice.id])).length).toBe(3);
      const totals = await f.one('select sum(amount) as total from payments where invoice_id=$1',[invoice.id]);
      expect(Number(totals.total)).toBe(205);
      await screenshot(b,'10-fresh-session-current-balance');
    });
    expect(diagnostics.errors).toEqual([]);
    expect(diagnostics.blockedExternal).toEqual([]);
    // Unauthorized eager modules may answer 403; any 5xx is a real failure.
    expect(diagnostics.api.filter(r=>r.status>=500)).toEqual([]);
    expect(diagnostics.checkpoints).toHaveLength(10);
  } finally {
    for (const [index,context] of contexts.entries()) {
      for (const page of context.pages()) {
        await info.attach(`final-operator-${index}`, { body:await page.screenshot().catch(()=>Buffer.alloc(0)),contentType:'image/png' });
      }
      await context.close();
    }
    await info.attach('diagnostics', { body:Buffer.from(JSON.stringify(diagnostics,null,2)),contentType:'application/json' });
    globalThis.fetch = nativeFetch;
    if (api) await api.close();
    await db.end();
  }
});
