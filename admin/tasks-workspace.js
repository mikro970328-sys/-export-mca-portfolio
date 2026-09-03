(() => {
  'use strict';

  if (window.__tasksWorkspaceInstalled) return;
  window.__tasksWorkspaceInstalled = true;

  const OWNER = 'tasks-workspace.js';
  const state = {
    tasks:[],
    context:null,
    loaded:false,
    loading:false,
    loadError:'',
    lastUpdated:null,
    activeFilter:'pending',
    query:'',
    status:'all',
    priority:'all',
    team:'all',
    assignee:'all',
    selectedTaskId:null,
    busyAction:'',
    lastFocused:null
  };

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  })[character]);
  const can = permission => Boolean(window.ExportMcaAccessControl?.can?.(permission));
  const statusLabels = {
    pending:'Pendiente',
    in_progress:'En curso',
    blocked:'Bloqueada',
    completed:'Completada',
    cancelled:'Cancelada'
  };
  const priorityLabels = { low:'Baja',normal:'Normal',high:'Alta',critical:'Crítica' };
  const entityLabels = {
    client:'Cliente',
    sales_order:'Venta',
    purchase_order:'Compra',
    warehouse_receipt:'Recepción',
    load:'Cargue',
    shipment:'Contenedor',
    invoice:'Factura',
    supplier_bill:'Factura proveedor',
    document:'Documento',
    customer_advance:'Anticipo',
    proforma:'Proforma'
  };
  const taskErrorMessages = Object.freeze({
    TASK_ID_INVALID:'La tarea seleccionada no es válida.',
    ID_INVALID:'La tarea seleccionada no es válida.',
    TASK_NOT_FOUND:'La tarea ya no está disponible.',
    TASK_TEAM_INVALID:'El equipo seleccionado no está disponible.',
    TASK_ASSIGNEE_INVALID:'El responsable seleccionado no está disponible.',
    TASK_ASSIGNEE_NOT_TEAM_MEMBER:'El responsable debe pertenecer al equipo seleccionado.',
    TASK_ACTOR_INVALID:'No se pudo validar tu cuenta para esta acción.',
    TASK_ACTOR_REQUIRED:'No se pudo validar tu cuenta para esta acción.',
    TASK_STATUS_INVALID:'El estado seleccionado no es válido.',
    TASK_TRANSITION_INVALID:'Ese cambio de estado no está disponible para la tarea.',
    TASK_REASON_REQUIRED:'Escribe el motivo para continuar.',
    TASK_COMMENT_REQUIRED:'Escribe el comentario antes de enviarlo.',
    TASK_DEPENDENCY_SELF_FORBIDDEN:'Una tarea no puede depender de sí misma.',
    TASK_DEPENDENCY_INVALID:'Una de las dependencias seleccionadas no es válida.',
    TASK_DEPENDENCY_CYCLE:'Esa dependencia crearía un ciclo entre tareas.',
    TASK_OPEN_DEPENDENCIES:'Completa primero las dependencias pendientes de esta tarea.'
  });
  const safeTaskErrors = new Set([
    'Tarea no encontrada',
    'El título es obligatorio',
    'Prioridad inválida',
    'Entidad inválida',
    'El comentario es obligatorio',
    'Estado inválido',
    'Se requiere permiso de gestión de tareas',
    'Completa primero las dependencias pendientes de esta tarea'
  ]);

  function safeTaskMessage(error,fallback='No se pudo completar la operación. Intenta nuevamente.') {
    const raw=String(error?.message||'').trim();
    const code=String(error?.code||raw.match(/(?:TASK_[A-Z0-9_]+|ID_INVALID)/)?.[0]||'').trim();
    if(taskErrorMessages[code])return taskErrorMessages[code];
    if(error?.status===401)return 'Tu sesión terminó. Inicia sesión nuevamente para continuar.';
    if(error?.status===403)return 'No tienes permiso para completar esta acción.';
    if(error?.status===404)return 'La tarea ya no está disponible.';
    if(safeTaskErrors.has(raw))return raw;
    console.error('TASK_WORKSPACE_OPERATION_FAILED',{status:error?.status||null,code:code||null,error});
    return fallback;
  }

  const request = async (path,options={}) => {
    if (typeof window.api !== 'function') throw new Error('API no disponible');
    return window.api(path,options);
  };

  function taskCounts(tasks=[]) {
    return {
      pending:tasks.filter(task=>task.status==='pending').length,
      in_progress:tasks.filter(task=>task.status==='in_progress').length,
      blocked:tasks.filter(task=>task.status==='blocked').length,
      overdue:tasks.filter(task=>task.is_overdue===true).length,
      completed:tasks.filter(task=>task.status==='completed').length
    };
  }

  function visibleTasks(tasks=[],filters={}) {
    const query=String(filters.query||'').trim().toLowerCase();
    const activeFilter=String(filters.activeFilter||'all');
    const status=String(filters.status||'all');
    const priority=String(filters.priority||'all');
    const team=String(filters.team||'all');
    const assignee=String(filters.assignee||'all');

    return tasks.filter(task=>{
      if(activeFilter==='overdue'&&task.is_overdue!==true)return false;
      if(['pending','in_progress','blocked','completed'].includes(activeFilter)&&task.status!==activeFilter)return false;
      if(activeFilter==='all'&&status!=='all'&&task.status!==status)return false;
      if(priority!=='all'&&task.priority!==priority)return false;
      if(team!=='all'&&String(task.assigned_team_id||'')!==team)return false;
      if(assignee==='unassigned'&&(task.assigned_admin_id||task.assigned_team_id))return false;
      if(assignee!=='all'&&assignee!=='unassigned'&&String(task.assigned_admin_id||'')!==assignee)return false;
      if(query&&!`${task.title||''} ${task.description||''} ${task.entity_label||''} ${task.assigned_admin_name||''} ${task.assigned_admin_username||''} ${task.assigned_team_name||''}`.toLowerCase().includes(query))return false;
      return true;
    });
  }

  function currentFilters() {
    return {
      activeFilter:state.activeFilter,
      query:state.query,
      status:state.status,
      priority:state.priority,
      team:state.team,
      assignee:state.assignee
    };
  }

  function getState() {
    return {
      owner:OWNER,
      loaded:state.loaded,
      loading:state.loading,
      loadError:Boolean(state.loadError),
      lastUpdated:state.lastUpdated,
      activeFilter:state.activeFilter,
      selectedTaskId:state.selectedTaskId,
      total:state.tasks.length,
      visible:visibleTasks(state.tasks,currentFilters()).length,
      metrics:taskCounts(state.tasks)
    };
  }

  function setMessage(message,ok=true) {
    const node=byId('tasksMessage');
    if(!node)return;
    node.textContent=message||'';
    node.className=`tasks-message ${message?(ok?'ok':'bad'):''}`;
  }

  function ensureSurface() {
    if(!can('tasks.read'))return false;
    const homeSubmenu=document.querySelector('.nav-group[data-nav-group="home"] .submenu');
    if(homeSubmenu&&!homeSubmenu.querySelector('[data-section="tasksSection"]')) {
      const button=document.createElement('button');
      button.type='button';
      button.dataset.section='tasksSection';
      button.dataset.navLabel='Mis tareas';
      button.setAttribute('aria-label','Mis tareas');
      button.title='Mis tareas';
      button.innerHTML='<span class="nav-icon" aria-hidden="true"></span><span class="nav-label">Mis tareas</span>';
      const notifications=homeSubmenu.querySelector('[data-section="notificationsSection"]');
      if(notifications)homeSubmenu.insertBefore(button,notifications);else homeSubmenu.appendChild(button);
      window.ExportMcaIcons?.hydrate?.(button);
    }
    const main=document.querySelector('.main-shell main');
    if(main&&!byId('tasksSection')) {
      const section=document.createElement('section');
      section.id='tasksSection';
      section.className='app-section hidden';
      main.appendChild(section);
    }
    try {
      if(window.titles&&typeof window.titles==='object')window.titles.tasksSection='Mis tareas';
    } catch {}
    return Boolean(byId('tasksSection'));
  }

  function shellMarkup() {
    const manage=can('tasks.manage');
    return `<div class="tasks-shell native-workspace-shell">
      <header class="tasks-head native-workspace-hero">
        <div class="tasks-hero-main">
          <div class="native-workspace-heading">
            <span class="native-workspace-kicker">Coordinación operativa</span>
            <h2>Mis tareas</h2>
            <p>${manage?'Prioriza, asigna y da seguimiento al trabajo operativo de todo el equipo.':'Consulta el trabajo asignado a ti, a tus equipos o creado por ti.'}</p>
            <div class="tasks-hero-state">
              <span class="tasks-state-dot" aria-hidden="true"></span>
              <span id="tasksOperationalState">Preparando cola de trabajo</span>
              <span id="tasksLastUpdated">Preparando…</span>
            </div>
          </div>
          <div class="tasks-head-actions native-workspace-actions">
            <button type="button" class="alt tasks-secondary" data-task-action="refresh">Actualizar</button>
            ${manage?'<button type="button" class="tasks-primary" data-task-action="create">Nueva tarea</button>':''}
          </div>
        </div>
        <div id="tasksSummary" class="tasks-summary native-workspace-summary" aria-label="Resumen de tareas"></div>
      </header>

      <section class="tasks-command" aria-label="Buscar y filtrar tareas">
        <label class="tasks-search-field" for="tasksSearch">
          <span>Buscar</span>
          <input id="tasksSearch" class="tasks-search" type="search" placeholder="Título, responsable o trabajo vinculado" autocomplete="off">
        </label>
        <div class="tasks-filter-grid">
          <label><span>Estado</span><select id="tasksStatusFilter"><option value="all">Todos</option><option value="pending">Pendientes</option><option value="in_progress">En curso</option><option value="blocked">Bloqueadas</option><option value="completed">Completadas</option><option value="cancelled">Canceladas</option></select></label>
          <label><span>Prioridad</span><select id="tasksPriorityFilter"><option value="all">Todas</option><option value="critical">Crítica</option><option value="high">Alta</option><option value="normal">Normal</option><option value="low">Baja</option></select></label>
          <label><span>Equipo</span><select id="tasksTeamFilter"><option value="all">Todos</option></select></label>
          ${manage?'<label><span>Responsable</span><select id="tasksAssigneeFilter"><option value="all">Todos</option><option value="unassigned">Sin asignar</option></select></label>':''}
        </div>
        <button type="button" class="tasks-filter-clear" data-task-action="clear">Limpiar filtros</button>
      </section>

      <div id="tasksMessage" class="tasks-message" aria-live="polite"></div>
      <section id="tasksPanel" class="tasks-panel native-workspace-panel" aria-labelledby="tasksPanelTitle">
        <div class="tasks-panel-head">
          <div>
            <span class="tasks-eyebrow">Cola personal</span>
            <h3 id="tasksPanelTitle">Trabajo priorizado</h3>
            <p>Abre una tarea para consultar su detalle, comentarios, historial y dependencias.</p>
          </div>
          <span id="tasksResultCount" class="tasks-result-count" aria-live="polite">Consultando…</span>
        </div>
        <div id="tasksTableWrap" class="tasks-table-wrap" role="list"></div>
      </section>
    </div>

    <div id="tasksModal" class="tasks-modal hidden" role="dialog" aria-modal="true" aria-labelledby="tasksModalTitle" aria-describedby="tasksModalBody">
      <div class="tasks-modal-panel" role="document">
        <div class="tasks-modal-head">
          <div><span class="tasks-modal-kicker">Gestión de tarea</span><h3 id="tasksModalTitle">Tarea</h3></div>
          <button type="button" class="alt tasks-modal-close" data-task-modal-close aria-label="Cerrar detalle">Cerrar</button>
        </div>
        <div id="tasksModalBody" class="tasks-modal-body"></div>
        <div id="tasksModalActions" class="tasks-modal-actions"></div>
      </div>
    </div>`;
  }

  function formatUpdatedAt(value) {
    if(!value)return 'Preparando…';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return 'Actualización disponible';
    return `Actualizado ${date.toLocaleTimeString('es-US',{hour:'2-digit',minute:'2-digit'})}`;
  }

  function renderOperationalState() {
    const metrics=taskCounts(state.tasks);
    const open=metrics.pending+metrics.in_progress+metrics.blocked;
    const statusNode=byId('tasksOperationalState');
    const updatedNode=byId('tasksLastUpdated');
    const panel=byId('tasksPanel');
    if(statusNode) {
      statusNode.textContent=state.loading
        ? 'Sincronizando cola de trabajo'
        : state.loadError
          ? 'La cola requiere atención'
          : `${open} abierta${open===1?'':'s'} en seguimiento`;
    }
    if(updatedNode)updatedNode.textContent=formatUpdatedAt(state.lastUpdated);
    if(panel)panel.setAttribute('aria-busy',state.loading?'true':'false');
  }

  function renderSummary() {
    const node=byId('tasksSummary');
    if(!node)return;
    const metrics=taskCounts(state.tasks);
    const cards=[
      ['pending','Pendientes','taskMetricPending'],
      ['in_progress','En curso','taskMetricInProgress'],
      ['blocked','Bloqueadas','taskMetricBlocked'],
      ['overdue','Vencidas','taskMetricOverdue'],
      ['completed','Completadas','taskMetricCompleted']
    ];
    node.innerHTML=cards.map(([key,label,id])=>`<button id="${id}" type="button" class="tasks-summary-card native-workspace-summary-card ${state.activeFilter===key?'active':''} ${key==='overdue'&&metrics[key]?'tasks-count-critical':''}" data-task-filter="${key}" aria-pressed="${state.activeFilter===key?'true':'false'}"><span>${label}</span><strong>${metrics[key]}</strong></button>`).join('');
  }

  function populateFilters() {
    const team=byId('tasksTeamFilter');
    if(team&&team.options.length===1) {
      team.insertAdjacentHTML('beforeend',(state.context?.teams||[]).map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join(''));
    }
    const assignee=byId('tasksAssigneeFilter');
    if(assignee&&assignee.options.length===2) {
      assignee.insertAdjacentHTML('beforeend',(state.context?.users||[]).map(row=>`<option value="${esc(row.id)}">${esc(row.full_name||row.username)}</option>`).join(''));
    }
  }

  function formatDate(value) {
    if(!value)return 'Sin fecha límite';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return 'Sin fecha límite';
    return date.toLocaleString('es-US',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }

  function assignmentMarkup(task) {
    const person=task.assigned_admin_name||task.assigned_admin_username;
    const team=task.assigned_team_name;
    if(person&&team)return `<strong>${esc(person)}</strong><small>${esc(team)}</small>`;
    if(person)return `<strong>${esc(person)}</strong><small>Responsable directo</small>`;
    if(team)return `<strong>${esc(team)}</strong><small>Asignada al equipo</small>`;
    return '<strong class="muted">Sin asignar</strong><small>Requiere responsable</small>';
  }

  function entityLabel(task) {
    if(!task.entity_type)return '<span class="tasks-entity-empty">Sin trabajo vinculado</span>';
    const value=task.entity_label||String(task.entity_id||'').slice(0,8)||'Sin referencia';
    return `<span class="tasks-entity-link">${esc(entityLabels[task.entity_type]||task.entity_type)} · ${esc(value)}</span>`;
  }

  function taskCard(task) {
    const dependencyCount=Number(task.open_dependency_count)||0;
    const description=String(task.description||'').trim();
    return `<article class="tasks-card ${task.is_overdue?'is-overdue':''}" role="listitem">
      <div class="tasks-card-main">
        <div class="tasks-card-badges">
          <span class="tasks-status ${esc(task.status)}">${esc(statusLabels[task.status]||task.status)}</span>
          <span class="tasks-priority ${esc(task.priority)}">${esc(priorityLabels[task.priority]||task.priority)}</span>
          ${task.is_overdue?'<span class="tasks-due-badge">Vencida</span>':''}
        </div>
        <h4 class="tasks-title">${esc(task.title)}</h4>
        <p class="tasks-sub">${esc(description||'Sin descripción.')}</p>
      </div>
      <dl class="tasks-card-meta">
        <div><dt>Responsable</dt><dd class="tasks-assignee">${assignmentMarkup(task)}</dd></div>
        <div><dt>Vence</dt><dd class="${task.is_overdue?'tasks-overdue':''}">${esc(formatDate(task.due_at))}</dd></div>
        <div><dt>Origen</dt><dd>${task.origin==='workflow'?'Workflow':'Manual'}</dd></div>
      </dl>
      <div class="tasks-card-foot">
        <div class="tasks-card-context">${entityLabel(task)}${dependencyCount?`<span class="tasks-dependency-badge">${dependencyCount} dependencia${dependencyCount===1?'':'s'} pendiente${dependencyCount===1?'':'s'}</span>`:''}</div>
        <button type="button" class="alt tasks-open-button" data-task-action="open" data-id="${esc(task.id)}">Abrir detalle</button>
      </div>
    </article>`;
  }

  function renderResultRegion() {
    const wrap=byId('tasksTableWrap');
    const result=byId('tasksResultCount');
    if(!wrap)return;

    if(state.loading&&!state.loaded) {
      if(result)result.textContent='Consultando…';
      wrap.innerHTML='<div class="tasks-loading" role="status"><span class="tasks-loading-pulse" aria-hidden="true"></span><div><strong>Organizando tu cola</strong><p>Estamos consultando tareas, responsables y dependencias.</p></div></div>';
      return;
    }

    if(state.loadError&&!state.loaded) {
      if(result)result.textContent='Sin datos';
      wrap.innerHTML='<div class="tasks-empty tasks-error"><strong>No se pudo cargar la cola de trabajo</strong><p>Revisa tu conexión e inténtalo nuevamente.</p><button type="button" class="alt" data-task-action="refresh">Reintentar</button></div>';
      return;
    }

    const rows=visibleTasks(state.tasks,currentFilters());
    if(result)result.textContent=`${rows.length} de ${state.tasks.length}`;
    if(!rows.length) {
      wrap.innerHTML='<div class="tasks-empty"><strong>No hay tareas para esta vista</strong><p>Prueba con otro estado, prioridad o término de búsqueda.</p><button type="button" class="alt" data-task-action="clear">Limpiar filtros</button></div><div class="tasks-footer">0 tareas visibles</div>';
      return;
    }

    wrap.innerHTML=`<div class="tasks-list">${rows.map(taskCard).join('')}</div><div class="tasks-footer">${rows.length} tarea${rows.length===1?'':'s'} visible${rows.length===1?'':'s'} · ${state.tasks.length} en tu cola</div>`;
  }

  function render() {
    renderOperationalState();
    renderSummary();
    populateFilters();
    renderResultRegion();
  }

  async function load(options={}) {
    if(state.loading)return;
    state.loading=true;
    state.loadError='';
    setMessage('');
    render();
    try {
      const [tasksResult,contextResult]=await Promise.all([
        request('/api/tasks'),
        request('/api/tasks?action=context')
      ]);
      state.tasks=Array.isArray(tasksResult.tasks)?tasksResult.tasks:[];
      state.context=contextResult.context||{manage:false,teams:[],users:[],memberships:[]};
      state.loaded=true;
      state.lastUpdated=new Date().toISOString();
      if(options.successMessage)setMessage(options.successMessage,true);
    } catch(error) {
      state.loadError=safeTaskMessage(error,'No se pudieron cargar las tareas. Intenta nuevamente.');
      setMessage(state.loadError,false);
    } finally {
      state.loading=false;
      render();
    }
  }

  function setModalActions(actions=[]) {
    const foot=byId('tasksModalActions');
    if(!foot)return;
    foot.innerHTML='';
    actions.forEach(action=>{
      const button=document.createElement('button');
      button.type='button';
      button.textContent=action.label;
      button.className=action.className||'';
      if(action.close)button.dataset.taskModalClose='true';
      if(typeof action.onClick==='function')button.addEventListener('click',action.onClick);
      foot.appendChild(button);
    });
  }

  function focusFirstModalControl() {
    const modal=byId('tasksModal');
    if(!modal||modal.classList.contains('hidden'))return;
    const target=modal.querySelector('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])');
    target?.focus?.();
  }

  function openModal(title,body,actions=[]) {
    const modal=byId('tasksModal');
    if(!modal)return;
    if(modal.classList.contains('hidden'))state.lastFocused=document.activeElement;
    const titleNode=byId('tasksModalTitle');
    const bodyNode=byId('tasksModalBody');
    if(titleNode)titleNode.textContent=title;
    if(bodyNode)bodyNode.innerHTML=body;
    setModalActions(actions);
    modal.classList.remove('hidden');
    document.body.classList.add('tasks-dialog-open');
    setTimeout(focusFirstModalControl,0);
  }

  function closeModal() {
    const modal=byId('tasksModal');
    if(!modal||modal.classList.contains('hidden'))return;
    modal.classList.add('hidden');
    modal.removeAttribute('aria-busy');
    document.body.classList.remove('tasks-dialog-open');
    if(byId('tasksModalBody'))byId('tasksModalBody').innerHTML='';
    if(byId('tasksModalActions'))byId('tasksModalActions').innerHTML='';
    state.selectedTaskId=null;
    state.busyAction='';
    const previous=state.lastFocused;
    state.lastFocused=null;
    if(previous?.isConnected)previous.focus?.();
  }

  function setModalBusy(busy) {
    const modal=byId('tasksModal');
    if(!modal)return;
    modal.setAttribute('aria-busy',busy?'true':'false');
    modal.querySelectorAll('button').forEach(button=>{button.disabled=busy;});
  }

  function setInlineModalError(message) {
    let node=byId('tasksModalError');
    if(!node) {
      node=document.createElement('div');
      node.id='tasksModalError';
      node.className='tasks-message bad';
      byId('tasksModalBody')?.prepend(node);
    }
    node.textContent=message||'No se pudo completar la operación.';
  }

  async function runModalAction(key,action,fallback) {
    if(state.busyAction)return;
    state.busyAction=key;
    setModalBusy(true);
    try {
      await action();
    } catch(error) {
      setInlineModalError(safeTaskMessage(error,fallback));
    } finally {
      state.busyAction='';
      setModalBusy(false);
    }
  }

  function handleDocumentKeydown(event) {
    const modal=byId('tasksModal');
    if(!modal||modal.classList.contains('hidden'))return;
    if(event.key==='Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if(event.key!=='Tab')return;
    const focusable=[...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(node=>node.getClientRects().length>0);
    if(!focusable.length) {
      event.preventDefault();
      return;
    }
    const first=focusable[0];
    const last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first) {
      event.preventDefault();
      last.focus();
    } else if(!event.shiftKey&&document.activeElement===last) {
      event.preventDefault();
      first.focus();
    }
  }

  const option=(value,label,selected='')=>`<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label)}</option>`;

  function localDateInput(value) {
    if(!value)return '';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return '';
    const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
    return local.toISOString().slice(0,16);
  }

  function eligibleUsers(teamId) {
    const users=state.context?.users||[];
    const memberships=state.context?.memberships||[];
    if(!teamId||!memberships.length)return users;
    const ids=new Set(memberships.filter(row=>row.team_id===teamId).map(row=>row.admin_user_id));
    return users.filter(row=>ids.has(row.id));
  }

  function taskForm(task={}) {
    const teamId=task.assigned_team_id||'';
    const adminId=task.assigned_admin_id||'';
    return `<form id="tasksEditForm" class="tasks-form">
      <label class="full"><span>Título</span><input name="title" maxlength="180" value="${esc(task.title||'')}" required></label>
      <label class="full"><span>Descripción</span><textarea name="description" rows="4">${esc(task.description||'')}</textarea></label>
      <label><span>Prioridad</span><select name="priority">${['normal','high','critical','low'].map(value=>option(value,priorityLabels[value],task.priority||'normal')).join('')}</select></label>
      <label><span>Vence</span><input name="due_at" type="datetime-local" value="${esc(localDateInput(task.due_at))}"></label>
      <label><span>Equipo</span><select name="assigned_team_id" id="tasksFormTeam"><option value="">Sin equipo</option>${(state.context?.teams||[]).map(row=>option(row.id,row.name,teamId)).join('')}</select></label>
      <label><span>Responsable</span><select name="assigned_admin_id" id="tasksFormAssignee"><option value="">Sin responsable</option>${eligibleUsers(teamId).map(row=>option(row.id,row.full_name||row.username,adminId)).join('')}</select></label>
      <label><span>Tipo de entidad</span><select name="entity_type"><option value="">Sin vínculo</option>${Object.entries(entityLabels).map(([value,label])=>option(value,label,task.entity_type||'')).join('')}</select></label>
      <label><span>ID de entidad</span><input name="entity_id" value="${esc(task.entity_id||'')}" placeholder="UUID"></label>
      <p class="tasks-form-help full">Para vincular trabajo, selecciona un tipo e ingresa también su ID.</p>
    </form>`;
  }

  function bindAssignmentFilter() {
    const team=byId('tasksFormTeam');
    const assignee=byId('tasksFormAssignee');
    if(!team||!assignee)return;
    team.addEventListener('change',()=>{
      const current=assignee.value;
      const users=eligibleUsers(team.value);
      assignee.innerHTML='<option value="">Sin responsable</option>'+users.map(row=>option(row.id,row.full_name||row.username,current)).join('');
      if(current&&!users.some(row=>row.id===current))assignee.value='';
    });
  }

  function formPayload() {
    const form=byId('tasksEditForm');
    const data=new FormData(form);
    const due=data.get('due_at');
    return {
      title:String(data.get('title')||'').trim(),
      description:String(data.get('description')||'').trim()||null,
      priority:data.get('priority'),
      due_at:due?new Date(String(due)).toISOString():null,
      assigned_team_id:data.get('assigned_team_id')||null,
      assigned_admin_id:data.get('assigned_admin_id')||null,
      entity_type:data.get('entity_type')||null,
      entity_id:String(data.get('entity_id')||'').trim()||null
    };
  }

  function openCreate() {
    if(!can('tasks.manage'))return;
    openModal('Nueva tarea',taskForm(),[
      {label:'Cancelar',className:'alt tasks-secondary',close:true},
      {
        label:'Crear tarea',
        className:'tasks-primary',
        onClick:()=>runModalAction('create',async()=>{
          await request('/api/tasks',{method:'POST',body:JSON.stringify({action:'create',...formPayload()})});
          closeModal();
          await load({successMessage:'Tarea creada correctamente.'});
        },'No se pudo crear la tarea. Intenta nuevamente.')
      }
    ]);
    bindAssignmentFilter();
  }

  const historyLabel=row=>({
    created:'Tarea creada',
    updated:'Tarea actualizada',
    transitioned:'Cambio de estado',
    commented:'Comentario agregado',
    dependencies_changed:'Dependencias actualizadas'
  })[row.event_type]||row.event_type;

  function detailMarkup(task) {
    const writable=task.capabilities?.write&&can('tasks.write');
    const manageable=task.capabilities?.manage&&can('tasks.manage');
    const actions=[];
    if(writable&&task.status==='pending')actions.push(['in_progress','Iniciar'],['blocked','Bloquear'],['completed','Completar']);
    if(writable&&task.status==='in_progress')actions.push(['pending','Volver a pendiente'],['blocked','Bloquear'],['completed','Completar']);
    if(writable&&task.status==='blocked')actions.push(['in_progress','Reanudar'],['pending','Volver a pendiente'],['completed','Completar']);
    if(manageable&&['completed','cancelled'].includes(task.status))actions.push(['pending','Reabrir']);

    return `<div class="tasks-kicker">${esc(entityLabels[task.entity_type]||'Tarea operativa')}${task.entity_label?` · ${esc(task.entity_label)}`:''}</div>
      <div class="tasks-action-strip">
        ${actions.map(([status,label])=>`<button type="button" class="${status==='completed'?'success':'alt'}" data-task-transition="${status}" data-id="${esc(task.id)}">${esc(label)}</button>`).join('')}
        ${manageable&&!['completed','cancelled'].includes(task.status)?`<button type="button" class="danger" data-task-transition="cancelled" data-id="${esc(task.id)}">Cancelar tarea</button>`:''}
        ${manageable?`<button type="button" class="alt" data-task-action="edit-detail" data-id="${esc(task.id)}">Editar</button><button type="button" class="alt" data-task-action="dependencies" data-id="${esc(task.id)}">Dependencias</button>`:''}
      </div>
      <div class="tasks-detail-grid">
        <div>
          <div class="tasks-detail-meta">
            <div class="tasks-meta-item"><span>Estado</span><b>${esc(statusLabels[task.status]||task.status)}</b></div>
            <div class="tasks-meta-item"><span>Prioridad</span><b>${esc(priorityLabels[task.priority]||task.priority)}</b></div>
            <div class="tasks-meta-item"><span>Responsable</span><b>${esc(task.assigned_admin_name||task.assigned_admin_username||'Sin responsable')}</b></div>
            <div class="tasks-meta-item"><span>Equipo</span><b>${esc(task.assigned_team_name||'Sin equipo')}</b></div>
            <div class="tasks-meta-item"><span>Vence</span><b class="${task.is_overdue?'tasks-overdue':''}">${esc(formatDate(task.due_at))}${task.is_overdue?' · Vencida':''}</b></div>
            <div class="tasks-meta-item"><span>Origen</span><b>${task.origin==='workflow'?'Workflow':'Manual'}</b></div>
          </div>
          <section class="tasks-detail-section"><h4>Descripción</h4><div class="tasks-description">${esc(task.description||'Sin descripción.')}</div></section>
          <section class="tasks-detail-section"><h4>Dependencias</h4><div class="tasks-dependency-list">${task.dependencies?.length?task.dependencies.map(dependency=>`<div class="tasks-dependency"><strong>${esc(dependency.title)}</strong><small>${esc(statusLabels[dependency.status]||dependency.status)}${dependency.entity_label?' · '+esc(dependency.entity_label):''}</small></div>`).join(''):'<div class="tasks-detail-empty">Sin dependencias.</div>'}</div></section>
          <section class="tasks-detail-section"><h4>Comentarios</h4><div class="tasks-comment-list">${task.comments?.length?task.comments.map(comment=>`<div class="tasks-comment"><strong>${esc(comment.author_username)}</strong><small>${esc(formatDate(comment.created_at))}</small><p>${esc(comment.body)}</p></div>`).join(''):'<div class="tasks-detail-empty">Sin comentarios.</div>'}</div>${writable?'<form id="tasksCommentForm" class="tasks-comment-form"><label><span>Nuevo comentario</span><textarea name="body" placeholder="Agrega contexto operativo…" required></textarea></label><button type="submit" class="tasks-primary">Comentar</button></form>':''}</section>
        </div>
        <div>
          <section class="tasks-detail-section tasks-history-section"><h4>Historial</h4><div class="tasks-history-list">${task.history?.length?task.history.slice().reverse().map(row=>`<div class="tasks-history"><strong>${esc(historyLabel(row))}</strong><small>${esc(row.actor_username||'Sistema')} · ${esc(formatDate(row.created_at))}${row.from_status&&row.to_status?` · ${esc(statusLabels[row.from_status])} → ${esc(statusLabels[row.to_status])}`:''}</small></div>`).join(''):'<div class="tasks-detail-empty">Sin historial.</div>'}</div></section>
          ${task.dependents?.length?`<section class="tasks-detail-section"><h4>Trabajo que depende de esta tarea</h4><div class="tasks-dependency-list">${task.dependents.map(dependent=>`<div class="tasks-dependency"><strong>${esc(dependent.title)}</strong><small>${esc(statusLabels[dependent.status]||dependent.status)}</small></div>`).join('')}</div></section>`:''}
        </div>
      </div>`;
  }

  async function openDetail(id) {
    state.selectedTaskId=id;
    openModal('Cargando tarea…','<div class="tasks-loading" role="status"><span class="tasks-loading-pulse" aria-hidden="true"></span><div><strong>Cargando detalle</strong><p>Consultando historial y dependencias.</p></div></div>');
    try {
      const result=await request(`/api/tasks?id=${encodeURIComponent(id)}`);
      if(String(state.selectedTaskId)!==String(id))return;
      const task=result.task;
      byId('tasksModalTitle').textContent=task.title;
      byId('tasksModalBody').innerHTML=detailMarkup(task);
      setModalActions([{label:'Cerrar',className:'alt tasks-secondary',close:true}]);
      byId('tasksCommentForm')?.addEventListener('submit',event=>{
        event.preventDefault();
        const body=new FormData(event.currentTarget).get('body');
        runModalAction('comment',async()=>{
          await request('/api/tasks',{method:'POST',body:JSON.stringify({action:'comment',task_id:id,body})});
          await load({successMessage:'Comentario agregado.'});
          await openDetail(id);
        },'No se pudo agregar el comentario. Intenta nuevamente.');
      });
      setTimeout(focusFirstModalControl,0);
    } catch(error) {
      openModal('Tarea',`<div class="tasks-message bad">${esc(safeTaskMessage(error,'No se pudo abrir la tarea. Intenta nuevamente.'))}</div>`,[
        {label:'Cerrar',className:'alt tasks-secondary',close:true}
      ]);
    }
  }

  async function openEdit(id) {
    try {
      const result=await request(`/api/tasks?id=${encodeURIComponent(id)}`);
      const task=result.task;
      openModal('Editar tarea',taskForm(task),[
        {label:'Volver',className:'alt tasks-secondary',onClick:()=>openDetail(id)},
        {
          label:'Guardar cambios',
          className:'tasks-primary',
          onClick:()=>runModalAction('edit',async()=>{
            await request('/api/tasks',{method:'PATCH',body:JSON.stringify({id,...formPayload()})});
            await load({successMessage:'Cambios guardados.'});
            await openDetail(id);
          },'No se pudieron guardar los cambios. Intenta nuevamente.')
        }
      ]);
      bindAssignmentFilter();
    } catch(error) {
      setInlineModalError(safeTaskMessage(error,'No se pudo abrir la edición. Intenta nuevamente.'));
    }
  }

  function openReason(id,status) {
    const label=status==='blocked'?'Bloquear tarea':'Cancelar tarea';
    openModal(label,`<form id="tasksReasonForm" class="tasks-reason-form"><label><span>Motivo</span><textarea name="reason" rows="4" placeholder="Explica el motivo para dejar trazabilidad" required></textarea></label><div id="tasksModalError" class="tasks-message bad"></div></form>`,[
      {label:'Volver',className:'alt tasks-secondary',onClick:()=>openDetail(id)},
      {
        label,
        className:status==='cancelled'?'danger':'tasks-primary',
        onClick:()=>{
          const reason=String(new FormData(byId('tasksReasonForm')).get('reason')||'').trim();
          if(!reason)return setInlineModalError('Escribe el motivo.');
          return runModalAction(`transition:${status}`,()=>transition(id,status,reason),'No se pudo cambiar el estado. Intenta nuevamente.');
        }
      }
    ]);
  }

  async function transition(id,status,reason=null) {
    await request('/api/tasks',{method:'POST',body:JSON.stringify({action:'transition',task_id:id,status,reason})});
    await load({successMessage:'Estado de la tarea actualizado.'});
    await openDetail(id);
  }

  async function openDependencies(id) {
    try {
      const result=await request(`/api/tasks?id=${encodeURIComponent(id)}`);
      const task=result.task;
      const chosen=new Set((task.dependencies||[]).map(row=>row.id));
      const choices=state.tasks.filter(row=>row.id!==id);
      openModal('Dependencias',`<p class="tasks-dependency-intro">Marca las tareas que deben completarse antes de esta.</p><div class="tasks-dependency-picker">${choices.length?choices.map(row=>`<label class="tasks-dependency-option"><input type="checkbox" name="task_dependency" value="${esc(row.id)}" ${chosen.has(row.id)?'checked':''}><span><strong>${esc(row.title)}</strong><small>${esc(statusLabels[row.status]||row.status)}${row.entity_label?' · '+esc(row.entity_label):''}</small></span></label>`).join(''):'<div class="tasks-detail-empty">No hay otras tareas disponibles.</div>'}</div><div id="tasksModalError" class="tasks-message bad"></div>`,[
        {label:'Volver',className:'alt tasks-secondary',onClick:()=>openDetail(id)},
        {
          label:'Guardar dependencias',
          className:'tasks-primary',
          onClick:()=>runModalAction('dependencies',async()=>{
            const ids=[...byId('tasksModalBody').querySelectorAll('input[name="task_dependency"]:checked')].map(node=>node.value);
            await request('/api/tasks',{method:'POST',body:JSON.stringify({action:'set_dependencies',task_id:id,dependency_ids:ids})});
            await load({successMessage:'Dependencias actualizadas.'});
            await openDetail(id);
          },'No se pudieron guardar las dependencias. Intenta nuevamente.')
        }
      ]);
    } catch(error) {
      setInlineModalError(safeTaskMessage(error,'No se pudieron abrir las dependencias. Intenta nuevamente.'));
    }
  }

  function resetFilters() {
    state.activeFilter='all';
    state.query='';
    state.status='all';
    state.priority='all';
    state.team='all';
    state.assignee='all';
    if(byId('tasksSearch'))byId('tasksSearch').value='';
    if(byId('tasksStatusFilter'))byId('tasksStatusFilter').value='all';
    if(byId('tasksPriorityFilter'))byId('tasksPriorityFilter').value='all';
    if(byId('tasksTeamFilter'))byId('tasksTeamFilter').value='all';
    if(byId('tasksAssigneeFilter'))byId('tasksAssigneeFilter').value='all';
    render();
  }

  async function handleClick(event) {
    const target=event.target instanceof Element?event.target:null;
    if(!target)return;
    if(target.closest('[data-task-modal-close]')) {
      closeModal();
      return;
    }
    if(target===byId('tasksModal')) {
      closeModal();
      return;
    }
    const filter=target.closest('[data-task-filter]');
    if(filter) {
      state.activeFilter=filter.dataset.taskFilter;
      state.status='all';
      if(byId('tasksStatusFilter'))byId('tasksStatusFilter').value='all';
      render();
      return;
    }
    const transitionButton=target.closest('[data-task-transition]');
    if(transitionButton) {
      const id=transitionButton.dataset.id;
      const status=transitionButton.dataset.taskTransition;
      if(['blocked','cancelled'].includes(status))openReason(id,status);
      else await runModalAction(`transition:${status}`,()=>transition(id,status),'No se pudo cambiar el estado. Intenta nuevamente.');
      return;
    }
    const action=target.closest('[data-task-action]');
    if(action) {
      event.stopPropagation();
      const type=action.dataset.taskAction;
      const id=action.dataset.id;
      if(type==='refresh')return load();
      if(type==='clear')return resetFilters();
      if(type==='create')return openCreate();
      if(type==='open')return openDetail(id);
      if(type==='edit-detail')return openEdit(id);
      if(type==='dependencies')return openDependencies(id);
    }
    const row=target.closest('[data-task-open]');
    if(row)return openDetail(row.dataset.taskOpen);
  }

  function bindFilters() {
    byId('tasksSearch')?.addEventListener('input',event=>{state.query=event.currentTarget.value;render();});
    byId('tasksStatusFilter')?.addEventListener('change',event=>{state.activeFilter='all';state.status=event.currentTarget.value;render();});
    byId('tasksPriorityFilter')?.addEventListener('change',event=>{state.priority=event.currentTarget.value;render();});
    byId('tasksTeamFilter')?.addEventListener('change',event=>{state.team=event.currentTarget.value;render();});
    byId('tasksAssigneeFilter')?.addEventListener('change',event=>{state.assignee=event.currentTarget.value;render();});
  }

  function renderBase() {
    const section=byId('tasksSection');
    if(!section)return;
    section.dataset.tasksOwner = 'tasks-workspace.js';
    section.innerHTML=shellMarkup();
    section.addEventListener('click',handleClick);
    bindFilters();
    document.addEventListener('keydown',handleDocumentKeydown);
    render();
  }

  async function mount() {
    if(!ensureSurface())return;
    renderBase();
    await load();
    window.addEventListener('export-mca:section-changed',event=>{
      if(event.detail?.id==='tasksSection'&&!state.loaded)load();
    });
  }

  window.TasksWorkspace=Object.freeze({
    owner:OWNER,
    load,
    open:openDetail,
    visibleTasks,
    taskCounts,
    render,
    getState,
    state
  });

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
