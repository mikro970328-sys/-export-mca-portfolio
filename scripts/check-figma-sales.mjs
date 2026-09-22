import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { salesFixture } from './lib/figma-sales-fixture.mjs';

let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
const flush=()=>new Promise(resolve=>setTimeout(resolve,20));
for (const writable of [true,false]) {
  const dom=new JSDOM(salesFixture({writable}),{url:'https://erp-visual.invalid/',runScripts:'dangerously'});
  const win=dom.window, doc=win.document, one=selector=>doc.querySelector(selector);
  const edit=(selector,value,type='input')=>{
    one(selector).value=value;
    one(selector).dispatchEvent(new win.Event(type,{bubbles:true}));
  };
  await flush();
  check(doc.querySelectorAll('.sales-order-row').length===3,'Open sales retain the confirmed status filter');
  check(one('#newOrder').hidden===!writable,'Creation follows server write access');
  check(one('#salesAccessNote').hidden===writable,'Read-only guidance follows server write access');
  one('[data-view="draft"]').click();
  check(doc.querySelectorAll('.sales-order-row').length===1,'Draft filter works');
  check(Boolean(one('[data-edit-order]'))===writable,'Edit follows the exact server capability');
  check(!one('[data-load-order]'),'Draft without load capability has no create-load action');
  one('[data-view="all"]').click();
  edit('#search','REF-247');
  check(doc.querySelectorAll('.sales-order-row').length===1,'Reference search survives the new row presentation');
  check(one('.sales-order-total').textContent.includes('€'),'Each sale retains its currency');
  edit('#search','No matching record');
  check(Boolean(one('.sales-empty')),'Empty search has a useful state');
  edit('#search','');
  one('[data-supply-order]').click();
  check(win.__fixtureCalls.some(call=>call.supply),'Supply action still reaches its existing owner');
  if (writable) {
    one('#newOrder').click();
    await flush();
    check(!one('#orderModal').classList.contains('hidden'),'New sale opens the existing modal');
    check(one('label[for="oClientPickerButton"]'),'Client picker keeps a persistent associated label');
    edit('.lQty','10');edit('.lPrice','12.5');
    check(one('.lTotal').value==='125','Unit pricing still computes the line total');
    edit('.lTotal','250');
    check(one('.lPrice').value==='25','Total pricing still computes the unit price');
    check(one('.lPriceMode').value==='total','The source selector follows editing the total');
    edit('.lPriceMode','unit','change');edit('.lQty','20');
    check(one('.lTotal').value==='500','Changing source preserves the selected pricing behavior');
    check(one('#salesOrderTotalPreview b').textContent==='$500.00','Order total remains based on line totals');
    one('#addOrderLine').click();
    const ids=[...doc.querySelectorAll('[id]')].map(node=>node.id);
    check(new Set(ids).size===ids.length,'Dynamic field labels have unique IDs');
    one('#orderModal [data-close="order"]').click();
    check(one('#orderModal').classList.contains('hidden'),'Original close action works');
  }
  check(win.__fixtureCalls.every(call=>!call.method||call.method==='GET'),'Fixture never writes business records');
  dom.window.close();
}
console.log(`Figma Sales DOM: ${checks} checks passed. Layout/browser checks remain separate.`);
