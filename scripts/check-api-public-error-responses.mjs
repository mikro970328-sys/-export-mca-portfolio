import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as realLib from '../api/_lib.js';
import { parseExecutiveFilters } from '../api/_executive-dashboard.js';

// Execute the original handlers. Only authorization, storage and external
// transports are substituted; no database, credentials or messages are used.
const id = '10000000-0000-4000-8000-000000000001';
const internal = 'SUPABASE_500:{"message":"private_sql_internal_sentinel","details":"private_connection_sentinel"}';
const admin = { admin_id:id, username:'qa', role:'master_admin' };
const endpoints = ['ap-links', 'discharge-release-alerts', 'document-bundle', 'documents',
  'export', 'financial-links', 'importers', 'invoice-expediente-context', 'login',
  'manual-tracking-alerts', 'manual-tracking-event', 'operations', 'products', 'reports',
  'shipment-document-readiness', 'shipment-documents', 'stagnant-shipment-alerts', 'suppliers', 'tracking-alerts'];
let checks = 0;

async function request(name, options = {}) {
  let calls = 0;
  const rejected = () => { calls++; throw options.error || new Error(internal); };
  const lib = { ...realLib, supabase:options.supabase || rejected, writeAudit:async()=>{},
    sendWhatsApp:rejected,
    authorizeAdmin:async (req,res) => {
      if (options.denied) { realLib.fail(res,403,'No tienes permiso para realizar esta acción'); return null; }
      return admin;
    }
  };
  const deps = {
    './_lib.js':lib, 'node:crypto':crypto,
    './_document-bundle.js':{ streamContainerDocumentBundle:options.bundle || rejected },
    './_executive-dashboard.js':{ parseExecutiveFilters, loadExecutiveDashboard:rejected },
    './_operation-lifecycle.js':{ operationIsFinalized:()=>false, reconcileOperationLifecycle:async()=>{} },
    './_shipment-actions.js':{ assertShipmentBusinessAction:async()=>{} },
    './_notification-delivery.js':{ claimNotificationDelivery:async()=>({claimed:true,deliveryKey:'qa'}),
      releaseNotificationDelivery:async()=>{}, whatsappMilestoneAllowed:event=>['DEPA','RELEASE'].includes(event) },
    './_alert-lifecycle.js':{ DAY:86400000, HOUR:3600000, loadConditionMap:async()=>new Map() }
  };
  const source = fs.readFileSync(`api/${name}.js`,'utf8')
    .replace(/^import \{([^}]+)\} from '([^']+)';$/gm,(_,bindings,path)=>`const {${bindings}} = deps[${JSON.stringify(path)}];`)
    .replace(/^import (\w+) from '([^']+)';$/gm,(_,binding,path)=>`const ${binding} = deps[${JSON.stringify(path)}];`)
    .replace('export default async function handler','async function handler');
  assert.doesNotMatch(source,/^import |^export /m,'Review the handler adapter when module syntax changes');
  const handler = new Function('deps','console',`${source}\nreturn handler;`)(deps,{error(){},warn(){}});
  const res = {statusCode:0,headers:{},headersSent:options.headersSent || false,destroyed:false,
    setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);},destroy(){this.destroyed=true;}};
  const req = {method:name==='login'?'POST':name==='manual-tracking-event'?'PATCH':'GET',headers:{},
    body:{username:'qa-user',password:'fake-password',id,event:'load'},
    query:{shipment_id:id,invoice_id:id,include_options:'0'},...options.req};
  await handler(req,res);
  return {...res,calls};
}

function expectSafe(response, status, message) {
  assert.equal(response.statusCode,status);
  assert.equal(typeof response.body.error,'string');
  if(message) assert.equal(response.body.error,message);
  assert.doesNotMatch(JSON.stringify(response.body),/sentinel|SUPABASE_|STORAGE_|JWT_|LOGIN_SESSION|"details"/);
  checks++;
}

for (const name of endpoints) {
  expectSafe(await request(name),500);
  expectSafe(await request(name,{error:Object.assign(new Error(internal),{retryable:true})}),503);
  // A recognizable validation phrase embedded in an upstream error must never
  // authorize the rest of that response for public display.
  expectSafe(await request(name,{error:new Error(`Nombre de archivo inválido ${internal}`)}),500);
  if(name!=='login') {
    const denied=await request(name,{denied:true});
    expectSafe(denied,403);
    assert.equal(denied.calls,0,'Permission rejection must precede transport access');
  }
}

for (const [name,req,message,extra] of [
  ['products',{method:'POST',body:{}},'El nombre del producto es obligatorio'],
  ['products',{method:'POST',body:{name:'Panel',unit:'123'}},'La unidad base debe ser texto, por ejemplo: unidades, cajas o paneles'],
  ['products',{method:'POST',body:{name:'Panel',sku:'QA'}},'Ya existe un producto con ese SKU',{supabase:async()=>[{id,sku:'QA'}]}],
  ['suppliers',{method:'POST',body:{}},'El nombre del proveedor es obligatorio'],
  ['importers',{method:'POST',body:{action:'sync_client',client_id:id}},'Cliente no encontrado',{supabase:async()=>[]}],
  ['invoice-expediente-context',{query:{invoice_id:'bad'}},'Factura inválido'],
  ['invoice-expediente-context',{},'Factura no encontrada',{supabase:async()=>[]}],
  ['operations',{method:'POST',body:{}},'Falta el cliente'],
  ['documents',{query:{operation_id:'bad'}},'Expediente inválido'],
  ['shipment-documents',{query:{shipment_id:'bad'}},'Contenedor inválido'],
  ['reports',{query:{dataset:'bad'}},'Reporte inválido.'],
  ['reports',{query:{limit:5001}},'Límite inválido. Usa un valor entre 1 y 5000.'],
  ['reports',{query:{start:'2026-02-30'}},'Fecha inicial inválida.'],
  ['reports',{query:{dataset:'inventory',currency:'USD'}},'El filtro currency no aplica al reporte Inventario actual.'],
  ['login',{body:{username:'!'}},'Nombre de usuario inválido']
]) expectSafe(await request(name,{req,...extra}),400,message);

expectSafe(await request('document-bundle',{bundle:async()=>{throw new Error('Este contenedor todavía no tiene documentación para descargar');}}),400,'Este contenedor todavía no tiene documentación para descargar');
const streaming=await request('document-bundle',{headersSent:true});
assert.equal(streaming.destroyed,true);
assert.equal(streaming.body,undefined,'Do not append a JSON error to a started ZIP stream');checks++;

for(const [code,message] of [
  ['CUBA_DOCUMENT_HISTORICAL_DELETE_FORBIDDEN','Una versión histórica no puede eliminarse desde este flujo.'],
  ['CUBA_DOCUMENT_ALREADY_DELETED','Este documento ya fue eliminado.'],
  ['CUBA_DOCUMENT_NOT_FOUND','Documento no encontrado.']
]) expectSafe(await request('shipment-documents',{error:new Error(`SUPABASE_400:{"message":"${code}","details":"private_sql_internal_sentinel"}`)}),400,message);
expectSafe(await request('manual-tracking-event',{error:new Error('SHIPMENT_ALREADY_DELIVERED')}),409,'Este contenedor ya fue marcado como entregado.');

const previousTemplate = process.env.TWILIO_DEPARTED_CONTENT_SID;
try {
  process.env.TWILIO_DEPARTED_CONTENT_SID='test-only-no-network';
  const result=await request('manual-tracking-event',{
    req:{body:{id,event:'departed'}},
    supabase:async(table,options)=>table==='shipments'&&!options.method?[{id,client_id:id,clients:{active:true,phone:'+15555550100'}}]:[]
  });
  assert.equal(result.statusCode,200);
  assert.equal(result.body.updated,true,'Notification failure must preserve the saved tracking event');
  assert.equal(result.body.notified,false);
  assert.equal(result.body.notification_status,'failed');
  assert.equal(result.body.notification_error,'No se pudo enviar la notificación de WhatsApp');
  assert.doesNotMatch(JSON.stringify(result.body),/sentinel|SUPABASE_/);checks++;
} finally {
  if(previousTemplate===undefined) delete process.env.TWILIO_DEPARTED_CONTENT_SID;
  else process.env.TWILIO_DEPARTED_CONTENT_SID=previousTemplate;
}

console.log(`API public error responses: ${checks} checks passed across ${endpoints.length} handlers (isolated, no external writes).`);
