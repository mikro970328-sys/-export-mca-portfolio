import {test,expect} from '@playwright/test';
import {helpCenterFixture} from '../../scripts/lib/help-center-fixture.mjs';

async function start(page,{master=true}={}){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url()==='https://erp-help.invalid/'?route.fulfill({contentType:'text/html',body:helpCenterFixture({master})}):route.abort());
  await page.goto('https://erp-help.invalid/');
  await page.waitForFunction(()=>window.__fixtureReady===true);
  await page.locator('[data-section="helpSection"]').click();
  await expect(page.locator('#helpSection')).toBeVisible();
  return errors;
}
async function shot(page,info,name){const path=info.outputPath(name+'.png');await page.screenshot({path,scale:'css'});await info.attach(name,{path,contentType:'image/png'});}

for(const width of [1440,1024])test(`Help index and article fit desktop ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});const errors=await start(page);
  await expect(page.locator('.help-card')).toHaveCount(43);
  await expect(page.locator('[data-section="helpSection"] .ui-icon-svg')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await shot(page,info,'help-index-'+width);
  await page.locator('.help-card[data-help-article="recorrido-directo"]').click();
  await expect(page.locator('#helpArticleTitle')).toHaveText('Recorrido completo: Direct Ship');
  await expect(page.locator('#helpArticleTitle')).toBeFocused();
  await expect(page.locator('.help-steps li')).toHaveCount(6);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await shot(page,info,'help-direct-ship-'+width);expect(errors).toEqual([]);
});
test('Help search handles accents, filters, empty state and return to results',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await start(page);
  await page.locator('#helpSearch').fill('¿Cómo crear una factura?');
  await expect(page.locator('.help-card[data-help-article="facturas"]')).toBeVisible();
  await page.locator('#helpClear').click();
  await page.locator('#helpSearch').fill('RECEPCIÓN');
  await expect(page.locator('.help-card[data-help-article="recepciones"]')).toBeVisible();
  await page.locator('[data-help-category="Compras y almacén"]').click();
  await page.locator('.help-card[data-help-article="recepciones"]').click();
  await page.locator('[data-help-back]').click();
  await expect(page.locator('#helpSearch')).toHaveValue('RECEPCIÓN');
  await expect(page.locator('[data-help-category="Compras y almacén"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('#helpSearch').fill('xxxxxxxx-no-result');await expect(page.locator('#helpEmpty')).toBeVisible();
  await page.locator('[data-help-reset]').click();await expect(page.locator('.help-card')).toHaveCount(43);
  await page.locator('#helpSearch').fill('costo incompleto');await expect(page.locator('.help-card[data-help-article="margen"]')).toBeVisible();
});
test('Help is available to restricted operators without opening restricted modules',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await start(page,{master:false});
  await page.locator('.help-card[data-help-article="equipo"]').click();
  await expect(page.locator('[data-help-module]')).toBeDisabled();
  await expect(page.locator('#helpModuleStatus')).toContainText('no está disponible');
  await page.locator('#helpArticle [data-help-article="cuenta"]').click();await expect(page.locator('[data-help-module]')).toBeEnabled();
  await page.locator('[data-help-module]').click();await expect(page.locator('#accountSection')).toBeVisible();
  expect(await page.evaluate(()=>window.__fixtureCalls.filter(c=>c.method!=='GET'))).toEqual([]);
});
test('Help report template has a clipboard fallback and print hides navigation',async({page},info)=>{
  await page.setViewportSize({width:1440,height:1000});await start(page);
  await page.locator('.help-card[data-help-article="reportar"]').click();
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('QA denied');}}}));
  await page.locator('[data-help-copy]').click();await expect(page.locator('#helpCopyStatus')).toContainText('seleccionada');
  await expect(page.locator('#helpReportTemplate')).toHaveValue(/Qué ocurrió y mensaje exacto/);
  await shot(page,info,'help-report');
  await page.emulateMedia({media:'print'});await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('.help-article-actions')).toBeHidden();await expect(page.locator('#helpArticleTitle')).toBeVisible();
  expect(await page.evaluate(()=>window.__fixtureCalls.filter(c=>c.method!=='GET'))).toEqual([]);
});
