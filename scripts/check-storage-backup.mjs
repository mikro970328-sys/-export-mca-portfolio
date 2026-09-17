import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { exportStorageBackup, verifyStorageBackup } from './storage-backup.mjs';

// HTTP fixture only: no hosted Supabase keys, real files or production data.
const md5 = bytes => crypto.createHash('md5').update(bytes).digest('hex');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const stamp = '2026-09-17T00:00:00.000Z';
const privateKey = 'synthetic-secret-must-never-appear-in-an-error';
async function fixture(t, fault = '') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-backup-qa-'));
  const files = new Map([
    ['alpha.pdf', Buffer.from('%PDF-1.4\nsynthetic invoice\n')],
    ['empty.txt', Buffer.alloc(0)],
    ['folder/archivo # % ñ.txt', Buffer.from('synthetic nested document')],
    ['folder/deeper/alpha.pdf', Buffer.from('second synthetic invoice')],
    ['z-last.txt', Buffer.from('last page')]
  ]);
  const requests = [];
  let downloads = 0;
  const bucket = id => ({ id, name: id, public: id === 'empty-bucket', created_at: stamp,
    updated_at: stamp, file_size_limit: null, allowed_mime_types: null });
  const server = http.createServer(async (req, res) => {
    try {
      requests.push({ method: req.method, url: req.url });
      assert.equal(req.headers.authorization, `Bearer ${privateKey}`);
      assert.equal(req.headers.apikey, privateKey);
      const send = (value, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
      };
      if (fault === 'auth') return send({ error: privateKey }, 403);
      if (req.method === 'GET' && req.url.startsWith('/storage/v1/bucket/')) {
        const id = decodeURIComponent(req.url.split('/').at(-1));
        const b = bucket(id);
        if (fault === 'bucket-change' && downloads) b.public = !b.public;
        return send(b);
      }
      if (req.method === 'POST' && req.url.startsWith('/storage/v1/object/list/')) {
        let body = ''; for await (const chunk of req) body += chunk;
        const { prefix, offset, limit, sortBy } = JSON.parse(body);
        assert.deepEqual(sortBy, { column: 'name', order: 'asc' });
        const id = decodeURIComponent(req.url.split('/').at(-1));
        if (id === 'empty-bucket') return send([]);
        const rows = new Map();
        for (const [key, bytes] of files) {
          const start = prefix ? prefix + '/' : '';
          if (!key.startsWith(start)) continue;
          const relative = key.slice(start.length), name = relative.split('/')[0];
          if (relative.includes('/')) rows.set(name, { name, id: null, metadata: null });
          else rows.set(name, { name, id: sha(key).slice(0, 32), created_at: stamp,
            updated_at: fault === 'inventory-change' && downloads ? '2026-09-17T01:00:00Z' : stamp,
            last_accessed_at: downloads ? new Date().toISOString() : stamp,
            metadata: { size: bytes.length, eTag: md5(bytes), mimetype: 'application/octet-stream',
              cacheControl: 'max-age=3600' } });
        }
        if (fault === 'unsafe-name') return send([{ name: '..', id: null, metadata: null }]);
        const ordered = [...rows.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        return send(ordered.slice(fault === 'repeat-page' ? 0 : offset,
          (fault === 'repeat-page' ? 0 : offset) + limit));
      }
      if (req.method === 'GET' && req.url.startsWith('/storage/v1/object/docs/')) {
        downloads++;
        const key = req.url.slice('/storage/v1/object/docs/'.length).split('/').map(decodeURIComponent).join('/');
        const original = files.get(key);
        assert.ok(original, 'Object key must retain spaces, percent signs and Unicode');
        if (fault === 'missing') return send({ error: privateKey }, 404);
        if (fault === 'redirect') { res.writeHead(302, { location: '/credential-trap' }); res.end(); return; }
        let bytes = original;
        if (fault === 'truncated') bytes = bytes.subarray(0, bytes.length - 1);
        if (fault === 'corrupt') bytes = Buffer.alloc(bytes.length, 'X');
        const tag = fault === 'etag-change' ? 'changed' : md5(original);
        res.writeHead(200, { etag: `"${tag}"`, 'content-type': 'application/octet-stream' });
        res.end(bytes); return;
      }
      send({ error: 'unexpected operation' }, 500);
    } catch { res.writeHead(500); res.end('fixture failure'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true }); });
  const options = { sourceUrl: `http://127.0.0.1:${server.address().port}`, projectRef: 'synthetic',
    key: privateKey, bucketIds: ['docs', 'empty-bucket'], destination: path.join(root, 'copy'),
    pageSize: 2, allowLocalTest: true };
  return { root, files, requests, options };
}

test('complete paginated export: nested keys, empty files/buckets, byte hashes, private modes and offline verification', async t => {
  const f = await fixture(t);
  const expected = { buckets: 2, objects: 5, bytes: [...f.files.values()].reduce((n, b) => n + b.length, 0) };
  assert.deepEqual(await exportStorageBackup(f.options), expected);
  assert.deepEqual(await verifyStorageBackup(f.options.destination), expected);
  const manifest = JSON.parse(await fs.readFile(path.join(f.options.destination, 'manifest.json')));
  for (const o of manifest.objects) {
    assert.deepEqual(await fs.readFile(path.join(f.options.destination, o.member)), f.files.get(o.key));
    assert.equal(o.sha256, sha(f.files.get(o.key)));
    assert.equal((await fs.stat(path.join(f.options.destination, o.member))).mode & 0o777, 0o600);
  }
  assert.equal((await fs.stat(f.options.destination)).mode & 0o777, 0o700);
  assert.ok(f.requests.every(r => r.method === 'GET' || (r.method === 'POST' && r.url.startsWith('/storage/v1/object/list/'))));
  const texts = await Promise.all(['manifest.json', 'COMPLETE'].map(name => fs.readFile(path.join(f.options.destination, name), 'utf8')));
  assert.ok(texts.every(text => !text.includes(privateKey)));
});

for (const [fault, error] of [
  ['auth', /SOURCE_HTTP_403/], ['missing', /SOURCE_HTTP_404/],
  ['truncated', /SOURCE_SIZE_MISMATCH/], ['corrupt', /SOURCE_HASH_MISMATCH/],
  ['etag-change', /SOURCE_ETAG_MISMATCH/], ['inventory-change', /SOURCE_CHANGED_DURING_BACKUP/],
  ['bucket-change', /SOURCE_CHANGED_DURING_BACKUP/], ['repeat-page', /INVENTORY_UNSTABLE/],
  ['unsafe-name', /INVENTORY_UNSTABLE/], ['redirect', /SOURCE_REQUEST_FAILED/]
]) test(`rejects ${fault}; incomplete exports have no completion marker and response bodies stay private`, async t => {
  const f = await fixture(t, fault);
  await assert.rejects(exportStorageBackup(f.options), e => {
    assert.match(e.message, error); assert.ok(!e.message.includes(privateKey)); return true;
  });
  await assert.rejects(fs.access(path.join(f.options.destination, 'COMPLETE')));
  assert.ok(f.requests.every(r => !r.url.includes('credential-trap')));
});

test('offline verification rejects modified, missing and symbolic-link members', async t => {
  const f = await fixture(t); await exportStorageBackup(f.options);
  const member = path.join(f.options.destination, 'object-00000000.bin');
  const original = await fs.readFile(member);
  await fs.writeFile(member, Buffer.alloc(original.length, 'Z'));
  await assert.rejects(verifyStorageBackup(f.options.destination), /OBJECT_HASH_MISMATCH/);
  await fs.unlink(member);
  await assert.rejects(verifyStorageBackup(f.options.destination), /ENOENT/);
  const other = path.join(f.root, 'outside.bin'); await fs.writeFile(other, original);
  await fs.symlink(other, member);
  await assert.rejects(verifyStorageBackup(f.options.destination), /ELOOP/);
});

test('offline verification rejects a changed manifest and path traversal even with a recomputed completion hash', async t => {
  const f = await fixture(t); await exportStorageBackup(f.options);
  const manifestPath = path.join(f.options.destination, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath));
  manifest.objects[0].member = '../outside.bin';
  const text = JSON.stringify(manifest);
  await fs.writeFile(manifestPath, text);
  await assert.rejects(verifyStorageBackup(f.options.destination), /MANIFEST_HASH_MISMATCH/);
  await fs.writeFile(path.join(f.options.destination, 'COMPLETE'), sha(text));
  await assert.rejects(verifyStorageBackup(f.options.destination), /OBJECT_INVALID/);
});

test('does not overwrite existing output; rejects Git directories including symlinked parents', async t => {
  const f = await fixture(t); await fs.mkdir(f.options.destination);
  await fs.writeFile(path.join(f.options.destination, 'keep.txt'), 'preserve');
  await assert.rejects(exportStorageBackup(f.options), /EEXIST/);
  assert.equal(await fs.readFile(path.join(f.options.destination, 'keep.txt'), 'utf8'), 'preserve');
  const repo = path.join(f.root, 'repo'); await fs.mkdir(repo); await fs.mkdir(path.join(repo, '.git'));
  await assert.rejects(exportStorageBackup({ ...f.options, destination: path.join(repo, 'copy') }), /DESTINATION_IN_GIT/);
  const alias = path.join(f.root, 'alias'); await fs.symlink(repo, alias);
  await assert.rejects(exportStorageBackup({ ...f.options, destination: path.join(alias, 'copy') }), /DESTINATION_IN_GIT/);
});

test('rejects an unexpected project/origin or missing bucket selection before transmitting credentials', async t => {
  const f = await fixture(t);
  await assert.rejects(exportStorageBackup({ ...f.options, sourceUrl: 'https://example.com', allowLocalTest: false }), /SOURCE_INVALID/);
  const projectRef = 'a'.repeat(20);
  const anon = `header.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
  await assert.rejects(exportStorageBackup({ ...f.options, sourceUrl: `https://${projectRef}.supabase.co`,
    projectRef, key: anon, allowLocalTest: false }), /SOURCE_PRIVILEGED_KEY_REQUIRED/);
  await assert.rejects(exportStorageBackup({ ...f.options, bucketIds: [] }), /BUCKET_SELECTION_INVALID/);
  assert.equal(f.requests.length, 0);
});

test('CLI rejects export in GitHub Actions and prints no key or private destination', () => {
  let caught;
  try { execFileSync(process.execPath, ['scripts/storage-backup.mjs', 'export', '/private/secret-destination'], {
    env: { ...process.env, GITHUB_ACTIONS: 'true', SUPABASE_SERVICE_ROLE_KEY: privateKey }, stdio: 'pipe' }); }
  catch (e) { caught = e; }
  assert.equal(caught.status, 1);
  assert.equal(caught.stdout.toString(), '');
  assert.equal(caught.stderr.toString().trim(), 'EXPORT_FORBIDDEN_IN_PUBLIC_CI');
});
