import { authorizeAdmin, fail, ok, supabase, upstreamFailureStatus } from './_lib.js';

// Dashboard projection owner: api/dashboard.js.
export default async function handler(req,res) {
  const requestStartedAt=Date.now();
  const admin = await authorizeAdmin(req,res,'dashboard.read');
  const authorizedAt=Date.now();
  if (!admin) return;
  if (req.method !== 'GET') return fail(res,405,'Método no permitido');

  try {
    const permissionRows = admin.role === 'master_admin'
      ? []
      : await supabase('admin_effective_permissions', {
          query:`?select=permission_key&admin_user_id=eq.${encodeURIComponent(admin.admin_id)}`
        });
    const permissionKeys = new Set((permissionRows || []).map(row => String(row.permission_key || '')));
    const can = key => admin.role === 'master_admin' || permissionKeys.has(key);

    const canClients = can('clients.read');
    const canProcurement = can('procurement.read');
    const canWarehouse = can('warehouse.read');
    const canSales = can('sales.read');
    const canTasks = can('tasks.read');
    const canNotifications = can('notifications.read');
    const canProducts = canSales || canProcurement || canWarehouse;

    if (req.query?.client_id && !canClients) return fail(res,403,'No tienes permiso para filtrar por cliente');
    if (req.query?.supplier_id && !canProcurement) return fail(res,403,'No tienes permiso para filtrar por proveedor');
    if (req.query?.product_id && !canProducts) return fail(res,403,'No tienes permiso para filtrar por producto');

    const snapshotResult = await supabase('rpc/admin_dashboard_snapshot_cached', {
      method:'POST',
      readOnly:true,
      body:{
        p_can_clients:canClients,
        p_can_procurement:canProcurement,
        p_can_products:canProducts,
        p_can_sales:canSales,
        p_can_warehouse:canWarehouse,
        p_can_tasks:canTasks,
        p_can_notifications:canNotifications
      }
    });
    const overview = Array.isArray(snapshotResult) ? snapshotResult[0] : snapshotResult;
    if (!overview || typeof overview !== 'object') throw new Error('DASHBOARD_OVERVIEW_INVALID');

    res.setHeader?.('Server-Timing','authorization_ms;dur='+(authorizedAt-requestStartedAt)+', data_ms;dur='+(Date.now()-authorizedAt)+', total_ms;dur='+(Date.now()-requestStartedAt));
    return ok(res,{
      owner:'api/dashboard.js',
      generated_at:new Date().toISOString(),
      ...overview
    });
  } catch (error) {
    console.error('[dashboard]',error);
    const message=String(error?.message || 'No se pudo cargar el dashboard');
    const invalid=message.includes('DASHBOARD_FILTER_');
    return fail(res,invalid?400:upstreamFailureStatus(error,500),invalid?message:'No se pudo cargar el dashboard');
  }
}
