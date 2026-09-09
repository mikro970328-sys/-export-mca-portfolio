const { test, expect, chromium, devices } = require('@playwright/test');

test.describe.configure({mode:'serial'});
test.setTimeout(120000);

test('two operators see committed finance changes without a manual reload',async({},testInfo)=>{
  const {createOperatorAcceptanceDb}=await import('../../scripts/lib/operator-acceptance-db.mjs');
  const {operatorFixture}=await import('../../scripts/lib/operator-acceptance-fixture.mjs');
  const {startOperatorBrowserServer}=await import('../../scripts/lib/operator-browser-server.mjs');
  const db=await createOperatorAcceptanceDb();
  let server,browser,contextA,contextB;
  try{
    const {f,users}=await operatorFixture(db);
    const invoice=await f.invoice(await f.sale());
    server=await startOperatorBrowserServer(db);
    browser=await chromium.launch({headless:true});
    contextA=await browser.newContext({viewport:{width:1440,height:1000}});
    contextB=await browser.newContext({...devices['iPhone 15']});
    const pageA=await contextA.newPage();
    const pageB=await contextB.newPage();
    const diagnostics={a:{live:0,mainNavigations:0},b:{live:0,mainNavigations:0}};

    for(const [page,key] of [[pageA,'a'],[pageB,'b']]){
      page.on('response',response=>{
        const url=new URL(response.url());
        if(url.pathname==='/api/live-updates'&&response.status()===200)diagnostics[key].live+=1;
      });
      page.on('framenavigated',frame=>{
        if(frame===page.mainFrame())diagnostics[key].mainNavigations+=1;
      });
    }

    async function login(page,user,path){
      await page.goto(`${server.origin}${path}`,{waitUntil:'domcontentloaded'});
      await expect(page).toHaveURL(`${server.origin}/admin/index.html`);
      await page.locator('#username').fill(user.username);
      await page.locator('#password').fill(user.password);
      const response=page.waitForResponse(item=>new URL(item.url()).pathname==='/api/login'&&item.request().method()==='POST');
      await page.locator('#login').click();
      expect((await response).status()).toBe(200);
      await expect(page.locator('#loginPage')).toBeHidden();
      await expect(page.locator('[data-section="invoicesSection"]')).toBeAttached();
      await page.evaluate(()=>window.NavigationShell.openInvoices());
      await expect(page.locator('#invoicesSection')).toBeVisible();
      const frame=page.frameLocator('#invoicesSection iframe');
      await expect(frame.locator(`[data-invoice-row="${invoice.id}"]`)).toBeVisible();
      return frame;
    }

    const frameA=await login(pageA,users.a,'/admin/index.html');
    const frameB=await login(pageB,users.b,'/admin/pwa.html');
    await expect.poll(()=>diagnostics.a.live,{timeout:12000}).toBeGreaterThanOrEqual(1);
    await expect.poll(()=>diagnostics.b.live,{timeout:12000}).toBeGreaterThanOrEqual(1);
    const stableMainNavigations=diagnostics.b.mainNavigations;
    const rowA=frameA.locator(`[data-invoice-row="${invoice.id}"]`);
    const rowB=frameB.locator(`[data-invoice-row="${invoice.id}"]`);
    await expect(rowA.locator('.invoice-money.balance')).toHaveText('USD 400.00');
    await expect(rowB.locator('.invoice-money.balance')).toHaveText('USD 400.00');

    await rowA.getByRole('button',{name:'Registrar cobro'}).click();
    await frameA.locator('#pAmount').fill('120');
    await frameA.locator('#pReference').fill('QA-VISUAL-1');
    const firstWrite=pageA.waitForResponse(item=>new URL(item.url()).pathname==='/api/invoice-payments'&&item.request().method()==='POST');
    await frameA.locator('#savePayment').click();
    expect((await firstWrite).status()).toBe(200);
    await expect(rowB.locator('.invoice-money.balance')).toHaveText('USD 280.00',{timeout:12000});
    expect(diagnostics.b.mainNavigations).toBe(stableMainNavigations);
    expect(await pageB.evaluate(()=>performance.getEntriesByType('navigation').length)).toBe(1);
    await pageB.screenshot({path:testInfo.outputPath('operator-b-pwa-after-live-refresh.png'),fullPage:true});

    await rowB.getByRole('button',{name:'Ver detalle'}).click();
    await expect(frameB.locator('#detailModal')).toBeVisible();
    await expect(frameB.locator('#detailBody')).toContainText('USD 280.00');
    const liveBeforeSecondWrite=diagnostics.b.live;
    await frameA.locator('[data-close="detail"]').click();
    await rowA.getByRole('button',{name:'Registrar cobro'}).click();
    await frameA.locator('#pAmount').fill('80');
    await frameA.locator('#pReference').fill('QA-VISUAL-2');
    const secondWrite=pageA.waitForResponse(item=>new URL(item.url()).pathname==='/api/invoice-payments'&&item.request().method()==='POST');
    await frameA.locator('#savePayment').click();
    expect((await secondWrite).status()).toBe(200);
    await expect.poll(()=>diagnostics.b.live,{timeout:12000}).toBeGreaterThan(liveBeforeSecondWrite);
    await expect(frameB.locator('#detailBody')).toContainText('USD 280.00');
    await frameB.locator('[data-close="detail"]').click();
    await expect(rowB.locator('.invoice-money.balance')).toHaveText('USD 200.00',{timeout:5000});
    expect(diagnostics.b.mainNavigations).toBe(stableMainNavigations);
    expect(Number((await f.financial(invoice)).balance_due)).toBe(200);

    const pwaState=await pageB.evaluate(async()=>{
      const registration=await navigator.serviceWorker.ready;
      return {
        controlled:Boolean(navigator.serviceWorker.controller),
        displayMode:matchMedia('(display-mode: standalone)').matches,
        scope:registration.scope,
        viewport:{width:innerWidth,height:innerHeight}
      };
    });
    expect(pwaState.scope).toBe(`${server.origin}/`);
    expect(pwaState.viewport.width).toBeLessThanOrEqual(430);
    await pageA.screenshot({path:testInfo.outputPath('operator-a-after-two-payments.png'),fullPage:true});
    await testInfo.attach('acceptance-summary',{
      body:Buffer.from(JSON.stringify({
        operators:[users.a.id,users.b.id],
        invoice:invoice.id,
        finalBalance:200,
        pwaLaunchRoute:true,
        serviceWorkerControlled:pwaState.controlled,
        automaticRefresh:true,
        modalDeferral:true,
        manualReloads:0
      },null,2)),
      contentType:'application/json'
    });
  }finally{
    await contextA?.close();
    await contextB?.close();
    await browser?.close();
    await server?.close();
    await db.end();
  }
});
