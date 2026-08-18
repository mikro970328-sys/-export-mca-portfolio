import { fail, ok, readJson, requireAdmin, supabase } from './_lib.js';

const text = value => String(value ?? '').trim();
const numberOrNull = value => value === '' || value === null || value === undefined ? null : Number(value);
const positive = (value, label, allowZero = false) => {
  const n = Number(value);
  if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) throw new Error(`${label} inválido`);
  return n;
};
const isNumericText = value => /^[-+]?\d+(?:[.,]\d+)?$/.test(text(value));
const normalizeUnit = (value, fallback = 'unidades') => {
  const candidate = text(value);
  if (!candidate || isNumericText(candidate)) return text(fallback) && !isNumericText(fallback) ? text(fallback) : 'unidades';
  return candidate;
};

async function audit(admin, action, entityType, entityId, details = {}) {
  try {
    await supabase('audit_log', { method:'POST', body:[{
      action, entity_type:entityType, entity_id:entityId || null, details,
      actor_admin_id:admin.id || null, actor_username:admin.username || null
    }] });
  } catch {}
}

async function loadAll() {
  const [warehouses, rawProducts, receipts, rawItems] = await Promise.all([
    supabase('warehouses', { query:'?select=*&order=active.desc,name.asc' }),
    supabase('products', { query:'?select=*&order=active.desc,name.asc' }),
    supabase('warehouse_receipts', { query:'?select=*,warehouse:warehouses(id,code,name,country,city),supplier:suppliers(id,name)&order=received_at.desc,created_at.desc' }),
    supabase('warehouse_receipt_items', { query:'?select=*,product:products(id,sku,name,brand,category,package_format,unit,default_units_per_pallet)&order=created_at.asc' })
  ]);

  const products = (rawProducts || []).map(product => ({
    ...product,
    unit: normalizeUnit(product.unit)
  }));

  const byReceipt = new Map();
  for (const rawItem of rawItems || []) {
    const product = rawItem.product ? { ...rawItem.product, unit: normalizeUnit(rawItem.product.unit) } : null;
    const item = { ...rawItem, product, unit: normalizeUnit(rawItem.unit, product?.unit) };
    if (!byReceipt.has(item.receipt_id)) byReceipt.set(item.receipt_id, []);
    byReceipt.get(item.receipt_id).push(item);
  }

  return {
    warehouses: warehouses || [],
    products,
    receipts: (receipts || []).map(receipt => ({ ...receipt, items:byReceipt.get(receipt.id) || [] }))
  };
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    if (req.method === 'GET') return ok(res, await loadAll());

    if (req.method === 'POST') {
      const body = await readJson(req);
      const action = text(body.action);

      if (action === 'create_warehouse') {
        const code = text(body.code).toUpperCase();
        const name = text(body.name);
        const country = text(body.country);
        if (!code || !name || !country) throw new Error('Código, nombre y país son obligatorios');
        const created = await supabase('warehouses', { method:'POST', query:'?select=*', body:[{
          code, name, country, city:text(body.city) || null, address:text(body.address) || null,
          notes:text(body.notes) || null, created_by:admin.id || null
        }] });
        await audit(admin, 'warehouse_created', 'warehouse', created?.[0]?.id, { code, name, country });
        return ok(res, { warehouse:created?.[0] });
      }

      if (action === 'create_product') {
        const name = text(body.name);
        if (!name) throw new Error('El nombre del producto es obligatorio');
        const sku = text(body.sku).toUpperCase() || null;
        const rawUnit = text(body.unit);
        if (rawUnit && isNumericText(rawUnit)) throw new Error('La unidad base debe ser texto, por ejemplo: paneles, cajas o unidades');
        const unit = normalizeUnit(rawUnit);
        const defaultUnits = numberOrNull(body.default_units_per_pallet);
        if (defaultUnits !== null && (!Number.isFinite(defaultUnits) || defaultUnits <= 0)) throw new Error('Unidades por pallet inválidas');
        const unitWeight = numberOrNull(body.unit_weight_kg);
        if (unitWeight !== null && (!Number.isFinite(unitWeight) || unitWeight < 0)) throw new Error('Peso unitario inválido');
        const created = await supabase('products', { method:'POST', query:'?select=*', body:[{
          sku, name, description:text(body.description) || null, category:text(body.category) || null,
          brand:text(body.brand) || null, hs_code:text(body.hs_code) || null,
          country_of_origin:text(body.country_of_origin) || null, unit,
          unit_weight_kg:unitWeight, package_format:text(body.package_format) || null,
          default_units_per_pallet:defaultUnits, notes:text(body.notes) || null
        }] });
        await audit(admin, 'product_created', 'product', created?.[0]?.id, { sku, name, unit });
        return ok(res, { product:created?.[0] });
      }

      if (action === 'create_receipt') {
        const warehouseId = text(body.warehouse_id);
        if (!warehouseId) throw new Error('Selecciona el almacén que recibe la mercancía');
        const lines = Array.isArray(body.items) ? body.items : [];
        if (!lines.length) throw new Error('Agrega al menos una línea de mercancía');

        const productIds = [...new Set(lines.map(line => text(line.product_id)).filter(Boolean))];
        if (!productIds.length) throw new Error('Selecciona al menos un producto');
        const productRows = await supabase('products', {
          query:`?select=id,name,unit,default_units_per_pallet&id=in.(${productIds.join(',')})`
        });
        const productById = new Map((productRows || []).map(product => [product.id, product]));

        const cleanLines = lines.map((line, index) => {
          const productId = text(line.product_id);
          if (!productId) throw new Error(`Selecciona el producto de la línea ${index + 1}`);
          const product = productById.get(productId);
          if (!product) throw new Error(`El producto de la línea ${index + 1} no existe`);

          const entryMode = text(line.entry_mode).toLowerCase() || 'units';
          let pallets = 0;
          let quantity = 0;
          let unitsPerPallet = numberOrNull(line.units_per_pallet);

          if (entryMode === 'pallets') {
            pallets = positive(line.pallets, `Pallets de la línea ${index + 1}`);
            if (unitsPerPallet === null) unitsPerPallet = numberOrNull(product.default_units_per_pallet);
            if (unitsPerPallet === null || !Number.isFinite(unitsPerPallet) || unitsPerPallet <= 0) {
              throw new Error(`Indica las unidades por pallet en la línea ${index + 1}`);
            }
            quantity = pallets * unitsPerPallet;
          } else if (entryMode === 'units') {
            quantity = positive(line.quantity, `Cantidad de la línea ${index + 1}`);
            pallets = 0;
            unitsPerPallet = null;
          } else {
            throw new Error(`Forma de recepción inválida en línea ${index + 1}`);
          }

          const netWeight = numberOrNull(line.net_weight_kg);
          const grossWeight = numberOrNull(line.gross_weight_kg);
          const unitCost = numberOrNull(line.unit_cost);
          if (netWeight !== null && (!Number.isFinite(netWeight) || netWeight < 0)) throw new Error(`Peso neto inválido en línea ${index + 1}`);
          if (grossWeight !== null && (!Number.isFinite(grossWeight) || grossWeight < 0)) throw new Error(`Peso bruto inválido en línea ${index + 1}`);
          if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) throw new Error(`Costo inválido en línea ${index + 1}`);

          return {
            product_id:productId, pallets, quantity, unit:normalizeUnit(product.unit),
            units_per_pallet:unitsPerPallet, net_weight_kg:netWeight, gross_weight_kg:grossWeight,
            unit_cost:unitCost, currency:text(line.currency).toUpperCase() || 'USD',
            lot_number:text(line.lot_number) || null, notes:text(line.notes) || null
          };
        });

        const receivedAt = body.received_at ? new Date(body.received_at).toISOString() : new Date().toISOString();
        const createdHeaders = await supabase('warehouse_receipts', { method:'POST', query:'?select=*', body:[{
          warehouse_id:warehouseId, supplier_id:text(body.supplier_id) || null,
          supplier_name:text(body.supplier_name) || null, received_at:receivedAt,
          truck_reference:text(body.truck_reference) || null, driver_name:text(body.driver_name) || null,
          reference_number:text(body.reference_number) || null, notes:text(body.notes) || null,
          created_by:admin.id || null
        }] });
        const receipt = createdHeaders?.[0];
        if (!receipt?.id) throw new Error('No se pudo crear la recepción');
        try {
          const createdItems = await supabase('warehouse_receipt_items', { method:'POST', query:'?select=*', body:cleanLines.map(line => ({ ...line, receipt_id:receipt.id })) });
          await audit(admin, 'warehouse_receipt_created', 'warehouse_receipt', receipt.id, {
            receipt_number:receipt.receipt_number, warehouse_id:warehouseId,
            lines:cleanLines.length, total_quantity:cleanLines.reduce((sum,x)=>sum+x.quantity,0),
            total_pallets:cleanLines.reduce((sum,x)=>sum+x.pallets,0)
          });
          return ok(res, { receipt:{ ...receipt, items:createdItems || [] } });
        } catch (error) {
          await supabase('warehouse_receipts', { method:'DELETE', query:`?id=eq.${encodeURIComponent(receipt.id)}` }).catch(()=>{});
          throw error;
        }
      }

      return fail(res, 400, 'Acción no reconocida');
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const action = text(body.action);
      const id = text(body.id);
      if (!id) throw new Error('Falta el identificador');

      if (action === 'set_warehouse_active') {
        const active = Boolean(body.active);
        const rows = await supabase('warehouses', { method:'PATCH', query:`?id=eq.${encodeURIComponent(id)}&select=*`, body:{ active, updated_at:new Date().toISOString() } });
        await audit(admin, active ? 'warehouse_reactivated' : 'warehouse_deactivated', 'warehouse', id);
        return ok(res, { warehouse:rows?.[0] });
      }
      if (action === 'set_product_active') {
        const active = Boolean(body.active);
        const rows = await supabase('products', { method:'PATCH', query:`?id=eq.${encodeURIComponent(id)}&select=*`, body:{ active, updated_at:new Date().toISOString() } });
        await audit(admin, active ? 'product_reactivated' : 'product_deactivated', 'product', id);
        return ok(res, { product:rows?.[0] });
      }
      if (action === 'cancel_receipt') {
        const rows = await supabase('warehouse_receipts', { method:'PATCH', query:`?id=eq.${encodeURIComponent(id)}&status=eq.received&select=*`, body:{ status:'cancelled', updated_at:new Date().toISOString() } });
        if (!rows?.length) throw new Error('La recepción no existe o ya fue cancelada');
        await audit(admin, 'warehouse_receipt_cancelled', 'warehouse_receipt', id, { receipt_number:rows[0].receipt_number });
        return ok(res, { receipt:rows[0] });
      }
      return fail(res, 400, 'Acción no reconocida');
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    console.error('WAREHOUSE_API_ERROR', error);
    return fail(res, 400, error.message || 'No se pudo procesar la operación de almacén');
  }
}
