import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const numberOrNull = value => value === '' || value === null || value === undefined ? null : Number(value);
const normalizedSku = value => text(value, 120).toUpperCase().replace(/\s+/g, ' ');
const isNumericText = value => /^[-+]?\d+(?:[.,]\d+)?$/.test(text(value));
const normalizeUnit = value => {
  const unit = text(value, 80);
  if (!unit) return 'unidades';
  if (isNumericText(unit)) throw new Error('La unidad base debe ser texto, por ejemplo: unidades, cajas o paneles');
  return unit;
};

async function listProducts() {
  return await supabase('products', { query:'?select=id,sku,name,description,category,brand,hs_code,country_of_origin,unit,unit_weight_kg,unit_volume_m3,currency,active,created_at,updated_at,package_format,default_units_per_pallet,notes&order=active.desc,name.asc' }) || [];
}

async function assertUniqueSku(sku, excludeId = null) {
  if (!sku) return;
  const rows = await supabase('products', { query:'?select=id,sku' }) || [];
  const duplicate = rows.find(item => String(item.id) !== String(excludeId || '') && normalizedSku(item.sku) === sku);
  if (duplicate) throw new Error('Ya existe un producto con ese SKU');
}

function productPayload(body) {
  const name = text(body.name, 250);
  if (!name) throw new Error('El nombre del producto es obligatorio');
  const sku = normalizedSku(body.sku) || null;
  const defaultUnitsPerPallet = numberOrNull(body.default_units_per_pallet);
  const unitWeightKg = numberOrNull(body.unit_weight_kg);
  const unitVolumeM3 = numberOrNull(body.unit_volume_m3);
  if (defaultUnitsPerPallet !== null && (!Number.isFinite(defaultUnitsPerPallet) || defaultUnitsPerPallet <= 0)) throw new Error('Unidades por pallet inválidas');
  if (unitWeightKg !== null && (!Number.isFinite(unitWeightKg) || unitWeightKg < 0)) throw new Error('Peso unitario inválido');
  if (unitVolumeM3 !== null && (!Number.isFinite(unitVolumeM3) || unitVolumeM3 < 0)) throw new Error('Volumen unitario inválido');
  return {
    sku,
    name,
    description:text(body.description, 2000) || null,
    category:text(body.category, 160) || null,
    brand:text(body.brand, 160) || null,
    hs_code:text(body.hs_code, 120) || null,
    country_of_origin:text(body.country_of_origin, 160) || null,
    unit:normalizeUnit(body.unit),
    unit_weight_kg:unitWeightKg,
    unit_volume_m3:unitVolumeM3,
    package_format:text(body.package_format, 250) || null,
    default_units_per_pallet:defaultUnitsPerPallet,
    notes:text(body.notes, 2000) || null
  };
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') return ok(res, { products:await listProducts() });

    if (req.method === 'POST') {
      const body = await readJson(req);
      const payload = productPayload(body);
      await assertUniqueSku(payload.sku);
      const rows = await supabase('products', {
        method:'POST',
        prefer:'return=representation',
        body:[payload]
      });
      const product = rows?.[0];
      if (!product?.id) throw new Error('No se pudo crear el producto');
      await writeAudit(admin, 'product_created', 'product', product.id, { sku:product.sku, name:product.name });
      return ok(res, { product });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = text(body.id, 80);
      if (!id) throw new Error('Falta el producto');
      const action = text(body.action, 60) || 'update';
      const existing = await supabase('products', { query:`?select=*&id=eq.${encodeURIComponent(id)}&limit=1` });
      if (!existing?.[0]) throw new Error('Producto no encontrado');

      if (action === 'set_active') {
        const active = Boolean(body.active);
        const rows = await supabase('products', {
          method:'PATCH',
          prefer:'return=representation',
          query:`?id=eq.${encodeURIComponent(id)}`,
          body:{ active, updated_at:new Date().toISOString() }
        });
        await writeAudit(admin, active ? 'product_reactivated' : 'product_deactivated', 'product', id, { sku:existing[0].sku, name:existing[0].name });
        return ok(res, { product:rows?.[0] });
      }

      if (action !== 'update') return fail(res, 400, 'Acción de producto inválida');
      const payload = productPayload(body);
      await assertUniqueSku(payload.sku, id);
      const rows = await supabase('products', {
        method:'PATCH',
        prefer:'return=representation',
        query:`?id=eq.${encodeURIComponent(id)}`,
        body:{ ...payload, updated_at:new Date().toISOString() }
      });
      await writeAudit(admin, 'product_updated', 'product', id, { sku:payload.sku, name:payload.name });
      return ok(res, { product:rows?.[0] });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    console.error('[products]', error);
    return fail(res, 400, error.message || 'No se pudo procesar el producto');
  }
}
