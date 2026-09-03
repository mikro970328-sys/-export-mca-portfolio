const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.ERP_BASE_URL || 'https://admin.exportmca.com';
const ERP_ORIGIN = new URL(BASE_URL).origin;
const REQUIRED_SECRETS = ['ERP_E2E_USERNAME', 'ERP_E2E_PASSWORD'];
const ALLOWED_API_WRITES = new Set(['POST /api/login']);
const ERP_ERROR_MARKERS = /COSTS_INITIAL_LOAD_FAILED|PUBLICATIONS_UI_FAILED|CONTAINER_[A-Z_]+_FAILED|\[admin (?:boot|dashboard|secondary modules)\]|(?:Type|Reference|Syntax)Error|Uncaught/i;

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
  await expect(page.locator('#mobileOverlay')).not.toHaveClass(/show/);
  return section;
}

function expectedGreeting(hour) {
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

test('UX-7 production is read-only and usable on real iPhone Safari', async ({ page }, testInfo) => {
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

    await test.step('Dashboard greeting and responsive owner', async () => {
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

    await test.step('PWA prerequisites available in Safari', async () => {
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

    await test.step('Tracking has no page overflow and uses one visual owner', async () => {
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

    await test.step('Action menu matches backend capabilities and detail is read-only', async () => {
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
      await expect(page.locator('#modal')).toHaveClass(/hidden/);
      checkpoint('tracking-actions-and-detail', { actions: actualActions, detailAction });
    });

    await test.step('Register container renders but is never submitted', async () => {
      await openSection(page, 'registerContainerSection');
      await expect(page.locator('#registerContainerTitle')).toHaveText('Registrar contenedor');
      await expect(page.locator('#shipmentRegistrationForm')).toBeVisible();
      await expect(page.locator('#shipmentContainer')).toHaveValue('');
      await expect(page.locator('#saveShipment')).toBeVisible();
      await assertOneVisibleSection(page, 'registerContainerSection');
      const geometry = await assertNoDocumentOverflow(page, 'Registrar contenedor');
      await assertElementsFitViewport(page.locator('.tracking-register-hero'), 'Registration hero');
      await attachPrivateScreenshot(page, testInfo, 'register-container-iphone-safari');
      checkpoint('register-container-readonly', { geometry, submitted: false });
    });

    await test.step('Commercial publications stays embedded without duplicate login', async () => {
      await openSection(page, 'publicationsSection');
      const frameElement = page.locator('#publicationsSection iframe');
      await expect(frameElement).toBeVisible();
      const publications = page.frameLocator('#publicationsSection iframe');
      await expect(publications.locator('#publicationsTitle')).toHaveText('Publicaciones');
      await expect(publications.locator('#totalMetric')).not.toHaveText('—');
      if (await publications.locator('#loginPage').count()) throw new Error('Duplicate login found inside Publications');
      const owner = await assertOneVisibleSection(page, 'publicationsSection');
      if (owner.visibleFrames !== 1) throw new Error('Publications has more than one visible embedded page');
      const outerGeometry = await assertNoDocumentOverflow(page, 'Publicaciones outer shell');
      const innerGeometry = await publications.locator('html').evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
      if (innerGeometry.scrollWidth !== innerGeometry.clientWidth) throw new Error('Publications iframe has horizontal document overflow');
      await expect(publications.locator('#pageMessage')).not.toHaveClass(/is-error/);
      await attachPrivateScreenshot(page, testInfo, 'publications-iphone-safari');
      checkpoint('publications', { outerGeometry, innerGeometry, visibleFrames: owner.visibleFrames, duplicateLogin: false });
    });

    await test.step('Costs loads without COSTS_INITIAL_LOAD_FAILED', async () => {
      await openSection(page, 'costsSection');
      const costs = page.frameLocator('#costsSection iframe');
      await expect(costs.getByRole('heading', { name: 'Costos operativos' })).toBeVisible();
      await expect(costs.locator('#metrics > *')).toHaveCount(5);
      await expect(costs.locator('#content')).not.toContainText('No se pudo cargar Costos');
      await expect(costs.locator('#pageMsg')).toHaveText('');
      const costsResponses = diagnostics.apiResponses.filter(item => item.path === '/api/costs');
      if (!costsResponses.some(item => item.status === 200)) throw new Error('Costs API did not return HTTP 200');
      await assertOneVisibleSection(page, 'costsSection');
      const geometry = await assertNoDocumentOverflow(page, 'Costos outer shell');
      await attachPrivateScreenshot(page, testInfo, 'costs-iphone-safari');
      checkpoint('costs', { geometry, apiStatus: 200, markerAbsent: true });
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
    await testInfo.attach('ux7-ios-certification.json', {
      body: Buffer.from(JSON.stringify(sanitized, null, 2)),
      contentType: 'application/json'
    });
  }
});
