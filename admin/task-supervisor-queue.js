(() => {
  'use strict';
  if(window.__taskSupervisorQueueInstalled)return;
  window.__taskSupervisorQueueInstalled=true;

  const state={tasks:[],summary:null,groups:null,routes:[],loading:false,filter:'all'};
  const byId=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const request=async(path,options={})=>{if(typeof window.api!=='function')throw new Error('API no disponible');return window.api(path,options);};
  const canManage=()=>window.ExportMcaAccessControl?.can?.('tasks.manage')===true;
  const attentionLabel={blocked:'Bloqueada',overdue:'Vencida',unassigned:'Sin asignar',due_soon:'Por vencer',normal:'Normal',closed:'Cerrada'};
  const priorityLabel={critical:'Crítica',high:'Alta',normal:'Normal',low:'Baja'};

  function ensureButton(){
    if(!canManage())return false;
    const actions=document.querySelector('#tasksSection .tasks-head-actions');
    if(!actions)return false;
    if(!actions.querySelector('[data-task-supervisor-open]')){
      const button=document.createElement('button');
      button.type='button';button.className='alt';button.dataset.taskSupervisorOpen='true';button.textContent='Supervisión';
      button.addEventListener('click',open);actions.prepend(button);
    }
    return true;
  }

  function ensureModal(){
    if(byId('taskSupervisorModal'))return;
    const modal=document.createElement('div');
    modal.id='taskSupervisorModal';modal.className='task-supervisor-modal hidden';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','taskSupervisorTitle');
    modal.innerHTML='<div class="task-supervisor-panel"><div class="task-supervisor-head"><div><h3 id="taskSupervisorTitle">Supervisión de trabajo</h3><p>Atención derivada de tareas, SLA y routing. Esto no crea Alertas ni Notificaciones.</p></div><div style="display:flex;gap:8px"><button type="button" class="alt" data-task-supervisor-refresh>Actualizar</button><button type="button" class="alt" data-task-supervisor-close>Cerrar</button></div></div><div class="task-supervisor-body"><div id="taskSupervisorSummary" class="task-supervisor-summary"></div><div class="task-supervisor-toolbar"><input id="taskSupervisorSearch" class="task-supervisor-search" type="search" placeholder="Buscar tarea..."><select id="taskSupervisorWorkflow"><option value="all">Todos los workflows</option></select><select id="taskSupervisorPriority"><option value="all">Todas las prioridades</option><option value="critical">Crítica</option><option value="high">Alta</option><option value="normal">Normal</option><option value="low">Baja</option></select><select id="taskSupervisorRouting"><option value="all">Todo el routing</option><option value="attention">Requiere routing</option><option value="ok">Routing resuelto</option></select></div><div id="taskSupervisorMessage" class="task-supervisor-message" aria-live="polite"></div><div id="taskSupervisorTable" class="task-supervisor-table-wrap"></div><div class="task-supervisor-section"><h4>Salud de handoffs</h4><div id="taskSupervisorRoutes" class="task-route-health-grid"></div></div></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click',handleClick);
    byId('taskSupervisorSearch')?.addEventListener('input',renderTable);
    byId('taskSupervisorWorkflow')?.addEventListener('change',renderTable);
    byId('taskSupervisorPriority')?.addEventListener('change',renderTable);
    byId('taskSupervisorRouting')?.addEventListener('change',renderTable);
  }

  function setMessage(message,bad=false){const node=byId('taskSupervisorMessage');if(!node)return;node.textContent=message||'';node.className=`task-supervisor-message ${message&&bad?'bad':''}`;}
  function formatDate(value){if(!value)return 'Sin plazo';const d=new Date(value);return Number.isNaN(d.getTime())?'Sin plazo':d.toLocaleString('es-US',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
  function minuteText(value){const n=Number(value);if(!Number.isFinite(n))return '—';const abs=Math.abs(n);if(abs<60)return `${Math.round(abs)} min`;const hours=abs/60;if(hours<48)return `${hours.toFixed(hours<10?1:0)} h`;return `${(hours/24).toFixed(hours<72?1:0)} d`;}

  function renderSummary(){
    const summary=state.summary||{};
    const cards=[['unassigned','Sin asignar',summary.unassigned||0],['due_soon','Por vencer',summary.due_soon||0],['overdue','Vencidas',summary.overdue||0],['blocked','Bloqueadas',summary.blocked||0],['routing','Routing',summary.routing_attention||0],['all','Abiertas',summary.open||0]];
    const node=byId('taskSupervisorSummary');if(!node)return;
    node.innerHTML=cards.map(([key,label,count])=>`<button type="button" class="${state.filter===key?'active':''} ${['overdue','blocked','routing'].includes(key)&&count?'attention':''}" data-task-supervisor-filter="${key}"><span>${esc(label)}</span><b>${Number(count)||0}</b></button>`).join('');
  }

  function populateWorkflow(){
    const select=byId('taskSupervisorWorkflow');if(!select||select.options.length>1)return;
    const workflows=state.groups?.workflows||[];
    select.insertAdjacentHTML('beforeend',workflows.map(row=>`<option value="${esc(row.key)}">${esc(row.label)} (${Number(row.count)||0})</option>`).join(''));
  }

  function visibleRows(){
    const q=String(byId('taskSupervisorSearch')?.value||'').trim().toLowerCase();
    const workflow=byId('taskSupervisorWorkflow')?.value||'all';
    const priority=byId('taskSupervisorPriority')?.value||'all';
    const routing=byId('taskSupervisorRouting')?.value||'all';
    return state.tasks.filter(task=>{
      if(!task.is_open)return false;
      if(state.filter==='routing'&&!task.needs_routing_attention)return false;
      if(!['all','routing'].includes(state.filter)&&task.attention_state!==state.filter)return false;
      if(workflow!=='all'&&String(task.workflow_key||'manual')!==workflow)return false;
      if(priority!=='all'&&task.priority!==priority)return false;
      if(routing==='attention'&&!task.needs_routing_attention)return false;
      if(routing==='ok'&&task.needs_routing_attention)return false;
      if(q&&!`${task.title||''} ${task.description||''} ${task.assigned_team_name||''} ${task.assigned_admin_name||''} ${task.workflow_label||''}`.toLowerCase().includes(q))return false;
      return true;
    });
  }

  function renderTable(){
    const rows=visibleRows(),node=byId('taskSupervisorTable');if(!node)return;
    if(!rows.length){node.innerHTML='<div class="tasks-empty">No hay trabajo para este filtro.</div><div class="task-supervisor-footer">0 tareas</div>';return;}
    node.innerHTML=`<table class="task-supervisor-table"><thead><tr><th>Tarea</th><th>Atención</th><th>Prioridad</th><th>Responsable</th><th>SLA</th><th>Workflow</th></tr></thead><tbody>${rows.map(task=>`<tr data-supervisor-task="${esc(task.id)}"><td><div class="task-supervisor-title">${esc(task.title)}</div><div class="task-supervisor-sub">${esc(task.description||'')}${task.needs_routing_attention?'<br><span class="task-routing-badge">Requiere routing</span>':''}</div></td><td><span class="task-attention-badge ${esc(task.attention_state)}">${esc(attentionLabel[task.attention_state]||task.attention_state)}</span></td><td>${esc(priorityLabel[task.priority]||task.priority)}</td><td>${esc(task.assigned_admin_name||task.assigned_admin_username||task.assigned_team_name||'Sin asignar')}${task.assigned_admin_name&&task.assigned_team_name?`<div class="task-supervisor-sub">${esc(task.assigned_team_name)}</div>`:''}</td><td>${esc(formatDate(task.due_at))}<div class="task-supervisor-sub">${task.attention_state==='overdue'?`Vencida hace ${esc(minuteText(task.due_in_minutes))}`:task.due_in_minutes!==null?`Restan ${esc(minuteText(task.due_in_minutes))}`:'Sin SLA'}</div></td><td>${esc(task.workflow_label||task.workflow_key||'Manual')}</td></tr>`).join('')}</tbody></table><div class="task-supervisor-footer">${rows.length} de ${Number(state.summary?.open)||0} tareas abiertas</div>`;
  }

  function routeState(route){
    if(!route.assigned_team_id&&!route.assigned_admin_id)return ['Sin routing','warn'];
    if(route.routing_access_compatible===true)return ['Compatible','ok'];
    return ['Permisos incompatibles','bad'];
  }
  function renderRoutes(){
    const node=byId('taskSupervisorRoutes');if(!node)return;
    node.innerHTML=state.routes.length?state.routes.map(route=>{const [label,cls]=routeState(route),assigned=route.assigned_admin_name||route.assigned_admin_username||route.assigned_team_name||'Sin asignar',perms=(route.required_permissions||[]).join(' · ')||'Sin permisos requeridos';return `<div class="task-route-health-card"><strong>${esc(route.label)}</strong><small>${esc(assigned)}</small><small>Permisos: ${esc(perms)}</small>${route.assigned_team_id?`<small>Miembros elegibles: ${Number(route.team_eligible_member_count)||0} / ${Number(route.team_member_count)||0}</small>`:''}<span class="task-route-health-state ${cls}">${esc(label)}</span></div>`;}).join(''):'<div class="tasks-empty">No hay rutas de workflow.</div>';
  }

  function render(){renderSummary();populateWorkflow();renderTable();renderRoutes();}
  async function load(){
    if(state.loading)return;state.loading=true;setMessage('Cargando supervisión...');
    try{const result=await request('/api/task-supervisor-queue');state.tasks=result.tasks||[];state.summary=result.summary||{};state.groups=result.groups||{};state.routes=result.routes||[];setMessage('');render();}
    catch(error){setMessage(error.message||'No se pudo cargar la supervisión.',true);}
    finally{state.loading=false;}
  }
  async function open(){ensureModal();byId('taskSupervisorModal').classList.remove('hidden');await load();}
  function close(){byId('taskSupervisorModal')?.classList.add('hidden');}

  async function handleClick(event){
    const target=event.target instanceof Element?event.target:null;if(!target)return;
    if(target.closest('[data-task-supervisor-close]'))return close();
    if(target.closest('[data-task-supervisor-refresh]'))return load();
    const filter=target.closest('[data-task-supervisor-filter]');if(filter){state.filter=filter.dataset.taskSupervisorFilter;renderSummary();renderTable();return;}
    const row=target.closest('[data-supervisor-task]');if(row){const id=row.dataset.supervisorTask;close();try{await window.TasksWorkspace?.open?.(id);}catch(error){console.error('[task supervisor open]',error);}return;}
    if(target===byId('taskSupervisorModal'))close();
  }

  function mount(){if(!canManage())return;ensureButton();window.addEventListener('export-mca:section-changed',event=>{if(event.detail?.id==='tasksSection')ensureButton();});window.addEventListener('export-mca:admin-ready',ensureButton);}
  window.TaskSupervisorQueue=Object.freeze({open,load});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
