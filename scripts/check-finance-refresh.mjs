import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the whole existing refresh runtime; only browser/clock/HTTP are fixtures.
function harness(){
  let now=0,nextId=0,reportModal=false;const timers=new Map(),observers=[],listeners=new Map();
  const count={reports:0,invoices:0,dashboard:0};
  const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  async function advance(ms){const end=now+ms;for(let i=0;i<100;i++){
    await settle();const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!next){now=end;return;}now=next[1].at;timers.delete(next[0]);next[1].fn();
  }throw Error('Refresh timer loop');}
  class Observer{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){}}
  class Event{constructor(type,options={}){this.type=type;this.detail=options.detail;}}
  const reportDoc={body:{},readyState:'complete',defaultView:{getComputedStyle:()=>({visibility:'visible'})},
    querySelectorAll:()=>reportModal?[{getClientRects:()=>[{}]}]:[]};
  const reports={contentDocument:reportDoc,contentWindow:{fetch:async()=>({ok:true}),CustomEvent:Event,dispatchEvent(){},ExecutiveReports:{async refresh(){count.reports++;}}},closest:()=>({id:'reportsSection'}),addEventListener(){}};
  const invoices={contentDocument:{body:{},readyState:'complete',querySelectorAll:()=>[]},contentWindow:{fetch:async()=>({ok:true}),CustomEvent:Event,dispatchEvent(){},InvoicesModule:{async refresh(){count.invoices++;}}},closest:()=>({id:'invoicesSection'}),addEventListener(){}};
  const doc={readyState:'complete',body:{},querySelectorAll:s=>s==='.app-section iframe'?[reports,invoices]:[],
    querySelector:s=>s==='#reportsSection iframe'?reports:s==='#invoicesSection iframe'?invoices:null};
  const win={navigator:{onLine:true},fetch:async()=>({ok:true}),
    addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(handler);},
    dispatchEvent(event){for(const handler of listeners.get(event.type)||[])handler(event);},
    ExportMcaAdminData:{async loadCore(){},async loadDashboard(){count.dashboard++;}}};win.parent=win;
  vm.runInNewContext(fs.readFileSync('admin/embedded-auto-refresh.js','utf8'),{
    window:win,document:doc,location:{href:'https://fixture.invalid/admin/index.html',hash:'',pathname:'/admin/index.html',search:''},
    history:{state:null,replaceState(){}},localStorage:{getItem:()=>null,setItem(){}},MutationObserver:Observer,CustomEvent:Event,
    CSS:{escape:x=>x},URL,console,AbortController,setTimeout(fn,delay=0){const id=++nextId;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)
  });
  return {win,invoices,count,advance,live:win.ExportMcaEmbeddedAutoRefresh,
    modal(open){reportModal=open;for(const observer of observers)observer.callback([]);}};
}

const passed=[],failures=[];
async function test(name,run){try{await run();passed.push(name);console.log(`PASS ${name}`);}catch(error){failures.push(name);console.error(`FAIL ${name}: ${error.message}`);}}
await test('REF-01 local invoice, advance, supplier and cost actions refresh reports',async()=>{
  const h=harness();let expected=0;
  for(const path of ['/api/invoices','/api/invoice-payments','/api/customer-advances','/api/supplier-payments','/api/costs']){
    await h.win.fetch(path,{method:'POST'});await h.advance(600);assert.equal(h.count.reports,++expected,`${path} left report stale`);
  }
});
await test('REF-02 another session financial change refreshes reports once',async()=>{
  const h=harness(),versions={sales:0,invoices:0,payables:0,costs:0};h.live.applyLiveSnapshot({versions});
  let expected=0;for(const scope of Object.keys(versions)){
    versions[scope]++;h.live.applyLiveSnapshot({versions});await h.advance(600);assert.equal(h.count.reports,++expected);
    h.live.applyLiveSnapshot({versions});await h.advance(600);assert.equal(h.count.reports,expected,'unchanged versions must stay quiet');
  }
});
await test('REF-03 embedded invoice action refreshes report while preserving its source refresh',async()=>{
  const h=harness();await h.invoices.contentWindow.fetch('/api/invoice-payments',{method:'POST'});await h.advance(600);
  assert.equal(h.count.reports,1);assert.equal(h.count.invoices,1);assert.equal(h.count.dashboard,1);
});
await test('REF-04 report modal defers refresh until closing',async()=>{
  const h=harness();h.modal(true);h.live.queueExternalScopes(['sales'],'QA');await h.advance(600);assert.equal(h.count.reports,0);
  h.modal(false);await h.advance(200);assert.equal(h.count.reports,1);
});
await test('REF-05 role change reloads current capabilities in other open workspaces',async()=>{
  const h=harness();h.live.applyLiveSnapshot({versions:{account:0,invoices:0}});
  h.live.applyLiveSnapshot({versions:{account:1,invoices:0}});await h.advance(600);
  assert.equal(h.count.invoices,1,'invoice capabilities must refresh without an invoice mutation');
  assert.equal(h.count.reports,1,'report access must reflect the same role change');
  h.live.applyLiveSnapshot({versions:{account:1,invoices:0}});await h.advance(600);
  assert.equal(h.count.invoices,1,'an unchanged role version must remain quiet');
});
await test('REF-06 local role updates preserve modal deferral',async()=>{
  const h=harness();h.modal(true);
  await h.win.fetch('/api/access-control?resource=roles',{method:'PATCH'});await h.advance(600);
  assert.equal(h.count.invoices,1);assert.equal(h.count.reports,0);
  h.modal(false);await h.advance(200);assert.equal(h.count.reports,1);
});
console.log(`Finance refresh acceptance: ${passed.length}/${passed.length+failures.length}.`);
if(failures.length)process.exitCode=1;
