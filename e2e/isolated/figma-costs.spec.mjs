import { test, expect } from '@playwright/test';
import { costsFixture } from '../../scripts/lib/figma-costs-fixture.mjs';

async function open(page, options) {
  const html=costsFixture(options);
  await page.route('**/*',route=>route.request().url()==='https://erp-visual.invalid/'
    ? route.fulfill({contentType:'text/html',body:html}) : route.abort());
  await page.goto('https://erp-visual.invalid/');
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.cost-record')).toHaveCount(5);
}
async function fits(page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}
async function posts(page) {
  return page.evaluate(()=>window.__fixtureCalls.filter(call=>call.method==='POST').map(call=>call.body));
}

test('Figma expenses: white list, readable cards, search, menus and financial views',async({page},info)=>{
  await page.emulateMedia({colorScheme:'dark'});
  await open(page);
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.locator('#costsPageTitle')).toHaveCSS('color','rgb(32, 33, 31)');
  await fits(page);
  const row=page.locator('.cost-record').first();
  expect(await row.locator('[data-edit]').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.screenshot({path:info.outputPath('gastos.png'),fullPage:true});
  await info.attach('gastos',{path:info.outputPath('gastos.png'),contentType:'image/png'});
  await row.locator('summary').click();
  await expect(row.locator('[data-void]')).toBeVisible();
  await expect(row.locator('[data-post]')).toHaveCount(0);
  await row.locator('[data-detail]').click();
  await expect(page.locator('#detailBody')).toContainText('Distribución');
  await expect(page.locator('#detailBody')).toContainText('PO-DEMO-0248');
  await expect(page.locator('#detailBody')).toContainText('Registro ficticio');
  await page.keyboard.press('Escape');
  await row.locator('summary').focus();
  await page.keyboard.press('Escape');
  await expect(row.locator('details')).not.toHaveAttribute('open');
  await page.locator('#search').fill('REF-DEMO-47');
  await expect(page.locator('.cost-record')).toHaveCount(1);
  await expect(page.locator('.cost-amount')).toContainText('EUR 2,100.00');
  await page.locator('#search').fill('no existe');
  await expect(page.locator('.costs-empty')).toContainText('Sin resultados');
  await page.locator('#clearCostFilters').click();
  for(const view of ['landed','cogs','profitability','charges']){
    await page.locator(`[data-view="${view}"]`).click();
    await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute('aria-pressed','true');
    await fits(page);
  }
  await page.locator('[data-view="profitability"]').click();
  await page.locator('[data-profit-subview="shipments"]').click();
  await expect(page.locator('.profit-card').filter({hasText:'CONT-DEMO-0248'})).toContainText('Ganancia del contenedor');
  await expect(page.locator('.profit-card').filter({hasText:'CONT-DEMO-0248'})).toContainText('350.00');
  await expect(page.locator('.profit-card').filter({hasText:'CONT-DEMO-0248'})).toContainText('total acordado');
  await page.locator('[data-profit-subview="operations"]').click();
  await expect(page.locator('.profit-card').filter({hasText:'OP-DEMO-0248'})).toBeVisible();
  expect(await posts(page)).toEqual([]);
});

test('Company monthly and annual profit subtract worker salary and tips; void payroll is excluded',async({page})=>{
  await open(page);
  await page.locator('[data-view="profitability"]').click();
  await page.locator('[data-profit-subview="company"]').click();
  const result=page.locator('.company-month-table tbody tr').last();
  await expect(result).toContainText('125.00');
  await page.locator('[data-payroll-add]').click();
  await page.locator('#payrollSalary').fill('300');
  await page.locator('#payrollTips').fill('50');
  await page.locator('#savePayroll').click();
  await expect(page.locator('.payroll-row').filter({hasText:'350.00'})).toHaveCount(1);
  await expect(page.locator('.company-month-table tbody tr').last()).toContainText('225.00');
  await expect(page.locator('.company-month-table tbody tr').last().locator('td').last()).toHaveClass(/company-net-negative/);
  await page.locator('[data-payroll-void="fixture-payroll-created"]').click();
  await page.locator('#costDecisionAccept').click();
  await expect(page.locator('.company-month-table tbody tr').last()).toContainText('125.00');
  const calls=await posts(page);
  expect(calls.filter(call=>call.action==='create')).toHaveLength(1);
  expect(calls.filter(call=>call.action==='void')).toHaveLength(1);
});

test('Company profit stays pending when an issued invoice has no recognized merchandise cost',async({page})=>{
  await open(page,{companyPending:true});
  await page.locator('[data-view="profitability"]').click();
  await page.locator('[data-profit-subview="company"]').click();
  await expect(page.locator('.company-month-table tbody tr').last()).toContainText('Pendiente de costo');
  await expect(page.locator('.company-annual-card')).toContainText('Pendiente: costo de mercancía incompleto');
});

test('Finance readers see the company deduction without employee salary details',async({page})=>{
  await open(page,{writable:false});
  await page.locator('[data-view="profitability"]').click();
  await page.locator('[data-profit-subview="company"]').click();
  await expect(page.locator('.company-month-table tbody tr').last()).toContainText('125.00');
  await expect(page.locator('.payroll-row')).toHaveCount(0);
  await expect(page.locator('[data-payroll-add]')).toHaveCount(0);
  await expect(page.locator('.payroll-section')).toContainText('detalle por trabajador requiere permiso');
});

for(const viewport of [{width:390,height:500},{width:1440,height:700}]){
  test(`Expense form scroll, allocation preview and posted revision at ${viewport.width}`,async({page},info)=>{
    await page.setViewportSize(viewport);
    await open(page);
    await page.locator('[data-edit="fixture-cost-0"]').click();
    await expect(page.locator('#chargeHelp')).toContainText('historial');
    await expect(page.locator('#cAmount')).toHaveValue('1250');
    await expect(page.locator('[data-target-id]')).toHaveValue('fixture-po');
    await expect(page.locator('#chargeTotalPreview')).toHaveText('USD 1,250.00');
    await page.locator('#cAmount').fill('1400');
    await expect(page.locator('#allocationPreview')).toContainText('Sin asignar: USD 150.00');
    await page.locator('[data-amount]').fill('1450');
    await expect(page.locator('#allocationPreview')).toContainText('Exceso asignado: USD 50.00');
    await page.locator('[data-amount]').fill('1400');
    await page.locator('#cNotes').fill('Corrección de prueba\nCon historial.');
    await expect(page.locator('#allocationPreview')).toContainText('Sin asignar: USD 0.00');
    const dialog=page.locator('#chargeModal .dialog');
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.locator('#chargeTitle').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('editar-gasto.png')});
    await info.attach('editar-gasto',{path:info.outputPath('editar-gasto.png'),contentType:'image/png'});
    await page.locator('#saveCharge').scrollIntoViewIfNeeded();
    const box=await page.locator('#saveCharge').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y+box.height).toBeLessThanOrEqual(viewport.height+1);
    await page.screenshot({path:info.outputPath('guardar-gasto-visible.png')});
    await info.attach('guardar-gasto-visible',{path:info.outputPath('guardar-gasto-visible.png'),contentType:'image/png'});
    await page.locator('#saveCharge').click();
    await expect(page.locator('#chargeModal')).not.toBeVisible();
    await expect(page.locator('#pageMsg')).toContainText('historial');
    const [body]=await posts(page);
    expect(body).toMatchObject({action:'revise_posted',cost_charge_id:'fixture-cost-0',amount:1400,currency:'USD',notes:'Corrección de prueba\nCon historial.'});
    expect(body.allocations).toEqual([{amount:'1400',basis:'manual',purchase_order_id:'fixture-po',notes:'Distribución de demostración'}]);
    await fits(page);
  });
}

test('Expense create, draft edit, validation, server failure and cancel keep correct actions',async({page})=>{
  await open(page);
  await page.locator('#newCharge').click();
  await expect(page.locator('#chargeTitle')).toHaveText('Nuevo gasto');
  await page.locator('#saveCharge').click();
  await expect(page.locator('#chargeMsg')).toContainText('mayor que cero');
  expect(await posts(page)).toEqual([]);
  await page.locator('#cAmount').fill('80');
  await page.locator('[data-remove-allocation]').click();
  await expect(page.locator('#allocationPreview')).toContainText('Sin asignar: USD 80.00');
  await page.locator('#addAllocation').click();
  await page.locator('[data-target-type]').selectOption('load_id');
  await page.locator('[data-target-id]').selectOption('fixture-load');
  await page.locator('[data-amount]').fill('80');
  await page.locator('#saveCharge').click();
  await expect(page.locator('#chargeModal')).not.toBeVisible();
  expect((await posts(page))[0]).toMatchObject({action:'create',amount:80,allocations:[{load_id:'fixture-load',amount:'80'}]});
  await page.locator('[data-edit="fixture-cost-2"]').click();
  await expect(page.locator('#cCategory')).toBeFocused();
  await expect(page.locator('#chargeHelp')).not.toContainText('historial');
  await page.locator('#cAmount').fill('400');
  await expect(page.locator('#cAmount')).toBeFocused();
  await expect(page.locator('#cAmount')).toHaveValue('400');
  await page.evaluate(()=>{window.__fixtureRejectWrites=true});
  await page.locator('#saveCharge').click();
  await expect(page.locator('#chargeMsg')).not.toBeEmpty();
  await expect(page.locator('#saveCharge')).toBeEnabled();
  await expect(page.locator('#cAmount')).toHaveValue('400');
  await page.evaluate(()=>{window.__fixtureRejectWrites=false});
  await page.locator('#saveCharge').click();
  await expect(page.locator('#chargeModal')).not.toBeVisible();
  expect((await posts(page)).at(-1)).toMatchObject({action:'replace',cost_charge_id:'fixture-cost-2',amount:400,allocations:[]});
  const before=(await posts(page)).length;
  await page.locator('[data-edit="fixture-cost-0"]').click();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  expect((await posts(page)).length).toBe(before);
});

test('Read-only expense users can inspect and cannot create, edit, post or void',async({page})=>{
  await open(page,{writable:false});
  await expect(page.locator('#newCharge')).not.toBeVisible();
  await expect(page.locator('#costsReadOnlyNote')).toBeVisible();
  await expect(page.locator('[data-edit],[data-post],[data-void]')).toHaveCount(0);
  await page.locator('.cost-record summary').first().click();
  await page.locator('[data-detail]').first().click();
  await expect(page.locator('#detailModal')).toBeVisible();
  await expect(page.locator('#detailActions button')).toHaveCount(0);
  expect(await posts(page)).toEqual([]);
});
