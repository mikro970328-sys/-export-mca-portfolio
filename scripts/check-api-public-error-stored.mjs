import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as realLib from '../api/_lib.js';

// Original API handlers and response serializers; only authorization, database,
// lifecycle capabilities and provider transports are substituted. No network,
// credentials, production records or customer messages are used.
globalThis.fetch = async () => { throw new Error('Unexpected network access in isolated acceptance'); };
const id='10000000-0000-4000-8000-000000000001';
const internal='SUPABASE_500:{"message":"private_sql_internal_sentinel","details":"private_connection_sentinel"}';
const provider='TWILIO_30001:private_provider_sentinel';
const admin={admin_id:id,username:'qa',role:'master_admin'};
const failed={id,status:'failed',delivery_status:'failed',notification_scope:'message',event_type:'release',
  error_message:internal,attempt_count:2,provider_message_id:'test-provider-id',
  clients:{name:'Cliente "QA"',phone:'+15555550100'},shipments:{container_number:'QA-TEST'},
  payload:{container_number:'QA-TEST',error:provider,previous:[{error_message:internal}]}};
const client={id,name:'Cliente QA',company:'Empresa QA',phone:'+15555550100',active:true,welcome_status:'failed',welcome_error:internal};
const shipment={id,client_id:id,operation_id:id,container_number:'QA-TEST',active:true,
  operational_status:'Registrado',release_notification_status:'failed',release_notification_error:internal,clients:client};
const copy=value=>JSON.parse(JSON.stringify(value));
const failures=[];
let checks=0;
async function check(name,fn){try{await fn();checks++;console.log('PASS '+name);}catch(error){failures.push(name);console.error('FAIL '+name+': '+error.message);}}
function safe(response,status=200){assert.equal(response.statusCode,status);assert.doesNotMatch(response.text,/private_\w+_sentinel|SUPABASE_|TWILIO_30001/);}
function safeError(value){assert.equal(typeof value,'string');assert.ok(value.trim());assert.doesNotMatch(value,/sentinel|SUPABASE_|TWILIO_30001/);}

async function request(name,options={}){
  const calls=[],writes=[],permissions=[];
  const lib={...realLib,
    authorizeAdmin:async(req,res,permission)=>{
      permissions.push(permission);
      if(options.denied){realLib.fail(res,403,'No tienes permiso para realizar esta acción');return null;}
      return admin;
    },
    supabase:async(table,params={})=>{
      calls.push({table,...params});
      if(params.method)writes.push({table,...copy(params)});
      return copy(await (options.database||(async()=>[]))(table,params));
    },
    sendWhatsApp:options.send||(async()=>{throw new Error(provider);}),
    writeAudit:async(...args)=>{writes.push({table:'audit_log',args:copy(args)});}
  };
  const deps={
    './_lib.js':lib,'node:crypto':crypto,
    './_operation-lifecycle.js':{reconcileOperationLifecycle:async()=>{}},
    './_shipment-actions.js':{assertShipmentBusinessAction:options.businessAction||(async()=>{}),
      loadShipmentActionCapabilityMap:async()=>({map:new Map([[id,{actions:{edit:{allowed:true}}}]]),write_access:true}),
      loadShipmentActionCapabilities:async()=>({actions:{edit:{allowed:true}}})},
    './_notification-delivery.js':{
      claimNotificationDelivery:async()=>({claimed:true,deliveryKey:'test-delivery'}),
      releaseNotificationDelivery:options.releaseClaim||(async()=>{}),
      whatsappMilestoneAllowed:event=>['DEPA','RELEASE'].includes(event)
    }
  };
  const source=fs.readFileSync('api/'+name+'.js','utf8')
    .replace(/^import \{([^}]+)\} from '([^']+)';$/gm,(_,bindings,path)=>'const {'+bindings+'} = deps['+JSON.stringify(path)+'];')
    .replace(/^import (\w+) from '([^']+)';$/gm,(_,binding,path)=>'const '+binding+' = deps['+JSON.stringify(path)+'];')
    .replace('export default async function handler','async function handler');
  assert.doesNotMatch(source,/^import |^export /m,'Review handler adapter after module syntax changes');
  const handler=new Function('deps','console',source+'\nreturn handler;')(deps,{error(){},warn(){}});
  const res={statusCode:0,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},
    end(body){this.text=String(body);if(this.headers['content-type']?.includes('application/json'))this.body=JSON.parse(body);}};
  await handler({method:'GET',headers:{},query:{},body:{},...options.req},res);
  return {...res,calls,writes,permissions};
}

for(const name of ['shipments','clients']){
  await check(name+' list retains business fields and hides persisted diagnosis',async()=>{
    const fixture=name==='shipments'?shipment:client,before=JSON.stringify(fixture);
    const r=await request(name,{database:async table=>table===name?[fixture]:[]});
    safe(r);assert.equal(JSON.stringify(fixture),before);
    const row=r.body[name][0];assert.equal(row.id,id);
    if(name==='shipments'){assert.equal(row.fulfillment.mode,'unlinked');assert.equal(row.capabilities.actions.edit.allowed,true);safeError(row.release_notification_error);}
    else {assert.equal(row.name,client.name);assert.equal(row.welcome_status,'failed');safeError(row.welcome_error);}
    assert.equal(r.writes.length,0,'Read projection must never rewrite diagnosis');
  });
  for(const fallback of [false,true]) await check(name+' edit '+(fallback?'empty PATCH fallback':'returned record')+' hides diagnosis',async()=>{
    const fixture=name==='shipments'?shipment:client;
    const r=await request(name,{req:{method:'PATCH',body:{id,company:'Editada',product:'Panel'}},
      database:async(table,p)=>{
        if(table!==name)return [];
        if(p.method==='PATCH')return fallback?[]:[{...fixture,...p.body}];
        if(p.query.includes('select=*'))return [fixture];
        return [];
      }});
    safe(r);const row=r.body[name==='shipments'?'shipment':'client'];assert.equal(row.id,id);
    assert.equal(row[name==='shipments'?'release_notification_status':'welcome_status'],'failed');
    const patch=r.writes.find(x=>x.table===name&&x.method==='PATCH').body;
    assert.equal(Object.hasOwn(patch,name==='shipments'?'release_notification_error':'welcome_error'),false);
  });
  await check(name+' create response uses the same public projection',async()=>{
    const fixture=name==='shipments'?shipment:client;
    const r=await request(name,{req:{method:'POST',body:{name:'Cliente QA',phone:'+15555550100',container_number:'QA-TEST'}},
      database:async(table,p)=>table===name&&p.method==='POST'?[fixture]:[]});
    safe(r);assert.equal(r.body[name==='shipments'?'shipment':'client'].id,id);
  });
}

for(const scope of ['', 'operational'])await check('notifications '+(scope||'message')+' filtered list protects nested diagnosis',async()=>{
  const notification={...failed,notification_scope:scope||'message',alert_status:'pending'};
  const r=await request('history',{req:{query:{mode:'notifications',scope,status:'failed'}},
    database:async table=>table==='operational_alert_conditions'?[{notification_id:id,condition_active:true}]:[notification]});
  safe(r);assert.equal(r.body.notifications.length,1);
  const row=r.body.notifications[0];safeError(row.error_message);safeError(row.payload.error);
  assert.equal(row.normalized_status,'failed');assert.equal(row.attempt_count,2);assert.equal(row.provider_message_id,'test-provider-id');
  assert.equal(r.writes.length,0);
});

for(const action of ['mark_read','resolve','snooze','reopen'])await check('operational '+action+' result keeps action and protects diagnosis',async()=>{
  const notification={...failed,notification_scope:'operational',alert_status:action==='resolve'?'resolved':'pending'};
  const r=await request('history',{req:{method:'PATCH',query:{mode:'notifications'},body:{id,action,hours:2}},
    database:async table=>table==='rpc/act_on_operational_alert'?{action,notification_id:id}:[notification]});
  safe(r);assert.equal(r.body.result.action,action);assert.equal(r.body.notification.id,id);
  assert.deepEqual(r.permissions,[action==='mark_read'?'notifications.read':'notifications.manage']);
});

const historyRows=[
  {id:'business',event_type:'updated',title:'Datos actualizados',details:'Producto: Panel; cantidad: 12'},
  {id:'release',event_type:'release_failed',title:'Contenedor liberado; falló la notificación',details:provider},
  ...['manual_depa','manual_release','manual_correction_depa','manual_correction_release'].map(event_type=>({
    id:event_type,event_type,title:'Tracking ERP',details:'Registrado → Liberado · Confirmado por qa · Falló WhatsApp: '+provider})),
  {id:'success',event_type:'manual_depa',title:'Tracking ERP',details:'Registrado → Salió del puerto · Confirmado por qa · WhatsApp: test-provider-id'}
];
for(const entity of ['shipment_id','client_id'])await check(entity+' history preserves events and internal diagnosis without exposing it',async()=>{
  const audit=[{action:'welcome_failed',entity_id:id,details:{error:internal,attempt:2,actor:'qa'}}];
  const before=JSON.stringify({historyRows,failed,audit});
  const r=await request('history',{req:{query:{[entity]:id}},
    database:async table=>table==='shipment_history'?historyRows:table==='notifications'?[failed]:audit});
  safe(r);assert.equal(JSON.stringify({historyRows,failed,audit}),before);
  assert.equal(r.body.events.length,historyRows.length);
  assert.equal(r.body.events[0].details,historyRows[0].details);
  assert.equal(r.body.events.at(-1).details,historyRows.at(-1).details);
  for(const event of r.body.events.slice(2,-1))assert.match(event.details,/Confirmado por qa/);
  assert.equal(r.body.notifications[0].delivery_status,'failed');
  assert.equal(r.writes.length,0);
  if(entity==='client_id'){assert.equal(r.body.audit_events[0].details.attempt,2);safeError(r.body.audit_events[0].details.error);}
});

await check('CSV export preserves columns, quoted names and IDs while masking diagnosis',async()=>{
  const r=await request('export',{req:{query:{mode:'notifications'}},database:async()=>[failed,{...failed,error_message:null}]});
  safe(r);assert.match(r.headers['content-type'],/text\/csv/);
  const lines=r.text.split('\n');assert.equal(lines.length,3);
  assert.match(lines[0],/"Proveedor ID","Error"$/);assert.match(lines[1],/"Cliente ""QA"""/);
  assert.match(lines[1],/"failed","failed","test-provider-id","[^"]+"/);
  assert.match(lines[2],/"test-provider-id",""$/);assert.equal(r.writes.length,0);
});

await check('empty errors and known public setup message remain useful',async()=>{
  const rows=[null,'','Plantilla no configurada','Plantilla no configurada '+internal].map((welcome_error,index)=>({...client,id:String(index),welcome_error}));
  const r=await request('clients',{database:async()=>rows});safe(r);
  assert.deepEqual(r.body.clients.slice(0,3).map(x=>x.welcome_error),[null,'','Plantilla no configurada']);
  safeError(r.body.clients[3].welcome_error);
});

const originalTemplate=process.env.TWILIO_RELEASE_CONTENT_SID;
try{
  process.env.TWILIO_RELEASE_CONTENT_SID='test-only-no-network';
  await check('release succeeds with safe partial failure and retains private evidence',async()=>{
    let sends=0,releases=0;
    const r=await request('shipments',{req:{method:'PATCH',body:{id,action:'release'}},
      database:async(table,p)=>table==='shipments'&&!p.method?[shipment]:[],
      send:async()=>{sends++;throw new Error(provider);},releaseClaim:async()=>{releases++;}});
    safe(r);assert.equal(r.body.released,true);assert.equal(r.body.notification_status,'failed');safeError(r.body.notification_error);
    assert.equal(sends,1);assert.equal(releases,1);
    assert.equal(r.writes.find(x=>x.table==='shipments').body.release_notification_error,provider);
    assert.equal(r.writes.find(x=>x.table==='notifications').body[0].error_message,provider);
    assert.equal(r.writes.find(x=>x.table==='shipment_history').body[0].details,provider);
    assert.equal(r.writes.find(x=>x.table==='audit_log').body[0].details.error,provider);
  });
}finally{if(originalTemplate===undefined)delete process.env.TWILIO_RELEASE_CONTENT_SID;else process.env.TWILIO_RELEASE_CONTENT_SID=originalTemplate;}

for(const retryable of [false,true])await check('shipments unknown upstream error '+(retryable?'503':'500')+' does not expose transport body',async()=>{
  const r=await request('shipments',{database:async()=>{throw Object.assign(new Error(internal),{retryable});}});
  safe(r,retryable?503:500);safeError(r.body.error);
});
for(const [body,message] of [
  [{container_number:'QA',quantity:-1},'Cantidad inválida'],
  [{container_number:'QA',departure_date:'bad'},'Fecha de salida inválida']
])await check('shipments known validation: '+message,async()=>{
  const r=await request('shipments',{req:{method:'POST',body}});safe(r,400);assert.equal(r.body.error,message);
});
await check('shipments canonical linked-load rejection retains 409',async()=>{
  const r=await request('shipments',{req:{method:'DELETE',query:{id}},database:async()=>[shipment],
    businessAction:async()=>{throw new Error('SHIPMENT_LINKED_TO_LOAD '+internal);}});
  safe(r,409);assert.match(r.body.error,/Cargue/);assert.equal(r.writes.length,0);
});
for(const name of ['shipments','clients','history','export'])await check(name+' denied authorization precedes data and messages',async()=>{
  const r=await request(name,{denied:true,req:{query:name==='history'?{mode:'notifications'}:{}}});
  safe(r,403);assert.equal(r.calls.length,0);assert.equal(r.writes.length,0);
});
console.log('Stored/indirect public errors: '+checks+' passed; '+failures.length+' failed (isolated original handlers; no external writes).');
if(failures.length)process.exitCode=1;
