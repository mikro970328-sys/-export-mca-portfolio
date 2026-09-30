import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const source=fs.readFileSync('admin/notification-inbox.js','utf8');
const publicKey='A'.repeat(87);
const oldId='11111111-1111-4111-8111-111111111111';
const newId='22222222-2222-4222-8222-222222222222';
async function harness({status='expired',sessionValid=false,permission='granted',pushEnabled=false,
  deleteStatus=200,unsubscribe=true,postStatus=200,readFailure=false}={}) {
  const dom=new JSDOM('<div class="topbar-actions"></div>',{url:'https://erp.example/admin/',runScripts:'outside-only'});
  const w=dom.window,calls=[];
  let requests=0,subscriptions=0,unsubscribes=0,registered=false;
  const subscription=(endpoint)=>({endpoint,expirationTime:null,
    options:{applicationServerKey:new Uint8Array(65).buffer},
    toJSON:()=>({endpoint,keys:{p256dh:'B'.repeat(87),auth:'C'.repeat(22)}}),
    unsubscribe:async()=>{unsubscribes++;return unsubscribe;}});
  const old=subscription('https://push.example/expired'),fresh=subscription('https://push.example/fresh');
  const devices=()=>registered?[{id:newId,status:'active',session_valid:true,device_label:'QA new'}]:[
    {id:oldId,status,session_valid:sessionValid,device_label:'QA old',last_seen_at:'2026-09-26T00:00:00Z'}];
  w.Notification={permission,requestPermission:async()=>{requests++;return permission;}};
  w.PushManager=function(){};
  Object.defineProperty(w.navigator,'serviceWorker',{value:{ready:Promise.resolve({pushManager:{
    getSubscription:async()=>old,
    subscribe:async()=>{subscriptions++;return fresh;}
  }})}});
  w.localStorage.setItem('export_mca_push_subscription_id',oldId);
  w.api=async(path,options={})=>{
    const method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
    calls.push({path,method,body});
    if(path==='/api/notification-inbox')return{items:[],counts:{total:0,unread:0},preferences:{push_enabled:registered||pushEnabled}};
    assert.equal(path,'/api/push-subscriptions');
    if(method==='GET'){
      if(readFailure)throw Error('synthetic private diagnostic');
      return{config:{ready:true,public_key:publicKey},devices:devices()};
    }
    if(method==='DELETE'&&deleteStatus!==200){const e=Error('synthetic failure');e.status=deleteStatus;throw e;}
    if(method==='POST'){
      if(postStatus!==200){const e=Error('synthetic failure');e.status=postStatus;throw e;}
      registered=true;return{subscription:{subscription_id:newId},devices:devices()};
    }
    return{};
  };
  // The fixture never grants a real browser permission or contacts a provider.
  w.console.error=()=>{};
  w.eval(source);
  await new Promise(setImmediate);
  await w.NotificationInbox.open();
  await w.document.querySelector('[data-notification-view="preferences"]').onclick();
  return{w,calls,activate:()=>w.document.getElementById('enablePushDevice').onclick(),
    counters:()=>({requests,subscriptions,unsubscribes}),close:()=>w.close()};
}

for(const [status,sessionValid] of [['expired',false],['revoked',false],['active',false]]){
  const h=await harness({status,sessionValid});
  try{
    assert.match(h.w.document.querySelector('.push-availability').textContent,/Activa este dispositivo/);
    assert.equal(h.w.document.querySelector('.push-availability').classList.contains('ok'),false);
    assert.equal(h.w.document.querySelector('[data-notification-pref="push_enabled"]').disabled,true);
    assert.deepEqual(h.counters(),{requests:0,subscriptions:0,unsubscribes:0},'loading must never ask permission or renew');
    await h.activate();
    assert.deepEqual(h.counters(),{requests:1,subscriptions:1,unsubscribes:1});
    const mutations=h.calls.filter(c=>c.method!=='GET');
    assert.deepEqual(mutations.map(c=>c.method),['DELETE','POST']);
    assert.equal(mutations[0].body.reason,'subscription_renewed');
    assert.equal(mutations[1].body.subscription.endpoint,'https://push.example/fresh');
    assert.equal(h.w.localStorage.getItem('export_mca_push_subscription_id'),newId);
    assert.match(h.w.document.querySelector('.push-availability').textContent,/activo para recibir avisos/);
  }finally{h.close();}
}

for(const pushEnabled of [false,true]){
  const h=await harness({status:'active',sessionValid:true,pushEnabled});
  try{
    assert.equal(h.w.document.querySelector('.push-availability').classList.contains('ok'),pushEnabled);
    if(!pushEnabled)assert.match(h.w.document.querySelector('.push-availability').textContent,/preferencias/);
    await h.activate();
    assert.deepEqual(h.counters(),{requests:1,subscriptions:0,unsubscribes:0},'valid subscription is retained');
  }finally{h.close();}
}

for(const options of [{deleteStatus:404},{deleteStatus:401},{unsubscribe:false},{postStatus:503},{permission:'denied'},{readFailure:true}]){
  const h=await harness(options);
  try{
    if(options.readFailure){
      assert.match(h.w.document.querySelector('.push-availability').textContent,/No se pudieron consultar/);
      assert.ok(!h.w.document.body.textContent.includes('synthetic private diagnostic'));
      continue;
    }
    await h.activate();
    if(options.deleteStatus===404){assert.equal(h.counters().subscriptions,1);continue;}
    assert.notEqual(h.w.localStorage.getItem('export_mca_push_subscription_id'),newId);
    if(options.deleteStatus===401||options.unsubscribe===false)assert.equal(h.counters().subscriptions,0);
    if(options.unsubscribe===false)assert.match(h.w.document.getElementById('notificationInboxMessage').textContent,/No se pudo renovar/);
    if(options.postStatus===503)assert.equal(h.counters().unsubscribes,2,'failed registration cleans up the newly created browser subscription');
    if(options.permission==='denied')assert.equal(h.calls.filter(c=>c.method!=='GET').length,0);
  }finally{h.close();}
}
console.log('Push device renewal: expiry, revoked sessions, consent, preferences and failure cleanup passed; no provider contacted.');
