import { fail, ok, requireAdmin, supabase } from './_lib.js';

const n = value => Number(value || 0);
const cleanUnit = value => {
  const unit = String(value || '').trim();
  return unit && !/^[-+]?\d+(?:[.,]\d+)?$/.test(unit) ? unit : 'unidades';
};

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const [receipts, items, movements, warehouses] = await Promise.all([
      supabase('warehouse_receipts', {
        query:'?select=id,receipt_number,warehouse_id,received_at,status,warehouse:warehouses(id,code,name,country,city)&status=eq.received&order=received_at.asc'
      }),
      supabase('warehouse_receipt_items', {
        query:'?select=id,receipt_id,product_id,pallets,quantity,unit,units_per_pallet,lot_number,gross_weight_kg,product:products(id,sku,name,brand,category,unit,package_format)&order=created_at.asc'
      }),
      supabase('inventory_movements', {
        query:'?select=id,warehouse_id,product_id,receipt_item_id,movement_type,quantity_delta,pallets_delta,reserved_quantity_delta,reserved_pallets_delta,reference_type,reference_id,notes,created_at&order=created_at.asc'
      }).catch(() => []),
      supabase('warehouses', { query:'?select=id,code,name,country,city,active&order=active.desc,name.asc' })
    ]);

    const receiptById = new Map((receipts || []).map(r => [r.id, r]));
    const sourceByItem = new Map();

    for (const item of items || []) {
      const receipt = receiptById.get(item.receipt_id);
      if (!receipt) continue;
      sourceByItem.set(item.id, {
        receipt_item_id:item.id,
        receipt_id:receipt.id,
        receipt_number:receipt.receipt_number,
        received_at:receipt.received_at,
        warehouse_id:receipt.warehouse_id,
        warehouse:receipt.warehouse,
        product_id:item.product_id,
        product:item.product,
        unit:cleanUnit(item.unit || item.product?.unit),
        units_per_pallet:item.units_per_pallet,
        lot_number:item.lot_number,
        gross_weight_kg:item.gross_weight_kg,
        physical_quantity:n(item.quantity),
        physical_pallets:n(item.pallets),
        reserved_quantity:0,
        reserved_pallets:0,
        movement_count:0
      });
    }

    for (const movement of movements || []) {
      const source = movement.receipt_item_id ? sourceByItem.get(movement.receipt_item_id) : null;
      if (!source) continue;
      source.physical_quantity += n(movement.quantity_delta);
      source.physical_pallets += n(movement.pallets_delta);
      source.reserved_quantity += n(movement.reserved_quantity_delta);
      source.reserved_pallets += n(movement.reserved_pallets_delta);
      source.movement_count += 1;
    }

    const sources = [...sourceByItem.values()].map(source => ({
      ...source,
      available_quantity:Math.max(0, source.physical_quantity - source.reserved_quantity),
      available_pallets:Math.max(0, source.physical_pallets - source.reserved_pallets)
    })).filter(source => source.physical_quantity !== 0 || source.physical_pallets !== 0 || source.reserved_quantity !== 0 || source.reserved_pallets !== 0);

    const consolidatedMap = new Map();
    for (const source of sources) {
      const key = `${source.warehouse_id}:${source.product_id}`;
      if (!consolidatedMap.has(key)) {
        consolidatedMap.set(key, {
          warehouse_id:source.warehouse_id,
          warehouse:source.warehouse,
          product_id:source.product_id,
          product:source.product,
          unit:source.unit,
          physical_quantity:0,
          physical_pallets:0,
          reserved_quantity:0,
          reserved_pallets:0,
          available_quantity:0,
          available_pallets:0,
          source_count:0,
          sources:[]
        });
      }
      const row = consolidatedMap.get(key);
      row.physical_quantity += source.physical_quantity;
      row.physical_pallets += source.physical_pallets;
      row.reserved_quantity += source.reserved_quantity;
      row.reserved_pallets += source.reserved_pallets;
      row.available_quantity += source.available_quantity;
      row.available_pallets += source.available_pallets;
      row.source_count += 1;
      row.sources.push(source);
    }

    const inventory = [...consolidatedMap.values()].sort((a,b) => {
      const warehouseCompare = String(a.warehouse?.name || '').localeCompare(String(b.warehouse?.name || ''), 'es');
      if (warehouseCompare) return warehouseCompare;
      return String(a.product?.name || '').localeCompare(String(b.product?.name || ''), 'es');
    });

    return ok(res, {
      inventory,
      warehouses:warehouses || [],
      totals:{
        products:inventory.length,
        physical_pallets:inventory.reduce((sum,row)=>sum+n(row.physical_pallets),0),
        reserved_pallets:inventory.reduce((sum,row)=>sum+n(row.reserved_pallets),0),
        available_pallets:inventory.reduce((sum,row)=>sum+n(row.available_pallets),0)
      }
    });
  } catch (error) {
    console.error('INVENTORY_API_ERROR', error);
    return fail(res, 400, error.message || 'No se pudo cargar el inventario');
  }
}
