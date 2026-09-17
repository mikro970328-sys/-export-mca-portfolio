import fs from 'node:fs/promises';
import { createWriteStream, constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

// Offline verification and explicitly invoked, read-only Storage exports.
// No scheduler, remote writes, retention deletion, database dump or cloud upload.
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, function (_, v) {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v;
});
const requireValue = (condition, code) => { if (!condition) throw new Error(code); };
const validSegment = s => typeof s === 'string' && s.length > 0 &&
  !['.', '..'].includes(s) && !/[\u0000-\u001f\u007f/\\]/.test(s);
const etag = value => typeof value === 'string' ? value.replace(/^"|"$/g, '') : null;
const summary = m => ({ buckets: m.buckets.length, objects: m.objects.length,
  bytes: m.objects.reduce((n, o) => n + o.bytes, 0) });

async function privateDestination(destination) {
  const parent = await fs.realpath(path.dirname(path.resolve(destination)));
  for (let current = parent; ; current = path.dirname(current)) {
    try { await fs.lstat(path.join(current, '.git')); throw new Error('DESTINATION_IN_GIT'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
  const directory = path.join(parent, path.basename(destination));
  await fs.mkdir(directory, { mode: 0o700 }); // Fail if it already exists, including symlinks.
  return directory;
}

async function verifyMembers(directory, manifest) {
  requireValue(manifest.format === 'export-mca-storage-v1' &&
    Array.isArray(manifest.buckets) && Array.isArray(manifest.objects), 'MANIFEST_INVALID');
  const buckets = new Set();
  for (const b of manifest.buckets) {
    requireValue(validSegment(b.id) && typeof b.public === 'boolean' && !buckets.has(b.id), 'BUCKET_INVALID');
    buckets.add(b.id);
  }
  const identities = new Set();
  for (const [i, o] of manifest.objects.entries()) {
    requireValue(o.member === `object-${String(i).padStart(8, '0')}.bin` &&
      buckets.has(o.bucket) && typeof o.key === 'string' && o.key.split('/').every(validSegment) &&
      Number.isSafeInteger(o.bytes) && o.bytes >= 0 && /^[a-f0-9]{64}$/.test(o.sha256), 'OBJECT_INVALID');
    const identity = JSON.stringify([o.bucket, o.key]);
    requireValue(!identities.has(identity), 'OBJECT_DUPLICATE');
    identities.add(identity);
    const handle = await fs.open(path.join(directory, o.member), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      requireValue(stat.isFile() && stat.size === o.bytes, 'OBJECT_SIZE_MISMATCH');
      const hash = crypto.createHash('sha256');
      for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
      requireValue(hash.digest('hex') === o.sha256, 'OBJECT_HASH_MISMATCH');
    } finally { await handle.close(); }
  }
  return summary(manifest);
}

async function readRegular(file) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    requireValue((await handle.stat()).isFile(), 'MANIFEST_INVALID');
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}

export async function verifyStorageBackup(directory) {
  const manifestText = await readRegular(path.join(directory, 'manifest.json'));
  const completedHash = (await readRegular(path.join(directory, 'COMPLETE'))).trim();
  requireValue(digest(manifestText) === completedHash, 'MANIFEST_HASH_MISMATCH');
  return verifyMembers(directory, JSON.parse(manifestText));
}

export async function exportStorageBackup({ sourceUrl, projectRef, key, bucketIds,
  destination, pageSize = 100, allowLocalTest = false }) {
  const url = new URL(sourceUrl);
  const testOrigin = allowLocalTest && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  requireValue(testOrigin || (url.protocol === 'https:' && /^[a-z]{20}$/.test(projectRef) &&
    url.hostname === `${projectRef}.supabase.co` && !url.port), 'SOURCE_INVALID');
  requireValue(url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password, 'SOURCE_INVALID');
  requireValue(typeof key === 'string' && key.length > 0, 'SOURCE_KEY_MISSING');
  if (!testOrigin) {
    let role;
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch {}
    // The server verifies the key; this prevents accidentally exporting an RLS-filtered subset.
    requireValue(key.startsWith('sb_secret_') || role === 'service_role', 'SOURCE_PRIVILEGED_KEY_REQUIRED');
  }
  requireValue(Array.isArray(bucketIds) && bucketIds.length > 0 && bucketIds.every(validSegment) &&
    new Set(bucketIds).size === bucketIds.length, 'BUCKET_SELECTION_INVALID');
  requireValue(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 1000, 'PAGE_SIZE_INVALID');
  const startedAt = new Date().toISOString();
  const root = `${url.origin}/storage/v1`;
  async function request(suffix, body) {
    let response;
    try {
      response = await fetch(root + suffix, { method: body ? 'POST' : 'GET',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
          'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' },
        body: body ? JSON.stringify(body) : undefined, redirect: 'error',
        signal: AbortSignal.timeout(60_000) });
    } catch { throw new Error('SOURCE_REQUEST_FAILED'); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`SOURCE_HTTP_${response.status}`); // Never print response bodies or URLs.
    }
    return response;
  }
  async function inventory() {
    const buckets = [], objects = [];
    for (const id of [...bucketIds].sort()) {
      const b = await (await request(`/bucket/${encodeURIComponent(id)}`)).json();
      requireValue(b.id === id && typeof b.public === 'boolean' && (!b.type || b.type === 'STANDARD'), 'BUCKET_INVALID');
      buckets.push({ id, name: b.name, public: b.public, file_size_limit: b.file_size_limit ?? null,
        allowed_mime_types: b.allowed_mime_types ?? null, created_at: b.created_at, updated_at: b.updated_at });
      const queue = [''], prefixes = new Set(['']);
      for (let q = 0; q < queue.length; q++) {
        const prefix = queue[q], names = new Set();
        for (let offset = 0; ; offset += pageSize) {
          requireValue(offset < 100_000 && objects.length < 100_000, 'INVENTORY_LIMIT');
          const rows = await (await request(`/object/list/${encodeURIComponent(id)}`,
            { prefix, offset, limit: pageSize, sortBy: { column: 'name', order: 'asc' } })).json();
          requireValue(Array.isArray(rows) && rows.length <= pageSize, 'INVENTORY_INVALID');
          for (const row of rows) {
            requireValue(validSegment(row.name) && !names.has(row.name), 'INVENTORY_UNSTABLE');
            names.add(row.name);
            const objectKey = prefix ? `${prefix}/${row.name}` : row.name;
            if (row.id == null && row.metadata == null) {
              requireValue(!prefixes.has(objectKey) && queue.length < 10_000, 'INVENTORY_INVALID');
              prefixes.add(objectKey); queue.push(objectKey);
            } else {
              const size = row.metadata?.size;
              requireValue(typeof row.id === 'string' && row.id.length > 0 &&
                Number.isSafeInteger(size) && size >= 0 && typeof row.updated_at === 'string', 'OBJECT_METADATA_INVALID');
              // last_accessed_at can change because of this export; it is not a revision.
              objects.push({ bucket: id, key: objectKey, id: row.id, updated_at: row.updated_at,
                created_at: row.created_at, bytes: size, metadata: {
                  size, eTag: row.metadata.eTag ?? null, mimetype: row.metadata.mimetype ?? null,
                  cacheControl: row.metadata.cacheControl ?? null,
                  lastModified: row.metadata.lastModified ?? null } });
            }
          }
          if (rows.length < pageSize) break;
        }
      }
    }
    objects.sort((a, b) => {
      const x = JSON.stringify([a.bucket, a.key]), y = JSON.stringify([b.bucket, b.key]);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    return { buckets, objects };
  }
  const before = await inventory();
  const directory = await privateDestination(destination);
  const members = [];
  for (const [i, object] of before.objects.entries()) {
    const suffix = `/object/${encodeURIComponent(object.bucket)}/${object.key.split('/').map(encodeURIComponent).join('/')}`;
    const response = await request(suffix);
    const expectedETag = etag(object.metadata.eTag);
    if (expectedETag && etag(response.headers.get('etag')) !== expectedETag) {
      await response.body?.cancel(); throw new Error('SOURCE_ETAG_MISMATCH');
    }
    const hash = crypto.createHash('sha256'), md5 = crypto.createHash('md5');
    let bytes = 0;
    const member = `object-${String(i).padStart(8, '0')}.bin`;
    const measure = new Transform({ transform(chunk, _, done) {
      bytes += chunk.length;
      if (bytes > object.bytes) return done(new Error('SOURCE_SIZE_MISMATCH'));
      hash.update(chunk); md5.update(chunk); done(null, chunk);
    } });
    requireValue(response.body, 'SOURCE_BODY_MISSING');
    await pipeline(Readable.fromWeb(response.body), measure,
      createWriteStream(path.join(directory, member), { flags: 'wx', mode: 0o600 }));
    requireValue(bytes === object.bytes, 'SOURCE_SIZE_MISMATCH');
    const contentMd5 = md5.digest('hex');
    if (expectedETag && /^[a-f0-9]{32}$/i.test(expectedETag))
      requireValue(contentMd5 === expectedETag.toLowerCase(), 'SOURCE_HASH_MISMATCH');
    members.push({ ...object, member, sha256: hash.digest('hex') });
  }
  const after = await inventory();
  requireValue(canonical(before) === canonical(after), 'SOURCE_CHANGED_DURING_BACKUP');
  const manifest = { format: 'export-mca-storage-v1', projectRef, startedAt,
    completedAt: new Date().toISOString(), buckets: before.buckets, objects: members };
  const result = await verifyMembers(directory, manifest);
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  await fs.writeFile(path.join(directory, 'manifest.json'), serialized, { flag: 'wx', mode: 0o600 });
  // Completion marker is written last. Failed/partial exports never have one.
  await fs.writeFile(path.join(directory, 'COMPLETE'), digest(serialized) + '\n', { flag: 'wx', mode: 0o600 });
  return result;
}

async function main() {
  const [mode, directory, ...extra] = process.argv.slice(2);
  if (mode === '--help') {
    console.log('node scripts/storage-backup.mjs export /private/new-directory\n' +
      'Requires ERP_BACKUP_PROJECT_REF, ERP_BACKUP_BUCKETS (comma separated), SUPABASE_SERVICE_ROLE_KEY.\n' +
      'node scripts/storage-backup.mjs verify /private/existing-directory\n' +
      'Exports refuse Git checkouts and GitHub Actions. No credentials are needed to verify.');
    return;
  }
  requireValue(directory && !extra.length && ['export', 'verify'].includes(mode), 'USAGE_INVALID');
  let result;
  if (mode === 'verify') result = await verifyStorageBackup(directory);
  else {
    requireValue(process.env.GITHUB_ACTIONS !== 'true', 'EXPORT_FORBIDDEN_IN_PUBLIC_CI');
    const projectRef = process.env.ERP_BACKUP_PROJECT_REF || '';
    result = await exportStorageBackup({ sourceUrl: `https://${projectRef}.supabase.co`, projectRef,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
      bucketIds: (process.env.ERP_BACKUP_BUCKETS || '').split(',').filter(Boolean), destination: directory });
  }
  console.log(JSON.stringify({ status: 'verified', mode, ...result }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Unknown errors can contain file paths or credential-bearing URLs.
    const code = /^[A-Z][A-Z_0-9]+$/.test(error.message) ? error.message : 'BACKUP_FAILED';
    console.error(code); process.exitCode = 1;
  });
}
