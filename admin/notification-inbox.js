(() => {
  'use strict';
  if (window.__notificationInboxInstalled) return;
  window.__notificationInboxInstalled = true;

  const state = { items: [], counts: { total:0, unread:0, task:0, alert:0 }, preferences:null, view:'inbox', filter:'all', history:[], open:false, busy:false, message:'' };
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const canManage = () => window.ExportMcaAccessControl?.can?.('notifications.manage') === true;
  const labelType = value => ({task:'Tarea',alert:'Alerta',system:'Sistema'})[value] || value || 'Notificación';
  const labelStatus = value => ({pending:'Pendiente',in_progress:'En progreso',blocked:'Bloqueada',completed:'Completada',cancelled:'Cancelada',snoozed:'Pospuesta',resolved:'Resuelta',active:'Activa'})[value] || value || '-';
  const dateLabel = value => { const d=new Date(value||0); return Number.isNaN(d.getTime())?'-':d.toLocaleString('es-US',{dateStyle:'medium',timeStyle:'short'}); };
  const apiCall = (path, options={}) => typeof window.api === 'function' ? window.api(path,options) : Promise.reject(new Error('API no disponible'));

  function setMessage(message='', bad=false) {
    state.message=message;
    const node=$('notificationInboxMessage');
    if(node){ node.textContent=message; node.className=`notification-message ${bad?'bad':'ok'}`; }
  }

  function ensureShell() {
    const actions=document.querySelector('.topbar-actions');
    if(actions && !$('notificationInboxBell')) {
      const button=document.createElement('button');
      button.id='notificationInboxBell';
      button.type='button';
      button.className='notification-inbox-bell';
      button.setAttribute('aria-label','Abrir notificaciones');
      button.title='Notificaciones';
      button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span id="notificationInboxBadge" class="notification-inbox-badge" hidden>0</span>';
      button.addEventListener('click',()=>openPanel());
      actions.prepend(button);
    }
    if(!$('notificationInboxOverlay')) {
      const overlay=document.createElement('div');
      overlay.id='notificationInboxOverlay';
      overlay.className='notification-inbox-overlay';
      overlay.hidden=true;
      overlay.innerHTML='<div class="notification-inbox-panel" role="dialog" aria-modal="true" aria-labelledby="notificationInboxTitle"><div id="notificationInboxBody"></div></div>';
      overlay.addEventListener('click',event=>{ if(event.target===overlay) closePanel(); });
      document.body.appendChild(overlay);
    }
  }

  function renderBadge() {
    const badge=$('notificationInboxBadge');
    if(!badge)return;
    const count=Number(state.counts?.unread||0);
    badge.textContent=count>99?'99+':String(count);
    badge.hidden=count===0;
  }

  function filteredItems() {
    if(state.filter==='unread') return state.items.filter(item=>item.is_unread===true);
    if(state.filter==='task') return state.items.filter(item=>item.source_type==='task');
    if(state.filter==='alert') return state.items.filter(item=>item.source_type==='alert');
    return state.items;
  }

  function renderItem(item) {
    const payload=item.action_payload||{};
    const sourceOpen=item.source_active!==false;
    return `<article class="notification-item ${item.is_unread?'is-unread':''}">
      <span class="notification-severity ${esc(item.severity)}"></span>
      <div>
        <div class="notification-item-title">${esc(item.title)}</div>
        <div class="notification-item-meta"><span class="notification-chip">${esc(labelType(item.source_type))}</span><span class="notification-chip ${sourceOpen?'active':'closed'}">${esc(labelStatus(item.source_status))}</span>${item.escalation_level?'<span class="notification-chip">Escalación</span>':''}<span>${esc(dateLabel(item.created_at))}</span></div>
        ${item.message?`<div class="notification-item-message">${esc(item.message)}</div>`:''}
      </div>
      <div class="notification-item-actions">
        ${(payload.task_id||item.entity_id)?`<button type="button" class="alt" data-notification-open="${esc(item.id)}">Abrir trabajo</button>`:''}
        <button type="button" class="alt" data-notification-action="${item.is_unread?'mark_read':'mark_unread'}" data-notification-id="${esc(item.id)}">${item.is_unread?'Marcar leída':'Marcar no leída'}</button>
        <button type="button" class="alt" data-notification-action="dismiss" data-notification-id="${esc(item.id)}">Ocultar</button>
      </div>
    </article>`;
  }

  function renderInbox() {
    const list=filteredItems();
    return `<div class="notification-summary"><div class="notification-summary-item"><span>Sin leer</span><strong>${state.counts.unread||0}</strong></div><div class="notification-summary-item"><span>Total</span><strong>${state.counts.total||0}</strong></div><div class="notification-summary-item"><span>Tareas</span><strong>${state.counts.task||0}</strong></div><div class="notification-summary-item"><span>Alertas</span><strong>${state.counts.alert||0}</strong></div></div>
      <div class="notification-filters"><button class="notification-filter ${state.filter==='all'?'active':''}" data-notification-filter="all">Todas</button><button class="notification-filter ${state.filter==='unread'?'active':''}" data-notification-filter="unread">Sin leer</button><button class="notification-filter ${state.filter==='task'?'active':''}" data-notification-filter="task">Tareas</button><button class="notification-filter ${state.filter==='alert'?'active':''}" data-notification-filter="alert">Alertas</button></div>
      <div class="notification-list">${list.length?list.map(renderItem).join(''):'<div class="notification-empty">No hay notificaciones para este filtro.</div>'}</div>`;
  }

  function renderPreferences() {
    const p=state.preferences||{};
    const check=(key,label,help)=>`<label class="notification-pref"><input type="checkbox" data-notification-pref="${key}" ${p[key]!==false?'checked':''}><span><b>${label}</b><small>${help}</small></span></label>`;
    return `<div class="notification-preferences-grid">${check('in_app_enabled','Inbox dentro del ERP','Control maestro de notificaciones internas.')}${check('task_assignments_enabled','Asignaciones de tareas','Avisar cuando una tarea quede asignada a ti o a un equipo elegible.')}${check('operational_alerts_enabled','Alertas operativas','Recibir excepciones P9 que correspondan a tu trabajo.')}${check('escalations_enabled','Escalaciones','Recibir escalaciones cuando tengas responsabilidad de supervisión.')}</div><div class="notification-external-note">WhatsApp usa la integración Twilio existente, pero la entrega interna P10 no se activa hasta tener una plantilla específica aprobada. Email no se habilita sin definir primero un proveedor.</div><div class="notification-actions" style="margin-top:12px"><button id="saveNotificationPreferences" type="button">Guardar preferencias</button></div>`;
  }

  function renderHistory() {
    if(!state.history.length)return '<div class="notification-empty">No hay historial de mensajería.</div>';
    return `<div class="notification-history-table"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Destinatario</th><th>Estado</th><th>Error</th><th></th></tr></thead><tbody>${state.history.map(row=>{const status=String(row.normalized_status||row.status||row.delivery_status||'pending').toLowerCase();return `<tr><td>${esc(dateLabel(row.created_at))}</td><td>${esc(row.notification_type||row.event_type||row.event_status||'tracking')}</td><td>${esc(row.recipient||row.recipient_phone||row.clients?.phone||'-')}</td><td><span class="notification-history-status ${esc(status)}">${esc(status)}</span></td><td>${esc(row.error_message||'-')}</td><td>${canManage()&&['failed','undelivered','pending'].includes(status)?`<button type="button" class="alt" data-notification-retry="${esc(row.id)}">Reintentar</button>`:''}</td></tr>`;}).join('')}</tbody></table></div>`;
  }

  function render() {
    const target=$('notificationInboxBody'); if(!target)return;
    target.innerHTML=`<div class="notification-workspace"><div class="notification-head"><div><h2 id="notificationInboxTitle">Notificaciones</h2><p>Inbox personal. Las tareas son trabajo; las alertas son excepciones; aquí solo se entrega y registra lectura.</p></div><div class="notification-actions"><button id="notificationMarkAllRead" class="alt" type="button">Marcar todo leído</button><button id="notificationRefresh" class="alt" type="button">Actualizar</button><button id="notificationClose" class="alt" type="button">Cerrar</button></div></div><div class="notification-tabs"><button class="notification-tab ${state.view==='inbox'?'active':''}" data-notification-view="inbox">Inbox</button><button class="notification-tab ${state.view==='history'?'active':''}" data-notification-view="history">Historial WhatsApp</button><button class="notification-tab ${state.view==='preferences'?'active':''}" data-notification-view="preferences">Preferencias</button><button class="notification-tab" id="openOperationalAlerts">Centro de alertas</button></div><div id="notificationInboxMessage" class="notification-message">${esc(state.message)}</div>${state.view==='inbox'?renderInbox():state.view==='history'?renderHistory():renderPreferences()}</div>`;
    $('notificationClose').onclick=closePanel;
    $('notificationRefresh').onclick=()=>refresh({history:state.view==='history'});
    $('notificationMarkAllRead').onclick=()=>actAllRead();
    $('openOperationalAlerts').onclick=()=>{closePanel(); if(typeof window.showSection==='function')window.showSection('notificationsSection'); window.loadOperationalAlertCenter?.();};
    target.querySelectorAll('[data-notification-view]').forEach(button=>button.onclick=async()=>{state.view=button.dataset.notificationView;if(state.view==='history'&&!state.history.length)await loadHistory();render();});
    target.querySelectorAll('[data-notification-filter]').forEach(button=>button.onclick=()=>{state.filter=button.dataset.notificationFilter;render();});
    target.querySelectorAll('[data-notification-action]').forEach(button=>button.onclick=()=>actItem(button.dataset.notificationId,button.dataset.notificationAction));
    target.querySelectorAll('[data-notification-open]').forEach(button=>button.onclick=()=>openWork(button.dataset.notificationOpen));
    target.querySelectorAll('[data-notification-retry]').forEach(button=>button.onclick=()=>retryHistory(button.dataset.notificationRetry));
    if($('saveNotificationPreferences'))$('saveNotificationPreferences').onclick=savePreferences;
  }

  async function loadHistory() {
    try { const result=await apiCall('/api/history?mode=notifications&scope=message'); state.history=result.notifications||[]; }
    catch(error){ setMessage(error.message||'No se pudo cargar el historial.',true); }
  }

  async function refresh({history=false}={}) {
    if(state.busy)return; state.busy=true;
    try {
      const result=await apiCall('/api/notification-inbox');
      state.items=result.items||[]; state.counts=result.counts||state.counts; state.preferences=result.preferences||state.preferences; setMessage(''); renderBadge();
      if(history)await loadHistory();
      if(state.open)render();
    } catch(error) { setMessage(error.message||'No se pudieron cargar las notificaciones.',true); if(state.open)render(); }
    finally { state.busy=false; }
  }

  async function actItem(id,action) {
    try { await apiCall('/api/notification-inbox',{method:'PATCH',body:JSON.stringify({id,action})}); await refresh(); }
    catch(error){setMessage(error.message||'No se pudo actualizar la notificación.',true);render();}
  }

  async function actAllRead() {
    try { await apiCall('/api/notification-inbox',{method:'PATCH',body:JSON.stringify({action:'mark_all_read'})}); await refresh(); }
    catch(error){setMessage(error.message||'No se pudo actualizar el inbox.',true);render();}
  }

  async function retryHistory(id) {
    try { const result=await apiCall('/api/history?mode=notifications',{method:'PATCH',body:JSON.stringify({id,action:'retry'})}); setMessage(`Reintento enviado: ${result.status||'queued'}`); await loadHistory(); render(); }
    catch(error){setMessage(error.message||'No se pudo reintentar el mensaje.',true);render();}
  }

  async function savePreferences() {
    const body={action:'preferences'};
    document.querySelectorAll('[data-notification-pref]').forEach(input=>{body[input.dataset.notificationPref]=input.checked;});
    body.whatsapp_enabled=false; body.email_enabled=false;
    try { const result=await apiCall('/api/notification-inbox',{method:'PATCH',body:JSON.stringify(body)}); state.preferences=result.preferences||state.preferences; setMessage('Preferencias guardadas.'); render(); }
    catch(error){setMessage(error.message||'No se pudieron guardar las preferencias.',true);render();}
  }

  async function openWork(id) {
    const item=state.items.find(row=>String(row.id)===String(id)); if(!item)return;
    try {
      if(item.is_unread)await apiCall('/api/notification-inbox',{method:'PATCH',body:JSON.stringify({id:item.id,action:'mark_read'})});
      closePanel();
      const payload=item.action_payload||{};
      if(payload.task_id && window.TasksWorkspace?.open){ if(typeof window.showSection==='function')window.showSection('tasksSection'); await window.TasksWorkspace.open(payload.task_id); return; }
      if(item.entity_type==='operational_task' && item.entity_id && window.TasksWorkspace?.open){ if(typeof window.showSection==='function')window.showSection('tasksSection'); await window.TasksWorkspace.open(item.entity_id); return; }
      if(item.entity_type && item.entity_id && window.OperationalNavigation?.openEntity){ const opened=await window.OperationalNavigation.openEntity({type:item.entity_type,id:item.entity_id}); if(opened!==false)return; }
      throw new Error('No hay un destino operativo disponible para esta notificación.');
    } catch(error){ state.open=true; ensureShell(); $('notificationInboxOverlay').hidden=false; setMessage(error.message||'No se pudo abrir el trabajo.',true); await refresh(); }
  }

  async function openPanel() { ensureShell(); state.open=true; $('notificationInboxOverlay').hidden=false; document.body.classList.add('notification-inbox-open'); render(); await refresh(); }
  function closePanel() { state.open=false; $('notificationInboxOverlay').hidden=true; document.body.classList.remove('notification-inbox-open'); }

  function install() {
    ensureShell();
    refresh().catch(()=>{});
    window.addEventListener('export-mca:data-loaded',()=>refresh().catch(()=>{}));
    window.addEventListener('focus',()=>refresh().catch(()=>{}));
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.open)closePanel();});
    window.NotificationInbox=Object.freeze({open:openPanel,refresh,close:closePanel,getState:()=>({...state}),owner:'notification-inbox.js'});
    return true;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();
