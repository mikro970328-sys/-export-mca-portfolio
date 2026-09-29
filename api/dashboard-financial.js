import { authorizeAdmin, fail, ok, supabase, upstreamFailureStatus } from './_lib.js';
import { loadExecutiveDashboard } from './_executive-dashboard.js';

// Keep finance access behind the same dashboard permission and explicit filter checks.
export default async function handler(req,res) {
  const admin = await authorizeAdmin(req,res,'dashboard.read');
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
    const canProducts = canSales || canProcurement || canWarehouse;

    if (req.query?.client_id && !canClients) return fail(res,403,'No tienes permiso para filtrar por cliente');
    if (req.query?.supplier_id && !canProcurement) return fail(res,403,'No tienes permiso para filtrar por proveedor');
    if (req.query?.product_id && !canProducts) return fail(res,403,'No tienes permiso para filtrar por producto');

    const executive = await loadExecutiveDashboard(req.query || {});
    return ok(res,executive);
  } catch (error) {
    console.error('[dashboard financial]',error);
    const message=String(error?.message || 'No se pudo cargar el resumen financiero');
    const invalid=/^(Fecha inicial|Fecha final|Moneda|Cliente|Proveedor|Producto|La fecha inicial)/.test(message);
    return fail(res,invalid?400:upstreamFailureStatus(error,500),invalid?message:'No se pudo cargar el resumen financiero');
  }
}
