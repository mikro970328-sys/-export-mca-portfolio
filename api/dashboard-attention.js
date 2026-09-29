import { authorizeAdmin, fail, ok, supabase } from './_lib.js';

const number = value => Number(value || 0);

export default async function handler(req,res) {
  const admin = await authorizeAdmin(req,res,'dashboard.read');
  if (!admin) return;
  if (req.method !== 'GET') return fail(res,405,'Método no permitido');

  try {
    const permissionRows = admin.role === 'master_admin'
      ? []
      : await supabase('admin_effective_permissions', {
          query:'?select=permission_key&admin_user_id=eq.' + encodeURIComponent(admin.admin_id)
        });
    const permissionKeys = new Set((permissionRows || []).map(row => String(row.permission_key || '')));
    const can = key => admin.role === 'master_admin' || permissionKeys.has(key);
    const result = await supabase('executive_operational_attention', {
      query:'?select=open_tasks,blocked_tasks,overdue_tasks,unassigned_tasks,due_soon_tasks,routing_attention_tasks,active_alerts,critical_alerts'
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || typeof row !== 'object') throw new Error('DASHBOARD_ATTENTION_INVALID');

    return ok(res,{
      owner:'api/dashboard-attention.js',
      generated_at:new Date().toISOString(),
      work_attention:{
        tasks:can('tasks.read') ? {
          open:number(row.open_tasks),
          blocked:number(row.blocked_tasks),
          overdue:number(row.overdue_tasks),
          unassigned:number(row.unassigned_tasks),
          due_soon:number(row.due_soon_tasks),
          routing:number(row.routing_attention_tasks)
        } : null,
        alerts:can('notifications.read') ? {
          active:number(row.active_alerts),
          critical:number(row.critical_alerts)
        } : null
      }
    });
  } catch (error) {
    console.error('[dashboard attention]',error);
    return fail(res,500,'No se pudieron actualizar las alertas del dashboard');
  }
}
