import { test, expect } from '@playwright/test';
import { salesFixture } from '../../scripts/lib/figma-sales-fixture.mjs';

async function open(page, options) {
  const html = salesFixture(options);
  await page.route('**/*', route => route.request().url()==='https://erp-visual.invalid/'
    ? route.fulfill({contentType:'text/html',body:html}) : route.abort());
  await page.goto('https://erp-visual.invalid/');
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.sales-order-row')).toHaveCount(3);
}

async function fits(page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}

test('Figma sales: white theme, real filters, accessible actions and form pricing', async ({page}, info) => {
  await page.emulateMedia({colorScheme:'dark'});
  await open(page);
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.locator('#salesPageTitle')).toHaveCSS('color','rgb(32, 33, 31)');
  await fits(page);
  await info.attach('ventas', {body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  const first=page.locator('.sales-order-row').first();
  await first.locator('summary').click();
  await expect(first.locator('[data-load-order]')).toBeVisible();
  await expect(first.locator('[data-edit-order]')).toHaveCount(0);
  await first.locator('[data-supply-order]').click();
  expect(await page.evaluate(()=>window.__fixtureCalls.some(call=>call.supply==='fixture-sale-0'))).toBe(true);
  await first.locator('summary').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(first.locator('details')).not.toHaveAttribute('open');
  await expect(first.locator('summary')).toBeFocused();
  await page.locator('#search').fill('REF-247');
  await expect(page.locator('.sales-order-row')).toHaveCount(1);
  await expect(page.locator('.sales-order-total')).toContainText('€');
  await page.locator('#search').fill('sin coincidencias');
  await expect(page.locator('.sales-empty')).toBeVisible();
  await page.locator('#search').fill('');
  await page.locator('[data-view="draft"]').click();
  await expect(page.locator('.sales-order-row')).toHaveCount(1);
  await page.locator('.sales-order-row summary').click();
  await expect(page.locator('[data-edit-order]')).toBeVisible();
  await expect(page.locator('[data-load-order]')).toHaveCount(0);
  await page.locator('#newOrder').click();
  await expect(page.locator('#orderModal')).toBeVisible();
  await expect(page.locator('#oClientPickerButton')).toBeVisible();
  await page.locator('.lQty').fill('10');
  await page.locator('.lPrice').fill('12.5');
  await expect(page.locator('.lTotal')).toHaveValue('125');
  await expect(page.locator('#salesOrderTotalPreview b')).toHaveText('$125.00');
  await page.locator('.lTotal').fill('250');
  await expect(page.locator('.lPrice')).toHaveValue('25');
  await expect(page.locator('.lPriceMode')).toHaveValue('total');
  await page.locator('.lPriceMode').selectOption('unit');
  await page.locator('.lQty').fill('20');
  await expect(page.locator('.lTotal')).toHaveValue('500');
  await expect(page.locator('#salesOrderTotalPreview b')).toHaveText('$500.00');
  await page.locator('#oNotes').fill('Notas de demostración\nSegunda línea');
  await page.locator('#oClientPickerButton').click();
  await page.locator('[data-client-id="fixture-client"]').click();
  await expect(page.locator('#oClientPickerButton')).toContainText('Costa Sur');
  await fits(page);
  await page.locator('#orderTitle').scrollIntoViewIfNeeded();
  await info.attach('nueva-venta', {body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  const dialog=page.locator('#orderModal .dialog');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.locator('#orderModal [data-close="order"]').first().click();
  await expect(page.locator('#orderModal')).not.toBeVisible();
  expect(await page.evaluate(()=>window.__fixtureCalls.every(call=>!call.method||call.method==='GET'))).toBe(true);
});

test('Figma sales: read-only users keep their original capabilities', async ({page}) => {
  await open(page,{writable:false});
  await expect(page.locator('#newOrder')).not.toBeVisible();
  await expect(page.locator('#salesAccessNote')).toBeVisible();
  await page.locator('.sales-order-row summary').first().click();
  await expect(page.locator('[data-edit-order],[data-load-order]')).toHaveCount(0);
  await expect(page.locator('[data-view-order]').first()).toBeVisible();
});

for (const viewport of [{width:390,height:500},{width:1440,height:700}]) {
  test(`Sales detail remains scrollable and expense editor reachable at ${viewport.width}`, async ({page}, info) => {
    await page.setViewportSize(viewport);
    await open(page,{workspace:true});
    await page.locator('[data-view-order]').first().click();
    const dialog=page.locator('#detailModal .sales-workspace-dialog');
    await expect(dialog).toBeVisible();
    await page.locator('[data-ws-tab="history"]').click();
    const last=page.locator('.sales-ws-history-row').last();
    await last.scrollIntoViewIfNeeded();
    const box=await last.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y+box.height).toBeLessThanOrEqual(viewport.height+1);
    expect(await dialog.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
    await page.locator('[data-ws-tab="costs"]').click();
    await page.locator('[data-ws-action="edit_cost"]').click();
    await expect(page.locator('#salesWorkspaceCostModal')).toBeVisible();
    await expect(page.locator('#wsCostAmount')).toHaveValue('11600');
    await page.locator('#wsCostAmount').fill('11500');
    await page.locator('#salesWorkspaceCostModal button').filter({hasText:'Cancelar'}).click();
    await expect(page.locator('#salesWorkspaceCostModal')).not.toBeVisible();
    await page.locator('[data-ws-action="edit_cost"]').scrollIntoViewIfNeeded();
    await info.attach('gasto-accesible',{body:await page.screenshot(),contentType:'image/png'});
    expect(await page.evaluate(()=>window.__fixtureCalls.every(call=>!call.method||call.method==='GET'))).toBe(true);
  });
}

test('Sales posted expense revision respects read-only capability',async({page})=>{
  await open(page,{workspace:true,writable:false});
  await page.locator('[data-view-order]').first().click();
  await page.locator('[data-ws-tab="costs"]').click();
  await expect(page.locator('[data-ws-action="edit_cost"]')).toHaveCount(0);
});
