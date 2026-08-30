import { authorizeAdmin, fail, ok, supabase } from './_lib.js';
import { loadExecutiveDashboard } from './_executive-dashboard.js';

// Dashboard projection owner: api/dashboard.js.
function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

async function hasPermission(admin, permissionKey) {
  if (admin.role === 'master_admin') return true;
  const rows = await supabase('admin_effective_permissions', {
    query:`?select=permission_key&admin_user_id=eq.${encodeURIComponent(admin.admin_id)}&permission_key=eq.${encodeURIComponent(permissionKey)}&limit=1`
  });
  return Boolean(rows?.length);
}

async function hasAnyPermission(admin, permissionKeys=[]) {
  if (admin.role === 'master_admin') return true;
  for (const permissionKey of permissionKeys) {
    if (await hasPermission(admin,permissionKey)) return true;
  }
  return false;
}

function classifyShipment(shipment) {
  const status = normalize(shipment.operational_status || shipment.last_status || 'registrado');
  if (shipment.active === false || shipment.delivered_at || /entreg|delivered|cerrad|closed/.test(status)) return 'delivered';
  if (shipment.released_at || /liberad|released|disponible para entrega|available for delivery/.test(status)) return 'released';
  if (/esperando liberacion|awaiting release|pendiente de liberacion/.test(status)) return 'awaiting_release';
  if (/destino|destination|arribo|arrived|descargad|discharged/.test(status)) return 'at_destination';
  if (/transit|transito|salio del puerto|salida del puerto|cargado en el buque|loaded on vessel|en navegacion|navegando|transbordo|transshipment|zarpo|zarpado|booking confirmado|cargado/.test(status)) return 'in_transit';
  return 'active_other';
}

function buildShipmentStats(shipments) {
  const stats = { total:shipments.length, active:0, in_transit:0, at_destination:0, awaiting_release:0, released:0, delivered:0, active_other:0 };
  for (const shipment of shipments) {
    const group = classifyShipment(shipment);
    if (group !== 'delivered' && shipment.active !== false) stats.active += 1;
    stats[group] += 1;
  }
  return stats;
}

// Legacy operations are retained for compatibility/history only. P11 UI does not expose Expedientes.
function buildOperationStats(operations, shipments) {
  const byOperation = new Map();
  shipments.forEach(shipment => {
    if (!shipment.operation_id) return;
    const key = String(shipment.operation_id);
    if (!byOperation.has(key)) byOperation.set(key, []);
    byOperation.get(key).push(shipment);
  });
  const isFinalized = operation => {
    const linked = byOperation.get(String(operation.id)) || [];
    return linked.length > 0 && linked.every(shipment => classifyShipment(shipment) === 'delivered');
  };
  const activeOperations = operations.filter(operation => !isFinalized(operation) && normalize(operation.status) !== 'cancelled');
  return {
    total: operations.length,
    active: activeOperations.length,
    incomplete: activeOperations.filter(operation => !(byOperation.get(String(operation.id)) || []).length).length,
    closed: operations.filter(operation => isFinalized(operation)).length
  };
}

function buildWrStats(receipts) {
  return {
    total: receipts.length,
    received: receipts.filter(row => row.status === 'received').length,
    cancelled: receipts.filter(row => row.status === 'cancelled').length
  };
}

function buildLoadStats(loads) {
  const activeStates = new Set(['draft','reserved','loading','loaded']);
  return {
    total: loads.length,
    active: loads.filter(row => activeStates.has(row.status)).length,
    draft: loads.filter(row => row.status === 'draft').length,
    reserved: loads.filter(row => row.status === 'reserved').length,
    dispatched: loads.filter(row => row.status === 'dispatched').length,
    cancelled: loads.filter(row => row.status === 'cancelled').length
  };
}

function numeric(value) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function inventoryCounts(sources) {
  const rows = sources.filter(source => source.warehouse_active !== false);
  const available = rows.filter(source =>
    numeric(source.physical_quantity) - numeric(source.reserved_quantity) > 0 ||
    numeric(source.physical_pallets) - numeric(source.reserved_pallets) > 0
  );
  return {
    source_lines: available.length,
    products_with_stock: new Set(available.map(row => row.product_id).filter(Boolean)).size,
    wr_with_stock: new Set(available.map(row => row.receipt_id).filter(Boolean)).size,
    physical_quantity: rows.reduce((sum,row)=>sum+numeric(row.physical_quantity),0),
    reserved_quantity: rows.reduce((sum,row)=>sum+numeric(row.reserved_quantity),0),
    available_quantity: rows.reduce((sum,row)=>sum+numeric(row.physical_quantity)-numeric(row.reserved_quantity),0),
    physical_pallets: rows.reduce((sum,row)=>sum+numeric(row.physical_pallets),0),
    reserved_pallets: rows.reduce((sum,row)=>sum+numeric(row.reserved_pallets),0),
    available_pallets: rows.reduce((sum,row)=>sum+numeric(row.physical_pallets)-numeric(row.reserved_pallets),0)
  };
}

function recentActivity(shipments) {
  return [...shipments]
    .sort((a,b) => new Date(b.updated_at || b.last_event_at || b.created_at || 0) - new Date(a.updated_at || a.last_event_at || a.created_at || 0))
    .slice(0,6)
    .map(shipment => ({
      id:shipment.id,
      container_number:shipment.container_number,
      client_name:shipment.clients?.name || null,
      operational_status:shipment.operational_status || shipment.last_status || 'Registrado',
      updated_at:shipment.updated_at || shipment.last_event_at || shipment.created_at || null
    }));
}

function uniqueCurrencies(groups=[]) {
  return [...new Set(groups.flat().map(row=>String(row?.currency || '').trim().toUpperCase()).filter(Boolean))].sort();
}

export default async function handler(req,res) {
  const admin = await authorizeAdmin(req,res,'dashboard.read');
  if (!admin) return;
  if (req.method !== 'GET') return fail(res,405,'Método no permitido');

  try {
    const [canClients,canProcurement,canWarehouse,canSales,canTasks,canNotifications] = await Promise.all([
      hasPermission(admin,'clients.read'),
      hasPermission(admin,'procurement.read'),
      hasPermission(admin,'warehouse.read'),
      hasPermission(admin,'sales.read'),
      hasPermission(admin,'tasks.read'),
      hasPermission(admin,'notifications.read')
    ]);
    const canProducts = await hasAnyPermission(admin,['sales.read','procurement.read','warehouse.read']);

    if (req.query?.client_id && !canClients) return fail(res,403,'No tienes permiso para filtrar por cliente');
    if (req.query?.supplier_id && !canProcurement) return fail(res,403,'No tienes permiso para filtrar por proveedor');
    if (req.query?.product_id && !canProducts) return fail(res,403,'No tienes permiso para filtrar por producto');

    const [clients, products, suppliers, shipments, operations, receipts, loads, warehouses, inventorySources, documents, executive, attentionRows, clientOptions, supplierOptions, productOptions, invoiceCurrencies, salesCurrencies, purchaseCurrencies, billCurrencies] = await Promise.all([
      supabase('clients',{ query:'?select=id,active' }),
      supabase('products',{ query:'?select=id,active' }),
      supabase('suppliers',{ query:'?select=id,active' }),
      supabase('shipments',{ query:'?select=id,client_id,operation_id,container_number,active,operational_status,last_status,last_event_at,updated_at,created_at,released_at,delivered_at,clients(id,name)' }),
      supabase('operations',{ query:'?select=id,status,updated_at,closed_at' }),
      supabase('warehouse_receipts',{ query:'?select=id,status' }),
      supabase('loads',{ query:'?select=id,status' }),
      supabase('warehouses',{ query:'?select=id,active' }),
      supabase('inventory_source_balances',{ query:'?select=receipt_id,product_id,physical_quantity,physical_pallets,reserved_quantity,reserved_pallets,warehouse_active' }),
      supabase('documents',{ query:'?select=id' }),
      loadExecutiveDashboard(req.query || {}),
      (canTasks || canNotifications) ? supabase('executive_operational_attention',{ query:'?select=*&limit=1' }) : Promise.resolve([]),
      canClients ? supabase('clients',{ query:'?select=id,name,company&active=eq.true&order=name.asc' }) : Promise.resolve([]),
      canProcurement ? supabase('suppliers',{ query:'?select=id,name,legal_name&active=eq.true&order=name.asc' }) : Promise.resolve([]),
      canProducts ? supabase('products',{ query:'?select=id,name,sku,brand&active=eq.true&order=name.asc' }) : Promise.resolve([]),
      supabase('executive_invoice_kpi_source',{ query:'?select=currency&limit=5000' }),
      supabase('executive_sales_order_kpi_source',{ query:'?select=currency&limit=5000' }),
      supabase('executive_purchase_order_kpi_source',{ query:'?select=currency&limit=5000' }),
      supabase('executive_supplier_bill_kpi_source',{ query:'?select=currency&limit=5000' })
    ]);

    const shipmentRows = shipments || [];
    const shipmentStats = buildShipmentStats(shipmentRows);
    const operationStats = buildOperationStats(operations || [],shipmentRows);
    const attention = attentionRows?.[0] || {};

    return ok(res,{
      owner:'api/dashboard.js',
      generated_at:new Date().toISOString(),
      stats:{
        clients:(clients || []).filter(row => row.active !== false).length,
        products:(products || []).filter(row => row.active !== false).length,
        suppliers:(suppliers || []).filter(row => row.active !== false).length,
        ...shipmentStats
      },
      operations:operationStats,
      warehouse_receipts:buildWrStats(receipts || []),
      loads:buildLoadStats(loads || []),
      inventory:inventoryCounts(inventorySources || []),
      warehouses:{
        total:(warehouses || []).length,
        active:(warehouses || []).filter(row => row.active !== false).length
      },
      documents:{ total:(documents || []).length },
      work_attention:{
        tasks:canTasks ? {
          open:Number(attention.open_tasks || 0),
          blocked:Number(attention.blocked_tasks || 0),
          overdue:Number(attention.overdue_tasks || 0),
          unassigned:Number(attention.unassigned_tasks || 0),
          due_soon:Number(attention.due_soon_tasks || 0),
          routing:Number(attention.routing_attention_tasks || 0)
        } : null,
        alerts:canNotifications ? {
          active:Number(attention.active_alerts || 0),
          critical:Number(attention.critical_alerts || 0)
        } : null
      },
      filter_options:{
        clients:clientOptions || [],
        suppliers:supplierOptions || [],
        products:productOptions || [],
        currencies:uniqueCurrencies([invoiceCurrencies || [],salesCurrencies || [],purchaseCurrencies || [],billCurrencies || []]),
        capabilities:{ clients:canClients,suppliers:canProcurement,products:canProducts,sales:canSales,warehouse:canWarehouse }
      },
      recent_activity:recentActivity(shipmentRows),
      executive
    });
  } catch (error) {
    console.error('[dashboard]',error);
    const message=String(error?.message || 'No se pudo cargar el dashboard');
    const invalid=message.includes('DASHBOARD_FILTER_');
    return fail(res,invalid?400:500,invalid?message:'No se pudo cargar el dashboard');
  }
}
