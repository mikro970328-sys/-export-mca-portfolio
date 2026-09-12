const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.ERP_BASE_URL || 'https://admin.exportmca.com';
const ERP_ORIGIN = new URL(BASE_URL).origin;
const REQUIRED_SECRETS = ['ERP_E2E_USERNAME', 'ERP_E2E_PASSWORD'];
const ALLOWED_API_WRITES = new Set(['POST /api/login']);
const ERROR_MARKERS = /(?:SALES|PURCHASE|WAREHOUSE|INVENTORY|LOADS|CLIENT)[A-Z0-9_]*_(?:FAILED|ERROR)|CLIENTS_MARKUP_MISSING|(?:Type|Reference|Syntax)Error|Uncaught/i;

const EMBEDDED_SURFACES = [
  {
    sectionId:'salesSection',
    label:'Ventas',
    owner:'sales.js',
    heading:'#salesPageTitle',
    headingText:'Ventas',
    hero:'.sales-page-head',
    summary:'.sales-metrics',
    panel:'.sales-list-panel',
    ready:'#orderList',
    readyMode:'content'
  },
  {
    sectionId:'purchasesSection',
    label:'Compras',
    owner:'purchases.js',
    heading:'#purchasesPageTitle',
    headingText:'Compras',
    hero:'.purchases-page-head',
    summary:'.purchases-metrics',
    panel:'.purchases-list-panel',
    ready:'#orderList',
    readyMode:'content'
  },
  {
    sectionId:'warehouseSection',
    label:'Recepciones WR',
    owner:'warehouse.js',
    heading:'#warehousePageTitle',
    headingText:'Recepciones (WR)',
    hero:'.warehouse-page-head',
    summary:'.warehouse-metrics',
    panel:'.warehouse-list-panel',
    ready:'#receiptList',
    readyMode:'content'
  },
  {
    sectionId:'inventorySection',
    label:'Existencias',
    owner:'inventory.js',
    heading:'#inventoryPageTitle',
    headingText:'Existencias',
    hero:'.inventory-page-head',
    summary:'.inventory-metrics',
    panel:'.inventory-list-panel',
    ready:'#stockCount',
    readyMode:'settled-text'
  },
  {
    sectionId:'loadsSection',
    label:'Cargues',
    owner:'loads.js',
    heading:'#loadsPageTitle',
    headingText:'Cargues',
    hero:'.loads-page-head',
    summary:'.loads-metrics',
    panel:'.loads-list-panel',
    ready:'#loadCount',
    readyMode:'settled-text'
  }
];

function sanitize(value) {
  return String(value || '')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[id]')
    .replace(/[A-Z]{4}\d{7}/g, '[container]')
    .slice(0, 500);
}

function installReadOnlyDiagnostics(page) {
  const diagnostics = { apiResponses:[], failedRequests:[], blockedWrites:[], consoleErrors:[], pageErrors:[] };
  page.on('request', request => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (url.origin !== ERP_ORIGIN || !url.pathname.startsWith('/api/')) return;
    const method = request.method().toUpperCase();
    const signature = `${method} ${url.pathname}`;
    if (!['GET','HEAD','OPTIONS'].includes(method) && !ALLOWED_API_WRITES.has(signature)) diagnostics.blockedWrites.push(signature);
  });
  page.on('response', response => {
    let url;
    try { url = new URL(response.url()); } catch { return; }
    if (url.origin !== ERP_ORIGIN || !url.pathname.startsWith('/api/')) return;
    diagnostics.apiResponses.push({ method:response.request().method().toUpperCase(), path:url.pathname, status:response.status() });
  });
  page.on('requestfailed', request => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (url.origin !== ERP_ORIGIN || !url.pathname.startsWith('/api/')) return;
    diagnostics.failedRequests.push({ method:request.method().toUpperCase(), path:url.pathname, reason:sanitize(request.failure()?.errorText) });
  });
  page.on('console', message => { if (message.type() === 'error') diagnostics.consoleErrors.push(sanitize(message.text())); });
  page.on('pageerror', error => diagnostics.pageErrors.push(sanitize(error?.message || error)));
  return diagnostics;
}

async function openSection(page, sectionId) {
  const button = page.locator(`[data-section="${sectionId}"]`).first();
  if (!(await button.isVisible())) {
    const mobileMenu = page.locator('#mobileMenuBtn');
    if (await mobileMenu.isVisible()) {
      const open = await page.locator('#sidebar').evaluate(node => node.classList.contains('mobile-open'));
      if (!open) await mobileMenu.click();
    }
  }
  if (!(await button.isVisible())) {
    const group = button.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " nav-group ")][1]');
    if (await group.count()) {
      const groupButton = group.locator(':scope > .nav-group-btn');
      if (await groupButton.isVisible() && await groupButton.getAttribute('aria-expanded') !== 'true') await groupButton.click();
    }
  }
  await expect(button, `Navigation control for ${sectionId}`).toBeVisible();
  await button.click();
  const section = page.locator(`#${sectionId}`);
  await expect(section).toBeVisible();
  return section;
}

async function assertOuterOwner(page, sectionId) {
  const state = await page.evaluate(expected => {
    const visible = node => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    return {
      visibleSections:[...document.querySelectorAll('.app-section')].filter(visible).map(node => node.id),
      visibleFrames:[...document.querySelectorAll('iframe')].filter(visible).length,
      clientWidth:document.documentElement.clientWidth,
      scrollWidth:document.documentElement.scrollWidth,
      expected
    };
  }, sectionId);
  if (state.visibleSections.length !== 1 || state.visibleSections[0] !== sectionId || state.scrollWidth !== state.clientWidth) {
    throw new Error(`${sectionId}: outer owner or viewport containment failed`);
  }
  return state;
}

async function waitForEmbeddedSurface(frameElement, config) {
  const deadline = Date.now() + 30_000;
  let state = null;
  while (Date.now() < deadline) {
    state = await frameElement.evaluate((frame, cfg) => {
      const doc = frame.contentDocument;
      const html = doc?.documentElement;
      if (!doc || !html) return null;
      const visible = node => {
        if (!node) return false;
        const style = frame.contentWindow.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const fits = node => {
        if (!visible(node)) return false;
        const rect = node.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= html.clientWidth + 1;
      };
      const readyNode = doc.querySelector(cfg.ready);
      const readyText = readyNode?.textContent?.trim() || '';
      const ready = cfg.readyMode === 'settled-text'
        ? Boolean(readyText && !/Consultando|Cargando|Preparando/i.test(readyText))
        : Boolean(readyNode && (readyNode.children.length > 0 || readyText.length > 0));
      const summary = doc.querySelector(cfg.summary);
      return {
        owner:doc.body?.dataset?.owner || '',
        heading:doc.querySelector(cfg.heading)?.textContent?.trim() || '',
        duplicateLogin:Boolean(doc.getElementById('loginPage')),
        clientWidth:html.clientWidth,
        scrollWidth:html.scrollWidth,
        heroFits:fits(doc.querySelector(cfg.hero)),
        summaryFits:fits(summary),
        summaryItems:summary?.children.length || 0,
        panelFits:fits(doc.querySelector(cfg.panel)),
        ready,
        readyText
      };
    }, config);
    if (state?.duplicateLogin || (state?.owner === config.owner && state?.heading === config.headingText && state?.ready)) return state;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${config.label}: no alcanzó un estado legible`);
}

async function attachScreenshot(page, testInfo, name) {
  const body = await page.screenshot({ fullPage:false });
  await testInfo.attach(name, { body, contentType:'image/png' });
}

test('UX-7 operational workspaces are read-only and contained on real iPhone Safari', async ({ page }, testInfo) => {
  for (const name of REQUIRED_SECRETS) if (!process.env[name]) throw new Error(`Missing required secret: ${name}`);
  const diagnostics = installReadOnlyDiagnostics(page);

  await page.goto(BASE_URL, { waitUntil:'domcontentloaded' });
  await expect(page.locator('#username')).toBeVisible();
  await page.locator('#username').fill(process.env.ERP_E2E_USERNAME);
  await page.locator('#password').fill(process.env.ERP_E2E_PASSWORD);
  const loginResponse = page.waitForResponse(response => {
    try {
      const url = new URL(response.url());
      return url.origin === ERP_ORIGIN && url.pathname === '/api/login' && response.request().method() === 'POST';
    } catch { return false; }
  });
  await page.locator('#login').click();
  const response = await loginResponse;
  if (response.status() !== 200) throw new Error(`ERP login failed with HTTP ${response.status()}`);
  await expect(page.locator('#appShell')).toBeVisible();

  await test.step('Clientes uses its canonical native owner', async () => {
    await openSection(page, 'clientsSection');
    await expect(page.locator('#clients')).not.toContainText('Cargando clientes', { timeout:30_000 });
    const state = await page.locator('#clientsSection').evaluate(section => {
      const visible = node => {
        if (!node) return false;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const fits = node => {
        if (!visible(node)) return false;
        const rect = node.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1;
      };
      const summary = [...section.querySelectorAll('.clients-summary-card')];
      return {
        owner:window.ClientsModule?.owner || '',
        heroFits:fits(section.querySelector('.clients-hero')),
        summaryCount:summary.length,
        summaryFits:summary.length === 3 && summary.every(fits),
        directoryFits:fits(section.querySelector('.clients-directory')),
        searchType:section.querySelector('#clientSearch')?.getAttribute('type') || '',
        visibleDialogs:[...document.querySelectorAll('.client-overlay,.client-editor-overlay')].filter(visible).length
      };
    });
    if (state.owner !== 'clients-module.js' || !state.heroFits || state.summaryCount !== 3 || !state.summaryFits || !state.directoryFits || state.searchType !== 'search' || state.visibleDialogs) {
      throw new Error(`Clientes: canonical responsive owner failed ${sanitize(JSON.stringify(state))}`);
    }
    const outer = await assertOuterOwner(page, 'clientsSection');
    if (outer.visibleFrames !== 0) throw new Error('Clientes unexpectedly mounts an embedded page');
    await attachScreenshot(page, testInfo, 'clients-operations-iphone-safari');
  });

  for (const config of EMBEDDED_SURFACES) {
    await test.step(`${config.label} uses one contained embedded owner`, async () => {
      await openSection(page, config.sectionId);
      const frameElement = page.locator(`#${config.sectionId} iframe`);
      await expect(frameElement).toBeVisible();
      const state = await waitForEmbeddedSurface(frameElement, config);
      if (state.duplicateLogin) throw new Error(`${config.label}: duplicate login inside embedded workspace`);
      if (state.owner !== config.owner || state.heading !== config.headingText) throw new Error(`${config.label}: canonical owner mismatch`);
      if (state.scrollWidth !== state.clientWidth) throw new Error(`${config.label}: horizontal iframe overflow`);
      if (!state.heroFits || !state.summaryFits || state.summaryItems < 1 || !state.panelFits) {
        throw new Error(`${config.label}: responsive regions do not fit the iPhone viewport`);
      }
      const outer = await assertOuterOwner(page, config.sectionId);
      if (outer.visibleFrames !== 1) throw new Error(`${config.label}: expected exactly one visible iframe`);
      await attachScreenshot(page, testInfo, `${config.sectionId}-operations-iphone-safari`);
    });
  }

  const fatalConsoleErrors = diagnostics.consoleErrors.filter(message => ERROR_MARKERS.test(message));
  const serverFailures = diagnostics.apiResponses.filter(item => item.status >= 500);
  if (diagnostics.blockedWrites.length) throw new Error(`Read-only contract violated: ${[...new Set(diagnostics.blockedWrites)].join(', ')}`);
  if (diagnostics.failedRequests.length) throw new Error(`Operational API request failed: ${sanitize(JSON.stringify(diagnostics.failedRequests))}`);
  if (serverFailures.length) throw new Error(`Operational API returned 5xx: ${sanitize(JSON.stringify(serverFailures))}`);
  if (fatalConsoleErrors.length || diagnostics.pageErrors.length) {
    throw new Error(`Operational UI emitted fatal errors: ${sanitize(JSON.stringify({ fatalConsoleErrors, pageErrors:diagnostics.pageErrors }))}`);
  }
});
