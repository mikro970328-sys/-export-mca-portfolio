import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('admin/embedded-auto-refresh.js','utf8');
const settle=async()=>{for(let i=0;i<30;i+=1)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const response=(versions,status=200)=>({status,ok:status>=200&&status<300,json:async()=>({versions:{...versions}})});

function harness(shared={tasks:0,products:0}) {
  let now=0;
  let nextTimer=1;
  const timers=new Map();
  const listeners=new Map();
  const observers=[];
  const storage=new Map([['export_mca_token','fixture-token-A']]);
  const calls=[];
  const statuses=[];
  const counters={core:0,dashboard:0,tasks:0,expired:0};
  const dom={modal:false,visibility:'visible'};
  // Actual shell dialogs keep role="dialog" on a child of a hidden overlay.
  // They match the selector even while getClientRects() is empty.
  const hiddenDialogs=Array.from({length:3},()=>({getClientRects:()=>[]}));
  const activeDialog={getClientRects:()=>dom.modal?[{}]:[]};
  let transport=async()=>response(shared);
  const clock={
    setTimeout(fn,delay=0){const id=nextTimer++;timers.set(id,{at:now+delay,fn});return id;},
    clearTimeout(id){timers.delete(id);},
    pending(){return [...timers.values()].map(timer=>timer.at-now);},
    async advance(ms){
      const target=now+ms;
      let count=0;
      while(true){
        await settle();
        const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next)break;
        assert(++count<1000,'timer runaway');
        now=next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      now=target;
      await settle();
    }
  };
  class FixtureEvent {constructor(type,options={}){this.type=type;this.detail=options.detail;}}
  class FixtureObserver {
    constructor(callback){this.callback=callback;observers.push(this);}
    observe(){}
    disconnect(){}
  }
  const win={
    navigator:{onLine:true},
    addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(handler);},
    dispatchEvent(event){for(const handler of listeners.get(event.type)||[])handler(event);},
    fetch:async(path,options={})=>{calls.push({path,options});return transport(path,options);},
    TasksWorkspace:{async load(){counters.tasks+=1;}},
    ExportMcaAdminData:{async loadCore(){counters.core+=1;},async loadDashboard(){counters.dashboard+=1;}},
    ExportMcaAdminShellRuntime:{transitionExpiredSession(){counters.expired+=1;}}
  };
  win.parent=win;
  win.addEventListener('export-mca:live-sync-status',event=>statuses.push(event.detail));
  const doc={
    readyState:'complete',body:{},hidden:false,addEventListener(){},
    defaultView:{getComputedStyle:node=>({visibility:node===activeDialog?dom.visibility:'visible'})},
    querySelector(selector){return selector.startsWith('.modal')?hiddenDialogs[0]:null;},
    querySelectorAll(selector){return selector.includes('.modal')?[hiddenDialogs[0],activeDialog,...hiddenDialogs.slice(1)]:[];}
  };
  vm.runInNewContext(source,{
    window:win,document:doc,
    location:{href:'https://fixture.invalid/admin/index.html',hash:'',pathname:'/admin/index.html',search:''},
    history:{state:null,replaceState(){}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    fetch:(...args)=>win.fetch(...args),
    AbortController,MutationObserver:FixtureObserver,CustomEvent:FixtureEvent,
    CSS:{escape:value=>value},URL,console:{warn(){},error(){}},
    setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout
  });
  return {
    live:win.ExportMcaEmbeddedAutoRefresh,clock,calls,statuses,counters,win,doc,
    transport(fn){transport=fn;},
    token(value){if(value)storage.set('export_mca_token',value);else storage.delete('export_mca_token');},
    event(type,extra={}){win.dispatchEvent({type,...extra});},
    modal(open,visibility='visible'){dom.modal=open;dom.visibility=visibility;for(const observer of observers)observer.callback([]);}
  };
}

// Independent sessions observe the same source without manually reloading pages.
const shared={tasks:0,products:0};
const first=harness(shared);
const second=harness(shared);
await first.live.pollLiveState();
await second.live.pollLiveState();
assert.equal(first.counters.tasks+second.counters.tasks,0,'baseline must not trigger passive refreshes');
shared.tasks=1;
await first.clock.advance(4200);
await second.clock.advance(4200);
assert.equal(first.counters.tasks,1,'dialogs inside hidden overlays must not block live updates');
assert.equal(second.counters.tasks,1);
await first.clock.advance(12000);
assert.equal(first.counters.tasks,1,'unchanged versions must settle without refresh loops');
second.modal(true);
shared.tasks=2;
await second.clock.advance(4200);
assert.equal(second.counters.tasks,1,'external changes must wait for the editor');
second.modal(false);
await second.clock.advance(200);
assert.equal(second.counters.tasks,2,'closing the editor applies the pending change');
for(const visibility of ['hidden','collapse']){
  second.modal(true,visibility);
  shared.tasks+=1;
  await second.clock.advance(4200);
  assert.equal(second.counters.tasks,shared.tasks,'CSS-hidden dialogs must not block updates');
}
second.modal(false);
first.live.stopLiveSync();second.live.stopLiveSync();

// A timeout must release the running flag even if a fetch ignores AbortSignal.
for(const hungBody of [false,true]){
  const h=harness();
  h.transport(async()=>hungBody?{status:200,ok:true,json:()=>new Promise(()=>{})}:new Promise(()=>{}));
  const pending=h.live.pollLiveState();
  await settle();
  assert.equal(await h.live.pollLiveState(),false,'never overlap live requests');
  await h.clock.advance(12000);
  assert.equal(await pending,false,'hung response must time out');
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].options.signal.aborted,true);
  assert(h.clock.pending().includes(8000),'retry backs off after timeout');
  h.transport(async()=>response({tasks:0}));
  await h.clock.advance(8000);
  assert.equal(h.calls.length,2,'polling resumes without reloading');
  assert.equal(h.statuses.at(-1).status,'connected');
  assert(h.clock.pending().includes(4000),'success resets retry delay');
  h.live.stopLiveSync();
}

const recovery=harness();
await recovery.live.pollLiveState();
recovery.transport(async()=>response({},503));
await recovery.live.pollLiveState();
assert.equal(recovery.statuses.at(-1).status,'retrying');
recovery.transport(async()=>response({tasks:1,products:0}));
await recovery.clock.advance(8200);
assert.equal(recovery.counters.tasks,1,'connection failure must preserve previous versions');
for(const versions of [[],{}, {tasks:true},{tasks:-1},{tasks:null},{tasks:[1]}]){
  recovery.transport(async()=>({status:200,ok:true,json:async()=>({versions})}));
  await recovery.live.pollLiveState();
  assert.equal(recovery.statuses.at(-1).status,'retrying','invalid payload must not reset baseline');
  recovery.transport(async()=>response({tasks:1,products:0}));
  await recovery.clock.advance(8200);
  assert.equal(recovery.counters.tasks,1,'valid unchanged response after malformed data stays quiet');
}
recovery.doc.hidden=true;
await recovery.live.pollLiveState();
assert(recovery.clock.pending().includes(15000),'background polling uses slower cadence');
recovery.live.stopLiveSync();

const offline=harness();
await offline.live.pollLiveState();
offline.win.navigator.onLine=false;
offline.event('offline');
await offline.clock.advance(60000);
assert.equal(offline.calls.length,1,'no requests while offline');
offline.transport(async()=>response({tasks:1,products:0}));
offline.win.navigator.onLine=true;
offline.event('online');
await offline.clock.advance(200);
assert.equal(offline.counters.tasks,1,'online event resumes comparisons automatically');
offline.event('pagehide');
await offline.clock.advance(60000);
assert.equal(offline.calls.length,2,'pagehide pauses the scheduler');
offline.event('pageshow');
await offline.clock.advance(200);
assert.equal(offline.calls.length,3,'pageshow restarts the scheduler without another data refresh');
assert.equal(offline.counters.tasks,1);
offline.live.stopLiveSync();

// Late success/401 from the old token cannot repaint or invalidate the new user.
for(const status of [200,401]){
  const h=harness();
  const old=deferred();
  h.transport(()=>old.promise);
  const pending=h.live.pollLiveState();
  await settle();
  h.token('fixture-token-B');
  h.event('storage',{key:'export_mca_token',newValue:'fixture-token-B'});
  h.transport(async()=>response({tasks:5}));
  await h.clock.advance(0);
  old.resolve(response({tasks:999},status));
  await pending;
  await h.clock.advance(200);
  assert.equal(h.counters.expired,0,'old session response must not log out new user');
  assert.equal(h.counters.tasks,0,'old session response must not repaint new user');
  assert(h.calls.at(-1).options.headers.Authorization.endsWith('fixture-token-B'));
  h.live.stopLiveSync();
}

const logout=harness();
const late=deferred();
logout.transport(()=>late.promise);
const pendingLogout=logout.live.pollLiveState();
await settle();
logout.event('export-mca:session-ending');
late.resolve(response({tasks:9}));
await pendingLogout;
await logout.clock.advance(60000);
assert.equal(logout.calls.length,1,'session ending stops polling even before token removal');
assert.equal(logout.counters.tasks,0);
assert.equal(logout.statuses.length,0,'cancelled request must not claim connection success');

const unauthorized=harness();
unauthorized.transport(async()=>response({},401));
assert.equal(await unauthorized.live.pollLiveState(),false);
await unauthorized.clock.advance(60000);
assert.equal(unauthorized.counters.expired,1);
assert.equal(unauthorized.calls.length,1,'current unauthorized session must not retry forever');

console.log('Live sync recovery runtime: two sessions, modal, timeouts, retries, offline, background, logout and stale responses OK');
