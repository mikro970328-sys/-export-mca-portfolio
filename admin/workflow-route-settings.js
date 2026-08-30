(() => {
  'use strict';
  if(window.__workflowRouteSettingsInstalled)return;
  window.__workflowRouteSettingsInstalled=true;

  const state={routes:[],teams:[],users:[],memberships:[],loading:false};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const byId=id=>document.getElementById(id);
  const request=async(path,options={})=>{if(typeof window.api!=='function')throw new Error('API no disponible');return window.api(path,options);};
  const priorityLabel={low:'Baja',normal:'Normal',high:'Alta',critical:'Crítica'};

  function canManage(){return Boolean(window.ExportMcaAccessControl?.can?.('tasks.manage'));}
  function setMessage(message,ok=true){const node=byId('workflowRoutesMessage');if(!node)return;node.textContent=message||'';node.className=`workflow-routes-message ${message?(ok?'ok':'bad'):''}`;}

  function ensureButton(){
    if(!canManage())return false;
    const actions=document.querySelector('#tasksSection .tasks-head-actions');
    if(!actions)return false;
    if(!actions.querySelector('[data-workflow-routes-open]')){
      const button=document.createElement('button');
      button.type='button';button.className='alt';button.dataset.workflowRoutesOpen='true';button.textContent='Configurar handoffs';
      button.addEventListener('click',openSettings);actions.appendChild(button);
    }
    return true;
  }

  function ensureModal(){
    if(byId('workflowRoutesModal'))return;
    const modal=document.createElement('div');
    modal.id='workflowRoutesModal';modal.className='workflow-routes-modal hidden';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','workflowRoutesTitle');
    modal.innerHTML='<div class="workflow-routes-panel"><div class="workflow-routes-head"><div><h3 id="workflowRoutesTitle">Configurar handoffs</h3><p>Define a qué equipo o usuario llega cada trabajo automático. Dejar ambos vacíos mantiene la tarea sin asignar para supervisión.</p></div><button type="button" class="alt" data-workflow-routes-close>Cerrar</button></div><div class="workflow-routes-toolbar"><button type="button" class="alt" data-workflow-reconcile>Sincronizar trabajo actual</button><div id="workflowRoutesMessage" class="workflow-routes-message" aria-live="polite"></div></div><div id="workflowRoutesBody" class="workflow-routes-body"></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click',handleModalClick);
  }

  function eligibleUsers(teamId){
    if(!teamId)return state.users;
    const allowed=new Set(state.memberships.filter(row=>row.team_id===teamId).map(row=>row.admin_user_id));
    return state.users.filter(row=>allowed.has(row.id));
  }

  function options(rows,value,label,selected){return rows.map(row=>`<option value="${esc(row[value])}" ${String(row[value])===String(selected||'')?'selected':''}>${esc(label(row))}</option>`).join('');}

  function routeCard(route){
    const users=eligibleUsers(route.assigned_team_id);
    return `<form class="workflow-route-card" data-workflow-route-form="${esc(route.workflow_key)}">
      <div class="workflow-route-title"><div><strong>${esc(route.label)}</strong><small>${esc(route.description||route.workflow_key)}</small></div><label class="workflow-route-switch"><input type="checkbox" name="enabled" ${route.enabled?'checked':''}><span>Activa</span></label></div>
      <div class="workflow-route-grid">
        <div><label>Equipo</label><select name="assigned_team_id" data-route-team><option value="">Sin equipo</option>${options(state.teams,'id',row=>row.name,route.assigned_team_id)}</select></div>
        <div><label>Responsable</label><select name="assigned_admin_id" data-route-assignee><option value="">Sin responsable</option>${options(users,'id',row=>row.full_name||row.username,route.assigned_admin_id)}</select></div>
        <div><label>Prioridad</label><select name="default_priority">${Object.entries(priorityLabel).map(([value,label])=>`<option value="${value}" ${route.default_priority===value?'selected':''}>${label}</option>`).join('')}</select></div>
        <div><label>Vence en</label><div class="workflow-route-due"><input type="number" min="1" max="8760" step="1" name="default_due_hours" value="${esc(route.default_due_hours??'')}" placeholder="Sin plazo"><span>horas</span></div></div>
      </div>
      <div class="workflow-route-foot"><span>${route.active_task_count||0} tarea${Number(route.active_task_count)===1?'':'s'} activa${Number(route.active_task_count)===1?'':'s'}</span><button type="submit">Guardar</button></div>
    </form>`;
  }

  function render(){
    const body=byId('workflowRoutesBody');if(!body)return;
    body.innerHTML=state.routes.length?state.routes.map(routeCard).join(''):'<div class="tasks-empty">No hay rutas configuradas.</div>';
    body.querySelectorAll('[data-workflow-route-form]').forEach(form=>{
      form.addEventListener('submit',saveRoute);
      form.querySelector('[data-route-team]')?.addEventListener('change',()=>refreshAssignee(form));
    });
  }

  function refreshAssignee(form){
    const team=form.querySelector('[data-route-team]')?.value||'';
    const assignee=form.querySelector('[data-route-assignee]');if(!assignee)return;
    const current=assignee.value;
    const users=eligibleUsers(team);
    assignee.innerHTML='<option value="">Sin responsable</option>'+options(users,'id',row=>row.full_name||row.username,current);
    if(current&&!users.some(row=>row.id===current))assignee.value='';
  }

  async function load(){
    if(state.loading)return;state.loading=true;setMessage('Cargando...');
    try{const result=await request('/api/workflow-routes');state.routes=result.routes||[];state.teams=result.teams||[];state.users=result.users||[];state.memberships=result.memberships||[];setMessage('');render();}
    catch(error){setMessage(error.message||'No se pudo cargar la configuración.',false);}
    finally{state.loading=false;}
  }

  async function openSettings(){ensureModal();byId('workflowRoutesModal').classList.remove('hidden');await load();}
  function close(){byId('workflowRoutesModal')?.classList.add('hidden');}

  async function saveRoute(event){
    event.preventDefault();const form=event.currentTarget;const data=new FormData(form);const key=form.dataset.workflowRouteForm;
    setMessage('Guardando...');
    try{
      await request('/api/workflow-routes',{method:'PATCH',body:JSON.stringify({workflow_key:key,enabled:data.get('enabled')==='on',default_priority:data.get('default_priority'),default_due_hours:data.get('default_due_hours')||null,assigned_team_id:data.get('assigned_team_id')||null,assigned_admin_id:data.get('assigned_admin_id')||null})});
      setMessage('Handoff actualizado.',true);await load();if(window.TasksWorkspace?.load)await window.TasksWorkspace.load();ensureButton();
    }catch(error){setMessage(error.message||'No se pudo guardar.',false);}
  }

  async function reconcile(){
    setMessage('Sincronizando trabajo vigente...');
    try{await request('/api/workflow-routes',{method:'POST',body:JSON.stringify({action:'reconcile_current'})});setMessage('Trabajo vigente sincronizado.',true);await load();if(window.TasksWorkspace?.load)await window.TasksWorkspace.load();ensureButton();}
    catch(error){setMessage(error.message||'No se pudo sincronizar.',false);}
  }

  function handleModalClick(event){
    const target=event.target instanceof Element?event.target:null;if(!target)return;
    if(target.closest('[data-workflow-routes-close]'))return close();
    if(target.closest('[data-workflow-reconcile]'))return reconcile();
    if(target===byId('workflowRoutesModal'))close();
  }

  function mount(){if(!canManage())return;ensureButton();window.addEventListener('export-mca:section-changed',event=>{if(event.detail?.id==='tasksSection')ensureButton();});window.addEventListener('export-mca:admin-ready',ensureButton);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
