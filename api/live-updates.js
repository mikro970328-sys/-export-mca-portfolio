import { authenticateAdmin, fail, ok, supabase, upstreamFailureStatus } from './_lib.js';

const ALLOWED_SCOPES = new Set([
  'products','suppliers','purchases','warehouse','inventory','loads','sales',
  'clients','shipments','publications','invoices','payables','costs','tasks',
  'notifications','account','workers'
]);

export function normalizeLiveUpdateState(rows) {
  const versions = {};
  const changedAt = {};
  for (const row of rows || []) {
    const scope = String(row?.scope || '');
    const version = Number(row?.version);
    if (!ALLOWED_SCOPES.has(scope) || !Number.isSafeInteger(version) || version < 0) continue;
    versions[scope] = version;
    changedAt[scope] = row.changed_at || null;
  }
  return { versions, changed_at:changedAt };
}

export default async function handler(req, res) {
  try {
    const admin = await authenticateAdmin(req, res);
    if (!admin) return;
    if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

    const rows = await supabase('erp_change_state', {
      query:'?select=scope,version,changed_at&order=scope.asc'
    });
    return ok(res, { ...normalizeLiveUpdateState(rows), checked_at:new Date().toISOString() });
  } catch (error) {
    console.error('LIVE_UPDATES_ERROR', error);
    return fail(res, upstreamFailureStatus(error, 500), 'No se pudo comprobar la sincronización en vivo');
  }
}
