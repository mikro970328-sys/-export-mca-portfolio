import assert from 'node:assert/strict';
import { auditPublicErrorSource } from './audit-api-public-error-boundaries.mjs';

const rejected = [
  "return fail(res,500,error.message);",
  "return fail (res,500,'Falló',err?.message);",
  "return ok(res,{notification_error:exception.message});",
  "return ok\n(res,{error:e?.['message']});",
  "catch (upstream) { return fail(res,500,upstream.message); }",
  "return res.json({error:error.message});",
  "return res . json ({error:error?.message});",
  "return res.end(JSON.stringify({error:cause.message}));",
  "return json(res,500,{error:err['message']});",
  "return fail(res,500,String(error?.message));",
  "return fail(res,500,`Falló: ${error.message}`);",
  "return ok(res,{debug:error.stack});",
  `res.end(JSON.stringify({padding:'${'x'.repeat(800)}',error:error.message}));`
];
for(const source of rejected) assert.ok(auditPublicErrorSource(source).length,source);
for(const source of [
  "console.error(error.message); return fail(res,500,'No disponible');",
  "res.end('ok'); console.error(error.message);",
  "return ok(res,{updated:true,notification_error:'No se pudo enviar la notificación'});",
  "return fail(res,upstreamFailureStatus(error,500),'No disponible');"
]) assert.deepEqual(auditPublicErrorSource(source),[],source);
console.log('API public error audit: 17 detector regressions passed.');
