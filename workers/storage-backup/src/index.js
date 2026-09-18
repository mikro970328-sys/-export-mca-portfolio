const FORMAT = 'export-mca-r2-storage-v1';
const LATEST_KEY = 'state/latest.json';
const encoder = new TextEncoder();

const fail = code => { throw new Error(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const validSegment = value => typeof value === 'string' && value.length > 0 &&
  !['.', '..'].includes(value) && !/[\u0000-\u001f\u007f/\\]/.test(value);
const normalizedEtag = value => typeof value === 'string' ? value.replace(/^"|"$/g, '') : null;
function canonical(value) {
  return JSON.stringify(value, function (_, current) {
    return current && typeof current === 'object' && !Array.isArray(current)
      ? Object.fromEntries(Object.keys(current).sort().map(key => [key, current[key]]))
      : current;
  });
}

async function sha256(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function settings(env) {
  const projectRef = String(env.SOURCE_PROJECT_REF || '').trim();
  const bucketIds = String(env.SOURCE_BUCKETS || '').split(',').map(value => value.trim()).filter(Boolean);
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  const minIntervalHours = Number(env.MIN_BACKUP_INTERVAL_HOURS || 20);
  const staleAfterHours = Number(env.STALE_AFTER_HOURS || 24);
  const maxObjectBytes = Number(env.MAX_OBJECT_BYTES || 52_428_800);

  requireValue(/^[a-z]{20}$/.test(projectRef), 'SOURCE_PROJECT_INVALID');
  requireValue(bucketIds.length > 0 && bucketIds.every(validSegment) &&
    new Set(bucketIds).size === bucketIds.length, 'SOURCE_BUCKETS_INVALID');
  requireValue(serviceKey.startsWith('sb_secret_') || serviceRole(serviceKey), 'SOURCE_KEY_INVALID');
  requireValue(Number.isFinite(minIntervalHours) && minIntervalHours >= 1, 'MIN_INTERVAL_INVALID');
  requireValue(Number.isFinite(staleAfterHours) && staleAfterHours >= minIntervalHours, 'STALE_INTERVAL_INVALID');
  requireValue(Number.isSafeInteger(maxObjectBytes) && maxObjectBytes > 0, 'MAX_OBJECT_BYTES_INVALID');
  requireValue(env.BACKUPS && typeof env.BACKUPS.put === 'function', 'R2_BINDING_MISSING');
  return { projectRef, bucketIds, serviceKey, minIntervalHours, staleAfterHours, maxObjectBytes };
}

function serviceRole(key) {
  try {
    return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role';
  } catch {
    return false;
  }
}

function sourceHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Accept-Encoding': 'identity',
    'Cache-Control': 'no-cache'
  };
}

async function sourceRequest(config, fetchFn, suffix, body) {
  let response;
  try {
    response = await fetchFn(`https://${config.projectRef}.supabase.co/storage/v1${suffix}`, {
      method: body ? 'POST' : 'GET',
      headers: sourceHeaders(config.serviceKey),
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000)
    });
  } catch (error) {
    console.error('SOURCE_REQUEST_FAILED', {
      name: error?.name || 'Error',
      message: error?.message || 'Unknown fetch error'
    });
    fail('SOURCE_REQUEST_FAILED');
  }
  if (!response.ok) {
    await response.body?.cancel();
    fail(`SOURCE_HTTP_${response.status}`);
  }
  return response;
}

async function inventory(config, fetchFn) {
  const buckets = [];
  const objects = [];
  for (const id of [...config.bucketIds].sort()) {
    const bucket = await (await sourceRequest(config, fetchFn, `/bucket/${encodeURIComponent(id)}`)).json();
    requireValue(bucket.id === id && typeof bucket.public === 'boolean' &&
      (!bucket.type || bucket.type === 'STANDARD'), 'BUCKET_INVALID');
    buckets.push({
      id,
      name: bucket.name,
      public: bucket.public,
      file_size_limit: bucket.file_size_limit ?? null,
      allowed_mime_types: bucket.allowed_mime_types ?? null,
      created_at: bucket.created_at,
      updated_at: bucket.updated_at
    });

    const queue = [''];
    const prefixes = new Set(queue);
    for (let index = 0; index < queue.length; index += 1) {
      const prefix = queue[index];
      const names = new Set();
      for (let offset = 0; ; offset += 1000) {
        requireValue(offset < 100_000 && objects.length < 100_000, 'INVENTORY_LIMIT');
        const response = await sourceRequest(config, fetchFn, `/object/list/${encodeURIComponent(id)}`, {
          prefix,
          offset,
          limit: 1000,
          sortBy: { column: 'name', order: 'asc' }
        });
        const rows = await response.json();
        requireValue(Array.isArray(rows) && rows.length <= 1000, 'INVENTORY_INVALID');
        for (const row of rows) {
          requireValue(validSegment(row.name) && !names.has(row.name), 'INVENTORY_UNSTABLE');
          names.add(row.name);
          const key = prefix ? `${prefix}/${row.name}` : row.name;
          if (row.id == null && row.metadata == null) {
            requireValue(!prefixes.has(key) && queue.length < 10_000, 'INVENTORY_INVALID');
            prefixes.add(key);
            queue.push(key);
            continue;
          }
          const bytes = row.metadata?.size;
          requireValue(typeof row.id === 'string' && row.id.length > 0 &&
            Number.isSafeInteger(bytes) && bytes >= 0 && typeof row.updated_at === 'string',
          'OBJECT_METADATA_INVALID');
          requireValue(bytes <= config.maxObjectBytes, 'OBJECT_TOO_LARGE');
          objects.push({
            bucket: id,
            key,
            id: row.id,
            updated_at: row.updated_at,
            created_at: row.created_at,
            bytes,
            metadata: {
              size: bytes,
              eTag: row.metadata.eTag ?? null,
              mimetype: row.metadata.mimetype ?? null,
              cacheControl: row.metadata.cacheControl ?? null,
              lastModified: row.metadata.lastModified ?? null
            }
          });
        }
        if (rows.length < 1000) break;
      }
    }
  }
  objects.sort((left, right) => canonical([left.bucket, left.key]).localeCompare(canonical([right.bucket, right.key])));
  return { buckets, objects };
}

function backupId(date) {
  return date.toISOString().replace(/[-:.]/g, '').replace('000Z', 'Z') + '-' + crypto.randomUUID().slice(0, 8);
}

async function readR2Text(bucket, key) {
  const object = await bucket.get(key);
  return object ? object.text() : null;
}

async function latestBackup(bucket) {
  const text = await readR2Text(bucket, LATEST_KEY);
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return typeof value.completedAt === 'string' && Number.isFinite(Date.parse(value.completedAt)) &&
      Number.isSafeInteger(value.objects) && value.objects >= 0 &&
      Number.isSafeInteger(value.bytes) && value.bytes >= 0 ? value : null;
  } catch {
    return null;
  }
}

async function verifyR2Object(bucket, key, expectedBytes, expectedHash) {
  const stored = await bucket.get(key);
  requireValue(stored, 'R2_OBJECT_MISSING');
  const bytes = await stored.arrayBuffer();
  requireValue(bytes.byteLength === expectedBytes, 'R2_OBJECT_SIZE_MISMATCH');
  requireValue(await sha256(bytes) === expectedHash, 'R2_OBJECT_HASH_MISMATCH');
}

export async function createBackup(env, { fetchFn = fetch, now = new Date() } = {}) {
  const config = settings(env);
  const previous = await latestBackup(env.BACKUPS);
  if (previous) {
    const ageHours = (now.getTime() - Date.parse(previous.completedAt)) / 3_600_000;
    if (Number.isFinite(ageHours) && ageHours >= 0 && ageHours < config.minIntervalHours) {
      return { status: 'fresh', latest: previous };
    }
  }

  const id = backupId(now);
  const prefix = `backups/${id}`;
  try {
    const before = await inventory(config, fetchFn);
    const members = [];
    for (const [index, object] of before.objects.entries()) {
      const suffix = `/object/${encodeURIComponent(object.bucket)}/${object.key.split('/').map(encodeURIComponent).join('/')}`;
      const response = await sourceRequest(config, fetchFn, suffix);
      const bytes = await response.arrayBuffer();
      requireValue(bytes.byteLength === object.bytes, 'SOURCE_SIZE_MISMATCH');
      const expectedEtag = normalizedEtag(object.metadata.eTag);
      const responseEtag = normalizedEtag(response.headers.get('etag'));
      requireValue(!expectedEtag || expectedEtag === responseEtag, 'SOURCE_ETAG_MISMATCH');
      const hash = await sha256(bytes);
      const member = `object-${String(index).padStart(8, '0')}.bin`;
      const key = `${prefix}/${member}`;
      await env.BACKUPS.put(key, bytes, {
        httpMetadata: object.metadata.mimetype ? { contentType: object.metadata.mimetype } : undefined,
        customMetadata: { sha256: hash }
      });
      await verifyR2Object(env.BACKUPS, key, object.bytes, hash);
      members.push({ ...object, member, sha256: hash });
    }

    const after = await inventory(config, fetchFn);
    requireValue(canonical(before) === canonical(after), 'SOURCE_CHANGED_DURING_BACKUP');
    const manifest = {
      format: FORMAT,
      projectRef: config.projectRef,
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      buckets: before.buckets,
      objects: members
    };
    const manifestText = JSON.stringify(manifest, null, 2) + '\n';
    const manifestHash = await sha256(manifestText);
    await env.BACKUPS.put(`${prefix}/manifest.json`, manifestText, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { sha256: manifestHash }
    });
    requireValue(await readR2Text(env.BACKUPS, `${prefix}/manifest.json`) === manifestText,
      'R2_MANIFEST_MISMATCH');
    await env.BACKUPS.put(`${prefix}/COMPLETE`, manifestHash + '\n', {
      httpMetadata: { contentType: 'text/plain' }
    });
    requireValue(await readR2Text(env.BACKUPS, `${prefix}/COMPLETE`) === manifestHash + '\n',
      'R2_COMPLETION_MISMATCH');
    const summary = {
      backupId: id,
      completedAt: manifest.completedAt,
      buckets: manifest.buckets.length,
      objects: manifest.objects.length,
      bytes: manifest.objects.reduce((total, object) => total + object.bytes, 0),
      manifestSha256: manifestHash
    };
    const latestText = JSON.stringify(summary);
    await env.BACKUPS.put(LATEST_KEY, latestText, {
      httpMetadata: { contentType: 'application/json' }
    });
    requireValue(await readR2Text(env.BACKUPS, LATEST_KEY) === latestText, 'R2_LATEST_MISMATCH');
    return { status: 'completed', latest: summary };
  } catch (error) {
    const code = /^[A-Z][A-Z_0-9]+$/.test(error?.message || '') ? error.message : 'BACKUP_FAILED';
    try {
      await env.BACKUPS.put(`${prefix}/FAILED.json`, JSON.stringify({ failedAt: now.toISOString(), code }), {
        httpMetadata: { contentType: 'application/json' }
      });
    } catch {}
    const current = await latestBackup(env.BACKUPS).catch(() => null);
    const stale = !current || (now.getTime() - Date.parse(current.completedAt)) / 3_600_000 >= config.staleAfterHours;
    await notifyFailure(config, fetchFn, code, now, stale).catch(() => {});
    throw new Error(code);
  }
}

async function restRequest(config, fetchFn, path, init = {}) {
  const response = await fetchFn(`https://${config.projectRef}.supabase.co/rest/v1/${path}`, {
    ...init,
    headers: { ...sourceHeaders(config.serviceKey), Prefer: 'resolution=ignore-duplicates,return=minimal', ...init.headers },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) fail(`ALERT_HTTP_${response.status}`);
  return response;
}

async function deterministicUuid(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function notifyFailure(config, fetchFn, code, now, stale) {
  const [usersResponse, permissionsResponse, preferencesResponse] = await Promise.all([
    restRequest(config, fetchFn, 'admin_users?select=id,role&is_active=eq.true'),
    restRequest(config, fetchFn, 'admin_effective_permissions?select=admin_user_id&permission_key=eq.notifications.manage'),
    restRequest(config, fetchFn,
      'notification_preferences?select=admin_user_id,in_app_enabled,integration_failures_enabled')
  ]);
  const users = await usersResponse.json();
  const permitted = new Set((await permissionsResponse.json()).map(row => row.admin_user_id));
  const preferences = new Map((await preferencesResponse.json()).map(row => [row.admin_user_id, row]));
  const recipients = users.filter(user => {
    const preference = preferences.get(user.id);
    return (user.role === 'master_admin' || permitted.has(user.id)) &&
      preference?.in_app_enabled !== false && preference?.integration_failures_enabled !== false;
  });
  if (!recipients.length) return;
  const day = now.toISOString().slice(0, 10);
  const sourceId = await deterministicUuid(`export-mca-storage-backup:${day}:${code}`);
  const rows = recipients.map(user => ({
    recipient_admin_id: user.id,
    source_type: 'system',
    source_id: sourceId,
    source_version: `storage-backup:${day}:${code}`,
    source_event_type: 'integration_failure',
    target_type: 'permission',
    target_id: null,
    title: stale ? 'Respaldo automático atrasado' : 'Falló el respaldo automático',
    message: stale
      ? 'No existe una copia válida de archivos dentro de las últimas 24 horas.'
      : 'La copia programada de documentos e imágenes requiere revisión.',
    severity: stale ? 'critical' : 'warning',
    action_key: 'open_inbox',
    action_payload: { component: 'storage_backup', code },
    escalation_level: stale ? 1 : 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  }));
  await restRequest(config, fetchFn, 'notification_inbox_items?on_conflict=recipient_admin_id,source_type,source_id,source_version,escalation_level', {
    method: 'POST',
    body: JSON.stringify(rows)
  });
}

function authorized(request, env) {
  const expected = String(env.STATUS_TOKEN || '');
  return expected.length >= 32 && request.headers.get('authorization') === `Bearer ${expected}`;
}

export async function handleRequest(request, env, options = {}) {
  if (!authorized(request, env)) return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') {
    const latest = await latestBackup(env.BACKUPS);
    const ageHours = latest ? (Date.now() - Date.parse(latest.completedAt)) / 3_600_000 : null;
    return Response.json({
      healthy: ageHours !== null && ageHours <= Number(env.STALE_AFTER_HOURS || 24),
      completedAt: latest?.completedAt || null,
      ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
      objects: latest?.objects ?? null,
      bytes: latest?.bytes ?? null
    });
  }
  if (request.method === 'POST' && url.pathname === '/run') {
    const result = await createBackup(env, options);
    return Response.json(result, { status: result.status === 'completed' ? 201 : 200 });
  }
  return new Response('Not found', { status: 404 });
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
  async scheduled(_, env, ctx) {
    ctx.waitUntil(createBackup(env).catch(error => {
      console.error('STORAGE_BACKUP_FAILED', { code: error.message });
    }));
  }
};

export const internals = { canonical, deterministicUuid, latestBackup, sha256 };
