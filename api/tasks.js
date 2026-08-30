import { ok, fail, readJson, authorizeAdmin, supabase, writeAudit } from './_lib.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['pending','in_progress','blocked','completed','cancelled']);
const PRIORITIES = new Set(['low','normal','high','critical']);
const ENTITY_TYPES = new Set(['client','sales_order','purchase_order','warehouse_receipt','load','shipment','invoice','supplier_bill','document','customer_advance','proforma']);

const ENTITY_CONFIG = {
  client:{ table:'clients', select:'id,name', label:row=>row.name },
  sales_order:{ table:'sales_orders', select:'id,so_number', label:row=>row.so_number },
  purchase_order:{ table:'purchase_orders', select:'id,po_number', label:row=>row.po_number },
  warehouse_receipt:{ table:'warehouse_receipts', select:'id,receipt_number', label:row=>row.receipt_number },
  load:{ table:'loads', select:'id,load_number', label:row=>row.load_number },
  shipment:{ table:'shipments', select:'id,container_number', label:row=>row.container_number },
  invoice:{ table:'invoices', select:'id,invoice_number', label:row=>row.invoice_number },
  supplier_bill:{ table:'supplier_bills', select:'id,bill_number,supplier_invoice_number', label:row=>row.bill_number || row.supplier_invoice_number },
  document:{ table:'documents', select:'id,file_name,document_type', label:row=>row.file_name || row.document_type },
  customer_advance:{ table:'customer_advances', select:'id,advance_number', label:row=>row.advance_number },
  proforma:{ table:'proformas', select:'id,proforma_number', label:row=>row.proforma_number }
};

const urlFor = req => new URL(req.url || '/api/tasks', 'http://localhost');
const cleanText = (value, max = 1000) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0,max) : null;
};
const requireUuid = (value, code = 'ID_INVALID') => {
  const id = String(value || '').trim();
  if (!UUID_RE.test(id)) throw new Error(code);
  return id;
};
const nullableUuid = value => {
  if (value === null || value === undefined || value === '') return null;
  return requireUuid(value);
};

async function hasPermission(admin, permissionKey) {
  if (admin.role === 'master_admin') return true;
  const rows = await supabase('admin_effective_permissions', {
    query:`?select=permission_key&admin_user_id=eq.${encodeURIComponent(admin.admin_id)}&permission_key=eq.${encodeURIComponent(permissionKey)}&limit=1`
  });
  return Boolean(rows?.length);
}

async function activeTeamIds(adminId) {
  const rows = await supabase('admin_team_directory', {
    query:`?select=team_id&admin_user_id=eq.${encodeURIComponent(adminId)}&team_active=eq.true`
  });
  return [...new Set((rows || []).map(row=>row.team_id).filter(Boolean))];
}

async function visibilityQuery(admin, manage) {
  if (manage || admin.role === 'master_admin') return '';
  const teams = await activeTeamIds(admin.admin_id);
  const clauses = [
    `assigned_admin_id.eq.${admin.admin_id}`,
    `created_by.eq.${admin.admin_id}`
  ];
  if (teams.length) clauses.push(`assigned_team_id.in.(${teams.join(',')})`);
  return `&or=(${clauses.join(',')})`;
}

function filterQuery(searchParams, manage) {
  const parts = [];
  const status = searchParams.get('status');
  const priority = searchParams.get('priority');
  const teamId = searchParams.get('team_id');
  const adminId = searchParams.get('assigned_admin_id');
  const entityType = searchParams.get('entity_type');
  const overdue = searchParams.get('overdue');
  const unassigned = searchParams.get('unassigned');

  if (status && status !== 'all' && STATUSES.has(status)) parts.push(`status=eq.${encodeURIComponent(status)}`);
  if (priority && PRIORITIES.has(priority)) parts.push(`priority=eq.${encodeURIComponent(priority)}`);
  if (teamId && UUID_RE.test(teamId)) parts.push(`assigned_team_id=eq.${encodeURIComponent(teamId)}`);
  if (adminId && UUID_RE.test(adminId)) parts.push(`assigned_admin_id=eq.${encodeURIComponent(adminId)}`);
  if (entityType && ENTITY_TYPES.has(entityType)) parts.push(`entity_type=eq.${encodeURIComponent(entityType)}`);
  if (overdue === 'true') parts.push('is_overdue=eq.true');
  if (manage && unassigned === 'true') {
    parts.push('assigned_team_id=is.null');
    parts.push('assigned_admin_id=is.null');
  }
  return parts.length ? `&${parts.join('&')}` : '';
}

async function enrichEntityLabels(tasks = []) {
  const output = tasks.map(task=>({ ...task, entity_label:null }));
  const grouped = new Map();
  output.forEach(task=>{
    if (!task.entity_type || !task.entity_id || !ENTITY_CONFIG[task.entity_type]) return;
    if (!grouped.has(task.entity_type)) grouped.set(task.entity_type,new Set());
    grouped.get(task.entity_type).add(task.entity_id);
  });

  const labels = new Map();
  await Promise.all([...grouped.entries()].map(async([type,ids])=>{
    const config = ENTITY_CONFIG[type];
    const values = [...ids];
    if (!values.length) return;
    const rows = await supabase(config.table,{ query:`?select=${encodeURIComponent(config.select)}&id=in.(${values.join(',')})` });
    (rows || []).forEach(row=>labels.set(`${type}:${row.id}`,config.label(row) || null));
  }));

  output.forEach(task=>{ task.entity_label = labels.get(`${task.entity_type}:${task.entity_id}`) || null; });
  return output;
}

async function loadTaskList(req, admin, manage) {
  const url = urlFor(req);
  const visibility = await visibilityQuery(admin,manage);
  const filters = filterQuery(url.searchParams,manage);
  let rows = await supabase('operational_task_workspace', {
    query:`?select=*&limit=500&order=is_overdue.desc,due_at.asc.nullslast,updated_at.desc${visibility}${filters}`
  });
  const q = cleanText(url.searchParams.get('q'),120)?.toLowerCase();
  if (q) rows = (rows || []).filter(row=>`${row.title || ''} ${row.description || ''}`.toLowerCase().includes(q));
  return enrichEntityLabels(rows || []);
}

async function visibleTaskById(taskId, admin, manage) {
  const visibility = await visibilityQuery(admin,manage);
  const rows = await supabase('operational_task_workspace', {
    query:`?select=*&id=eq.${encodeURIComponent(taskId)}&limit=1${visibility}`
  });
  const enriched = await enrichEntityLabels(rows || []);
  return enriched[0] || null;
}

async function taskDetail(task, admin, manage) {
  const [comments,history,dependencyRows,dependentRows] = await Promise.all([
    supabase('operational_task_comments',{ query:`?select=id,task_id,author_admin_id,author_username,body,created_at&task_id=eq.${task.id}&order=created_at.asc` }),
    supabase('operational_task_history',{ query:`?select=id,event_type,actor_admin_id,actor_username,from_status,to_status,details,created_at&task_id=eq.${task.id}&order=created_at.asc` }),
    supabase('operational_task_dependencies',{ query:`?select=depends_on_task_id&task_id=eq.${task.id}` }),
    supabase('operational_task_dependencies',{ query:`?select=task_id&depends_on_task_id=eq.${task.id}` })
  ]);

  const dependencyIds = (dependencyRows || []).map(row=>row.depends_on_task_id);
  const dependentIds = (dependentRows || []).map(row=>row.task_id);
  const relatedIds = [...new Set([...dependencyIds,...dependentIds])];
  let related = [];
  if (relatedIds.length) {
    const rows = await supabase('operational_task_workspace',{ query:`?select=*&id=in.(${relatedIds.join(',')})` });
    related = await enrichEntityLabels(rows || []);
  }
  const byId = new Map(related.map(row=>[row.id,row]));

  return {
    ...task,
    comments:comments || [],
    history:history || [],
    dependencies:dependencyIds.map(id=>byId.get(id)).filter(Boolean),
    dependents:dependentIds.map(id=>byId.get(id)).filter(Boolean),
    capabilities:{ manage:Boolean(manage), write:await hasPermission(admin,'tasks.write') }
  };
}

async function loadContext(admin, manage) {
  if (!manage) {
    const teams = await supabase('admin_team_directory',{
      query:`?select=team_id,team_name,team_description,team_active&admin_user_id=eq.${admin.admin_id}&team_active=eq.true&order=team_name.asc`
    });
    return {
      manage:false,
      account:{ id:admin.admin_id, username:admin.username, full_name:admin.full_name },
      teams:(teams || []).map(row=>({ id:row.team_id,name:row.team_name,description:row.team_description,is_active:row.team_active })),
      users:[]
    };
  }
  const [teams,users] = await Promise.all([
    supabase('teams',{ query:'?select=id,name,description,is_active&is_active=eq.true&order=name.asc' }),
    supabase('admin_users',{ query:'?select=id,full_name,username,role,is_active&is_active=eq.true&order=full_name.asc' })
  ]);
  return { manage:true, account:{ id:admin.admin_id, username:admin.username, full_name:admin.full_name }, teams:teams || [], users:users || [] };
}

async function rpc(name, body) {
  return supabase(`rpc/${name}`,{ method:'POST', body, prefer:'return=representation' });
}

function errorResponse(res, error) {
  const message = String(error?.message || error || 'TASK_OPERATION_FAILED');
  const known = message.match(/(TASK_[A-Z0-9_]+)/)?.[1];
  const clientErrors = new Set([
    'TASK_NOT_FOUND','TASK_TEAM_INVALID','TASK_ASSIGNEE_INVALID','TASK_ASSIGNEE_NOT_TEAM_MEMBER','TASK_ACTOR_INVALID',
    'TASK_STATUS_INVALID','TASK_TRANSITION_INVALID','TASK_REASON_REQUIRED','TASK_COMMENT_REQUIRED','TASK_DEPENDENCY_SELF_FORBIDDEN',
    'TASK_DEPENDENCY_INVALID','TASK_DEPENDENCY_CYCLE','TASK_ACTOR_REQUIRED'
  ]);
  if (known && clientErrors.has(known)) return fail(res,400,known);
  console.error('TASK_API_ERROR',message);
  return fail(res,500,'No se pudo completar la operación de tareas');
}

export default async function handler(req,res) {
  try {
    const url = urlFor(req);
    const action = String(url.searchParams.get('action') || '').trim();

    if (req.method === 'GET') {
      const admin = await authorizeAdmin(req,res,'tasks.read');
      if (!admin) return;
      const manage = await hasPermission(admin,'tasks.manage');
      if (action === 'context') return ok(res,{ context:await loadContext(admin,manage) });
      const id = url.searchParams.get('id');
      if (id) {
        const taskId = requireUuid(id,'TASK_ID_INVALID');
        const task = await visibleTaskById(taskId,admin,manage);
        if (!task) return fail(res,404,'Tarea no encontrada');
        return ok(res,{ task:await taskDetail(task,admin,manage) });
      }
      return ok(res,{ tasks:await loadTaskList(req,admin,manage), manage });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const bodyAction = String(body.action || action || 'create');

      if (bodyAction === 'create') {
        const admin = await authorizeAdmin(req,res,'tasks.manage');
        if (!admin) return;
        const title = cleanText(body.title,180);
        if (!title) return fail(res,400,'El título es obligatorio');
        const priority = String(body.priority || 'normal');
        if (!PRIORITIES.has(priority)) return fail(res,400,'Prioridad inválida');
        const entityType = body.entity_type ? String(body.entity_type) : null;
        const entityId = nullableUuid(body.entity_id);
        if ((entityType && !ENTITY_TYPES.has(entityType)) || Boolean(entityType) !== Boolean(entityId)) return fail(res,400,'Entidad inválida');
        const result = await rpc('create_operational_task',{
          p_actor:admin.admin_id,
          p_title:title,
          p_description:cleanText(body.description,4000),
          p_priority:priority,
          p_due_at:body.due_at || null,
          p_assigned_team_id:nullableUuid(body.assigned_team_id),
          p_assigned_admin_id:nullableUuid(body.assigned_admin_id),
          p_entity_type:entityType,
          p_entity_id:entityId,
          p_origin:'manual',
          p_workflow_key:null,
          p_source_event_key:null,
          p_dedupe_key:null
        });
        const taskId = Array.isArray(result) ? result[0] : result;
        await writeAudit(admin,'task.create','operational_task',taskId,{ title, priority, assigned_team_id:body.assigned_team_id || null, assigned_admin_id:body.assigned_admin_id || null, entity_type:entityType, entity_id:entityId });
        return ok(res,{ task_id:taskId });
      }

      if (bodyAction === 'comment') {
        const admin = await authorizeAdmin(req,res,'tasks.write');
        if (!admin) return;
        const manage = await hasPermission(admin,'tasks.manage');
        const taskId = requireUuid(body.task_id,'TASK_ID_INVALID');
        const task = await visibleTaskById(taskId,admin,manage);
        if (!task) return fail(res,404,'Tarea no encontrada');
        const text = cleanText(body.body,4000);
        if (!text) return fail(res,400,'El comentario es obligatorio');
        const result = await rpc('add_operational_task_comment',{ p_task_id:taskId,p_actor:admin.admin_id,p_body:text });
        const commentId = Array.isArray(result) ? result[0] : result;
        await writeAudit(admin,'task.comment','operational_task',taskId,{ comment_id:commentId });
        return ok(res,{ comment_id:commentId });
      }

      if (bodyAction === 'transition') {
        const admin = await authorizeAdmin(req,res,'tasks.write');
        if (!admin) return;
        const manage = await hasPermission(admin,'tasks.manage');
        const taskId = requireUuid(body.task_id,'TASK_ID_INVALID');
        const task = await visibleTaskById(taskId,admin,manage);
        if (!task) return fail(res,404,'Tarea no encontrada');
        const target = String(body.status || '');
        if (!STATUSES.has(target)) return fail(res,400,'Estado inválido');
        const reopeningTerminal = ['completed','cancelled'].includes(task.status) && target === 'pending';
        if ((target === 'cancelled' || reopeningTerminal) && !manage) return fail(res,403,'Se requiere permiso de gestión de tareas');
        await rpc('transition_operational_task',{ p_task_id:taskId,p_actor:admin.admin_id,p_to_status:target,p_reason:cleanText(body.reason,1000) });
        await writeAudit(admin,'task.transition','operational_task',taskId,{ from_status:task.status,to_status:target,reason:cleanText(body.reason,1000) });
        return ok(res,{ success:true });
      }

      if (bodyAction === 'set_dependencies') {
        const admin = await authorizeAdmin(req,res,'tasks.manage');
        if (!admin) return;
        const taskId = requireUuid(body.task_id,'TASK_ID_INVALID');
        const ids = [...new Set((Array.isArray(body.dependency_ids) ? body.dependency_ids : []).map(value=>requireUuid(value,'TASK_DEPENDENCY_INVALID')))];
        await rpc('set_operational_task_dependencies',{ p_task_id:taskId,p_depends_on_task_ids:ids,p_actor:admin.admin_id });
        await writeAudit(admin,'task.dependencies','operational_task',taskId,{ dependency_ids:ids });
        return ok(res,{ success:true });
      }

      return fail(res,400,'Acción de tarea inválida');
    }

    if (req.method === 'PATCH') {
      const admin = await authorizeAdmin(req,res,'tasks.manage');
      if (!admin) return;
      const body = await readJson(req);
      const taskId = requireUuid(body.id || url.searchParams.get('id'),'TASK_ID_INVALID');
      const currentRows = await supabase('operational_task_workspace',{ query:`?select=*&id=eq.${taskId}&limit=1` });
      const current = currentRows?.[0];
      if (!current) return fail(res,404,'Tarea no encontrada');
      const priority = body.priority === undefined ? current.priority : String(body.priority);
      if (!PRIORITIES.has(priority)) return fail(res,400,'Prioridad inválida');
      const title = body.title === undefined ? current.title : cleanText(body.title,180);
      if (!title) return fail(res,400,'El título es obligatorio');
      const entityType = body.entity_type === undefined ? current.entity_type : (body.entity_type ? String(body.entity_type) : null);
      const entityId = body.entity_id === undefined ? current.entity_id : nullableUuid(body.entity_id);
      if ((entityType && !ENTITY_TYPES.has(entityType)) || Boolean(entityType) !== Boolean(entityId)) return fail(res,400,'Entidad inválida');

      await rpc('update_operational_task',{
        p_task_id:taskId,
        p_actor:admin.admin_id,
        p_title:title,
        p_description:body.description === undefined ? current.description : cleanText(body.description,4000),
        p_priority:priority,
        p_due_at:body.due_at === undefined ? current.due_at : (body.due_at || null),
        p_assigned_team_id:body.assigned_team_id === undefined ? current.assigned_team_id : nullableUuid(body.assigned_team_id),
        p_assigned_admin_id:body.assigned_admin_id === undefined ? current.assigned_admin_id : nullableUuid(body.assigned_admin_id),
        p_entity_type:entityType,
        p_entity_id:entityId
      });
      await writeAudit(admin,'task.update','operational_task',taskId,{ fields:Object.keys(body).filter(key=>key!=='id') });
      return ok(res,{ success:true });
    }

    return fail(res,405,'Método no permitido');
  } catch (error) {
    if (String(error?.message || '').includes('INVALID')) return fail(res,400,String(error.message));
    return errorResponse(res,error);
  }
}
