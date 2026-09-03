const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.ERP_BASE_URL || 'https://admin.exportmca.com';
const ERP_ORIGIN = new URL(BASE_URL).origin;
const REQUIRED_SECRETS = ['ERP_E2E_USERNAME', 'ERP_E2E_PASSWORD'];
const ALLOWED_API_WRITES = new Set(['POST /api/login']);
const CERT_SCOPE = process.env.ERP_CERT_SCOPE || 'all';
if (!['all', 'core', 'costs'].includes(CERT_SCOPE)) throw new Error(`Invalid ERP_CERT_SCOPE: ${CERT_SCOPE}`);
const RUN_CORE = CERT_SCOPE !== 'costs';
const RUN_COSTS = CERT_SCOPE !== 'core';
const PROFITABILITY_STATUS_ATTRIBUTE = 'data-profitability-probe-status';
const PROFITABILITY_STATE_ATTRIBUTE = 'data-profitability-probe-state';
const ERP_ERROR_MARKERS = /COSTS_INITIAL_LOAD_FAILED|COSTS_(?:REFRESH|UI)_FAILED|PROFITABILITY_LOAD_FAILED|INVOICES_UI_FAILED|PAYABLES_UI_FAILED|PUBLICATIONS_UI_FAILED|CONTAINER_[A-Z_]+_FAILED|\[admin (?:boot|dashboard|secondary modules)\]|(?:Type|Reference|Syntax)Error|Uncaught/i;

function sanitizeLog(value) {
  return String(value || '')
    .replace(/[A-Z]{4}\d{7}/g, '[container]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[id]')
    .slice(0, 600);
}

function installReadOnlyDiagnostics(page) {
  const diagnostics = {
    apiResponses: [],
    failedRequests: [],
    blockedWrites: [],
    consoleErrors: [],
    pageErrors: [],
    checkpoints: []
  };

  page.on('request', request => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (url.origin !== ERP_ORIGIN || !url.pathname.startsWith('/api/')) return;
    const signature = `${request.method().toUpperCase()} ${url.pathname}`;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method().toUpperCase()) && !ALLOWED_API_WRITES.has(signature)) {
      diagnostics.blockedWrites.push(signature);
    }
  });

  page.on('response', response => {
    let url;
    try { url = new URL(response.url()); } catch { return; }
    if (url.origin !== ERP_ORIGIN || !url.pathname.startsWith('/api/')) return;
    diagnostics.apiResponses.push({
      method: response.request().method().toUpperCase(),
      path: url.pathname,
      status: response.status()
    });
  });

  page.on('requestfailed', request => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (url.origin !== ERP_ORIGIN || !url.pathname.startsWith('/api/')) return;
    diagnostics.failedRequests.push({
      method: request.method().toUpperCase(),
      path: url.pathname,
      reason: sanitizeLog(request.failure()?.errorText)
    });
  });

  page.on('console', message => {
    if (message.type() !== 'error') return;
    diagnostics.consoleErrors.push(sanitizeLog(message.text()));
  });

  page.on('pageerror', error => diagnostics.pageErrors.push(sanitizeLog(error?.message || error)));
  return diagnostics;
}

async function attachPrivateScreenshot(page, testInfo, name) {
  const body = await page.screenshot({ fullPage: false });
  await testInfo.attach(name, { body, contentType: 'image/png' });
}

async function documentGeometry(page) {
  return page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight
  }));
}

async function assertNoDocumentOverflow(page, label) {
  const geometry = await documentGeometry(page);
  if (geometry.scrollWidth !== geometry.clientWidth) {
    throw new Error(`${label}: document scrollWidth ${geometry.scrollWidth} != clientWidth ${geometry.clientWidth}`);
  }
  return geometry;
}

async function assertElementsFitViewport(locator, label) {
  const result = await locator.evaluateAll(elements => {
    const width = window.innerWidth;
    const visible = elements
      .map((element, index) => ({ index, rect: element.getBoundingClientRect(), style: getComputedStyle(element) }))
      .filter(item => item.style.display !== 'none' && item.style.visibility !== 'hidden' && item.rect.width > 0);
    const outside = visible.filter(item => item.rect.left < -1 || item.rect.right > width + 1);
    return { total: elements.length, visible: visible.length, outside: outside.map(item => item.index), width };
  });
  if (result.visible === 0 || result.outside.length) {
    throw new Error(`${label}: ${result.visible} visible; outside viewport indexes ${result.outside.join(',') || 'none'}`);
  }
  return result;
}

async function assertOneVisibleSection(page, expectedSection) {
  const ownerState = await page.evaluate(() => {
    const visible = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    return {
      sections: [...document.querySelectorAll('.app-section')].filter(visible).map(element => element.id),
      loginVisible: visible(document.getElementById('loginPage')),
      visibleFrames: [...document.querySelectorAll('iframe')].filter(visible).length
    };
  });
  if (ownerState.loginVisible || ownerState.sections.length !== 1 || ownerState.sections[0] !== expectedSection) {
    throw new Error(`Visual owner mismatch for ${expectedSection}`);
  }
  return ownerState;
}

async function waitForEmbeddedState(page, frameElement, label, reader, ready) {
  const deadline = Date.now() + 30_000;
  let state = null;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      state = await frameElement.evaluate(reader);
      if (ready(state)) return state;
    } catch (error) {
      lastError = sanitizeLog(error?.message || error);
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`${label} did not reach a readable ready state${lastError ? `: ${lastError}` : ''}`);
}

async function installProfitabilityProbe(frameElement) {
  return frameElement.evaluate(frame => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) return { installed: false, opened: false };

    let opened = false;
    let timeoutId = 0;
    const updateProbe = timedOut => {
      const html = doc.documentElement;
      const content = doc.getElementById('content');
      const state = {
        opened,
        ready: Boolean(content?.querySelector('.profit-shell')),
        metricCount: content?.querySelectorAll('.profit-metric').length || 0,
        selectedView: doc.querySelector('[data-view="profitability"]')?.getAttribute('aria-pressed') || '',
        clientWidth: html?.clientWidth || 0,
        scrollWidth: html?.scrollWidth || 0,
        error: content?.textContent?.includes('No se pudo cargar la rentabilidad') === true,
        timedOut: Boolean(timedOut)
      };
      const status = state.ready ? 'ready' : state.error ? 'error' : state.timedOut ? 'timeout' : 'pending';
      frame.setAttribute('data-profitability-probe-status', status);
      frame.setAttribute('data-profitability-probe-state', JSON.stringify(state));
      if (status !== 'pending' && timeoutId) win.clearTimeout(timeoutId);
      return status;
    };

    frame.removeAttribute('data-profitability-probe-status');
    frame.removeAttribute('data-profitability-probe-state');
    const observer = new win.MutationObserver(() => {
      if (updateProbe(false) !== 'pending') observer.disconnect();
    });
    observer.observe(doc.getElementById('content') || doc.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    opened = win.CostsModule?.openProfitability('sales_orders') === true;
    if (updateProbe(false) === 'pending') {
      timeoutId = win.setTimeout(() => {
        updateProbe(true);
        observer.disconnect();
      }, 35_000);
    } else {
      observer.disconnect();
    }
    return { installed: true, opened };
  });
}

async function openSection(page, sectionId) {
  const sectionButton = page.locator(`[data-section="${sectionId}"]`).first();
  const section = page.locator(`#${sectionId}`);

  if (!(await sectionButton.isVisible())) {
    const mobileMenu = page.locator('#mobileMenuBtn');
    if (await mobileMenu.isVisible()) {
      const menuOpen = await page.locator('#sidebar').evaluate(element => element.classList.contains('mobile-open'));
      if (!menuOpen) await mobileMenu.click();
    }
  }

  if (!(await sectionButton.isVisible())) {
    const group = sectionButton.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " nav-group ")][1]');
    if (await group.count()) {
      const groupButton = group.locator(':scope > .nav-group-btn');
      if (await groupButton.isVisible()) await groupButton.click();
    }
  }

  await expect(sectionButton, `Navigation control for ${sectionId}`).toBeVisible();
  await sectionButton.click();
  await expect(section, `${sectionId} should be visible`).toBeVisible();
  const overlayClasses = (await page.locator('#mobileOverlay').getAttribute('class')) || '';
  expect(overlayClasses).not.toMatch(/(?:^|\s)show(?:\s|$)/);
  return section;
}

function expectedGreeting(hour) {
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

test(`UX-7 ${CERT_SCOPE} production is read-only and usable on real iPhone Safari`, async ({ page }, testInfo) => {
  for (const name of REQUIRED_SECRETS) {
    if (!process.env[name]) throw new Error(`Missing required secret: ${name}`);
  }

  const diagnostics = installReadOnlyDiagnostics(page);
  const checkpoint = (name, detail = {}) => diagnostics.checkpoints.push({ name, ...detail });

  try {
    await test.step('Authenticate without exposing credentials', async () => {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
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
      await expect(page.locator('#loginPage')).toBeHidden();
      await expect(page.locator('#dashboardGreeting')).toBeVisible();
      checkpoint('authenticated', { status: response.status() });
    });

    if (RUN_CORE) await test.step('Dashboard greeting and responsive owner', async () => {
      await assertOneVisibleSection(page, 'dashboardSection');
      const geometry = await assertNoDocumentOverflow(page, 'Dashboard');
      const localState = await page.evaluate(() => {
        const user = JSON.parse(localStorage.getItem('export_mca_user') || 'null');
        return {
          hour: new Date().getHours(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          firstName: String(user?.full_name || user?.username || 'equipo').trim().split(/\s+/)[0] || 'equipo'
        };
      });
      const greeting = (await page.locator('#dashboardGreeting').textContent() || '').trim();
      const wanted = `${expectedGreeting(localState.hour)}, ${localState.firstName}`;
      if (greeting !== wanted) throw new Error(`Dashboard greeting mismatch for local hour ${localState.hour}`);
      await attachPrivateScreenshot(page, testInfo, 'dashboard-iphone-safari');
      checkpoint('dashboard', { geometry, hour: localState.hour, timeZone: localState.timeZone, greeting: expectedGreeting(localState.hour) });
    });

    if (RUN_CORE) await test.step('PWA prerequisites available in Safari', async () => {
      const pwa = await page.evaluate(async () => {
        const link = document.querySelector('link[rel="manifest"]');
        const response = await fetch(link?.href || '/admin/manifest.webmanifest', { cache: 'no-store' });
        const manifest = await response.json();
        let registration = null;
        let registrationError = '';
        if ('serviceWorker' in navigator) {
          try {
            registration = await navigator.serviceWorker.getRegistration();
            if (!registration) registration = await navigator.serviceWorker.register('/sw.js');
          } catch (error) {
            registrationError = String(error?.message || error);
          }
        }
        return {
          manifestStatus: response.status,
          name: manifest.name,
          startUrl: manifest.start_url,
          scope: manifest.scope,
          display: manifest.display,
          iconCount: Array.isArray(manifest.icons) ? manifest.icons.length : 0,
          serviceWorkerSupported: 'serviceWorker' in navigator,
          serviceWorkerScope: registration?.scope || '',
          registrationError
        };
      });
      if (pwa.manifestStatus !== 200 || pwa.name !== 'Export MCA ERP' || pwa.startUrl !== '/admin/pwa.html' || pwa.scope !== '/admin/' || pwa.display !== 'standalone' || pwa.iconCount < 1) {
        throw new Error('PWA manifest contract is incomplete');
      }
      if (!pwa.serviceWorkerSupported || !pwa.serviceWorkerScope || pwa.registrationError) {
        throw new Error('PWA service worker could not register in Safari');
      }
      checkpoint('pwa-prerequisites', { ...pwa, registrationError: pwa.registrationError ? 'present' : '' });
    });

    if (RUN_CORE) await test.step('Navigation uses one canonical SVG icon system', async () => {
      const mobileMenu = page.locator('#mobileMenuBtn');
      if (await mobileMenu.isVisible()) {
        const menuOpen = await page.locator('#sidebar').evaluate(element => element.classList.contains('mobile-open'));
        if (!menuOpen) await mobileMenu.click();
        const sidebarClasses = (await page.locator('#sidebar').getAttribute('class')) || '';
        if (!/(?:^|\s)mobile-open(?:\s|$)/.test(sidebarClasses)) throw new Error('Mobile navigation did not open');
      }

      for (const groupName of ['commercial', 'operations']) {
        const groupButton = page.locator(`.nav-group[data-nav-group="${groupName}"]:not(.hidden) > .nav-group-btn`);
        if (await groupButton.count() && await groupButton.getAttribute('aria-expanded') !== 'true') await groupButton.click();
      }
      await page.locator('.sidebar-nav').evaluate(element => { element.scrollTop = 0; });

      const state = await page.evaluate(() => {
        window.ExportMcaIcons?.hydrate?.(document);
        const controls = [...document.querySelectorAll('#sidebar [data-nav-label]')];
        const visible = element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const failures = controls.flatMap(control => {
          const label = control.dataset.navLabel || 'sin-etiqueta';
          const holder = control.querySelector('.nav-icon');
          const icons = holder ? [...holder.querySelectorAll(':scope > svg[data-ui-icon]')] : [];
          const text = holder ? [...holder.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent || '').join('').trim() : '';
          const icon = icons[0];
          const rect = icon?.getBoundingClientRect();
          const reasons = [];
          if (!holder) reasons.push('sin-contenedor');
          if (holder?.dataset.iconMissing === 'true') reasons.push('sin-mapeo');
          if (icons.length !== 1) reasons.push(`svg-${icons.length}`);
          if (text) reasons.push('texto-heredado');
          if (icon?.getAttribute('aria-hidden') !== 'true' || icon?.getAttribute('focusable') !== 'false') reasons.push('accesibilidad');
          if (visible(control) && (!rect || rect.width < 19 || rect.width > 22 || rect.height < 19 || rect.height > 22 || rect.left < -1 || rect.right > document.documentElement.clientWidth + 1)) reasons.push('geometria');
          return reasons.length ? [{ label, reasons }] : [];
        });
        const menuButtons = ['sidebarToggle', 'mobileMenuBtn'].map(id => document.getElementById(id)).filter(Boolean);
        const bell = document.getElementById('operationalAlertBell');
        return {
          owner: window.ExportMcaIcons?.owner || '',
          controls: controls.length,
          visibleControls: controls.filter(visible).length,
          failures,
          menuButtonsCanonical: menuButtons.every(button => button.querySelectorAll(':scope > svg[data-ui-icon="menu"]').length === 1),
          bellCanonical: !bell || bell.querySelectorAll(':scope > svg[data-ui-icon="bell"]').length === 1,
          legacyGlyphs: /[⌂▣●＋◎▦✉♟◉↪▥◫◩▤▧▨▩◇⇄🔔]/u.test(document.querySelector('#sidebar')?.textContent || ''),
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth
        };
      });

      if (state.owner !== 'ui-icon-system.js' || state.controls < 10 || state.visibleControls < 4 || state.failures.length || !state.menuButtonsCanonical || !state.bellCanonical || state.legacyGlyphs || state.scrollWidth !== state.clientWidth) {
        throw new Error(`Canonical navigation icon contract failed: ${sanitizeLog(JSON.stringify(state))}`);
      }
      await attachPrivateScreenshot(page, testInfo, 'navigation-icons-iphone-safari');
      await page.evaluate(() => window.NavigationShell?.closeMobile?.());
      checkpoint('canonical-navigation-icons', {
        owner: state.owner,
        controls: state.controls,
        visibleControls: state.visibleControls,
        legacyGlyphs: false,
        overflow: false
      });
    });

    if (RUN_CORE) await test.step('Tracking has no page overflow and uses one visual owner', async () => {
      await openSection(page, 'containersSection');
      await expect(page.locator('#trackingTitle')).toBeVisible();
      await expect(page.locator('#trackingTotalCount')).not.toHaveText('—');
      await expect(page.locator('#trackingResultCount')).not.toHaveText(/Consultando/);
      await assertOneVisibleSection(page, 'containersSection');
      const geometry = await assertNoDocumentOverflow(page, 'Tracking');
      await assertElementsFitViewport(page.locator('.tracking-hero'), 'Tracking hero');
      await assertElementsFitViewport(page.locator('.tracking-hero-state'), 'Tracking status');
      const metrics = await assertElementsFitViewport(page.locator('.tracking-metrics article'), 'Tracking metrics');
      if (metrics.total !== 5) throw new Error(`Tracking metric count ${metrics.total} != 5`);

      const presentation = await page.evaluate(() => {
        const visible = selector => {
          const node = document.querySelector(selector);
          if (!node) return false;
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const wrapper = document.querySelector('.tracking-table-wrap');
        return {
          tableVisible: visible('.tracking-table-wrap'),
          mobileCardsVisible: visible('.tracking-mobile-list'),
          tableClientWidth: wrapper?.clientWidth || 0,
          tableScrollWidth: wrapper?.scrollWidth || 0
        };
      });
      if (!presentation.mobileCardsVisible && !presentation.tableVisible) throw new Error('Tracking has no visible result presentation');
      if (presentation.tableVisible && presentation.tableScrollWidth < presentation.tableClientWidth) throw new Error('Tracking table internal scroll contract is invalid');

      await attachPrivateScreenshot(page, testInfo, 'tracking-iphone-safari');
      checkpoint('tracking', { geometry, metrics: metrics.total, ...presentation });
    });

    if (RUN_CORE) await test.step('Action menu matches backend capabilities and detail is read-only', async () => {
      const trigger = page.locator('.container-actions-trigger:visible').first();
      await expect(trigger).toBeVisible();
      const shipmentId = await trigger.getAttribute('data-container-menu');
      await trigger.click();
      const menu = page.locator('#containerActionsPopover:not(.hidden)');
      await expect(menu).toBeVisible();

      const actualActions = await menu.locator('[data-container-action]').evaluateAll(buttons => buttons.map(button => button.dataset.containerAction));
      const expectedActions = await page.evaluate(id => {
        const shipment = (window.shipments || []).find(row => String(row.id) === String(id));
        const definitions = [
          ['view_info', 'info'],
          ['view_documents', 'documents'],
          ['edit', 'edit'],
          ['view_history', 'history'],
          ['assign_client', 'assign_client'],
          ['manual_tracking', 'manual_update'],
          ['release', 'release'],
          ['deliver', 'deliver'],
          ['reactivate', 'reactivate'],
          ['delete', 'delete']
        ];
        return definitions
          .filter(([capability]) => shipment?.capabilities?.actions?.[capability]?.allowed === true)
          .map(([, action]) => action);
      }, shipmentId);
      if (JSON.stringify(actualActions) !== JSON.stringify(expectedActions)) {
        throw new Error('Tracking action menu does not exactly match backend capabilities');
      }
      await attachPrivateScreenshot(page, testInfo, 'tracking-actions-iphone-safari');

      const detailAction = actualActions.includes('info') ? 'info' : actualActions.includes('documents') ? 'documents' : '';
      if (!detailAction) throw new Error('No read-only detail capability is available for the selected container');
      await menu.locator(`[data-container-action="${detailAction}"]`).click();
      await expect(page.locator('#modal:not(.hidden)')).toBeVisible();
      await expect(page.locator('#modalBody .tracking-dialog-root')).toBeVisible();
      await attachPrivateScreenshot(page, testInfo, 'tracking-detail-iphone-safari');
      await page.locator('#closeModal').click();
      const modalClasses = ((await page.locator('#modal').getAttribute('class')) || '').split(/\s+/);
      expect(modalClasses).toContain('hidden');
      checkpoint('tracking-actions-and-detail', { actions: actualActions, detailAction });
    });

    if (RUN_CORE) await test.step('Register container renders but is never submitted', async () => {
      await openSection(page, 'registerContainerSection');
      await expect(page.locator('#registerContainerTitle')).toHaveText('Registrar contenedor');
      await expect(page.locator('#shipmentRegistrationForm')).toBeVisible();
      const containerValue = await page.locator('#shipmentContainer').inputValue();
      expect(containerValue).toBe('');
      await expect(page.locator('#saveShipment')).toBeVisible();
      await assertOneVisibleSection(page, 'registerContainerSection');
      const geometry = await assertNoDocumentOverflow(page, 'Registrar contenedor');
      await assertElementsFitViewport(page.locator('.tracking-register-hero'), 'Registration hero');
      await attachPrivateScreenshot(page, testInfo, 'register-container-iphone-safari');
      checkpoint('register-container-readonly', { geometry, submitted: false });
    });

    if (RUN_CORE) await test.step('Commercial publications stays embedded without duplicate login', async () => {
      await openSection(page, 'publicationsSection');
      const frameElement = page.locator('#publicationsSection iframe');
      await expect(frameElement).toBeVisible();
      const publicationsState = await waitForEmbeddedState(page, frameElement, 'Publications iframe', frame => {
        const doc = frame.contentDocument;
        const html = doc?.documentElement;
        const metric = doc?.getElementById('totalMetric')?.textContent?.trim() || '';
        return {
          title: doc?.getElementById('publicationsTitle')?.textContent?.trim() || '',
          metricReady: Boolean(metric && metric !== '—'),
          duplicateLogin: Boolean(doc?.getElementById('loginPage')),
          clientWidth: html?.clientWidth || 0,
          scrollWidth: html?.scrollWidth || 0,
          messageError: doc?.getElementById('pageMessage')?.classList.contains('is-error') === true
        };
      }, state => state?.duplicateLogin || (state?.title === 'Publicaciones' && state.metricReady));
      if (publicationsState.duplicateLogin) throw new Error('Duplicate login found inside Publications');
      const owner = await assertOneVisibleSection(page, 'publicationsSection');
      if (owner.visibleFrames !== 1) throw new Error('Publications has more than one visible embedded page');
      const outerGeometry = await assertNoDocumentOverflow(page, 'Publicaciones outer shell');
      const innerGeometry = { clientWidth: publicationsState.clientWidth, scrollWidth: publicationsState.scrollWidth };
      if (innerGeometry.scrollWidth !== innerGeometry.clientWidth) throw new Error('Publications iframe has horizontal document overflow');
      if (publicationsState.messageError) throw new Error('Publications displayed an error state');
      await attachPrivateScreenshot(page, testInfo, 'publications-iphone-safari');
      checkpoint('publications', { outerGeometry, innerGeometry, visibleFrames: owner.visibleFrames, duplicateLogin: false });
    });

    if (RUN_CORE) await test.step('Invoices stays embedded, responsive and read-only', async () => {
      await openSection(page, 'invoicesSection');
      const frameElement = page.locator('#invoicesSection iframe');
      await expect(frameElement).toBeVisible();
      const invoicesState = await waitForEmbeddedState(page, frameElement, 'Invoices iframe', frame => {
        const doc = frame.contentDocument;
        const html = doc?.documentElement;
        const fits = node => {
          if (!node || !html) return false;
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.left >= -1 && rect.right <= html.clientWidth + 1;
        };
        const metrics = [...(doc?.querySelectorAll('.invoices-metrics .metric') || [])];
        const table = doc?.querySelector('.invoices-table-wrap');
        const result = doc?.getElementById('invoiceResultCount')?.textContent?.trim() || '';
        return {
          heading: doc?.getElementById('invoicesPageTitle')?.textContent?.trim() || '',
          resultReady: Boolean(result && !result.includes('Consultando')),
          duplicateLogin: Boolean(doc?.getElementById('loginPage')),
          owner: doc?.body?.dataset?.owner || '',
          clientWidth: html?.clientWidth || 0,
          scrollWidth: html?.scrollWidth || 0,
          heroFits: fits(doc?.querySelector('.invoices-page-head')),
          statusFits: fits(doc?.querySelector('.invoices-hero-state')),
          metricsFit: metrics.length === 5 && metrics.every(fits),
          metricCount: metrics.length,
          panelFits: fits(doc?.querySelector('.invoices-list-panel')),
          tableClientWidth: table?.clientWidth || 0,
          tableScrollWidth: table?.scrollWidth || 0,
          tableOverflowX: table ? getComputedStyle(table).overflowX : '',
          newInvoiceVisible: fits(doc?.getElementById('newInvoice')),
          moduleMethods: ['openInvoice', 'openCollection', 'openForSalesOrder'].every(name => typeof frame.contentWindow?.InvoicesModule?.[name] === 'function')
        };
      }, state => state?.duplicateLogin || (state?.heading === 'Facturación y cobros' && state.resultReady));

      if (invoicesState.duplicateLogin) throw new Error('Duplicate login found inside Invoices');
      if (invoicesState.owner !== 'invoices.js' || !invoicesState.moduleMethods) throw new Error('Invoices does not expose its canonical visual owner');
      if (invoicesState.scrollWidth !== invoicesState.clientWidth) throw new Error('Invoices iframe has horizontal document overflow');
      if (!invoicesState.heroFits || !invoicesState.statusFits || !invoicesState.metricsFit || !invoicesState.panelFits) throw new Error('Invoices responsive regions do not fit the iPhone viewport');
      if (invoicesState.metricCount !== 5) throw new Error(`Invoices metric count ${invoicesState.metricCount} != 5`);
      if (invoicesState.tableScrollWidth > invoicesState.tableClientWidth && !['auto', 'scroll'].includes(invoicesState.tableOverflowX)) throw new Error('Invoices internal table overflow is not contained');
      if (!invoicesState.newInvoiceVisible) throw new Error('Invoices create control is not visible for the certification account');

      const ownerState = await assertOneVisibleSection(page, 'invoicesSection');
      if (ownerState.visibleFrames !== 1) throw new Error('Invoices has more than one visible embedded page');
      const outerGeometry = await assertNoDocumentOverflow(page, 'Facturación outer shell');

      const opened = await frameElement.evaluate(frame => {
        const button = frame.contentDocument?.getElementById('newInvoice');
        if (!button || button.hidden) return false;
        button.click();
        return true;
      });
      if (!opened) throw new Error('Invoices read-only form inspection could not start');
      const formState = await waitForEmbeddedState(page, frameElement, 'Invoices form', frame => {
        const doc = frame.contentDocument;
        const html = doc?.documentElement;
        const modal = doc?.getElementById('invoiceModal');
        const dialog = modal?.querySelector('.dialog');
        const rect = dialog?.getBoundingClientRect();
        const visible = modal && getComputedStyle(modal).display !== 'none' && rect && rect.width > 0;
        return {
          visible: Boolean(visible),
          selectedSale: doc?.getElementById('iSalesOrder')?.value || '',
          saveVisible: Boolean(doc?.getElementById('saveInvoice')),
          dialogFits: Boolean(visible && rect.left >= -1 && rect.right <= (html?.clientWidth || 0) + 1),
          visibleDialogs: [...(doc?.querySelectorAll('[role="dialog"]') || [])].filter(node => getComputedStyle(node).display !== 'none').length,
          clientWidth: html?.clientWidth || 0,
          scrollWidth: html?.scrollWidth || 0
        };
      }, state => state?.visible === true);
      if (formState.selectedSale || !formState.saveVisible || !formState.dialogFits || formState.visibleDialogs !== 1 || formState.scrollWidth !== formState.clientWidth) {
        throw new Error('Invoices form is not a clean, contained read-only inspection state');
      }
      await attachPrivateScreenshot(page, testInfo, 'invoices-form-iphone-safari');
      await frameElement.evaluate(frame => frame.contentDocument?.querySelector('[data-close="invoice"]')?.click());
      const closed = await frameElement.evaluate(frame => frame.contentDocument?.getElementById('invoiceModal')?.classList.contains('hidden') === true);
      if (!closed) throw new Error('Invoices form did not close without submission');

      const invoiceResponses = diagnostics.apiResponses.filter(item => item.path === '/api/invoices');
      if (!invoiceResponses.some(item => item.status === 200)) throw new Error('Invoices API did not return HTTP 200');
      checkpoint('invoices-readonly', {
        outerGeometry,
        innerGeometry: { clientWidth: invoicesState.clientWidth, scrollWidth: invoicesState.scrollWidth },
        metrics: invoicesState.metricCount,
        visibleFrames: ownerState.visibleFrames,
        apiStatus: 200,
        submitted: false
      });
    });

    if (RUN_CORE) await test.step('Payables has one owner, separates its document and remains read-only', async () => {
      await openSection(page, 'payablesSection');
      const frameElement = page.locator('#payablesSection iframe');
      await expect(frameElement).toBeVisible();
      const payablesState = await waitForEmbeddedState(page, frameElement, 'Payables iframe', frame => {
        const doc = frame.contentDocument;
        const html = doc?.documentElement;
        const fits = node => {
          if (!node || !html) return false;
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.left >= -1 && rect.right <= html.clientWidth + 1;
        };
        const metrics = [...(doc?.querySelectorAll('.payables-metrics .metric') || [])];
        const table = doc?.querySelector('.payables-table-wrap');
        const result = doc?.getElementById('payablesResultCount')?.textContent?.trim() || '';
        return {
          heading: doc?.getElementById('payablesPageTitle')?.textContent?.trim() || '',
          resultReady: Boolean(result && !result.includes('Consultando')),
          duplicateLogin: Boolean(doc?.getElementById('loginPage')),
          owner: doc?.body?.dataset?.owner || '',
          clientWidth: html?.clientWidth || 0,
          scrollWidth: html?.scrollWidth || 0,
          heroFits: fits(doc?.querySelector('.payables-page-head')),
          statusFits: fits(doc?.querySelector('.payables-hero-state')),
          metricsFit: metrics.length === 5 && metrics.every(fits),
          metricCount: metrics.length,
          panelFits: fits(doc?.querySelector('.payables-list-panel')),
          tableClientWidth: table?.clientWidth || 0,
          tableScrollWidth: table?.scrollWidth || 0,
          tableOverflowX: table ? getComputedStyle(table).overflowX : '',
          moduleMethods: ['openBill', 'openPayment', 'refresh'].every(name => typeof frame.contentWindow?.PayablesModule?.[name] === 'function'),
          injectedVisualOwners: ['apContextStyles', 'operationalContextStyles'].filter(id => Boolean(doc?.getElementById(id)))
        };
      }, state => state?.duplicateLogin || (state?.heading === 'Cuentas por pagar' && state.resultReady));

      if (payablesState.duplicateLogin) throw new Error('Duplicate login found inside Payables');
      if (payablesState.owner !== 'payables.js' || !payablesState.moduleMethods) throw new Error('Payables does not expose its canonical visual owner');
      if (payablesState.scrollWidth !== payablesState.clientWidth) throw new Error('Payables iframe has horizontal document overflow');
      if (!payablesState.heroFits || !payablesState.statusFits || !payablesState.metricsFit || !payablesState.panelFits) throw new Error('Payables responsive regions do not fit the iPhone viewport');
      if (payablesState.metricCount !== 5) throw new Error(`Payables metric count ${payablesState.metricCount} != 5`);
      if (payablesState.tableScrollWidth > payablesState.tableClientWidth && !['auto', 'scroll'].includes(payablesState.tableOverflowX)) throw new Error('Payables internal table overflow is not contained');
      if (payablesState.injectedVisualOwners.length) throw new Error(`Payables received injected visual owners: ${payablesState.injectedVisualOwners.join(', ')}`);

      const ownerState = await assertOneVisibleSection(page, 'payablesSection');
      if (ownerState.visibleFrames !== 1) throw new Error('Payables has more than one visible embedded page');
      const outerGeometry = await assertNoDocumentOverflow(page, 'Cuentas por pagar outer shell');

      const detailStarted = await frameElement.evaluate(frame => {
        const doc = frame.contentDocument;
        doc?.querySelector('[data-view="all"]')?.click();
        const detail = doc?.querySelector('[data-bill-action="detail"]') || doc?.querySelector('[data-payment-action="detail"]');
        if (!detail) return false;
        detail.click();
        return true;
      });
      if (!detailStarted) throw new Error('Payables has no read-only detail available for certification');

      const detailState = await waitForEmbeddedState(page, frameElement, 'Payables detail', frame => {
        const doc = frame.contentDocument;
        const html = doc?.documentElement;
        const modal = doc?.getElementById('detailModal');
        const dialog = modal?.querySelector('.dialog');
        const rect = dialog?.getBoundingClientRect();
        const visible = modal && getComputedStyle(modal).display !== 'none' && rect && rect.width > 0;
        const trace = doc?.getElementById('detailTraceability');
        const traceText = doc?.getElementById('detailTraceabilityActions')?.textContent?.trim() || '';
        return {
          visible: Boolean(visible),
          dialogFits: Boolean(visible && rect.left >= -1 && rect.right <= (html?.clientWidth || 0) + 1),
          traceCount: doc?.querySelectorAll('#detailTraceability').length || 0,
          traceVisible: Boolean(trace && getComputedStyle(trace).display !== 'none'),
          traceReady: Boolean(traceText && !traceText.includes('Consultando')),
          duplicateTraceBlocks: doc?.querySelectorAll('#payablesTraceContext,.ap-context').length || 0,
          injectedVisualOwners: ['apContextStyles', 'operationalContextStyles'].filter(id => Boolean(doc?.getElementById(id))),
          visibleDialogs: [...(doc?.querySelectorAll('[role="dialog"]') || [])].filter(node => getComputedStyle(node).display !== 'none').length,
          clientWidth: html?.clientWidth || 0,
          scrollWidth: html?.scrollWidth || 0
        };
      }, state => state?.visible && state?.traceReady);
      if (!detailState.dialogFits || detailState.traceCount !== 1 || !detailState.traceVisible || detailState.duplicateTraceBlocks || detailState.injectedVisualOwners.length || detailState.visibleDialogs !== 1 || detailState.scrollWidth !== detailState.clientWidth) {
        throw new Error('Payables detail does not have one contained canonical Trazabilidad AP owner');
      }
      await attachPrivateScreenshot(page, testInfo, 'payables-detail-iphone-safari');
      await frameElement.evaluate(frame => frame.contentDocument?.querySelector('[data-close="detail"]')?.click());

      const formInspection = await frameElement.evaluate(frame => {
        const doc = frame.contentDocument;
        const button = doc?.getElementById('newBill');
        if (!button || button.hidden || button.disabled) return { available: false, hidden: Boolean(button?.hidden), disabled: Boolean(button?.disabled) };
        button.click();
        const modal = doc.getElementById('billModal');
        const dialog = modal?.querySelector('.dialog');
        const rect = dialog?.getBoundingClientRect();
        const html = doc.documentElement;
        return {
          available: true,
          visible: Boolean(modal && getComputedStyle(modal).display !== 'none'),
          selectedPO: doc.getElementById('bPO')?.value || '',
          saveVisible: Boolean(doc.getElementById('saveBill')),
          dialogFits: Boolean(rect && rect.left >= -1 && rect.right <= html.clientWidth + 1),
          visibleDialogs: [...doc.querySelectorAll('[role="dialog"]')].filter(node => getComputedStyle(node).display !== 'none').length,
          clientWidth: html.clientWidth,
          scrollWidth: html.scrollWidth
        };
      });
      if (formInspection.available) {
        if (!formInspection.visible || formInspection.selectedPO || !formInspection.saveVisible || !formInspection.dialogFits || formInspection.visibleDialogs !== 1 || formInspection.scrollWidth !== formInspection.clientWidth) {
          throw new Error('Payables bill form is not a clean, contained read-only inspection state');
        }
        await attachPrivateScreenshot(page, testInfo, 'payables-form-iphone-safari');
        await frameElement.evaluate(frame => frame.contentDocument?.querySelector('[data-close="bill"]')?.click());
      }

      const payablesResponses = diagnostics.apiResponses.filter(item => item.path === '/api/payables');
      const paymentResponses = diagnostics.apiResponses.filter(item => item.path === '/api/supplier-payments');
      const traceResponses = diagnostics.apiResponses.filter(item => item.path === '/api/ap-links');
      if (!payablesResponses.some(item => item.status === 200)) throw new Error('Payables API did not return HTTP 200');
      if (!paymentResponses.some(item => item.status === 200)) throw new Error('Supplier Payments API did not return HTTP 200');
      if (!traceResponses.some(item => item.status === 200)) throw new Error('AP traceability API did not return HTTP 200');
      checkpoint('payables-readonly', {
        outerGeometry,
        innerGeometry: { clientWidth: payablesState.clientWidth, scrollWidth: payablesState.scrollWidth },
        metrics: payablesState.metricCount,
        visibleFrames: ownerState.visibleFrames,
        traceabilityOwners: detailState.traceCount,
        formInspected: formInspection.available,
        apiStatus: 200,
        submitted: false
      });
    });

    if (RUN_COSTS) await test.step('Costs has one owner, contained regions and canonical profitability', async () => {
      await openSection(page, 'costsSection');
      const frameElement = page.locator('#costsSection iframe');
      await expect(frameElement).toBeVisible();
      const costsState = await waitForEmbeddedState(page, frameElement, 'Costs iframe', frame => {
        const doc = frame.contentDocument;
        const html = doc?.documentElement;
        const fits = node => {
          if (!node || !html) return false;
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.left >= -1 && rect.right <= html.clientWidth + 1;
        };
        const metrics = [...(doc?.querySelectorAll('.costs-metrics .metric') || [])];
        const table = doc?.querySelector('.costs-table-wrap');
        const result = doc?.getElementById('costsResultCount')?.textContent?.trim() || '';
        return {
          heading: doc?.getElementById('costsPageTitle')?.textContent?.trim() || '',
          resultReady: Boolean(result && !result.includes('Consultando')),
          duplicateLogin: Boolean(doc?.getElementById('loginPage')),
          owner: doc?.body?.dataset?.owner || '',
          clientWidth: html?.clientWidth || 0,
          scrollWidth: html?.scrollWidth || 0,
          heroFits: fits(doc?.querySelector('.costs-page-head')),
          statusFits: fits(doc?.querySelector('.costs-hero-state')),
          metricsFit: metrics.length === 5 && metrics.every(fits),
          metricCount: metrics.length,
          panelFits: fits(doc?.querySelector('.costs-list-panel')),
          tableClientWidth: table?.clientWidth || 0,
          tableScrollWidth: table?.scrollWidth || 0,
          tableOverflowX: table ? getComputedStyle(table).overflowX : '',
          moduleMethods: ['openCost', 'openProfitability', 'refresh'].every(name => typeof frame.contentWindow?.CostsModule?.[name] === 'function'),
          contentError: doc?.getElementById('content')?.textContent?.includes('No se pudo cargar Costos') === true,
          pageMessage: doc?.getElementById('pageMsg')?.textContent?.trim() || ''
        };
      }, state => state?.duplicateLogin || (state?.heading === 'Costos y rentabilidad' && state.resultReady));
      if (costsState.duplicateLogin) throw new Error('Duplicate login found inside Costs');
      if (costsState.owner !== 'costs.js' || !costsState.moduleMethods) throw new Error('Costs does not expose its canonical visual owner');
      if (costsState.contentError || costsState.pageMessage) throw new Error('Costs displayed an initial-load error state');
      if (costsState.scrollWidth !== costsState.clientWidth) throw new Error('Costs iframe has horizontal document overflow');
      if (!costsState.heroFits || !costsState.statusFits || !costsState.metricsFit || !costsState.panelFits) throw new Error('Costs responsive regions do not fit the iPhone viewport');
      if (costsState.metricCount !== 5) throw new Error(`Costs metric count ${costsState.metricCount} != 5`);
      if (costsState.tableScrollWidth > costsState.tableClientWidth && !['auto', 'scroll'].includes(costsState.tableOverflowX)) throw new Error('Costs internal table overflow is not contained');

      const ownerState = await assertOneVisibleSection(page, 'costsSection');
      if (ownerState.visibleFrames !== 1) throw new Error('Costs has more than one visible embedded page');
      const geometry = await assertNoDocumentOverflow(page, 'Costos outer shell');

      const profitabilityProbe = await installProfitabilityProbe(frameElement);
      if (!profitabilityProbe.installed || !profitabilityProbe.opened) throw new Error('Costs profitability probe could not open the canonical view');
      await expect(frameElement).toHaveAttribute(PROFITABILITY_STATUS_ATTRIBUTE, /^(?:ready|error|timeout)$/, { timeout: 45_000 });
      const profitabilityRawState = await frameElement.getAttribute(PROFITABILITY_STATE_ATTRIBUTE);
      const profitabilityState = JSON.parse(profitabilityRawState || '{}');
      if (!profitabilityState.opened || profitabilityState.timedOut || profitabilityState.error || !profitabilityState.ready || profitabilityState.metricCount !== 4 || profitabilityState.selectedView !== 'true') {
        throw new Error(`Costs profitability read-model did not render through the canonical owner: ${sanitizeLog(JSON.stringify(profitabilityState))}`);
      }
      if (profitabilityState.scrollWidth !== profitabilityState.clientWidth) throw new Error('Profitability view has horizontal document overflow');

      const costsResponses = diagnostics.apiResponses.filter(item => item.path === '/api/costs');
      const profitabilityResponses = diagnostics.apiResponses.filter(item => item.path === '/api/profitability');
      if (!costsResponses.some(item => item.status === 200)) throw new Error('Costs API did not return HTTP 200');
      if (!profitabilityResponses.some(item => item.status === 200)) throw new Error('Profitability API did not return HTTP 200');
      await attachPrivateScreenshot(page, testInfo, 'costs-iphone-safari');
      checkpoint('costs', {
        geometry,
        innerGeometry: { clientWidth: costsState.clientWidth, scrollWidth: costsState.scrollWidth },
        metrics: costsState.metricCount,
        profitabilityMetrics: profitabilityState.metricCount,
        visibleFrames: ownerState.visibleFrames,
        costsApiStatus: 200,
        profitabilityApiStatus: 200,
        markerAbsent: true
      });
    });

    await test.step('No operational write or real ERP error occurred', async () => {
      const badResponses = diagnostics.apiResponses.filter(item => item.status >= 400);
      const erpConsoleErrors = diagnostics.consoleErrors.filter(message => ERP_ERROR_MARKERS.test(message));
      if (diagnostics.blockedWrites.length) throw new Error(`Forbidden API writes detected: ${[...new Set(diagnostics.blockedWrites)].join(', ')}`);
      if (badResponses.length) throw new Error(`ERP API errors detected: ${badResponses.map(item => `${item.method} ${item.path}=${item.status}`).join(', ')}`);
      if (diagnostics.failedRequests.length) throw new Error(`ERP API request failures detected: ${diagnostics.failedRequests.map(item => `${item.method} ${item.path}`).join(', ')}`);
      if (diagnostics.pageErrors.length) throw new Error(`ERP page errors detected: ${diagnostics.pageErrors.join(' | ')}`);
      if (erpConsoleErrors.length) throw new Error(`ERP console error markers detected: ${erpConsoleErrors.join(' | ')}`);
      checkpoint('readonly-network-contract', {
        allowedWrite: 'POST /api/login',
        forbiddenWrites: 0,
        failedApiResponses: 0,
        failedApiRequests: 0,
        pageErrors: 0,
        erpConsoleMarkers: 0
      });
    });
  } finally {
    const sanitized = {
      target: ERP_ORIGIN,
      platform: 'iPhone 16 Pro / iOS 18 / Safari',
      scope: CERT_SCOPE,
      checkpoints: diagnostics.checkpoints,
      api: {
        total: diagnostics.apiResponses.length,
        failures: diagnostics.apiResponses.filter(item => item.status >= 400),
        requestFailures: diagnostics.failedRequests
      },
      safety: {
        allowedWrites: [...ALLOWED_API_WRITES],
        blockedWrites: diagnostics.blockedWrites
      },
      errors: {
        console: diagnostics.consoleErrors.filter(message => ERP_ERROR_MARKERS.test(message)),
        page: diagnostics.pageErrors
      },
      limitation: 'Playwright-iOS cannot certify Add to Home Screen or a standalone PWA relaunch; this run certifies Safari and the PWA web prerequisites.'
    };
    await testInfo.attach(`ux7-ios-certification-${CERT_SCOPE}.json`, {
      body: Buffer.from(JSON.stringify(sanitized, null, 2)),
      contentType: 'application/json'
    });
  }
});
