(() => {
  'use strict';
  if (window.__tasksWorkspaceInstalled) return;
  window.__tasksWorkspaceInstalled = true;

  const state = {
    tasks:[],
    context:null,
    loaded:false,
    loading:false,
    activeFilter:'pending',
    selectedTaskId:null
  };

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const can = permission => window.ExportMcaAccessControl?.can?.(permission) !== false;
  const canWrite = () => can('tasks.write');
  const canManage = () => can('tasks.manage');
  const statusLabels = { pending:'Pendiente',in_progress:'En curso',blocked:'Bloqueada',completed:'Completada',cancelled:'Cancelada' };
  const priorityLabels = { low:'Baja',normal:'Normal',high:'Alta',critical:'Crítica' };
  const entityLabels = { client:'Cliente',sales_order:'Venta',purchase_order:'Compra',warehouse_receipt:'Recepción',load:'Cargue',shipment:'Contenedor',invoice:'Factura',supplier_bill:'Factura proveedor',document:'Documento',customer_advance:'Anticipo',proforma:'Proforma' };

  async function request(path,options={}) {
    if (typeof window.api === 'function') return window.api(path,options);
    throw new Error('API no disponible');
  }

  function setMessage(message,ok=true) {
    const node=byId('tasksMessage');
    if(!node)return;
    node.textContent=message||'';
    node.className=`tasks-message ${message?(ok?'ok':'bad'):''}`;
  }

  function svgIcon() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5h6"/><path d="M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1Z"/><path d="M7 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="m8 13 2.2 2.2L16 9.5"/></svg>';
  }

  function ensureSurface() {
    if (!can('tasks.read')) return false;
    const nav=document.querySelector('.sidebar-nav');
    if(nav && !document.querySelector('[data-section="tasksSection"]')) {
      const button=document.createElement('button');
      button.type='button';
      button.dataset.section='tasksSection';
      button.dataset.navLabel='Mis tareas';
      button.setAttribute('aria-label','Mis tareas');
      button.title='Mis tareas';
      button.innerHTML=`<span class="nav-icon">${svgIcon()}</span><span class="nav-label">Mis tareas</span>`;
      const notifications=document.querySelector('[data-section="notificationsSection"]');
      nav.insertBefore(button,notifications || null);
    }
    const main=document.querySelector('.main-shell main');
    if(main && !byId('tasksSection')) {
      const section=document.createElement('section');
      section.id='tasksSection';
      section.className='app-section hidden';
      main.appendChild(section);
    }
    try { if(window.titles && typeof window.titles==='object') window.titles.tasksSection='Mis tareas'; } catch {}
    return Boolean(byId('tasksSection'));
  }

  function shellMarkup() {
    const manage=canManage();
    return `<div class="tasks-shell">
      <div class="tasks-head">
        <div><h2>Mis tareas</h2><p>${manage?'Cola operativa global, asignaciones y seguimiento del trabajo interno.':'Trabajo asignado a ti, a tus equipos o creado por ti.'}</p></div>
        <div class="tasks-head-actions"><button type="button" class="alt" data-task-action="refresh">Actualizar</button>${manage?'<button type="button" data-task-action="create">Nueva tarea</button>':''}</div>
      </div>
      <div id="tasksSummary" class="tasks-summary"></div>
      <div class="tasks-toolbar">
        <input id="tasksSearch" class="tasks-search" type="search" placeholder="Buscar tarea..." aria-label="Buscar tarea">
        <select id="tasksStatusFilter" aria-label="Estado"><option value="all">Todos los estados</option><option value="pending">Pendientes</option><option value="in_progress">En curso</option><option value="blocked">Bloqueadas</option><option value="completed">Completadas</option><option value="cancelled">Canceladas</option></select>
        <select id="tasksPriorityFilter" aria-label="Prioridad"><option value="all">Todas las prioridades</option><option value="critical">Crítica</option><option value="high">Alta</option><option value="normal">Normal</option><option value="low">Baja</option></select>
        <select id="tasksTeamFilter" aria-label="Equipo"><option value="all">Todos los equipos</option></select>
        ${manage?'<select id="tasksAssigneeFilter" aria-label="Responsable"><option value="all">Todos los responsables</option><option value="unassigned">Sin asignar</option></select>':'<div></div>'}
      </div>
      <div id="tasksMessage" class="tasks-message" aria-live="polite"></div>
      <div id="tasksTableWrap" class="tasks-table-wrap"></div>
    </div>
    <div id="tasksModal" class="tasks-modal hidden" role="dialog" aria-modal="true" aria-labelledby="tasksModalTitle"><div class="tasks-modal-panel"><div class="tasks-modal-head"><h3 id="tasksModalTitle"></h3><button type="button" class="alt" data-task-modal-close>Cerrar</button></div><div id="tasksModalBody" class="tasks-modal-body"></div><div id="tasksModalActions" class="tasks-modal-actions"></div></div></div>`;
  }

  function renderBase() {
    const section=byId('tasksSection');
    if(!section)return;
    section.innerHTML=shellMarkup();
    section.addEventListener('click',handleClick);
    byId('tasksSearch')?.addEventListener('input',render);
    byId('tasksStatusFilter')?.addEventListener('change',()=>{state.activeFilter='all';render();});
    byId('tasksPriorityFilter')?.addEventListener('change',render);
    byId('tasksTeamFilter')?.addEventListener('change',render);
    byId('tasksAssigneeFilter')?.addEventListener('change',render);
    document.addEventListener('keydown',event=>{if(event.key==='Escape')closeModal();});
  }

  function activeCounts() {
    const tasks=state.tasks;
    return {
      pending:tasks.filter(t=>t.status==='pending').length,
      in_progress:tasks.filter(t=>t.status==='in_progress').length,
      blocked:tasks.filter(t=>t.status==='blocked').length,
      overdue:tasks.filter(t=>t.is_overdue).length,
      completed:tasks.filter(t=>t.status==='completed').length
    };
  }

  function renderSummary() {
    const counts=activeCounts();
    const items=[['pending','Pendientes'],['in_progress','En curso'],['blocked','Bloqueadas'],['overdue','Vencidas'],['completed','Completadas']];
    byId('tasksSummary').innerHTML=items.map(([key,label])=>`<button type="button" class="${state.activeFilter===key?'active':''} ${key==='overdue'&&counts[key]?'tasks-count-critical':''}" data-task-filter="${key}"><span>${label}</span><b>${counts[key]}</b></button>`).join('');
  }

  function populateFilters() {
    const team=byId('tasksTeamFilter');
    if(team && team.options.length<=1) {
      const teams=state.context?.teams || [];
      team.insertAdjacentHTML('beforeend',teams.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join(''));
    }
    const assignee=byId('tasksAssigneeFilter');
    if(assignee && assignee.options.length<=2) {
      assignee.insertAdjacentHTML('beforeend',(state.context?.users || []).map(row=>`<option value="${esc(row.id)}">${esc(row.full_name || row.username)}</option>`).join(''));
    }
  }

  function filteredTasks() {
    const q=(byId('tasksSearch')?.value || '').trim().toLowerCase();
    const status=byId('tasksStatusFilter')?.value || 'all';
    const priority=byId('tasksPriorityFilter')?.value || 'all';
    const team=byId('tasksTeamFilter')?.value || 'all';
    const assignee=byId('tasksAssigneeFilter')?.value || 'all';
    return state.tasks.filter(task=>{
      if(state.activeFilter==='overdue' && !task.is_overdue)return false;
      if(['pending','in_progress','blocked','completed'].includes(state.activeFilter) && task.status!==state.activeFilter)return false;
      if(state.activeFilter==='all' && status!=='all' && task.status!==status)return false;
      if(priority!=='all' && task.priority!==priority)return false;
      if(team!=='all' && task.assigned_team_id!==team)return false;
      if(assignee==='unassigned' && (task.assigned_admin_id || task.assigned_team_id))return false;
      if(assignee!=='all' && assignee!=='unassigned' && task.assigned_admin_id!==assignee)return false;
      if(q && !`${task.title||''} ${task.description||''} ${task.entity_label||''} ${task.assigned_admin_name||''} ${task.assigned_team_name||''}`.toLowerCase().includes(q))return false;
      return true;
    });
  }

  function formatDate(value) {
    if(!value)return '—';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return '—';
    return date.toLocaleString('es-US',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }

  function assignmentLabel(task) {
    const person=task.assigned_admin_name || task.assigned_admin_username;
    const team=task.assigned_team_name;
    if(person && team)return `${esc(person)}<small>${esc(team)}</small>`;
    if(person)return esc(person);
    if(team)return `${esc(team)}<small>Equipo</small>`;
    return '<span class="muted">Sin asignar</span>';
  }

  function entityLabel(task) {
    if(!task.entity_type)return '—';
    return `<span class="tasks-entity-link">${esc(entityLabels[task.entity_type] || task.entity_type)} · ${esc(task.entity_label || String(task.entity_id).slice(0,8))}</span>`;
  }

  function renderTable() {
    const rows=filteredTasks();
    const wrap=byId('tasksTableWrap');
    if(!wrap)return;
    if(!rows.length) {
      wrap.innerHTML='<div class="tasks-empty">No hay tareas para este filtro.</div><div class="tasks-footer">0 tareas</div>';
      return;
    }
    wrap.innerHTML=`<table class="tasks-table"><thead><tr><th>Tarea</th><th>Estado</th><th>Prioridad</th><th>Responsable</th><th>Vence</th><th>Entidad</th><th></th></tr></thead><tbody>${rows.map(task=>`<tr data-task-open="${esc(task.id)}"><td><div class="tasks-title">${esc(task.title)}</div><div class="tasks-sub">${esc((task.description||'').slice(0,110))}${task.open_dependency_count?` · ${task.open_dependency_count} dependencia${Number(task.open_dependency_count)===1?'':'s'} pendiente${Number(task.open_dependency_count)===1?'':'s'}`:''}</div></td><td><span class="tasks-status ${esc(task.status)}">${esc(statusLabels[task.status]||task.status)}</span></td><td><span class="tasks-priority ${esc(task.priority)}">${esc(priorityLabels[task.priority]||task.priority)}</span></td><td class="tasks-assignee">${assignmentLabel(task)}</td><td class="${task.is_overdue?'tasks-overdue':''}">${task.is_overdue?'Vencida · ':''}${esc(formatDate(task.due_at))}</td><td>${entityLabel(task)}</td><td><div class="tasks-row-actions"><button type="button" class="alt" data-task-action="open" data-id="${esc(task.id)}">Abrir</button></div></td></tr>`).join('')}</tbody></table><div class="tasks-footer">${rows.length} tarea${rows.length===1?'':'s'} visibles · ${state.tasks.length} en tu cola</div>`;
  }

  function render() {
    renderSummary();
    populateFilters();
    renderTable();
  }

  async function load() {
    if(state.loading)return;
    state.loading=true;
    setMessage('Cargando tareas...');
    try {
      const [tasksResult,contextResult]=await Promise.all([request('/api/tasks'),request('/api/tasks?action=context')]);
      state.tasks=tasksResult.tasks || [];
      state.context=contextResult.context || { manage:false,teams:[],users:[],memberships:[] };
      state.loaded=true;
      setMessage('');
      render();
    } catch(error) {
      setMessage(error.message || 'No se pudieron cargar las tareas.',false);
      const wrap=byId('tasksTableWrap');if(wrap)wrap.innerHTML='<div class="tasks-empty">No se pudo cargar la cola de trabajo.</div>';
    } finally { state.loading=false; }
  }

  function closeModal() {
    byId('tasksModal')?.classList.add('hidden');
    if(byId('tasksModalBody'))byId('tasksModalBody').innerHTML='';
    if(byId('tasksModalActions'))byId('tasksModalActions').innerHTML='';
    state.selectedTaskId=null;
  }

  function openModal(title,body,actions=[]) {
    byId('tasksModalTitle').textContent=title;
    byId('tasksModalBody').innerHTML=body;
    const foot=byId('tasksModalActions');foot.innerHTML='';
    actions.forEach(action=>{
      const button=document.createElement('button');button.type='button';button.textContent=action.label;button.className=action.className||'';button.addEventListener('click',action.onClick);foot.appendChild(button);
    });
    byId('tasksModal').classList.remove('hidden');
  }

  function option(value,label,selected='') { return `<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label)}</option>`; }
  function localDateInput(value) {
    if(!value)return '';
    const date=new Date(value);if(Number.isNaN(date.getTime()))return '';
    const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
    return local.toISOString().slice(0,16);
  }

  function assignmentOptions(teamId='',adminId='') {
    const teams=(state.context?.teams||[]).map(row=>option(row.id,row.name,teamId)).join('');
    const users=eligibleUsers(teamId).map(row=>option(row.id,row.full_name||row.username,adminId)).join('');
    return { teams,users };
  }

  function eligibleUsers(teamId) {
    const users=state.context?.users || [];
    if(!teamId)return users;
    const membershipIds=new Set((state.context?.memberships||[]).filter(row=>row.team_id===teamId).map(row=>row.admin_user_id));
    return users.filter(row=>membershipIds.has(row.id));
  }

  function taskForm(task=null) {
    const current=task || {};
    const assignments=assignmentOptions(current.assigned_team_id||'',current.assigned_admin_id||'');
    return `<form id="tasksEditForm" class="tasks-form">
      <div class="full"><label>Título</label><input name="title" maxlength="180" value="${esc(current.title||'')}" required></div>
      <div class="full"><label>Descripción</label><textarea name="description" rows="4">${esc(current.description||'')}</textarea></div>
      <div><label>Prioridad</label><select name="priority">${['normal','high','critical','low'].map(v=>option(v,priorityLabels[v],current.priority||'normal')).join('')}</select></div>
      <div><label>Vence</label><input name="due_at" type="datetime-local" value="${esc(localDateInput(current.due_at))}"></div>
      <div><label>Equipo</label><select name="assigned_team_id" id="tasksFormTeam"><option value="">Sin equipo</option>${assignments.teams}</select></div>
      <div><label>Responsable</label><select name="assigned_admin_id" id="tasksFormAssignee"><option value="">Sin responsable</option>${assignments.users}</select></div>
      <div><label>Tipo de entidad</label><select name="entity_type"><option value="">Sin vínculo</option>${Object.entries(entityLabels).map(([value,label])=>option(value,label,current.entity_type||'')).join('')}</select></div>
      <div><label>ID de entidad</label><input name="entity_id" value="${esc(current.entity_id||'')}" placeholder="UUID"></div>
    </form>`;
  }

  function bindAssignmentFilter() {
    const team=byId('tasksFormTeam'),assignee=byId('tasksFormAssignee');
    if(!team||!assignee)return;
    team.addEventListener('change',()=>{
      const current=assignee.value;
      const users=eligibleUsers(team.value);
      assignee.innerHTML='<option value="">Sin responsable</option>'+users.map(row=>option(row.id,row.full_name||row.username,current)).join('');
      if(current && !users.some(row=>row.id===current))assignee.value='';
    });
  }

  function formPayload() {
    const form=byId('tasksEditForm');
    const data=new FormData(form);
    const due=data.get('due_at');
    return {
      title:String(data.get('title')||'').trim(),
      description:String(data.get('description')||'').trim() || null,
      priority:data.get('priority'),
      due_at:due ? new Date(String(due)).toISOString() : null,
      assigned_team_id:data.get('assigned_team_id') || null,
      assigned_admin_id:data.get('assigned_admin_id') || null,
      entity_type:data.get('entity_type') || null,
      entity_id:String(data.get('entity_id')||'').trim() || null
    };
  }

  function openCreate() {
    openModal('Nueva tarea',taskForm(),[
      {label:'Cancelar',className:'alt',onClick:closeModal},
      {label:'Crear tarea',onClick:async()=>{try{const payload=formPayload();await request('/api/tasks',{method:'POST',body:JSON.stringify({action:'create',...payload})});closeModal();setMessage('Tarea creada.',true);await load();}catch(error){setInlineModalError(error.message);}}}
    ]);
    bindAssignmentFilter();
  }

  function setInlineModalError(message) {
    let node=byId('tasksModalError');
    if(!node){node=document.createElement('div');node.id='tasksModalError';node.className='tasks-message bad';byId('tasksModalBody')?.prepend(node);}
    node.textContent=message||'No se pudo completar la operación.';
  }

  function historyLabel(row) {
    return ({created:'Tarea creada',updated:'Tarea actualizada',transitioned:'Cambio de estado',commented:'Comentario agregado',dependencies_changed:'Dependencias actualizadas'})[row.event_type] || row.event_type;
  }

  function detailMarkup(task) {
    const writable=task.capabilities?.write && canWrite();
    const manageable=task.capabilities?.manage && canManage();
    const actions=[];
    if(writable && task.status==='pending')actions.push(['in_progress','Iniciar'],['blocked','Bloquear'],['completed','Completar']);
    if(writable && task.status==='in_progress')actions.push(['pending','Volver a pendiente'],['blocked','Bloquear'],['completed','Completar']);
    if(writable && task.status==='blocked')actions.push(['in_progress','Reanudar'],['pending','Volver a pendiente'],['completed','Completar']);
    if(manageable && ['completed','cancelled'].includes(task.status))actions.push(['pending','Reabrir']);
    return `<div class="tasks-kicker">${esc(entityLabels[task.entity_type]||'Tarea operativa')}${task.entity_label?` · ${esc(task.entity_label)}`:''}</div><div class="tasks-action-strip">${actions.map(([status,label])=>`<button type="button" class="${status==='completed'?'success':'alt'}" data-task-transition="${status}" data-id="${esc(task.id)}">${esc(label)}</button>`).join('')}${manageable&&!['completed','cancelled'].includes(task.status)?`<button type="button" class="danger" data-task-transition="cancelled" data-id="${esc(task.id)}">Cancelar tarea</button>`:''}${manageable?`<button type="button" class="alt" data-task-action="edit-detail" data-id="${esc(task.id)}">Editar</button><button type="button" class="alt" data-task-action="dependencies" data-id="${esc(task.id)}">Dependencias</button>`:''}</div>
      <div class="tasks-detail-grid"><div><div class="tasks-detail-meta"><div class="tasks-meta-item"><span>Estado</span><b>${esc(statusLabels[task.status]||task.status)}</b></div><div class="tasks-meta-item"><span>Prioridad</span><b>${esc(priorityLabels[task.priority]||task.priority)}</b></div><div class="tasks-meta-item"><span>Responsable</span><b>${esc(task.assigned_admin_name||task.assigned_admin_username||'Sin responsable')}</b></div><div class="tasks-meta-item"><span>Equipo</span><b>${esc(task.assigned_team_name||'Sin equipo')}</b></div><div class="tasks-meta-item"><span>Vence</span><b class="${task.is_overdue?'tasks-overdue':''}">${esc(formatDate(task.due_at))}${task.is_overdue?' · Vencida':''}</b></div><div class="tasks-meta-item"><span>Origen</span><b>${task.origin==='workflow'?'Workflow':'Manual'}</b></div></div>
      <div class="tasks-detail-section"><h4>Descripción</h4><div class="tasks-description">${esc(task.description||'Sin descripción.')}</div></div>
      <div class="tasks-detail-section"><h4>Dependencias</h4><div class="tasks-dependency-list">${task.dependencies?.length?task.dependencies.map(dep=>`<div class="tasks-dependency"><strong>${esc(dep.title)}</strong><small>${esc(statusLabels[dep.status]||dep.status)}${dep.entity_label?' · '+esc(dep.entity_label):''}</small></div>`).join(''):'<div class="muted">Sin dependencias.</div>'}</div></div>
      <div class="tasks-detail-section"><h4>Comentarios</h4><div class="tasks-comment-list">${task.comments?.length?task.comments.map(comment=>`<div class="tasks-comment"><strong>${esc(comment.author_username)}</strong><small>${esc(formatDate(comment.created_at))}</small><p>${esc(comment.body)}</p></div>`).join(''):'<div class="muted">Sin comentarios.</div>'}</div>${writable?`<form id="tasksCommentForm" class="tasks-comment-form"><textarea name="body" placeholder="Agregar comentario..." required></textarea><button type="submit">Comentar</button></form>`:''}</div></div>
      <div><div class="tasks-detail-section" style="margin-top:0"><h4>Historial</h4><div class="tasks-history-list">${task.history?.length?task.history.slice().reverse().map(row=>`<div class="tasks-history"><strong>${esc(historyLabel(row))}</strong><small>${esc(row.actor_username||'Sistema')} · ${esc(formatDate(row.created_at))}${row.from_status&&row.to_status?` · ${esc(statusLabels[row.from_status])} → ${esc(statusLabels[row.to_status])}`:''}</small></div>`).join(''):'<div class="muted">Sin historial.</div>'}</div></div>${task.dependents?.length?`<div class="tasks-detail-section"><h4>Trabajo que depende de esta tarea</h4><div class="tasks-dependency-list">${task.dependents.map(dep=>`<div class="tasks-dependency"><strong>${esc(dep.title)}</strong><small>${esc(statusLabels[dep.status]||dep.status)}</small></div>`).join('')}</div></div>`:''}</div></div>`;
  }

  async function openDetail(id) {
    try {
      state.selectedTaskId=id;
      openModal('Cargando tarea...','<div class="tasks-empty">Cargando...</div>');
      const result=await request(`/api/tasks?id=${encodeURIComponent(id)}`);
      const task=result.task;
      byId('tasksModalTitle').textContent=task.title;
      byId('tasksModalBody').innerHTML=detailMarkup(task);
      byId('tasksModalActions').innerHTML='<button type="button" class="alt" data-task-modal-close>Cerrar</button>';
      byId('tasksCommentForm')?.addEventListener('submit',async event=>{event.preventDefault();const text=new FormData(event.currentTarget).get('body');try{await request('/api/tasks',{method:'POST',body:JSON.stringify({action:'comment',task_id:id,body:text})});await load();await openDetail(id);}catch(error){setInlineModalError(error.message);}});
    } catch(error) { openModal('Tarea','<div class="tasks-message bad">'+esc(error.message)+'</div>',[{label:'Cerrar',className:'alt',onClick:closeModal}]); }
  }

  async function openEdit(id) {
    try {
      const result=await request(`/api/tasks?id=${encodeURIComponent(id)}`);const task=result.task;
      openModal('Editar tarea',taskForm(task),[
        {label:'Cancelar',className:'alt',onClick:()=>openDetail(id)},
        {label:'Guardar cambios',onClick:async()=>{try{await request('/api/tasks',{method:'PATCH',body:JSON.stringify({id,...formPayload()})});await load();await openDetail(id);}catch(error){setInlineModalError(error.message);}}}
      ]);bindAssignmentFilter();
    } catch(error){setMessage(error.message,false);}
  }

  function openReason(id,status) {
    const label=status==='blocked'?'Bloquear tarea':'Cancelar tarea';
    openModal(label,`<form id="tasksReasonForm"><label>Motivo</label><textarea name="reason" rows="4" required></textarea><div id="tasksModalError" class="tasks-message bad"></div></form>`,[
      {label:'Volver',className:'alt',onClick:()=>openDetail(id)},
      {label,status==='cancelled'?className:'danger':className:'',onClick:async()=>{const reason=String(new FormData(byId('tasksReasonForm')).get('reason')||'').trim();if(!reason)return setInlineModalError('Escribe el motivo.');try{await transition(id,status,reason);}catch(error){setInlineModalError(error.message);}}}
    ]);
  }

  async function transition(id,status,reason=null) {
    await request('/api/tasks',{method:'POST',body:JSON.stringify({action:'transition',task_id:id,status,reason})});
    await load();
    await openDetail(id);
  }

  async function openDependencies(id) {
    try {
      const result=await request(`/api/tasks?id=${encodeURIComponent(id)}`);const task=result.task;const chosen=new Set((task.dependencies||[]).map(row=>row.id));
      const choices=state.tasks.filter(row=>row.id!==id);
      openModal('Dependencias',`<div class="muted" style="margin-bottom:8px">Marca las tareas que deben completarse antes de esta.</div><div class="tasks-dependency-picker">${choices.length?choices.map(row=>`<label class="tasks-dependency-option"><input type="checkbox" name="task_dependency" value="${esc(row.id)}" ${chosen.has(row.id)?'checked':''}><span><strong>${esc(row.title)}</strong><br><small>${esc(statusLabels[row.status]||row.status)}${row.entity_label?' · '+esc(row.entity_label):''}</small></span></label>`).join(''):'<div class="muted">No hay otras tareas.</div>'}</div><div id="tasksModalError" class="tasks-message bad"></div>`,[
        {label:'Cancelar',className:'alt',onClick:()=>openDetail(id)},
        {label:'Guardar',onClick:async()=>{const ids=[...byId('tasksModalBody').querySelectorAll('input[name="task_dependency"]:checked')].map(node=>node.value);try{await request('/api/tasks',{method:'POST',body:JSON.stringify({action:'set_dependencies',task_id:id,dependency_ids:ids})});await load();await openDetail(id);}catch(error){setInlineModalError(error.message);}}}
      ]);
    } catch(error){setMessage(error.message,false);}
  }

  async function handleClick(event) {
    const target=event.target instanceof Element?event.target:null;if(!target)return;
    if(target.closest('[data-task-modal-close]')){closeModal();return;}
    if(target===byId('tasksModal')){closeModal();return;}
    const filter=target.closest('[data-task-filter]');if(filter){state.activeFilter=filter.dataset.taskFilter;const status=byId('tasksStatusFilter');if(status)status.value='all';render();return;}
    const transitionButton=target.closest('[data-task-transition]');if(transitionButton){const id=transitionButton.dataset.id,status=transitionButton.dataset.taskTransition;if(['blocked','cancelled'].includes(status))openReason(id,status);else{try{await transition(id,status);}catch(error){setInlineModalError(error.message);}}return;}
    const action=target.closest('[data-task-action]');if(action){event.stopPropagation();const type=action.dataset.taskAction,id=action.dataset.id;if(type==='refresh')return load();if(type==='create')return openCreate();if(type==='open')return openDetail(id);if(type==='edit-detail')return openEdit(id);if(type==='dependencies')return openDependencies(id);}
    const row=target.closest('[data-task-open]');if(row)return openDetail(row.dataset.taskOpen);
  }

  async function mount() {
    if(!ensureSurface())return;
    renderBase();
    await load();
    window.addEventListener('export-mca:section-changed',event=>{if(event.detail?.id==='tasksSection'&&!state.loaded)load();});
  }

  window.TasksWorkspace=Object.freeze({ load,open:openDetail,state });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
