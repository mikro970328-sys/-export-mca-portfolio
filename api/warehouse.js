import crypto from 'node:crypto';
import { authorizeAdmin, fail, ok, readJson, supabase, upstreamFailureStatus } from './_lib.js';
import { loadWarehouseReceiptActionCapabilityMap } from './_warehouse-actions.js';

const text = value => String(value ?? '').trim();
const numberOrNull = value => value === '' || value === null || value === undefined ? null : Number(value);
const isNumericText = value => /^[-+]?\d+(?:[.,]\d+)?$/.test(text(value));
const normalizeUnit = (value, fallback = 'unidades') => {
  const candidate = text(value);
  if (!candidate || isNumericText(candidate)) return text(fallback) && !isNumericText(fallback) ? text(fallback) : 'unidades';
  return candidate;
};
const rpcRow = value => Array.isArray(value) ? (value[0] || null) : (value || null);

function translatedError(raw) {
  const messages = [
    ['WR_REQUEST_CONFLICT','Esta solicitud ya registró una recepción con otros datos. Revisa el listado antes de crear una nueva.'],
    ['WR_WAREHOUSE_REQUIRED','Selecciona el almacén que recibe la mercancía'],
    ['WR_WAREHOUSE_NOT_FOUND','El almacén seleccionado no existe'],
    ['WR_SUPPLIER_NOT_FOUND','El proveedor seleccionado no existe'],
    ['WR_SUPPLIER_INACTIVE','El proveedor seleccionado está inactivo'],
    ['WR_ITEMS_REQUIRED','Agrega al menos una línea de mercancía'],
    ['WR_HEADER_INVALID','Revisa el almacén, proveedor y fecha de recepción'],
    ['WR_PAYLOAD_INVALID','Solicitud de recepción inválida'],
    ['PERMISSION_REQUIRED','No tienes permiso para ejecutar esta acción de almacén.'],
    ['WR_NOT_FOUND','La recepción no existe.'],
    ['WR_NOT_RECEIVED','La recepción ya no está disponible para anular.'],
    ['WR_HAS_INVENTORY_HISTORY','No se puede anular porque la recepción ya tiene movimientos de inventario.'],
    ['WR_ASSIGNED_TO_LOAD','No se puede anular porque mercancía de esta recepción está asignada a un Cargue activo.'],
    ['WR_ACTION_INVALID','Acción de recepción inválida.'],
    ['WR_ACTION_NOT_ALLOWED','La acción ya no está disponible para esta recepción.'],
    ['WR_QUANTITY_PALLET_MISMATCH','La cantidad recibida debe coincidir con los pallets multiplicados por las unidades por pallet.']
  ];
  const translated = messages.find(([key]) => raw.includes(key))?.[1];
  if (translated) return translated;
  const lineMatch = raw.match(/WR_LINE_(PRODUCT_REQUIRED|PRODUCT_NOT_FOUND|PALLETS_INVALID|UNITS_INVALID|QUANTITY_INVALID|MODE_INVALID|NET_INVALID|GROSS_INVALID|COST_INVALID|NUMBER_INVALID):(\d+)/);
  if (lineMatch) {
    const n = lineMatch[2];
    return {
      PRODUCT_REQUIRED:'Selecciona el producto de la línea '+n,
      PRODUCT_NOT_FOUND:'El producto de la línea '+n+' no existe',
      PALLETS_INVALID:'Pallets de la línea '+n+' inválido',
      UNITS_INVALID:'Unidades por pallet inválidas en la línea '+n,
      QUANTITY_INVALID:'Cantidad de la línea '+n+' inválido',
      MODE_INVALID:'Forma de recepción inválida en línea '+n,
      NET_INVALID:'Peso neto inválido en línea '+n,
      GROSS_INVALID:'Peso bruto inválido en línea '+n,
      COST_INVALID:'Costo inválido en línea '+n,
      NUMBER_INVALID:'Revisa las cantidades, pesos y costos de la línea '+n
    }[lineMatch[1]];
  }
  const safe = new Set([
    'Código, nombre y país son obligatorios',
    'El nombre del producto es obligatorio',
    'La unidad base debe ser texto, por ejemplo: paneles, cajas o unidades',
    'Unidades por pallet inválidas',
    'Peso unitario inválido',
    'Selecciona el almacén que recibe la mercancía',
    'Agrega al menos una línea de mercancía',
    'El proveedor seleccionado no existe',
    'El proveedor seleccionado está inactivo',
    'Selecciona al menos un producto',
    'Falta el identificador'
  ]);
  if (safe.has(raw)) return raw;
  const patterns = [
    /^Selecciona el producto de la línea \d+$/,
    /^El producto de la línea \d+ no existe$/,
    /^Pallets de la línea \d+ inválido$/,
    /^Unidades por pallet inválidas en la línea \d+$/,
    /^Cantidad de la línea \d+ inválido$/,
    /^Forma de recepción inválida en línea \d+$/,
    /^(?:Peso neto|Peso bruto|Costo) inválido en línea \d+$/
  ];
  return patterns.some(pattern => pattern.test(raw)) ? raw : null;
}

async function audit(admin, action, entityType, entityId, details = {}) {
  try {
    await supabase('audit_log', { method:'POST', body:[{
      action, entity_type:entityType, entity_id:entityId || null, details,
      actor_admin_id:admin.admin_id || null, actor_username:admin.username || null
    }] });
  } catch {}
}

async function loadAll(admin) {
  const [warehouses, rawProducts, suppliers, receipts, rawItems, receiptAccess] = await Promise.all([
    supabase('warehouses', { query:'?select=*&order=active.desc,name.asc' }),
    supabase('products', { query:'?select=*&order=active.desc,name.asc' }),
    supabase('suppliers', { query:'?select=id,name,legal_name,email,phone,address,country,tax_id,notes,active&order=active.desc,name.asc' }),
    supabase('warehouse_receipts', { query:'?select=*,warehouse:warehouses(id,code,name,country,city),supplier:suppliers(id,name)&order=received_at.desc,created_at.desc' }),
    supabase('warehouse_receipt_items', { query:'?select=*,product:products(id,sku,name,brand,category,package_format,unit,default_units_per_pallet)&order=created_at.asc' }),
    loadWarehouseReceiptActionCapabilityMap(admin)
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
    suppliers: suppliers || [],
    receipts: (receipts || []).map(receipt => ({
      ...receipt,
      items:byReceipt.get(receipt.id) || [],
      capabilities:receiptAccess.map.get(String(receipt.id)) || { actions:{}, write_access:receiptAccess.write_access }
    })),
    write_access:receiptAccess.write_access
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const admin = await authorizeAdmin(req, res, 'warehouse.read');
      if (!admin) return;
      return ok(res, await loadAll(admin));
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const action = text(body.action);
      const admin = await authorizeAdmin(req, res, action === 'create_product' ? 'procurement.write' : 'warehouse.write');
      if (!admin) return;

      if (action === 'create_warehouse') {
        const code = text(body.code).toUpperCase();
        const name = text(body.name);
        const country = text(body.country);
        if (!code || !name || !country) throw new Error('Código, nombre y país son obligatorios');
        const created = await supabase('warehouses', { method:'POST', query:'?select=*', body:[{
          code, name, country, city:text(body.city) || null, address:text(body.address) || null,
          notes:text(body.notes) || null, created_by:admin.admin_id || null
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
        const requestId = text(body.registration_request_id) || crypto.randomUUID();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
          return fail(res,400,'Solicitud de recepción inválida. Abre una nueva recepción.');
        }
        let receivedAt = null;
        if (body.received_at) {
          const parsed = new Date(body.received_at);
          if (!Number.isFinite(parsed.getTime())) return fail(res,400,'Fecha de recepción inválida');
          receivedAt = parsed.toISOString();
        }
        const payload = {
          warehouse_id:text(body.warehouse_id) || null,
          supplier_id:text(body.supplier_id) || null,
          received_at:receivedAt,
          truck_reference:text(body.truck_reference) || null,
          driver_name:text(body.driver_name) || null,
          reference_number:text(body.reference_number) || null,
          notes:text(body.notes) || null,
          items:Array.isArray(body.items) ? body.items.map(line => Object.fromEntries(
            ['product_id','entry_mode','pallets','quantity','units_per_pallet','net_weight_kg',
              'gross_weight_kg','unit_cost','currency','lot_number','notes']
              .map(key => [key,line?.[key] ?? null])
          )) : []
        };
        const result = await supabase('rpc/create_warehouse_receipt_canonical', {
          method:'POST',body:{p_payload:payload,p_actor:admin.admin_id,p_request_id:requestId}
        });
        const receipt = rpcRow(result);
        if (!receipt?.id) throw new Error('WR_CREATE_EMPTY');
        return ok(res,{receipt});
      }

      return fail(res, 400, 'Acción no reconocida');
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const action = text(body.action);
      const admin = await authorizeAdmin(req, res, action === 'set_product_active' ? 'procurement.write' : 'warehouse.write');
      if (!admin) return;
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
        const result = await supabase('rpc/cancel_warehouse_receipt_canonical', { method:'POST', body:{
          p_receipt_id:id,
          p_actor:admin.admin_id || null
        } });
        const receipt = rpcRow(result);
        if (!receipt?.id) throw new Error('WR_NOT_FOUND');
        await audit(admin, 'warehouse_receipt_cancelled', 'warehouse_receipt', id, { receipt_number:receipt.receipt_number });
        return ok(res, { receipt });
      }
      return fail(res, 400, 'Acción no reconocida');
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    console.error('WAREHOUSE_API_ERROR', error);
    const raw = String(error.message || 'No se pudo procesar la operación de almacén');
    const translated = translatedError(raw);
    if (translated) return fail(res, raw.includes('PERMISSION_REQUIRED') ? 403 : raw.includes('WR_REQUEST_CONFLICT') ? 409 : 400, translated);
    return fail(res, upstreamFailureStatus(error,500), 'No se pudo procesar la operación de almacén');
  }
}
