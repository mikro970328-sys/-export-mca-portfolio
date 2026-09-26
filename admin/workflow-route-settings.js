(() => {
  'use strict';
  if(window.__workflowRouteSettingsInstalled)return;
  window.__workflowRouteSettingsInstalled=true;

  const state={routes:[],teams:[],users:[],memberships:[],loading:false,mutating:false,savingKey:null,drafts:new Map(),lastFocused:null};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const byId=id=>document.getElementById(id);
  const request=async(path,options={})=>{if(typeof window.api!=='function')throw new Error('API no disponible');return window.api(path,options);};
  const priorityLabel={low:'Baja',normal:'Normal',high:'Alta',critical:'Crítica'};
  function canManage(){return Boolean(window.ExportMcaAccessControl?.can?.('tasks.manage'));}
  function setMessage(message,ok=true){const node=byId('workflowRoutesMessage');if(!node)return;node.textContent=message||'';node.className=`workflow-routes-message ${message?(ok?'ok':'bad'):''}`;}
  function report(error,message,context){console.error('WORKFLOW_ROUTE_SETTINGS_UI_FAILED',{context,error});setMessage(message,false);}
  function setBusy(){
    const modal=byId('workflowRoutesModal');if(!modal)return;
    modal.setAttribute('aria-busy',state.loading||state.mutating?'true':'false');
    modal.querySelectorAll('button').forEach(button=>button.disabled=button.hasAttribute('data-workflow-routes-close')?state.mutating:state.loading||state.mutating);
    modal.querySelectorAll('[data-workflow-route-form]').forEach(form=>form.querySelectorAll('input,select').forEach(input=>input.disabled=state.savingKey===form.dataset.workflowRouteForm));
  }
  function ensureButton(){
    if(!canManage())return false;
    const actions=document.querySelector('#tasksSection .tasks-head-actions');if(!actions)return false;
    if(!actions.querySelector('[data-workflow-routes-open]')){
      const button=document.createElement('button');button.type='button';button.className='alt';button.dataset.workflowRoutesOpen='true';button.textContent='Asignaciones automáticas';button.addEventListener('click',openSettings);actions.appendChild(button);
    }
    return true;
  }
  function ensureModal(){
    if(byId('workflowRoutesModal'))return;
    const modal=document.createElement('div');modal.id='workflowRoutesModal';modal.className='workflow-routes-modal hidden';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','workflowRoutesTitle');
    modal.innerHTML='<div class="workflow-routes-panel"><div class="workflow-routes-head"><div><span class="workflow-routes-kicker">Export MCA</span><h3 id="workflowRoutesTitle">Configurar asignaciones automáticas</h3><p>Define el equipo, responsable, prioridad y plazo de cada trabajo automático. Dejar equipo y responsable vacíos mantiene la tarea sin asignar para supervisión.</p></div><button type="button" class="alt" data-workflow-routes-close>Cerrar</button></div><div class="workflow-routes-toolbar"><button type="button" class="alt" data-workflow-routes-refresh>Actualizar</button><button type="button" class="alt" data-workflow-reconcile>Sincronizar trabajo actual</button></div><div id="workflowRoutesMessage" class="workflow-routes-message" role="status" aria-live="polite"></div><div id="workflowRoutesBody" class="workflow-routes-body"></div></div>';
    document.body.appendChild(modal);modal.addEventListener('click',handleModalClick);
    document.addEventListener('keydown',event=>{
      if(modal.classList.contains('hidden'))return;
      if(event.key==='Escape'){event.preventDefault();close();return;}
      if(event.key!=='Tab')return;
      const controls=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(n=>n.getClientRects().length),first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    });
  }
  function eligibleUsers(teamId){if(!teamId)return state.users;const allowed=new Set(state.memberships.filter(row=>row.team_id===teamId).map(row=>row.admin_user_id));return state.users.filter(row=>allowed.has(row.id));}
  function options(rows,value,label,selected){return rows.map(row=>`<option value="${esc(row[value])}" ${String(row[value])===String(selected||'')?'selected':''}>${esc(label(row))}</option>`).join('');}
  function routeCard(record){
    const route={...record,...state.drafts.get(record.workflow_key)},users=eligibleUsers(route.assigned_team_id),id=name=>esc(`workflow_${route.workflow_key}_${name}`);
    return `<form class="workflow-route-card" data-workflow-route-form="${esc(route.workflow_key)}">
      <div class="workflow-route-title"><strong>${esc(route.label)}</strong><small>${esc(route.description||route.workflow_key)}</small></div><label class="workflow-route-switch"><input type="checkbox" name="enabled" ${route.enabled?'checked':''}><span>Activa</span></label>
      <div class="workflow-route-grid">
        <div><label for="${id('team')}">Equipo</label><select id="${id('team')}" name="assigned_team_id" data-route-team><option value="">Sin equipo</option>${options(state.teams,'id',row=>row.name,route.assigned_team_id)}</select></div>
        <div><label for="${id('assignee')}">Responsable</label><select id="${id('assignee')}" name="assigned_admin_id" data-route-assignee><option value="">Sin responsable</option>${options(users,'id',row=>row.full_name||row.username,route.assigned_admin_id)}</select></div>
        <div><label for="${id('priority')}">Prioridad</label><select id="${id('priority')}" name="default_priority">${Object.entries(priorityLabel).map(([value,label])=>`<option value="${value}" ${route.default_priority===value?'selected':''}>${label}</option>`).join('')}</select></div>
        <div><label for="${id('due')}">Vence en (horas)</label><input id="${id('due')}" type="number" min="1" max="8760" step="1" name="default_due_hours" value="${esc(route.default_due_hours??'')}" placeholder="Sin plazo"></div>
      </div>
      <div class="workflow-route-foot"><span>${route.active_task_count||0} tarea${Number(route.active_task_count)===1?'':'s'} activa${Number(route.active_task_count)===1?'':'s'}</span><button type="submit">Guardar</button></div>
    </form>`;
  }
  function capture(form){const data=new FormData(form);return {workflow_key:form.dataset.workflowRouteForm,enabled:data.get('enabled')==='on',default_priority:data.get('default_priority'),default_due_hours:data.get('default_due_hours')||null,assigned_team_id:data.get('assigned_team_id')||null,assigned_admin_id:data.get('assigned_admin_id')||null};}
  function render(){
    const body=byId('workflowRoutesBody');if(!body)return;const focus=document.activeElement,key=focus?.closest('[data-workflow-route-form]')?.dataset.workflowRouteForm,name=focus?.name,isSubmit=focus?.type==='submit';
    body.innerHTML=state.routes.length?state.routes.map(routeCard).join(''):'<div class="tasks-empty">No hay rutas configuradas.</div>';
    body.querySelectorAll('[data-workflow-route-form]').forEach(form=>{
      form.addEventListener('submit',saveRoute);const remember=()=>state.drafts.set(form.dataset.workflowRouteForm,capture(form));form.addEventListener('input',remember);form.addEventListener('change',remember);
      form.querySelector('[data-route-team]')?.addEventListener('change',()=>{refreshAssignee(form);remember();});
      if(key===form.dataset.workflowRouteForm)(isSubmit?form.querySelector('button[type=submit]'):form.elements.namedItem(name))?.focus({preventScroll:true});
    });setBusy();
  }
  function refreshAssignee(form){const team=form.querySelector('[data-route-team]')?.value||'',assignee=form.querySelector('[data-route-assignee]');if(!assignee)return;const current=assignee.value,users=eligibleUsers(team);assignee.innerHTML='<option value="">Sin responsable</option>'+options(users,'id',row=>row.full_name||row.username,current);if(current&&!users.some(row=>row.id===current))assignee.value='';}
  async function load({preserveMessage=false}={}){
    if(state.loading)return;state.loading=true;setBusy();if(!preserveMessage)setMessage('Cargando…');
    try{const result=await request('/api/workflow-routes');state.routes=result.routes||[];state.teams=result.teams||[];state.users=result.users||[];state.memberships=result.memberships||[];if(!preserveMessage)setMessage('');render();}
    catch(error){report(error,'No se pudo cargar la configuración. Usa Actualizar para intentarlo nuevamente.','load');}
    finally{state.loading=false;setBusy();}
  }
  async function openSettings(event){if(!canManage())return;ensureModal();state.lastFocused=event?.currentTarget||document.activeElement;byId('workflowRoutesModal').classList.remove('hidden');document.body.classList.add('workflow-routes-open');byId('workflowRoutesModal').querySelector('[data-workflow-routes-close]').focus();await load();}
  function close(){if(state.mutating)return;byId('workflowRoutesModal')?.classList.add('hidden');document.body.classList.remove('workflow-routes-open');(state.lastFocused?.isConnected?state.lastFocused:document.querySelector('[data-workflow-routes-open]'))?.focus();state.lastFocused=null;}
  async function saveRoute(event){
    event.preventDefault();if(state.mutating||state.loading||!canManage())return;const form=event.currentTarget;if(!form.reportValidity())return;const body=capture(form),key=body.workflow_key;state.drafts.set(key,body);state.mutating=true;state.savingKey=key;setBusy();setMessage('Guardando…');
    try{await request('/api/workflow-routes',{method:'PATCH',body:JSON.stringify(body)});state.drafts.delete(key);await load({preserveMessage:true});setMessage('Asignación automática actualizada.');if(window.TasksWorkspace?.load)await window.TasksWorkspace.load();ensureButton();}
    catch(error){report(error,'No se pudo guardar la asignación. Revisa el equipo y responsable e intenta nuevamente.','save');}
    finally{state.mutating=false;state.savingKey=null;setBusy();const current=[...byId('workflowRoutesBody').querySelectorAll('form')].find(f=>f.dataset.workflowRouteForm===key);current?.querySelector('button[type=submit]')?.focus({preventScroll:true});}
  }
  async function reconcile(){
    if(state.mutating||state.loading||!canManage())return;state.mutating=true;setBusy();setMessage('Sincronizando trabajo vigente…');
    try{await request('/api/workflow-routes',{method:'POST',body:JSON.stringify({action:'reconcile_current'})});await load({preserveMessage:true});setMessage('Trabajo vigente sincronizado.');if(window.TasksWorkspace?.load)await window.TasksWorkspace.load();ensureButton();}
    catch(error){report(error,'No se pudo sincronizar el trabajo. Intenta nuevamente.','reconcile');}
    finally{state.mutating=false;setBusy();byId('workflowRoutesModal').querySelector('[data-workflow-reconcile]')?.focus();}
  }
  function handleModalClick(event){const target=event.target instanceof Element?event.target:null;if(!target)return;if(target.closest('[data-workflow-routes-close]'))return close();if(target.closest('[data-workflow-routes-refresh]'))return load();if(target.closest('[data-workflow-reconcile]'))return reconcile();if(target===byId('workflowRoutesModal'))close();}
  function mount(){if(!canManage())return;ensureButton();window.addEventListener('export-mca:section-changed',event=>{if(event.detail?.id==='tasksSection')ensureButton();});window.addEventListener('export-mca:admin-ready',ensureButton);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
