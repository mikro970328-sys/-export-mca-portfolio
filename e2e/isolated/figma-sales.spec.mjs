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
