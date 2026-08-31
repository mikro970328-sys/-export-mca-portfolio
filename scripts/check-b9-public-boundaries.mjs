import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import twilio from 'twilio';
import { parseTwilioFormBody, validateTwilioRequest } from '../api/_twilio-webhook.js';

const root=process.cwd();
const failures=[];
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

const packageJson=JSON.parse(read('package.json'));
if(packageJson.dependencies?.twilio!=='6.1.0') failures.push('package.json: Twilio SDK must be pinned to 6.1.0');

const twilioHandler=read('api/twilio-status.js');
for(const required of [
  "bodyParser: false",
  "req.headers['x-twilio-signature']",
  'TWILIO_STATUS_CALLBACK_URL',
  'validateTwilioRequest({',
  "return fail(res, 403, 'Firma Twilio inválida')",
  "return fail(res, 503, 'Webhook no disponible')"
]){
  if(!twilioHandler.includes(required)) failures.push(`api/twilio-status.js: falta ${required}`);
}
const validationIndex=twilioHandler.indexOf('validateTwilioRequest({');
const mutationIndex=twilioHandler.indexOf("await supabase('notifications'");
if(validationIndex<0||mutationIndex<0||validationIndex>mutationIndex){
  failures.push('api/twilio-status.js: la validación de firma debe ocurrir antes de cualquier mutación Supabase');
}
if(/return\s+ok\s*\(\s*res\s*,\s*\{\s*received:\s*true\s*\}\s*\)\s*;?\s*\}\s*catch/s.test(twilioHandler)){
  failures.push('api/twilio-status.js: no debe ocultar fallas internas devolviendo 200 en catch');
}

for(const rel of ['api/public-marketplace.js','api/public-tracking.js']){
  const src=read(rel);
  if(!/fail\s*\(\s*res\s*,\s*410\b/.test(src)) failures.push(`${rel}: debe responder 410 Gone`);
  if(/\bsupabase\b/.test(src)) failures.push(`${rel}: un endpoint retirado no debe conservar acceso service-role a Supabase`);
}

const runtimeExtensions=new Set(['.js','.mjs','.html','.json']);
const excluded=new Set([
  'api/public-marketplace.js',
  'api/public-tracking.js',
  'scripts/check-b9-public-boundaries.mjs',
  'scripts/audit-b9-api-boundaries.mjs'
]);
const routes=['/api/public-marketplace','/api/public-tracking'];
const refs=[];
function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(['.git','node_modules'].includes(entry.name)) continue;
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) { walk(full); continue; }
    const rel=path.relative(root,full).replaceAll('\\','/');
    if(excluded.has(rel)||!runtimeExtensions.has(path.extname(entry.name))) continue;
    let src='';
    try { src=fs.readFileSync(full,'utf8'); } catch { continue; }
    for(const route of routes) if(src.includes(route)) refs.push(`${rel}:${route}`);
  }
}
walk(root);
if(refs.length) failures.push(`Rutas públicas retiradas todavía tienen consumidores runtime: ${refs.join(', ')}`);

const authToken='p16-test-auth-token';
const callbackUrl='https://app.exportmca.com/api/twilio-status';
const params={
  AccountSid:'AC00000000000000000000000000000000',
  MessageSid:'SM00000000000000000000000000000000',
  MessageStatus:'delivered',
  ErrorCode:'',
  FutureParameter:'preserve-me'
};
const signature=twilio.getExpectedTwilioSignature(authToken,callbackUrl,params);
assert.equal(validateTwilioRequest({authToken,signature,callbackUrl,params}),true,'valid Twilio signature must pass');
assert.equal(validateTwilioRequest({authToken,signature,callbackUrl,params:{...params,MessageStatus:'failed'}}),false,'tampered Twilio payload must fail');
assert.equal(validateTwilioRequest({authToken,signature:'',callbackUrl,params}),false,'missing Twilio signature must fail');
assert.equal(validateTwilioRequest({authToken,signature,callbackUrl:'https://admin.exportmca.com/api/twilio-status',params}),false,'different callback URL must fail');

const parsed=parseTwilioFormBody(Buffer.from('MessageSid=SM1&MessageStatus=delivered&Extra=A&Extra=B'));
assert.equal(parsed.MessageSid,'SM1');
assert.equal(parsed.MessageStatus,'delivered');
assert.deepEqual(parsed.Extra,['A','B']);

if(failures.length){
  console.error('P16 public boundary gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('P16 public boundary gate passed: Twilio signatures verified, retired endpoints isolated, no runtime consumers found.');
