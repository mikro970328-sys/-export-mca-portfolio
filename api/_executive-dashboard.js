import { supabase } from './_lib.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3,10}$/;

function cleanDate(value, label) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!DATE_RE.test(raw)) throw new Error(`${label} inválida. Usa YYYY-MM-DD.`);
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== raw) throw new Error(`${label} inválida.`);
  return raw;
}

function cleanUuid(value, label) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!UUID_RE.test(raw)) throw new Error(`${label} inválido.`);
  return raw;
}

function cleanCurrency(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return null;
  if (!CURRENCY_RE.test(raw)) throw new Error('Moneda inválida.');
  return raw;
}

export function parseExecutiveFilters(query = {}) {
  const filters = {
    start_date: cleanDate(query.start_date || query.start, 'Fecha inicial'),
    end_date: cleanDate(query.end_date || query.end, 'Fecha final'),
    currency: cleanCurrency(query.currency),
    client_id: cleanUuid(query.client_id, 'Cliente'),
    supplier_id: cleanUuid(query.supplier_id, 'Proveedor'),
    product_id: cleanUuid(query.product_id, 'Producto')
  };
  if (filters.start_date && filters.end_date && filters.start_date > filters.end_date) {
    throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
  }
  return filters;
}

export async function loadExecutiveDashboard(query = {}) {
  const filters = parseExecutiveFilters(query);
  const result = await supabase('rpc/executive_dashboard_rollup', {
    method:'POST',
    body:{
      p_start_date:filters.start_date,
      p_end_date:filters.end_date,
      p_currency:filters.currency,
      p_client_id:filters.client_id,
      p_supplier_id:filters.supplier_id,
      p_product_id:filters.product_id
    }
  });
  const payload = Array.isArray(result) ? (result[0] || {}) : (result || {});
  return {
    owner:'executive_dashboard_rollup',
    generated_at:new Date().toISOString(),
    ...payload
  };
}
