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
    const [balances, warehouses] = await Promise.all([
      supabase('inventory_source_balances', {
        query:'?select=*&order=received_at.asc,receipt_number.asc'
      }),
      supabase('warehouses', {
        query:'?select=id,code,name,country,city,active&order=active.desc,name.asc'
      })
    ]);

    const consolidatedMap = new Map();

    for (const row of balances || []) {
      const physicalQuantity = n(row.physical_quantity);
      const physicalPallets = n(row.physical_pallets);
      const reservedQuantity = n(row.reserved_quantity);
      const reservedPallets = n(row.reserved_pallets);
      const availableQuantity = Math.max(0, physicalQuantity - reservedQuantity);
      const availablePallets = Math.max(0, physicalPallets - reservedPallets);
      const unit = cleanUnit(row.receipt_unit || row.product_unit);

      const source = {
        receipt_item_id:row.receipt_item_id,
        receipt_id:row.receipt_id,
        receipt_number:row.receipt_number,
        received_at:row.received_at,
        warehouse_id:row.warehouse_id,
        warehouse:{
          id:row.warehouse_id,
          code:row.warehouse_code,
          name:row.warehouse_name,
          country:row.warehouse_country,
          city:row.warehouse_city,
          active:row.warehouse_active
        },
        product_id:row.product_id,
        product:{
          id:row.product_id,
          sku:row.product_sku,
          name:row.product_name,
          brand:row.product_brand,
          category:row.product_category,
          unit:cleanUnit(row.product_unit),
          package_format:row.product_package_format
        },
        unit,
        units_per_pallet:row.units_per_pallet,
        lot_number:row.lot_number,
        gross_weight_kg:row.gross_weight_kg,
        physical_quantity:physicalQuantity,
        physical_pallets:physicalPallets,
        reserved_quantity:reservedQuantity,
        reserved_pallets:reservedPallets,
        available_quantity:availableQuantity,
        available_pallets:availablePallets,
        movement_count:n(row.movement_count)
      };

      if (
        physicalQuantity === 0 && physicalPallets === 0 &&
        reservedQuantity === 0 && reservedPallets === 0
      ) continue;

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

      const consolidated = consolidatedMap.get(key);
      consolidated.physical_quantity += physicalQuantity;
      consolidated.physical_pallets += physicalPallets;
      consolidated.reserved_quantity += reservedQuantity;
      consolidated.reserved_pallets += reservedPallets;
      consolidated.available_quantity += availableQuantity;
      consolidated.available_pallets += availablePallets;
      consolidated.source_count += 1;
      consolidated.sources.push(source);
    }

    const inventory = [...consolidatedMap.values()].sort((a, b) => {
      const byWarehouse = String(a.warehouse?.name || '').localeCompare(String(b.warehouse?.name || ''), 'es');
      if (byWarehouse) return byWarehouse;
      return String(a.product?.name || '').localeCompare(String(b.product?.name || ''), 'es');
    });

    return ok(res, {
      inventory,
      warehouses:warehouses || [],
      totals:{
        products:new Set(inventory.map(row => row.product_id)).size,
        physical_pallets:inventory.reduce((sum, row) => sum + n(row.physical_pallets), 0),
        reserved_pallets:inventory.reduce((sum, row) => sum + n(row.reserved_pallets), 0),
        available_pallets:inventory.reduce((sum, row) => sum + n(row.available_pallets), 0)
      }
    });
  } catch (error) {
    console.error('INVENTORY_API_ERROR', error);
    return fail(res, 400, error.message || 'No se pudo cargar el inventario');
  }
}
