import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the existing owner, not a copied implementation. The select fixture
// models native replacement of options: innerHTML resets selection, and setting
// a value not present in the new options leaves it empty. Browser acceptance
// additionally exercises the original forms, actual HTTP and real select nodes.
const source=fs.readFileSync('admin/purchases.js','utf8');
const start=source.indexOf('function fillMasters(){');
const end=source.indexOf('\nfunction setPurchaseDestination(',start);
assert.ok(start>=0 && end>start,'Review purchase master-refresh owner boundary');

class Select {
  options=[''];
  selected='';
  set innerHTML(html) {
    this.options=[...html.matchAll(/<option value="([^"]*)"/g)].map(match=>match[1]);
    this.selected=this.options[0]||'';
  }
  get value() { return this.selected; }
  set value(value) { this.selected=this.options.includes(value)?value:''; }
}
function harness() {
  const elements=Object.fromEntries(['oSupplier','oWarehouse','rWarehouse'].map(id=>[id,new Select()]));
  const scope={suppliers:[{id:'supplier-a',name:'Supplier A'}],
    warehouses:[{id:'warehouse-a',code:'A',name:'Warehouse A'},{id:'warehouse-b',code:'B',name:'Warehouse B'}],
    $:id=>elements[id],esc:value=>String(value||'')};
  vm.createContext(scope);vm.runInContext(source.slice(start,end),scope);scope.fillMasters();
  return {elements,scope,refresh:()=>scope.fillMasters()};
}
const cases=[
  ['MR-01 late catalogue response preserves all current form selections',()=>{
    const {elements,refresh}=harness();
    elements.oSupplier.value='supplier-a';elements.oWarehouse.value='warehouse-a';elements.rWarehouse.value='warehouse-b';
    refresh();
    assert.equal(elements.oSupplier.value,'supplier-a');assert.equal(elements.oWarehouse.value,'warehouse-a');
    assert.equal(elements.rWarehouse.value,'warehouse-b');
  }],
  ['MR-02 explicit empty destination stays empty for Direct Ship',()=>{
    const {elements,refresh}=harness();elements.oWarehouse.value='';elements.rWarehouse.value='warehouse-b';
    refresh();assert.equal(elements.oWarehouse.value,'');assert.equal(elements.rWarehouse.value,'warehouse-b');
  }],
  ['MR-03 unavailable master is cleared instead of reintroduced',()=>{
    const {elements,scope,refresh}=harness();elements.oSupplier.value='supplier-a';elements.rWarehouse.value='warehouse-b';
    scope.suppliers=[];scope.warehouses=scope.warehouses.filter(row=>row.id!=='warehouse-b');
    refresh();assert.equal(elements.oSupplier.value,'');assert.equal(elements.rWarehouse.value,'');
  }],
  ['MR-04 repeated refresh keeps the most recent selection and new options',()=>{
    const {elements,scope,refresh}=harness();elements.rWarehouse.value='warehouse-a';refresh();
    elements.rWarehouse.value='warehouse-b';scope.warehouses.push({id:'warehouse-c',code:'C',name:'Warehouse C'});
    refresh();refresh();assert.equal(elements.rWarehouse.value,'warehouse-b');assert.ok(elements.rWarehouse.options.includes('warehouse-c'));
  }]
];
let failed=0;
for (const [name,run] of cases) {
  try { run();console.log(`PASS ${name}`); }
  catch(error) { failed++;console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`Purchase master refresh: ${cases.length-failed}/${cases.length}.`);
if(failed)process.exitCode=1;
