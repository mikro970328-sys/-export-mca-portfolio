import assert from 'node:assert/strict';
import { supabase, upstreamFailureStatus } from '../api/_lib.js';

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

process.env.SUPABASE_URL = 'https://fixture.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-role-key';

const response = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get:name => headers[String(name).toLowerCase()] || null },
  async text() { return body === null ? '' : JSON.stringify(body); }
});

const warnings = [];
console.warn = (event, details) => warnings.push({ event, details });

try {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return response(504, { message:'Gateway Timeout' }, { 'sb-request-id':'retry-504' });
    if (calls === 2) return response(401, { code:'PGRST303', message:'JWT issued at future' }, { 'sb-request-id':'retry-clock' });
    return response(200, [{ id:'shipment-1' }]);
  };
  assert.deepEqual(await supabase('shipments', { query:'?select=id' }), [{ id:'shipment-1' }]);
  assert.equal(calls, 3, 'GET debe recuperarse de 504 y del desfase transitorio de JWT');
  assert.deepEqual(warnings.map(row => row.details.request_id), ['retry-504', 'retry-clock']);

  warnings.length = 0;
  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error('socket reset');
    return response(200, [{ id:'client-1' }]);
  };
  assert.deepEqual(await supabase('clients'), [{ id:'client-1' }]);
  assert.equal(calls, 2, 'GET debe reintentar una falla de red transitoria');
  assert.equal(warnings[0]?.details?.reason, 'network');

  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response(401, { code:'PGRST303', message:'JWT signature verification failed' });
  };
  await assert.rejects(() => supabase('shipments'), error => {
    assert.equal(error.status, 401);
    assert.equal(error.code, 'PGRST303');
    assert.equal(error.retryable, false);
    assert.equal(upstreamFailureStatus(error), 400);
    return true;
  });
  assert.equal(calls, 1, 'un JWT realmente inválido no debe reintentarse');

  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response(504, { message:'Gateway Timeout' });
  };
  await assert.rejects(() => supabase('rpc/write_fixture', { method:'POST', body:{ id:'one' } }), error => {
    assert.equal(error.status, 504);
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(calls, 1, 'una escritura no debe repetirse automáticamente');

  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response(503, { message:'Service Unavailable' });
  };
  await assert.rejects(() => supabase('shipments'), error => {
    assert.equal(error.retryable, true);
    assert.equal(upstreamFailureStatus(error), 503);
    return true;
  });
  assert.equal(calls, 3, 'una lectura transitoria debe tener un máximo de tres intentos');
} finally {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
}

console.log('Supabase transient read retry contract: OK');
