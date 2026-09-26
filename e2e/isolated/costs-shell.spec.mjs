import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createOperatorAcceptanceDb } from '../../scripts/lib/operator-acceptance-db.mjs';
import { operatorFixture } from '../../scripts/lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer, root } from './server.mjs';

// Exercise the shipped shell, session, expense owner and HTTP/SQL together.
// Only disposable loopback databases are accepted by the existing QA server.
test('Figma expenses in the real shell: persistence, history, permissions and session recovery', async ({ browser }, info) => {
  test.setTimeout(240_000);
  process.chdir(root);
  const db = await createOperatorAcceptanceDb();
  const nativeFetch = globalThis.fetch;
  const contexts = [];
  const evidence = { checkpoints: [], errors: [], external: [], failedResponses: [] };
  let api;
  try {
    // Use the published revision RPC unchanged; the shared legacy finance
    // fixture deliberately predates this migration.
    await db.exec(fs.readFileSync('supabase/migrations/20260921211500_posted_cost_charge_revision.sql', 'utf8'));
    const { f, users } = await operatorFixture(db);
    const purchase = await f.purchase();
    const original = await f.one(`select * from create_posted_cost_charge(
      p_category=>'domestic_trucking',p_stage=>'inbound',p_amount=>1250,
      p_reference=>'QA-GASTO-ORIGINAL',p_allocations=>$1::jsonb,p_actor=>$2)`,
    [JSON.stringify([{ purchase_order_id: purchase.id, amount: 1250, basis: 'manual' }]), users.a.id]);
    api = await startBrowserAcceptanceServer();
    const origins = new Set([api.base, new URL(process.env.ERP_TEST_POSTGREST_URL).origin]);
    globalThis.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!origins.has(url.origin)) throw Error('QA refuses external backend traffic');
      return nativeFetch(input, options);
    };
    await api.ready(db);
    const master = await api.request('login', { method: 'POST',
      body: { username: users.master.username, password: users.master.password } });
    expect(master.status).toBe(200);
    const sessions = {};
    for (const key of ['a', 'b']) {
      const use = info.project.use;
      const context = await browser.newContext({ viewport: use.viewport, userAgent: use.userAgent,
        isMobile: use.isMobile, hasTouch: use.hasTouch, deviceScaleFactor: use.deviceScaleFactor,
        locale: 'es-US', timezoneId: 'America/New_York', serviceWorkers: 'allow' });
      contexts.push(context);
      context.setDefaultTimeout(15_000);
      await context.addInitScript(() => {
        window.__qaModulesReady = false;
        window.addEventListener('export-mca:modules-ready', () => { window.__qaModulesReady = true; }, { once: true });
      });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === api.base || ['data:', 'blob:', 'about:'].includes(url.protocol)) return route.continue();
        evidence.external.push(url.origin + url.pathname);
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      const session = { page, context, navigations: 0, costNavigations: 0 };
      sessions[key] = session;
      page.on('pageerror', error => evidence.errors.push({ operator: key, message: error.message }));
      page.on('crash', () => evidence.errors.push({ operator: key, message: 'page crash' }));
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) session.navigations++;
        else if (frame.url().includes('/admin/costs.html')) session.costNavigations++;
      });
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.origin === api.base && (response.status() === 404 || response.status() >= 500)) {
          evidence.failedResponses.push({ operator: key, path: url.pathname, status: response.status() });
        }
      });
    }
    const { a, b } = sessions;
    const frame = session => session.page.frameLocator('#costsSection iframe');
    const row = (session, number) => frame(session).locator('.cost-record').filter({ hasText: number });
    const step = async (name, run) => test.step(name, async () => {
      await run(); evidence.checkpoints.push(name); console.log(`PASS ${info.project.name} ${name}`);
    });
    const navigate = async (session, section) => {
      const page = session.page;
      if (await page.locator('#mobileMenuBtn').isVisible()
          && await page.locator('#mobileMenuBtn').getAttribute('aria-expanded') !== 'true') {
        await page.locator('#mobileMenuBtn').click();
      }
      const button = page.locator(`[data-section="${section}"]`).first();
      const group = page.locator('[data-nav-group="finance"] .nav-group-btn');
      if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
      await expect(group).toHaveAttribute('aria-expanded', 'true');
      await button.click();
      await expect(page.locator(`#${section}`)).toBeVisible();
      await expect(page.locator('.app-section:visible')).toHaveCount(1);
    };
    const login = async (session, key) => {
      const page = session.page;
      await page.locator('#username').fill(users[key].username);
      await page.locator('#password').fill(users[key].password);
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/login' && r.request().method() === 'POST');
      await page.locator('#login').click();
      expect((await response).status()).toBe(200);
      await expect(page.locator('#loginPage')).toBeHidden();
      // Startup restores the active navigation group after mounting the shell.
      // Early user interaction has its own delayed-asset navigation-startup test.
      await page.waitForFunction(() => window.__qaModulesReady === true);
      await expect(page.locator('[data-section="costsSection"]')).toHaveCount(1);
      await navigate(session, 'costsSection');
      await expect(frame(session).locator('#costsPageTitle')).toHaveText('Gastos y rentabilidad');
    };
    const fits = async session => {
      // sectionEnter translates the workspace by 4px for 180ms. Keep the
      // geometry limits unchanged and retry until the rendered layout settles.
      await expect(async () => {
        const header = await session.page.locator('.topbar').boundingBox();
        const workspace = await session.page.locator('#costsSection iframe').boundingBox();
        expect(workspace.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
        expect(workspace.y + workspace.height).toBeLessThanOrEqual(session.page.viewportSize().height + 1);
        for (const locator of [session.page.locator('html'), frame(session).locator('html')]) {
          const box = await locator.evaluate(el => ({ scroll: el.scrollWidth, width: el.clientWidth }));
          expect(box.scroll).toBeLessThanOrEqual(box.width + 1);
        }
      }).toPass({ timeout: 5000 });
    };
    const shot = async (session, name) => {
      const path = info.outputPath(`${name}.png`);
      await session.page.screenshot({ path });
      await info.attach(name, { path, contentType: 'image/png' });
    };
    const save = async session => {
      const response = session.page.waitForResponse(r => new URL(r.url()).pathname === '/api/costs' && r.request().method() === 'POST');
      await frame(session).locator('#saveCharge').click();
      const result = await response;
      expect(result.status()).toBe(200);
      await expect(frame(session).locator('#chargeModal')).toBeHidden();
      return (await result.json()).charge;
    };
    let replacement, draft;
    await step('GAS-01 actual PWA login and menu open one expense workspace', async () => {
      for (const [key, session] of Object.entries(sessions)) {
        await session.page.goto(`${api.base}/admin/pwa.html`);
        await login(session, key);
        await expect(row(session, original.cost_number).locator('.money-strong')).toHaveText('USD 1,250.00');
        await expect(frame(session).locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        const costFrame = session.page.frames().find(item => item.url().includes('/admin/costs.html'));
        await costFrame.evaluate(() => document.fonts.ready);
        expect(await costFrame.evaluate(() => document.fonts.check('14px Inter'))).toBe(true);
        await fits(session);
      }
      await shot(a, '01-gastos-en-erp');
    });
    const before = { page: b.navigations, frame: b.costNavigations };
    await step('GAS-02 posted revision saves from the embedded form and retains audited history', async () => {
      await a.page.setViewportSize({ width: info.project.use.isMobile ? 390 : 1440, height: 500 });
      await row(a, original.cost_number).locator('[data-edit]').click();
      await frame(a).locator('#cAmount').fill('1400');
      await frame(a).locator('[data-amount]').fill('1400');
      await frame(a).locator('#cReference').fill('QA-GASTO-CORREGIDO');
      await frame(a).locator('#cNotes').fill('Corrección integrada de prueba\nConservar historial.');
      await frame(a).locator('#saveCharge').scrollIntoViewIfNeeded();
      await fits(a);
      const button = await frame(a).locator('#saveCharge').boundingBox();
      const header = await a.page.locator('.topbar').boundingBox();
      expect(button.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
      expect(button.y + button.height).toBeLessThanOrEqual(501);
      await shot(a, '02-guardar-dentro-del-erp');
      replacement = await save(a);
      expect(replacement.id).not.toBe(original.id);
      const retained = await f.one('select status,amount from cost_charges where id=$1', [original.id]);
      expect(retained.status).toBe('void'); expect(Number(retained.amount)).toBe(1250);
      const stored = await f.one('select status,amount,notes from cost_charges where id=$1', [replacement.id]);
      expect(stored.status).toBe('posted'); expect(Number(stored.amount)).toBe(1400);
      expect(stored.notes).toBe('Corrección integrada de prueba\nConservar historial.');
      const allocation = await f.one('select purchase_order_id,amount from cost_charge_allocations where cost_charge_id=$1', [replacement.id]);
      expect(allocation.purchase_order_id).toBe(purchase.id); expect(Number(allocation.amount)).toBe(1400);
      const audit = await f.one("select actor_admin_id,details from audit_log where action='cost_charge_revised' and entity_id=$1", [replacement.id]);
      expect(audit.actor_admin_id).toBe(users.a.id);
      expect(audit.details.replaces_cost_charge_id).toBe(original.id);
    });
    await step('GAS-03 the other session receives the saved expense without navigation', async () => {
      await expect(row(b, replacement.cost_number).locator('.money-strong')).toHaveText('USD 1,400.00');
      await expect(row(b, original.cost_number).locator('.cost-status')).toContainText('Anulado');
      expect({ page: b.navigations, frame: b.costNavigations }).toEqual(before);
    });
    await step('GAS-04 create and edit a draft persist through the actual API', async () => {
      await frame(a).locator('#newCharge').click();
      await frame(a).locator('#cAmount').fill('80');
      await frame(a).locator('[data-target-id]').selectOption(purchase.id);
      await frame(a).locator('[data-amount]').fill('80');
      draft = await save(a);
      expect(draft.status).toBe('draft');
      await row(a, draft.cost_number).locator('[data-edit]').click();
      await frame(a).locator('#cAmount').fill('90');
      await frame(a).locator('[data-amount]').fill('90');
      const edited = await save(a);
      expect(edited.id).toBe(draft.id);
      expect(Number((await f.one('select amount from cost_charges where id=$1', [draft.id])).amount)).toBe(90);
      await expect(row(b, draft.cost_number).locator('.money-strong')).toHaveText('USD 90.00');
    });
    await step('GAS-05 removing write access updates the already open expense workspace', async () => {
      const result = await api.request('access-control?resource=roles', { method: 'PATCH', token: master.body.token,
        body: { id: users.b.access_role_id, permission_keys: ['finance.read', 'reports.read'] } });
      expect(result.status).toBe(200);
      await expect(frame(b).locator('#costsReadOnlyNote')).toBeVisible();
      await expect(frame(b).locator('#newCharge')).toBeHidden();
      await expect(frame(b).locator('[data-edit],[data-post],[data-void]')).toHaveCount(0);
      await expect(row(a, replacement.cost_number).locator('[data-edit]')).toBeVisible();
      await shot(b, '05-gastos-solo-lectura');
    });
    await step('GAS-06 navigation and reload preserve section, session and persisted amounts', async () => {
      await navigate(a, 'invoicesSection');
      await navigate(a, 'costsSection');
      await a.page.reload();
      await expect(a.page.locator('#loginPage')).toBeHidden();
      await a.page.waitForFunction(() => window.__qaModulesReady === true);
      await expect(a.page.locator('#costsSection')).toBeVisible();
      await expect(a.page.locator('[data-section="costsSection"]')).toHaveClass(/\bactive\b/);
      await expect(a.page.locator('.app-section:visible')).toHaveCount(1);
      await expect(row(a, replacement.cost_number).locator('.money-strong')).toHaveText('USD 1,400.00');
      await expect(row(a, draft.cost_number).locator('.money-strong')).toHaveText('USD 90.00');
      await fits(a);
      await shot(a, '06-gastos-despues-de-recargar');
    });
    await step('GAS-07 revocation returns only the affected session to login', async () => {
      const result = await api.request('admins', { method: 'PATCH', token: master.body.token,
        body: { id: users.b.id, revoke_sessions: true, revoke_reason: 'Isolated expense acceptance' } });
      expect(result.status).toBe(200);
      await expect(b.page.locator('#loginPage')).toBeVisible();
      await expect(a.page.locator('#loginPage')).toBeHidden();
      await login(b, 'b');
      await expect(frame(b).locator('#costsReadOnlyNote')).toBeVisible();
      await expect(row(b, replacement.cost_number).locator('.money-strong')).toHaveText('USD 1,400.00');
      expect(Number((await f.one('select count(*) as n from cost_charges')).n)).toBe(3);
    });
    expect(evidence.checkpoints).toHaveLength(7);
    expect(evidence.errors).toEqual([]);
    expect(evidence.external).toEqual([]);
    expect(evidence.failedResponses).toEqual([]);
  } finally {
    fs.mkdirSync(info.outputDir, { recursive: true });
    const path = info.outputPath('costs-shell-evidence.json');
    fs.writeFileSync(path, JSON.stringify(evidence, null, 2));
    await info.attach('costs-shell-evidence', { path, contentType: 'application/json' });
    for (const [index, context] of contexts.entries()) {
      for (const page of context.pages()) {
        try { await page.screenshot({ path: info.outputPath(`final-${index}.png`), timeout: 5000 }); } catch {}
      }
    }
    await Promise.allSettled(contexts.map(context => context.close()));
    globalThis.fetch = nativeFetch;
    try { await api?.close(); } finally { await db.end(); }
  }
});
