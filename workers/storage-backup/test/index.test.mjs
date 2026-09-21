import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackup, handleRequest } from '../src/index.js';

class MemoryR2Object {
  constructor(value) { this.value = value; }
  async arrayBuffer() { return this.value.slice(0); }
  async text() { return new TextDecoder().decode(this.value); }
}

class MemoryR2 {
  constructor({ corruptObjectReads = false } = {}) {
    this.objects = new Map();
    this.corruptObjectReads = corruptObjectReads;
  }
  async put(key, value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    this.objects.set(key, bytes.slice().buffer);
  }
  async get(key) {
    const value = this.objects.get(key);
    if (!value) return null;
    if (this.corruptObjectReads && key.includes('/object-')) {
      const corrupted = new Uint8Array(value.slice(0));
      if (corrupted.length) corrupted[0] ^= 0xff;
      return new MemoryR2Object(corrupted.buffer);
    }
    return new MemoryR2Object(value);
  }
}

function fixture({ truncate = false, corruptR2 = false, inventoryChange = false,
  now = new Date('2026-09-18T06:15:00.000Z') } = {}) {
  const files = new Map([
    ['erp-documents/operations/demo/invoice.pdf', new TextEncoder().encode('invoice bytes')],
    ['publication-images/catalog/item.png', new Uint8Array([1, 2, 3, 4])]
  ]);
  const stamp = '2026-09-17T12:00:00.000Z';
  const users = [{ id: '11111111-1111-4111-8111-111111111111', role: 'master_admin' }];
  const calls = [];
  let downloads = 0;
  const fetchFn = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ path: url.pathname, method: init.method || 'GET', body: init.body,
      redirect: init.redirect });
    if (url.pathname === '/rest/v1/admin_users') return Response.json(users);
    if (url.pathname === '/rest/v1/admin_effective_permissions') return Response.json([]);
    if (url.pathname === '/rest/v1/notification_preferences') return Response.json([]);
    if (url.pathname === '/rest/v1/notification_inbox_items') return new Response(null, { status: 201 });
    if (url.pathname.startsWith('/storage/v1/bucket/')) {
      const id = decodeURIComponent(url.pathname.split('/').at(-1));
      return Response.json({ id, name: id, public: id === 'publication-images', created_at: stamp, updated_at: stamp });
    }
    if (url.pathname.startsWith('/storage/v1/object/list/')) {
      const bucket = decodeURIComponent(url.pathname.split('/').at(-1));
      const { prefix = '' } = JSON.parse(init.body);
      const keys = [...files.keys()].filter(key => key.startsWith(`${bucket}/`)).map(key => key.slice(bucket.length + 1));
      const children = new Map();
      for (const key of keys) {
        const relative = prefix ? (key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : null) : key;
        if (!relative) continue;
        const [name, ...tail] = relative.split('/');
        if (tail.length) children.set(name, { name, id: null, metadata: null });
        else {
          const value = files.get(`${bucket}/${key}`);
          children.set(name, { id: `${bucket}-${name}`, name, created_at: stamp,
            updated_at: inventoryChange && downloads ? '2026-09-18T06:00:00.000Z' : stamp,
            metadata: { size: value.byteLength, eTag: null, mimetype: 'application/octet-stream' } });
        }
      }
      return Response.json([...children.values()]);
    }
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const rest = url.pathname.slice('/storage/v1/object/'.length).split('/').map(decodeURIComponent).join('/');
      const value = files.get(rest);
      if (!value) return new Response(null, { status: 404 });
      downloads += 1;
      const body = truncate ? value.slice(0, Math.max(0, value.length - 1)) : value;
      return new Response(body, { status: 200 });
    }
    return new Response(null, { status: 404 });
  };
  const env = {
    BACKUPS: new MemoryR2({ corruptObjectReads: corruptR2 }),
    SOURCE_PROJECT_REF: 'qflncyhdspuvtrxsqgbj',
    SOURCE_BUCKETS: 'erp-documents,publication-images',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture',
    MIN_BACKUP_INTERVAL_HOURS: '20',
    STALE_AFTER_HOURS: '24',
    MAX_OBJECT_BYTES: '1000000',
    STATUS_TOKEN: 'a'.repeat(32)
  };
  return { env, fetchFn, now, calls };
}

test('copies both approved buckets, verifies R2 and writes COMPLETE before latest state', async () => {
  const f = fixture();
  const result = await createBackup(f.env, f);
  assert.equal(result.status, 'completed');
  assert.equal(result.latest.buckets, 2);
  assert.equal(result.latest.objects, 2);
  const keys = [...f.env.BACKUPS.objects.keys()];
  const prefix = `backups/${result.latest.backupId}`;
  assert.ok(keys.includes(`${prefix}/object-00000000.bin`));
  assert.ok(keys.includes(`${prefix}/object-00000001.bin`));
  assert.ok(keys.includes(`${prefix}/manifest.json`));
  assert.ok(keys.includes(`${prefix}/COMPLETE`));
  assert.ok(keys.includes('state/latest.json'));
  assert.ok(f.calls.length > 0);
  assert.ok(f.calls.every(call => call.redirect === 'manual'));

  const skipped = await createBackup(f.env, { ...f, now: new Date('2026-09-18T12:15:00.000Z') });
  assert.equal(skipped.status, 'fresh');
});

test('does not mark a truncated export complete and creates an internal failure alert', async () => {
  const f = fixture({ truncate: true });
  await assert.rejects(createBackup(f.env, f), /SOURCE_SIZE_MISMATCH/);
  const keys = [...f.env.BACKUPS.objects.keys()];
  assert.ok(keys.some(key => key.endsWith('/FAILED.json')));
  assert.ok(!keys.some(key => key.endsWith('/COMPLETE')));
  assert.ok(!keys.includes('state/latest.json'));
  const alert = f.calls.find(call => call.path === '/rest/v1/notification_inbox_items');
  assert.ok(alert);
  const [row] = JSON.parse(alert.body);
  assert.equal(row.title, 'Respaldo automático atrasado');
  assert.equal(row.severity, 'critical');
  assert.equal(row.action_payload.code, 'SOURCE_SIZE_MISMATCH');
});

test('rejects bytes corrupted after persistence in R2', async () => {
  const f = fixture({ corruptR2: true });
  await assert.rejects(createBackup(f.env, f), /R2_OBJECT_HASH_MISMATCH/);
  const keys = [...f.env.BACKUPS.objects.keys()];
  assert.ok(keys.some(key => key.endsWith('/FAILED.json')));
  assert.ok(!keys.some(key => key.endsWith('/COMPLETE')));
  assert.ok(!keys.includes('state/latest.json'));
});

test('rejects a source inventory that changes while the backup is running', async () => {
  const f = fixture({ inventoryChange: true });
  await assert.rejects(createBackup(f.env, f), /SOURCE_CHANGED_DURING_BACKUP/);
  const keys = [...f.env.BACKUPS.objects.keys()];
  assert.ok(keys.some(key => key.endsWith('/FAILED.json')));
  assert.ok(!keys.some(key => key.endsWith('/COMPLETE')));
});

test('health and manual execution require the private status token', async t => {
  const f = fixture();
  // The backup timestamp and health age must use the same synthetic clock.
  // Comparing this dated fixture with the wall clock made the test expire.
  let now = f.now.getTime();
  t.mock.method(Date, 'now', () => now);
  const hidden = await handleRequest(new Request('https://worker.example/health'), f.env, f);
  assert.equal(hidden.status, 404);
  const hiddenRun = await handleRequest(new Request('https://worker.example/run', { method: 'POST' }), f.env, f);
  assert.equal(hiddenRun.status, 404);
  assert.equal(f.calls.length, 0);
  const headers = { Authorization: `Bearer ${f.env.STATUS_TOKEN}` };
  const run = await handleRequest(new Request('https://worker.example/run', { method: 'POST', headers }), f.env, f);
  assert.equal(run.status, 201);
  const health = await handleRequest(new Request('https://worker.example/health', { headers }), f.env, f);
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.healthy, true);
  assert.equal(body.objects, 2);
  assert.equal(body.ageHours, 0);

  now += 25 * 3_600_000;
  const stale = await handleRequest(new Request('https://worker.example/health', { headers }), f.env, f);
  const staleBody = await stale.json();
  assert.equal(staleBody.healthy, false);
  assert.equal(staleBody.ageHours, 25);
});
