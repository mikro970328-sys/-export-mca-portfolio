// Cargo comes from allocations for this container, never the full sale quantity.
// Keep the projection operational: no prices, purchase costs or account balances.
export const SHIPMENT_DIRECT_CARGO_SELECT = 'id,shipment_id,allocated_sales_quantity,allocated_sales_pallets,procurement:sales_procurement_allocations(supply_plan_line:sales_supply_plan_lines(sales_order_item:sales_order_items(product_id,unit,product:products(id,sku,name),sales_order:sales_orders(id,so_number,status))),purchase_order_item:purchase_order_items(purchase_order:purchase_orders(status)))';
export const SHIPMENT_LOAD_CARGO_SELECT = 'id,load_number,shipment_id,status,loaded_at,dispatched_at,items:load_items(id,product_id,planned_quantity,planned_pallets,unit,product:products(id,sku,name))';

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const rounded = value => Math.round(value * 1000) / 1000;

export function shipmentCargoMap(loads = [], direct = [], effective = []) {
  const map = new Map();
  const effectiveById = new Map(effective.map(row => [String(row.id), row]));
  const add = (shipmentId, mode, line, source = null) => {
    if (!shipmentId) return;
    const key = String(shipmentId);
    let cargo = map.get(key);
    if (!cargo) {
      cargo = { linked:true, mode, items:[], totals:[], pallets:0, sales_orders:[] };
      map.set(key, cargo);
    }
    const itemKey = `${line.product_id || line.product_name}\u0000${line.unit || ''}`;
    let item = cargo.items.find(row => row.key === itemKey);
    if (!item) {
      item = { ...line, key:itemKey, quantity:0, pallets:0, sales_orders:[] };
      cargo.items.push(item);
    }
    item.quantity = rounded(item.quantity + number(line.quantity));
    item.pallets = rounded(item.pallets + number(line.pallets));
    if (source && !item.sales_orders.some(row => row.id === source.id)) item.sales_orders.push(source);
    if (source && !cargo.sales_orders.some(row => row.id === source.id)) cargo.sales_orders.push(source);
  };
  for (const load of loads) {
    if (load.status === 'cancelled') continue;
    for (const item of load.items || []) add(load.shipment_id, 'warehouse', {
      product_id:item.product_id, product_name:item.product?.name || 'Producto', sku:item.product?.sku || null,
      unit:item.unit || '', quantity:item.planned_quantity, pallets:item.planned_pallets
    });
  }
  for (const allocation of direct) {
    const procurement = allocation.procurement;
    const item = procurement?.supply_plan_line?.sales_order_item;
    const sale = item?.sales_order;
    if (!item || sale?.status === 'cancelled' || procurement?.purchase_order_item?.purchase_order?.status === 'cancelled') continue;
    const quantities = effectiveById.get(String(allocation.id)) || allocation;
    add(allocation.shipment_id, 'direct', {
      product_id:item.product_id, product_name:item.product?.name || 'Producto', sku:item.product?.sku || null,
      unit:item.unit || '', quantity:quantities.allocated_sales_quantity, pallets:quantities.allocated_sales_pallets
    }, sale ? { id:sale.id, so_number:sale.so_number } : null);
  }
  for (const cargo of map.values()) {
    const totals = new Map();
    for (const item of cargo.items) {
      delete item.key;
      totals.set(item.unit, rounded((totals.get(item.unit) || 0) + item.quantity));
      cargo.pallets = rounded(cargo.pallets + item.pallets);
    }
    cargo.totals = [...totals].map(([unit, quantity]) => ({ unit, quantity }));
  }
  return map;
}
