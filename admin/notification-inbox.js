(() => {
  'use strict';
  if (window.__notificationInboxInstalled) return;
  window.__notificationInboxInstalled = true;

  const state = {
    items: [], counts: { total:0, unread:0, task:0, alert:0 }, preferences:null,
    view:'inbox', filter:'all', history:[], open:false, busy:false, message:'', focusItem:null,
    push:{ loaded:false, config:{ready:false,public_key:null}, devices:[], permission:'unsupported', currentDeviceId:null, error:'' }
  };
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const canManage = () => window.ExportMcaAccessControl?.can?.('notifications.manage') === true;
  const labelType = value => ({task:'Tarea',alert:'Alerta',system:'Sistema'})[value] || value || 'Notificación';
  const labelStatus = value => ({pending:'Pendiente',in_progress:'En progreso',blocked:'Bloqueada',completed:'Completada',cancelled:'Cancelada',snoozed:'Pospuesta',resolved:'Resuelta',active:'Activa'})[value] || value || '-';
  const historyStatusLabels = Object.freeze({pending:'Pendiente',queued:'En cola',accepted:'Aceptado',sent:'Enviado',delivered:'Entregado',read:'Leído',failed:'Fallido',undelivered:'No entregado'});
  const historyTypeLabels = Object.freeze({welcome:'Bienvenida',registered:'Registro',release:'Liberación',delivered:'Entrega',tracking:'Seguimiento'});
  const inboxErrorMessages = Object.freeze({
    NOTIFICATION_NOT_FOUND:'La notificación ya no está disponible.',
    NOTIFICATION_ACTOR_INVALID:'No tienes permiso para modificar esta notificación.',
    NOTIFICATION_ACTION_INVALID:'La acción seleccionada no está disponible.',
    NOTIFICATION_PHONE_INVALID:'El número de WhatsApp no es válido.',
    NOTIFICATION_PHONE_REQUIRED:'Indica un número de WhatsApp para activar ese canal.',
    NOTIFICATION_EMAIL_INVALID:'El correo no es válido.',
    NOTIFICATION_EMAIL_REQUIRED:'Indica un correo para activar ese canal.',
    PUSH_VAPID_NOT_CONFIGURED:'Web Push todavía no está configurado en el servidor.',
    PUSH_ACTIVE_DEVICE_REQUIRED:'Activa al menos un dispositivo antes de habilitar Web Push.',
    PUSH_SUBSCRIPTION_NOT_FOUND:'El dispositivo ya no está activo.',
    PUSH_SUBSCRIPTION_EXPIRED:'La suscripción del navegador expiró. Actívala nuevamente.',
    NOTIFICATION_DESTINATION_UNAVAILABLE:'Esta notificación no tiene un destino operativo disponible.'
  });
  const safeInboxErrors = new Set([
    'Identificador de notificación no válido',
    'Notificación no encontrada',
    'La cuenta actual no puede modificar notificaciones',
    'Acción de notificación no válida',
    'El número de WhatsApp no es válido',
    'Indica un número de WhatsApp para activar ese canal',
    'El correo no es válido',
    'Indica un correo para activar ese canal',
    'Las notificaciones push todavía no están configuradas',
    'Activa al menos un dispositivo antes de habilitar Web Push',
    'El dispositivo ya no está activo',
    'Falta el identificador de la notificación',
    'Acción no válida',
    'Las alertas operativas no se reenvían por WhatsApp',
    'La notificación no tiene destinatario',
    'No se pudo reenviar la notificación'
  ]);
  const dateLabel = value => { const d=new Date(value||0); return Number.isNaN(d.getTime())?'-':d.toLocaleString('es-US',{dateStyle:'medium',timeStyle:'short'}); };
  const apiCall = (path, options={}) => typeof window.api === 'function' ? window.api(path,options) : Promise.reject(new Error('API no disponible'));
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const standaloneMode = () => window.matchMedia?.('(display-mode: standalone)')?.matches === true || navigator.standalone === true;
  const isAppleMobile = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);

  function urlBase64ToBytes(value) {
    const padding='='.repeat((4-value.length%4)%4);
    const base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/');
    const raw=atob(base64);
    return Uint8Array.from([...raw].map(character=>character.charCodeAt(0)));
  }

  function subscriptionApplicationKey(subscription) {
    const buffer=subscription?.options?.applicationServerKey;
    if(!buffer)return null;
    let binary='';
    new Uint8Array(buffer).forEach(byte=>{binary+=String.fromCharCode(byte);});
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }

  function deviceLabel() {
    const platform=navigator.userAgentData?.platform||navigator.platform||'Dispositivo';
    const browser=/Edg\//.test(navigator.userAgent)?'Edge':/CriOS|Chrome\//.test(navigator.userAgent)?'Chrome':/Firefox\//.test(navigator.userAgent)?'Firefox':/Safari\//.test(navigator.userAgent)?'Safari':'Navegador';
    return `${platform} · ${browser}`.slice(0,80);
  }

  function safeInboxMessage(error,fallback='No se pudo completar la operación. Intenta nuevamente.',context='operation') {
    const raw=String(error?.message||'').trim();
    const publicMessage=raw.split(' · ')[0].trim();
    const code=String(error?.code||raw.match(/NOTIFICATION_[A-Z0-9_]+/)?.[0]||'').trim();
    const status=Number(error?.status||0);
    if(inboxErrorMessages[code])return inboxErrorMessages[code];
    if(status===401)return 'Tu sesión terminó. Inicia sesión nuevamente para continuar.';
    if(status===403)return 'No tienes permiso para completar esta acción.';
    if([400,404,409,422].includes(status)&&safeInboxErrors.has(publicMessage))return publicMessage;
    if(status===400&&publicMessage.startsWith('Falta configurar la plantilla para '))return 'Falta configurar la plantilla de este tipo de mensaje.';
    console.error('NOTIFICATION_INBOX_UI_FAILED',{context,status:status||null,code:code||null,error});
    return fallback;
  }

  function historyStatus(row) {
    const value=String(row.normalized_status||row.status||row.delivery_status||'pending').toLowerCase();
    return Object.prototype.hasOwnProperty.call(historyStatusLabels,value)?value:'recorded';
  }

  function historyDetail(row,status) {
    if(['failed','undelivered'].includes(status)||Boolean(row.error_message))return 'No se pudo entregar. Puedes reintentar el mensaje.';
    if(['pending','queued','accepted'].includes(status))return 'Entrega pendiente.';
    if(['sent','delivered','read'].includes(status))return 'Entrega confirmada.';
    return 'Comunicación registrada.';
  }

  function removeLegacyAlertBell() {
    $('operationalAlertBellWrap')?.remove();
    $('operationalAlertPopover')?.remove();
  }

  function setMessage(message='', bad=false) {
    state.message=message;
    const node=$('notificationInboxMessage');
    if(node){ node.textContent=message; node.className=`notification-message ${bad?'bad':'ok'}`; }
  }

  function ensureShell() {
    removeLegacyAlertBell();
    const actions=document.querySelector('.topbar-actions');
    if(actions && !$('notificationInboxBell')) {
      const button=document.createElement('button');
      button.id='notificationInboxBell';
      button.type='button';
      button.className='notification-inbox-bell';
      button.setAttribute('aria-label','Abrir notificaciones');
      button.title='Notificaciones';
      button.innerHTML='<span id="notificationInboxBadge" class="notification-inbox-badge" hidden>0</span>';
      button.addEventListener('click',()=>openPanel());
      actions.prepend(button);
      window.ExportMcaIcons?.hydrate?.(button);
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
    if('serviceWorker' in navigator){
      navigator.serviceWorker.ready.then(registration=>registration.active?.postMessage?.({type:'EXPORT_MCA_BADGE',count})).catch(()=>{});
    }
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
        ${(payload.task_id||item.entity_id||item.action_key==='open_alerts')?`<button type="button" class="alt" data-notification-open="${esc(item.id)}">Abrir</button>`:''}
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
    const activeDevices=state.push.devices.filter(device=>device.status==='active'&&device.session_valid===true);
    const check=(key,label,help,{disabled=false}={})=>`<label class="notification-pref ${disabled?'is-disabled':''}"><input type="checkbox" data-notification-pref="${key}" ${p[key]!==false?'checked':''} ${disabled?'disabled':''}><span><b>${label}</b><small>${help}</small></span></label>`;
    return `<div class="notification-preferences-grid">${check('in_app_enabled','Inbox dentro del ERP','Control maestro de notificaciones internas.')}${check('task_assignments_enabled','Asignaciones y vencimientos','Avisar por asignación, proximidad del vencimiento y excepciones relacionadas.')}${check('operational_alerts_enabled','Alertas operativas','Recibir excepciones P9 que correspondan a tu trabajo.')}${check('escalations_enabled','Escalaciones','Recibir escalaciones cuando tengas responsabilidad de supervisión.')}${check('tracking_updates_enabled','Cambios de tracking','Avisar cuando cambie el hito operativo de un contenedor.')}${check('document_updates_enabled','Documentos disponibles','Avisar cuando haya un documento nuevo autorizado.')}${check('integration_failures_enabled','Fallos de integraciones','Avisar a responsables cuando una entrega o webhook requiera revisión.')}${check('push_enabled','Entrega Web Push',activeDevices.length?'Enviar estas categorías a los dispositivos activos.':'Primero activa este dispositivo.',{disabled:activeDevices.length===0})}</div>${renderPushDevices()}<div class="notification-external-note">El aviso de pantalla bloqueada nunca incluye clientes, contenedores, documentos ni errores técnicos. El detalle se resuelve dentro del ERP después de autenticarte.</div><div class="notification-actions notification-preferences-actions"><button id="saveNotificationPreferences" type="button">Guardar preferencias</button></div>`;
  }

  function pushAvailability() {
    if(!pushSupported())return{tone:'bad',text:'Este navegador no admite Web Push.'};
    if(isAppleMobile()&&!standaloneMode())return{tone:'warn',text:'En iPhone o iPad, añade el ERP a la pantalla de inicio y ábrelo desde su icono.'};
    if(!state.push.config.ready)return{tone:'warn',text:'El servidor todavía no tiene configuradas las claves Web Push.'};
    if(state.push.permission==='denied')return{tone:'bad',text:'Las notificaciones están bloqueadas en los ajustes del navegador.'};
    if(state.push.permission==='granted')return{tone:'ok',text:'El navegador tiene permiso para mostrar avisos.'};
    return{tone:'neutral',text:'La activación requiere una pulsación explícita y permiso del navegador.'};
  }

  function renderPushDevices() {
    const availability=pushAvailability();
    const currentId=state.push.currentDeviceId;
    const devices=state.push.devices;
    const canActivate=pushSupported()&&state.push.config.ready&&state.push.permission!=='denied'&&(!isAppleMobile()||standaloneMode());
    return `<section class="push-device-card" aria-labelledby="pushDeviceTitle"><div class="push-device-head"><div><h3 id="pushDeviceTitle">Dispositivos Web Push</h3><p class="push-availability ${availability.tone}">${esc(availability.text)}</p></div><button id="enablePushDevice" type="button" ${canActivate?'':'disabled'}>${currentId?'Reactivar este dispositivo':'Activar notificaciones'}</button></div><div class="push-device-list">${devices.length?devices.map(device=>`<article class="push-device ${device.status==='active'&&device.session_valid?'is-active':''}"><div><b>${esc(device.device_label)}</b>${String(device.id)===String(currentId)?'<span class="notification-chip active">Este dispositivo</span>':''}<small>${device.status==='active'&&device.session_valid?'Activo':device.status==='expired'?'Expirado':'Desactivado'} · Última actividad ${esc(dateLabel(device.last_seen_at))}</small></div>${device.status==='active'&&device.session_valid?`<button type="button" class="alt" data-push-deactivate="${esc(device.id)}">Desactivar</button>`:''}</article>`).join(''):'<div class="notification-empty">No hay dispositivos registrados.</div>'}</div></section>`;
  }

  function renderHistory() {
    if(!state.history.length)return '<div class="notification-empty">No hay historial de mensajería.</div>';
    return `<div class="notification-history-table"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Destinatario</th><th>Estado</th><th>Detalle</th><th></th></tr></thead><tbody>${state.history.map(row=>{const status=historyStatus(row);return `<tr><td>${esc(dateLabel(row.created_at))}</td><td>${esc(historyTypeLabels[row.notification_type||row.event_type||row.event_status]||'Notificación')}</td><td>${esc(row.recipient||row.recipient_phone||row.clients?.phone||'-')}</td><td><span class="notification-history-status ${esc(status)}">${esc(historyStatusLabels[status]||'Registrado')}</span></td><td>${esc(historyDetail(row,status))}</td><td>${canManage()&&['failed','undelivered','pending'].includes(status)?`<button type="button" class="alt" data-notification-retry="${esc(row.id)}">Reintentar</button>`:''}</td></tr>`;}).join('')}</tbody></table></div>`;
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
    target.querySelectorAll('[data-push-deactivate]').forEach(button=>button.onclick=()=>deactivatePushDevice(button.dataset.pushDeactivate));
    if($('enablePushDevice'))$('enablePushDevice').onclick=enablePushDevice;
    if($('saveNotificationPreferences'))$('saveNotificationPreferences').onclick=savePreferences;
  }

  async function serviceWorkerRegistration() {
    if(!pushSupported())return null;
    return navigator.serviceWorker.ready;
  }

  async function loadPushState() {
    state.push.permission=pushSupported()?Notification.permission:'unsupported';
    try {
      const result=await apiCall('/api/push-subscriptions');
      state.push.config=result.config||{ready:false,public_key:null};
      state.push.devices=Array.isArray(result.devices)?result.devices:[];
      state.push.currentDeviceId=localStorage.getItem('export_mca_push_subscription_id')||null;
      if(state.push.currentDeviceId&&!state.push.devices.some(device=>String(device.id)===String(state.push.currentDeviceId)&&device.status==='active'&&device.session_valid===true)){
        localStorage.removeItem('export_mca_push_subscription_id');
        state.push.currentDeviceId=null;
      }
      state.push.error='';
    } catch(error) {
      state.push.error=safeInboxMessage(error,'No se pudieron consultar los dispositivos Web Push.','load_push_state');
    } finally {
      state.push.loaded=true;
    }
  }

  async function enablePushDevice() {
    if(!pushSupported())return setMessage('Este navegador no admite Web Push.',true);
    if(isAppleMobile()&&!standaloneMode())return setMessage('Añade el ERP a la pantalla de inicio y ábrelo desde su icono para activar notificaciones.',true);
    if(!state.push.config.ready||!state.push.config.public_key)return setMessage('Web Push todavía no está configurado en el servidor.',true);
    let newlyCreated=null;
    let registered=false;
    try {
      const permission=await Notification.requestPermission();
      state.push.permission=permission;
      if(permission!=='granted'){
        setMessage(permission==='denied'?'Las notificaciones quedaron bloqueadas en el navegador.':'No se concedió permiso para notificaciones.',true);
        return render();
      }
      const registration=await serviceWorkerRegistration();
      let subscription=await registration.pushManager.getSubscription();
      if(subscription&&subscriptionApplicationKey(subscription)!==state.push.config.public_key){
        try{await apiCall('/api/push-subscriptions',{method:'DELETE',body:JSON.stringify({endpoint:subscription.endpoint,reason:'key_rotated'})});}catch(error){if(Number(error?.status)!==404)throw error;}
        await subscription.unsubscribe();
        subscription=null;
      }
      if(!subscription){
        subscription=await registration.pushManager.subscribe({
          userVisibleOnly:true,
          applicationServerKey:urlBase64ToBytes(state.push.config.public_key)
        });
        newlyCreated=subscription;
      }
      const result=await apiCall('/api/push-subscriptions',{
        method:'POST',
        body:JSON.stringify({subscription:subscription.toJSON(),device_label:deviceLabel()})
      });
      registered=true;
      const id=result.subscription?.subscription_id;
      if(id)localStorage.setItem('export_mca_push_subscription_id',id);
      state.preferences={...(state.preferences||{}),push_enabled:true};
      await loadPushState();
      setMessage('Notificaciones activadas en este dispositivo.');
      render();
    } catch(error) {
      if(newlyCreated&&!registered){try{await newlyCreated.unsubscribe();}catch{}}
      setMessage(safeInboxMessage(error,'No se pudo activar este dispositivo. Intenta nuevamente.','enable_push'),true);
      await loadPushState();
      render();
    }
  }

  async function deactivatePushDevice(id) {
    try {
      const current=String(id)===String(localStorage.getItem('export_mca_push_subscription_id')||'');
      const result=await apiCall('/api/push-subscriptions',{method:'PATCH',body:JSON.stringify({id})});
      state.push.devices=result.devices||state.push.devices;
      if(current){
        const registration=await serviceWorkerRegistration();
        await (await registration?.pushManager?.getSubscription?.())?.unsubscribe?.();
        localStorage.removeItem('export_mca_push_subscription_id');
        state.push.currentDeviceId=null;
      }
      if(!state.push.devices.some(device=>device.status==='active'&&device.session_valid===true))state.preferences={...(state.preferences||{}),push_enabled:false};
      setMessage('Dispositivo desactivado.');
      render();
    } catch(error) {
      setMessage(safeInboxMessage(error,'No se pudo desactivar el dispositivo.','deactivate_push'),true);
      render();
    }
  }

  async function loadHistory() {
    try { const result=await apiCall('/api/history?mode=notifications&scope=message'); state.history=result.notifications||[]; }
    catch(error){ setMessage(safeInboxMessage(error,'No se pudo cargar el historial. Intenta nuevamente.','load_history'),true); }
  }

  async function refresh({history=false,focusId=null}={}) {
    if(state.busy)return; state.busy=true;
    try {
      const query=focusId?`?notification_id=${encodeURIComponent(focusId)}`:'';
      const [result]=await Promise.all([apiCall(`/api/notification-inbox${query}`),loadPushState()]);
      state.items=result.items||[]; state.counts=result.counts||state.counts; state.preferences=result.preferences||state.preferences; state.focusItem=result.focus_item||null; setMessage(''); renderBadge();
      if(history)await loadHistory();
      if(state.open)render();
    } catch(error) { setMessage(safeInboxMessage(error,'No se pudieron cargar las notificaciones. Intenta nuevamente.','refresh'),true); if(state.open)render(); }
    finally { state.busy=false; }
  }

  async function actItem(id,action) {
    try { await apiCall('/api/notification-inbox',{method:'PATCH',body:JSON.stringify({id,action})}); await refresh(); }
    catch(error){setMessage(safeInboxMessage(error,'No se pudo actualizar la notificación. Intenta nuevamente.','item_action'),true);render();}
  }

  async function actAllRead() {
    try { await apiCall('/api/notification-inbox',{method:'PATCH',body:JSON.stringify({action:'mark_all_read'})}); await refresh(); }
    catch(error){setMessage(safeInboxMessage(error,'No se pudo actualizar el inbox. Intenta nuevamente.','mark_all_read'),true);render();}
  }

  async function retryHistory(id) {
    try { const result=await apiCall('/api/history?mode=notifications',{method:'PATCH',body:JSON.stringify({id,action:'retry'})}); const status=historyStatus({status:result.status});setMessage(`Reintento enviado · ${historyStatusLabels[status]||'En cola'}`); await loadHistory(); render(); }
    catch(error){setMessage(safeInboxMessage(error,'No se pudo reintentar el mensaje. Intenta nuevamente.','retry_history'),true);render();}
  }

  async function savePreferences() {
    const body={action:'preferences'};
    document.querySelectorAll('[data-notification-pref]').forEach(input=>{body[input.dataset.notificationPref]=input.checked;});
    body.whatsapp_enabled=false; body.email_enabled=false;
    try { const result=await apiCall('/api/notification-inbox',{method:'PATCH',body:JSON.stringify(body)}); state.preferences=result.preferences||state.preferences; setMessage('Preferencias guardadas.'); render(); }
    catch(error){setMessage(safeInboxMessage(error,'No se pudieron guardar las preferencias. Intenta nuevamente.','save_preferences'),true);render();}
  }

  async function openWork(id) {
    const item=state.items.find(row=>String(row.id)===String(id))||(String(state.focusItem?.id)===String(id)?state.focusItem:null); if(!item)return;
    try {
      if(item.is_unread)await apiCall('/api/notification-inbox',{method:'PATCH',body:JSON.stringify({id:item.id,action:'mark_read'})});
      if(item.action_key==='open_inbox'){await refresh();return;}
      closePanel();
      const payload=item.action_payload||{};
      if(item.action_key==='open_alerts'){if(typeof window.showSection==='function')window.showSection('notificationsSection');window.loadOperationalAlertCenter?.();return;}
      if(payload.task_id && window.TasksWorkspace?.open){ if(typeof window.showSection==='function')window.showSection('tasksSection'); await window.TasksWorkspace.open(payload.task_id); return; }
      if(item.entity_type==='operational_task' && item.entity_id && window.TasksWorkspace?.open){ if(typeof window.showSection==='function')window.showSection('tasksSection'); await window.TasksWorkspace.open(item.entity_id); return; }
      if(item.entity_type && item.entity_id && window.OperationalNavigation?.openEntity){ const opened=await window.OperationalNavigation.openEntity({type:item.entity_type,id:item.entity_id}); if(opened!==false)return; }
      const error=new Error('No hay un destino operativo disponible para esta notificación.');
      error.code='NOTIFICATION_DESTINATION_UNAVAILABLE';
      throw error;
    } catch(error){
      const message=safeInboxMessage(error,'No se pudo abrir el trabajo. Intenta nuevamente.','open_work');
      state.open=true; ensureShell(); $('notificationInboxOverlay').hidden=false;
      await refresh();
      setMessage(message,true);
      render();
    }
  }

  async function openPanel() { ensureShell(); state.open=true; $('notificationInboxOverlay').hidden=false; document.body.classList.add('notification-inbox-open'); render(); await refresh(); }
  function closePanel() { state.open=false; $('notificationInboxOverlay').hidden=true; document.body.classList.remove('notification-inbox-open'); }

  function deepLinkId() {
    const value=new URL(location.href).searchParams.get('notification')||'';
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value:null;
  }

  function clearDeepLink() {
    const url=new URL(location.href);
    url.searchParams.delete('notification');
    history.replaceState(history.state,'',`${url.pathname}${url.search}${url.hash}`);
  }

  async function openDeepLink(id) {
    ensureShell();
    state.open=true;
    $('notificationInboxOverlay').hidden=false;
    document.body.classList.add('notification-inbox-open');
    render();
    if(!state.focusItem){setMessage('La notificación no está disponible para esta cuenta.',true);render();clearDeepLink();return;}
    clearDeepLink();
    await openWork(id);
  }

  async function deactivatePushForLogout() {
    try {
      if(!pushSupported())return;
      const registration=await serviceWorkerRegistration();
      const subscription=await registration?.pushManager?.getSubscription?.();
      if(subscription){
        try{await apiCall('/api/push-subscriptions',{method:'DELETE',body:JSON.stringify({endpoint:subscription.endpoint})});}catch(error){if(Number(error?.status)!==401&&Number(error?.status)!==404)throw error;}
        await subscription.unsubscribe();
      }
      registration?.active?.postMessage?.({type:'EXPORT_MCA_BADGE_CLEAR'});
    } finally {
      localStorage.removeItem('export_mca_push_subscription_id');
    }
  }

  async function deactivatePushForInvalidSession() {
    try {
      if(!pushSupported())return;
      const registration=await serviceWorkerRegistration();
      await (await registration?.pushManager?.getSubscription?.())?.unsubscribe?.();
      registration?.active?.postMessage?.({type:'EXPORT_MCA_BADGE_CLEAR'});
    } finally {
      localStorage.removeItem('export_mca_push_subscription_id');
    }
  }

  function install() {
    removeLegacyAlertBell();
    ensureShell();
    const linked=deepLinkId();
    refresh({focusId:linked}).then(()=>{if(linked)openDeepLink(linked);}).catch(()=>{});
    window.addEventListener('export-mca:data-loaded',()=>refresh().catch(()=>{}));
    window.addEventListener('export-mca:modules-ready',()=>{removeLegacyAlertBell();ensureShell();});
    window.addEventListener('focus',()=>refresh().catch(()=>{}));
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.open)closePanel();});
    window.NotificationInbox=Object.freeze({
      open:openPanel,refresh,close:closePanel,deactivatePushForLogout,deactivatePushForInvalidSession,
      getState:()=>({...state}),owner:'notification-inbox.js'
    });
    return true;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();
