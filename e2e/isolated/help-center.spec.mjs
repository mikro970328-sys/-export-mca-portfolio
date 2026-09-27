import {test,expect} from '@playwright/test';
import {helpCenterFixture} from '../../scripts/lib/help-center-fixture.mjs';

async function start(page,{master=true}={}){
  const errors=[],helpRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{
    if(/\/admin\/help-(?:content|center)(?:\.js|\.css)/.test(new URL(request.url()).pathname))helpRequests.push(request.url());
  });
  await page.route('**/*',route=>route.request().url()==='https://erp-help.invalid/'
    ?route.fulfill({contentType:'text/html',body:helpCenterFixture({master})})
    :route.abort());
  await page.goto('https://erp-help.invalid/');
  await page.waitForFunction(()=>window.__fixtureReady===true);
  return {errors,helpRequests};
}

for(const width of [1440,1024])test(`ERP shell has no Help section at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  const {errors,helpRequests}=await start(page);
  await expect(page.locator('[data-section="helpSection"]')).toHaveCount(0);
  await expect(page.locator('#helpSection')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Ayuda',exact:true})).toHaveCount(0);
  await expect(page.locator('#accountSection')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(helpRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('ERP shell keeps account access for restricted users without loading Help',async({page})=>{
  const {errors,helpRequests}=await start(page,{master:false});
  await expect(page.locator('[data-section="helpSection"]')).toHaveCount(0);
  await expect(page.locator('#helpSection')).toHaveCount(0);
  await expect(page.locator('#accountSection')).toBeVisible();
  expect(await page.evaluate(()=>window.__fixtureCalls.filter(call=>call.method!=='GET'))).toEqual([]);
  expect(helpRequests).toEqual([]);
  expect(errors).toEqual([]);
});
