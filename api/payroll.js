import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit, upstreamFailureStatus } from './_lib.js';

const text = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = 999999999999.99;

function cleanPeriod(value) {
  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error('Selecciona un mes válido.');
  return `${match[1]}-${match[2]}-01`;
}

function cleanAmounts(body, current = {}) {
  const salary = body.salary_amount === undefined ? Number(current.salary_amount || 0) : Number(body.salary_amount || 0);
  const tips = body.tips_amount === undefined ? Number(current.tips_amount || 0) : Number(body.tips_amount || 0);
  if (!Number.isFinite(salary) || !Number.isFinite(tips) || salary < 0 || tips < 0 || salary > MAX_AMOUNT || tips > MAX_AMOUNT || salary + tips <= 0) {
    throw new Error('El salario y las propinas deben ser montos válidos y sumar más de cero.');
  }
  return { salary_amount:salary, tips_amount:tips };
}

function cleanCurrency(value, fallback = 'USD') {
  const currency = text(value, 3).toUpperCase() || fallback;
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('La moneda debe tener tres letras.');
  return currency;
}

async function hasWriteAccess(admin) {
  if (admin?.role === 'master_admin') return true;
  const rows = await supabase('admin_effective_permissions', {
    query:`?select=permission_key&admin_user_id=eq.${encodeURIComponent(admin.admin_id)}&permission_key=eq.finance.write&limit=1`
  });
  return Boolean(rows?.length);
}

async function bootstrap(admin) {
  const [workers, entries, writeAccess] = await Promise.all([
    supabase('workers', { query:'?select=id,full_name,position,is_active&order=is_active.desc,full_name.asc&limit=2000' }),
    supabase('worker_monthly_payroll', { query:'?select=id,worker_id,period_start,salary_amount,tips_amount,currency,status,notes,created_at,updated_at,voided_at&order=period_start.desc,created_at.desc&limit=5000' }),
    hasWriteAccess(admin)
  ]);
  const totals = new Map();
  for (const entry of entries || []) {
    if (entry.status !== 'posted') continue;
    const period = String(entry.period_start || '').slice(0,10);
    const currency = String(entry.currency || 'USD').toUpperCase();
    const key = `${period}|${currency}`;
    if (!totals.has(key)) totals.set(key, { period_start:period, currency, salary_amount:0, tips_amount:0 });
    const total = totals.get(key);
    total.salary_amount += Number(entry.salary_amount || 0);
    total.tips_amount += Number(entry.tips_amount || 0);
  }
  return {
    workers:writeAccess ? workers || [] : [],
    entries:writeAccess ? entries || [] : [],
    company_totals:[...totals.values()].sort((a,b)=>a.period_start.localeCompare(b.period_start)||a.currency.localeCompare(b.currency)),
    write_access:writeAccess
  };
}

async function workerName(id) {
  const rows = await supabase('workers', { query:`?select=id,full_name&id=eq.${encodeURIComponent(id)}&limit=1` });
  if (!rows?.[0]) throw new Error('Selecciona un trabajador existente.');
  return rows[0];
}

async function assertNoActiveDuplicate({ workerId, periodStart, currency, excludeId = null }) {
  let query = `?select=id&worker_id=eq.${encodeURIComponent(workerId)}&period_start=eq.${encodeURIComponent(periodStart)}&currency=eq.${encodeURIComponent(currency)}&status=eq.posted&limit=1`;
  if (excludeId) query += `&id=neq.${encodeURIComponent(excludeId)}`;
  const rows = await supabase('worker_monthly_payroll', { query });
  if (rows?.length) throw new Error('Ya existe un salario para esa persona, mes y moneda. Abre el registro para corregirlo.');
}

async function createEntry(admin, body) {
  const workerId = text(body.worker_id, 80);
  if (!UUID.test(workerId)) throw new Error('Selecciona un trabajador existente.');
  const worker = await workerName(workerId);
  const periodStart = cleanPeriod(body.period);
  const currency = cleanCurrency(body.currency);
  const amounts = cleanAmounts(body);
  await assertNoActiveDuplicate({ workerId, periodStart, currency });
  const notes = text(body.notes, 1000) || null;
  const rows = await supabase('worker_monthly_payroll', {
    method:'POST', prefer:'return=representation',
    body:[{ worker_id:workerId, period_start:periodStart, ...amounts, currency, status:'posted', notes, created_by:admin.admin_id || null, updated_by:admin.admin_id || null }]
  });
  const entry = rows?.[0];
  if (!entry?.id) throw new Error('No se pudo guardar el salario.');
  await writeAudit(admin, 'worker_monthly_payroll_created', 'worker_monthly_payroll', entry.id, {
    worker_id:worker.id, worker_name:worker.full_name, period_start:periodStart, currency,
    salary_amount:amounts.salary_amount, tips_amount:amounts.tips_amount
  });
  return entry;
}

async function updateEntry(admin, body) {
  const id = text(body.id, 80);
  if (!UUID.test(id)) throw new Error('Selecciona un registro de salario válido.');
  const currentRows = await supabase('worker_monthly_payroll', { query:`?select=*&id=eq.${encodeURIComponent(id)}&limit=1` });
  const current = currentRows?.[0];
  if (!current || current.status !== 'posted') throw new Error('El registro ya no está disponible para corregir.');
  const workerId = body.worker_id === undefined ? current.worker_id : text(body.worker_id, 80);
  if (!UUID.test(workerId)) throw new Error('Selecciona un trabajador existente.');
  const worker = await workerName(workerId);
  const periodStart = body.period === undefined ? current.period_start : cleanPeriod(body.period);
  const currency = cleanCurrency(body.currency, current.currency);
  const amounts = cleanAmounts(body, current);
  await assertNoActiveDuplicate({ workerId, periodStart, currency, excludeId:id });
  const patch = {
    worker_id:workerId, period_start:periodStart, ...amounts, currency,
    notes:body.notes === undefined ? current.notes : text(body.notes, 1000) || null,
    updated_by:admin.admin_id || null, updated_at:new Date().toISOString()
  };
  const rows = await supabase('worker_monthly_payroll', {
    method:'PATCH', prefer:'return=representation', query:`?id=eq.${encodeURIComponent(id)}&status=eq.posted&select=*`, body:patch
  });
  if (!rows?.[0]) throw new Error('El registro ya no está disponible para corregir.');
  await writeAudit(admin, 'worker_monthly_payroll_updated', 'worker_monthly_payroll', id, {
    worker_id:worker.id, worker_name:worker.full_name, period_start:periodStart, currency,
    previous:{ salary_amount:current.salary_amount, tips_amount:current.tips_amount, worker_id:current.worker_id, period_start:current.period_start, currency:current.currency },
    current:{ salary_amount:amounts.salary_amount, tips_amount:amounts.tips_amount, worker_id:workerId, period_start:periodStart, currency }
  });
  return rows[0];
}

async function voidEntry(admin, body) {
  const id = text(body.id, 80);
  if (!UUID.test(id)) throw new Error('Selecciona un registro de salario válido.');
  const currentRows = await supabase('worker_monthly_payroll', { query:`?select=id,worker_id,period_start,currency,salary_amount,tips_amount,status&id=eq.${encodeURIComponent(id)}&limit=1` });
  const current = currentRows?.[0];
  if (!current || current.status !== 'posted') throw new Error('El registro ya no está disponible para anular.');
  const rows = await supabase('worker_monthly_payroll', {
    method:'PATCH', prefer:'return=representation', query:`?id=eq.${encodeURIComponent(id)}&status=eq.posted&select=*`,
    body:{ status:'void', voided_at:new Date().toISOString(), voided_by:admin.admin_id || null, updated_by:admin.admin_id || null, updated_at:new Date().toISOString() }
  });
  if (!rows?.[0]) throw new Error('El registro ya no está disponible para anular.');
  await writeAudit(admin, 'worker_monthly_payroll_voided', 'worker_monthly_payroll', id, {
    worker_id:current.worker_id, period_start:current.period_start, currency:current.currency,
    salary_amount:current.salary_amount, tips_amount:current.tips_amount
  });
  return rows[0];
}

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, req.method === 'GET' ? 'finance.read' : 'finance.write');
  if (!admin) return;
  try {
    if (req.method === 'GET') return ok(res, await bootstrap(admin));
    if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');
    const body = await readJson(req);
    const action = text(body.action, 40).toLowerCase();
    if (action === 'create') return ok(res, { entry:await createEntry(admin, body) });
    if (action === 'update') return ok(res, { entry:await updateEntry(admin, body) });
    if (action === 'void') return ok(res, { entry:await voidEntry(admin, body) });
    return fail(res, 400, 'Acción de salario no válida.');
  } catch (error) {
    const raw = String(error?.message || '');
    const safe = new Set([
      'Selecciona un mes válido.',
      'El salario y las propinas deben ser montos válidos y sumar más de cero.',
      'La moneda debe tener tres letras.',
      'Selecciona un trabajador existente.',
      'Ya existe un salario para esa persona, mes y moneda. Abre el registro para corregirlo.',
      'No se pudo guardar el salario.',
      'Selecciona un registro de salario válido.',
      'El registro ya no está disponible para corregir.',
      'El registro ya no está disponible para anular.'
    ]);
    const duplicateRace = error?.code === '23505' && String(error?.message || '').includes('worker_monthly_payroll_active_worker_period_currency_uidx');
    const message = duplicateRace ? 'Ya existe un salario para esa persona, mes y moneda. Abre el registro para corregirlo.' : safe.has(raw) ? raw : 'No se pudo procesar el salario. Intenta nuevamente.';
    const status = duplicateRace || safe.has(raw) ? 400 : upstreamFailureStatus(error, 500);
    if (status >= 500) console.error('[payroll]', error);
    return fail(res, status, message);
  }
}
