(() => {
  'use strict';

  if (window.__operationalAlertCenterInstalled) return;
  window.__operationalAlertCenterInstalled = true;

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[character]);

  const state = {
    operationalRows:[], messageRows:[], activeView:'operational', activeFilter:'active',
    messageFilter:'all', search:'', bellOpen:false, feedback:{message:'',bad:false},
    loading:false, loaded:false, loadError:false, lastUpdated:null, actionBusy:'', lastFocused:null
  };

  const messageStatuses = new Set(['pending','queued','accepted','sent','delivered','read','failed','undelivered']);
  const isOperational = row => row.notification_scope==='operational';
  const alertStatus = row => String(row.normalized_alert_status||row.alert_status||(row.resolved_at?'resolved':'pending')).toLowerCase();
  const messageStatus = row => {
    const value=String(row.normalized_status||row.status||row.delivery_status||'pending').toLowerCase();
    return messageStatuses.has(value)?value:'recorded';
  };
  const isActiveAlert = row => ['pending','snoozed'].includes(alertStatus(row));
  const unreadActive = row => isActiveAlert(row)&&!row.read_at;
  const severityLabel = value => ({critical:'Crítica',warning:'Advertencia',info:'Información'})[String(value||'').toLowerCase()]||'Advertencia';
  const statusLabel = value => ({
    pending:'Pendiente', snoozed:'Pospuesta', resolved:'Resuelta', failed:'Error', sent:'Enviada',
    queued:'En cola', delivered:'Entregada', read:'Leída', accepted:'Aceptada',
    undelivered:'No entregada', recorded:'Registrada'
  })[String(value||'').toLowerCase()]||'Pendiente';

  function typeLabel(row) {
    const type=String(row.notification_type||row.event_type||row.event_status||'').toLowerCase();
    if (/tracking_failed$/i.test(type)) return 'Error de tracking externo';
    return ({
      client_without_shipment:'Cliente sin contenedor',
      shipment_stale_tracking:'Tracking sin actualización',
      shipment_manual_tracking_stale:'Tracking manual sin actualización',
      shipment_discharged_not_released:'Descargado sin liberar',
      shipment_stagnant_status:'Contenedor sin avance',
      task_blocked:'Tarea bloqueada',
      task_overdue:'Tarea vencida',
      workflow_route_invalid:'Flujo de trabajo sin destino',
      shipment_customs_documents_missing:'Documentos Cuba pendientes',
      tracking_stale:'Tracking sin actualización',
      welcome:'Bienvenida', registered:'Contenedor registrado', release:'Liberación',
      delivered:'Entrega', tracking:'Tracking'
    })[type]||'Notificación';
  }

  function messageDeliveryDetail(row,status) {
    if (['failed','undelivered'].includes(status)||Boolean(row.error_message)) return 'No se pudo entregar. Puedes reintentar el mensaje.';
    if (['pending','queued','accepted'].includes(status)) return 'Entrega pendiente.';
    if (['sent','delivered','read'].includes(status)) return 'Entrega confirmada.';
    return 'Comunicación registrada.';
  }

  function dateLabel(value) {
    const date=new Date(value||0);
    return Number.isNaN(date.getTime())?'-':date.toLocaleString('es-US',{dateStyle:'medium',timeStyle:'short'});
  }

  function relativeTime(value) {
    const date=new Date(value||0);
    if (Number.isNaN(date.getTime())) return '-';
    const minutes=Math.max(0,Math.floor((Date.now()-date.getTime())/60000));
    if (minutes<60) return `hace ${minutes} min`;
    const hours=Math.floor(minutes/60);
    if (hours<24) return `hace ${hours} h`;
    const days=Math.floor(hours/24);
    return `hace ${days} día${days===1?'':'s'}`;
  }

  function entityName(row) {
    if (row.entity_type==='operational_task') return row.payload?.task_title||'Tarea operativa';
    if (row.event_type==='workflow_route_invalid') return row.payload?.workflow_label||'Flujo de trabajo';
    if (row.entity_type==='shipment'||row.shipment_id) return row.shipments?.container_number||row.payload?.container_number||'Contenedor';
    return row.clients?.name||row.payload?.client_name||'Cliente';
  }

  function sortAlerts(a,b) {
    const weight={critical:3,warning:2,info:1};
    const severityDifference=(weight[b.severity]||0)-(weight[a.severity]||0);
    return severityDifference||new Date(b.last_triggered_at||b.created_at||0)-new Date(a.last_triggered_at||a.created_at||0);
  }

  function normalizedSearch(value) {
    return String(value||'').trim().toLocaleLowerCase('es');
  }

  function rowMatchesSearch(row,search) {
    if (!search) return true;
    const content=[row.title,row.message,typeLabel(row),entityName(row),row.clients?.name,
      row.shipments?.container_number,row.payload?.message,row.payload?.client_name,
      row.payload?.container_number].filter(Boolean).join(' ').toLocaleLowerCase('es');
    return content.includes(search);
  }

  function visibleAlerts(rows=state.operationalRows,filter=state.activeFilter,search=state.search) {
    const term=normalizedSearch(search);
    return rows.filter(row => {
      const status=alertStatus(row);
      const allowed=filter==='active'?isActiveAlert(row)
        :filter==='critical'?isActiveAlert(row)&&row.severity==='critical'
        :filter==='pending'?status==='pending'
        :filter==='snoozed'?status==='snoozed'
        :filter==='resolved'?status==='resolved'
        :true;
      return allowed&&rowMatchesSearch(row,term);
    }).sort(sortAlerts);
  }

  function visibleMessages(rows=state.messageRows,filter=state.messageFilter,search=state.search) {
    const term=normalizedSearch(search);
    return rows.filter(row => {
      if (isOperational(row)) return false;
      const status=messageStatus(row);
      const allowed=filter==='issues'?['failed','undelivered'].includes(status)||Boolean(row.error_message)
        :filter==='pending'?['pending','queued','accepted'].includes(status)
        :filter==='delivered'?['sent','delivered','read'].includes(status)
        :true;
      return allowed&&rowMatchesSearch(row,term);
    }).sort((a,b) => new Date(b.created_at||0)-new Date(a.created_at||0));
  }

  function summaryMetrics(operationalRows=state.operationalRows,messageRows=state.messageRows) {
    const active=operationalRows.filter(isActiveAlert);
    const messages=messageRows.filter(row=>!isOperational(row));
    return {
      active:active.length,
      critical:active.filter(row=>String(row.severity||'').toLowerCase()==='critical').length,
      unread:active.filter(row=>!row.read_at).length,
      deliveryIssues:messages.filter(row=>['failed','undelivered'].includes(messageStatus(row))||Boolean(row.error_message)).length
    };
  }

  function publicState() {
    return {
      owner:'operational-alert-center.js', activeView:state.activeView, activeFilter:state.activeFilter,
      messageFilter:state.messageFilter, search:state.search, loading:state.loading, loaded:state.loaded,
      loadError:state.loadError, lastUpdated:state.lastUpdated, operationalCount:state.operationalRows.length,
      messageCount:state.messageRows.filter(row=>!isOperational(row)).length, ...summaryMetrics()
    };
  }

  function safeAlertMessage(error,fallback='No se pudo completar la operación. Intenta nuevamente.',context='operation') {
    const status=Number(error?.status||0)||null;
    console.error('OPERATIONAL_ALERT_CENTER_UI_FAILED',{context,status,error});
    return fallback;
  }

  function setFeedback(message='',bad=false) {
    state.feedback={message,bad};
    const node=$('operationalAlertFeedback');
    if (!node) return;
    node.textContent=message;
    node.className=`alert-center-feedback ${message?(bad?'bad':'ok'):''}`;
  }

  function operationalSummary() {
    const metrics=summaryMetrics();
    return `<div class="alert-summary-grid native-workspace-summary" aria-label="Resumen del centro de alertas">
      <article class="alert-summary active native-workspace-summary-card"><strong id="alertMetricActive">${metrics.active}</strong><span>Alertas activas</span></article>
      <article class="alert-summary critical native-workspace-summary-card"><strong id="alertMetricCritical">${metrics.critical}</strong><span>Críticas</span></article>
      <article class="alert-summary unread native-workspace-summary-card"><strong id="alertMetricUnread">${metrics.unread}</strong><span>Sin leer</span></article>
      <article class="alert-summary delivery native-workspace-summary-card"><strong id="alertMetricDelivery">${metrics.deliveryIssues}</strong><span>Incidencias de entrega</span></article>
    </div>`;
  }

  function heroMarkup() {
    const metrics=summaryMetrics();
    const stateLabel=state.loading?'Actualizando información'
      :state.loadError?'Actualización pendiente'
      :metrics.critical?`${metrics.critical} alerta${metrics.critical===1?'':'s'} crítica${metrics.critical===1?'':'s'}`
      :metrics.active?`${metrics.active} alerta${metrics.active===1?'':'s'} activa${metrics.active===1?'':'s'}`
      :'Operación sin excepciones activas';
    const updated=state.lastUpdated?`Actualizado ${dateLabel(state.lastUpdated)}`:'Preparando datos…';
    return `<header class="alert-center-hero native-workspace-hero">
      <div class="alert-center-heading native-workspace-heading">
        <span class="native-workspace-kicker">Control de excepciones</span>
        <h2>Centro de alertas</h2>
        <p>Alertas = excepciones. Tareas = trabajo. Mensajes = entrega al cliente.</p>
        <div class="alert-center-hero-state"><span class="alert-center-state-dot" aria-hidden="true"></span><span id="alertCenterOperationalState">${esc(stateLabel)}</span><span id="alertCenterLastUpdated">${esc(updated)}</span></div>
        <div id="operationalAlertFeedback" class="alert-center-feedback ${state.feedback.bad?'bad':state.feedback.message?'ok':''}" role="status" aria-live="polite">${esc(state.feedback.message)}</div>
      </div>
      ${operationalSummary()}
    </header>`;
  }

  function commandMarkup() {
    const placeholder=state.activeView==='operational'?'Buscar alerta, cliente o contenedor':'Buscar mensaje, cliente o contenedor';
    return `<section class="alert-center-command" aria-label="Vistas y búsqueda">
      <div class="notification-view-tabs" role="tablist" aria-label="Contenido del centro de alertas">
        <button type="button" class="alert-view-tab ${state.activeView==='operational'?'active':''}" data-alert-view="operational" role="tab" aria-selected="${state.activeView==='operational'}" aria-controls="alertCenterPanel">Alertas operativas</button>
        <button type="button" class="alert-view-tab ${state.activeView==='messages'?'active':''}" data-alert-view="messages" role="tab" aria-selected="${state.activeView==='messages'}" aria-controls="alertCenterPanel">Mensajes WhatsApp</button>
      </div>
      <label class="alert-center-search" for="alertCenterSearch"><span>Buscar</span><input id="alertCenterSearch" type="search" value="${esc(state.search)}" placeholder="${esc(placeholder)}" autocomplete="off"></label>
      <button type="button" id="reloadUnifiedNotifications" class="alert-center-refresh" ${state.loading?'disabled':''}>${state.loading?'Actualizando…':'Actualizar'}</button>
    </section>`;
  }

  function alertFilterMarkup() {
    return `<label class="alert-center-filter" for="operationalAlertFilter"><span>Estado</span><select id="operationalAlertFilter">
      <option value="active">Activas</option><option value="critical">Críticas</option>
      <option value="pending">Pendientes</option><option value="snoozed">Pospuestas</option>
      <option value="resolved">Resueltas</option><option value="all">Todas</option>
    </select></label>`;
  }

  function messageFilterMarkup() {
    return `<label class="alert-center-filter" for="messageDeliveryFilter"><span>Entrega</span><select id="messageDeliveryFilter">
      <option value="all">Todos los estados</option><option value="issues">Con incidencia</option>
      <option value="pending">Pendientes</option><option value="delivered">Confirmados</option>
    </select></label>`;
  }

  function alertCard(row) {
    const status=alertStatus(row);
    const active=isActiveAlert(row);
    const canOpen=row.entity_type==='shipment'||row.entity_type==='client'||row.entity_type==='operational_task'||row.shipment_id||row.client_id;
    const canReopen=!active&&row.condition_active===true;
    const busy=state.actionBusy===`alert:${row.id}`;
    return `<article class="operational-alert-card ${esc(row.severity||'warning')} ${status==='snoozed'?'snoozed':''}" data-alert-record="${esc(row.id)}">
      <div class="alert-severity-bar" aria-hidden="true"></div>
      <div class="alert-card-content">
        <div class="alert-card-eyebrow"><span>${esc(severityLabel(row.severity))}</span><span>${esc(relativeTime(row.last_triggered_at||row.created_at))}</span></div>
        <h4 class="alert-card-title">${!row.read_at?'<span class="alert-unread-dot" aria-label="Sin leer"></span>':''}${esc(row.title||typeLabel(row))}</h4>
        <p class="alert-card-message">${esc(row.message||row.payload?.message||typeLabel(row))}</p>
        <div class="alert-card-meta"><span class="alert-meta-chip status-${esc(status)}">${esc(statusLabel(status))}</span><span class="alert-meta-chip">${esc(entityName(row))}</span>${Number(row.condition_cycle_count||1)>1?`<span class="alert-meta-chip">${Number(row.condition_cycle_count)} ciclos</span>`:''}${Number(row.occurrence_count||1)>1?`<span class="alert-meta-chip">${Number(row.occurrence_count)} ocurrencias</span>`:''}</div>
      </div>
      <div class="alert-card-actions" aria-label="Acciones de la alerta">
        ${!row.read_at?`<button type="button" class="alert-secondary" data-alert-action="mark_read" data-alert-id="${esc(row.id)}" ${busy?'disabled':''}>Marcar leída</button>`:''}
        ${active?`<button type="button" class="alert-secondary" data-alert-action="snooze" data-alert-id="${esc(row.id)}" ${busy?'disabled':''}>Posponer</button><button type="button" class="alert-success" data-alert-action="resolve" data-alert-id="${esc(row.id)}" ${busy?'disabled':''}>Resolver</button>`:canReopen?`<button type="button" class="alert-secondary" data-alert-action="reopen" data-alert-id="${esc(row.id)}" ${busy?'disabled':''}>Reabrir</button>`:''}
        ${canOpen?`<button type="button" class="alert-primary" data-open-entity="${esc(row.id)}" ${busy?'disabled':''}>Abrir registro</button>`:''}
      </div>
    </article>`;
  }

  function messageCard(row) {
    const status=messageStatus(row);
    const canRetry=['failed','undelivered','pending'].includes(status);
    const busy=state.actionBusy===`message:${row.id}`;
    const client=row.clients?.name||row.payload?.client_name||'Cliente sin identificar';
    const container=row.shipments?.container_number||row.payload?.container_number||'Sin contenedor';
    return `<article class="alert-message-card status-${esc(status)}" data-message-record="${esc(row.id)}">
      <div class="alert-message-icon" aria-hidden="true"></div>
      <div class="alert-message-content">
        <div class="alert-card-eyebrow"><span>${esc(typeLabel(row))}</span><span>${esc(dateLabel(row.created_at))}</span></div>
        <h4>${esc(client)}</h4>
        <p>${esc(messageDeliveryDetail(row,status))}</p>
        <div class="alert-card-meta"><span class="alert-meta-chip status-${esc(status)}">${esc(statusLabel(status))}</span><span class="alert-meta-chip">${esc(container)}</span></div>
      </div>
      <div class="alert-message-actions">${canRetry?`<button type="button" class="alert-secondary" data-message-retry="${esc(row.id)}" ${busy?'disabled':''}>${busy?'Reintentando…':'Reintentar'}</button>`:'<span class="alert-message-complete">Sin acciones pendientes</span>'}</div>
    </article>`;
  }

  function resultMarkup() {
    if (state.loading&&!state.loaded) {
      return '<div class="alert-center-loading" role="status"><span aria-hidden="true"></span><div><strong>Consultando el centro de alertas</strong><small>Reuniendo excepciones y entregas recientes…</small></div></div>';
    }
    if (state.loadError&&!state.loaded) {
      return '<div class="alert-center-empty is-error"><strong>No se pudieron actualizar las alertas en este momento.</strong><span>Usa Actualizar para intentarlo nuevamente.</span></div>';
    }
    const rows=state.activeView==='operational'?visibleAlerts():visibleMessages();
    if (!rows.length) {
      const filtered=Boolean(state.search)||(state.activeView==='operational'?state.activeFilter!=='all':state.messageFilter!=='all');
      return `<div class="alert-center-empty"><strong>${filtered?'No hay resultados para esta búsqueda.':state.activeView==='operational'?'No hay alertas registradas.':'No hay mensajes registrados.'}</strong><span>${filtered?'Prueba otro término o filtro.':'La información aparecerá aquí cuando exista actividad.'}</span></div>`;
    }
    return `<div class="${state.activeView==='operational'?'alert-card-list':'alert-message-list'}">${rows.map(state.activeView==='operational'?alertCard:messageCard).join('')}</div>`;
  }

  function collectionHeaderMarkup() {
    const rows=state.activeView==='operational'?visibleAlerts():visibleMessages();
    const total=state.activeView==='operational'?state.operationalRows.length:state.messageRows.filter(row=>!isOperational(row)).length;
    const label=state.activeView==='operational'?'alerta':'mensaje';
    const description=state.activeView==='operational'
      ?'Resolver manualmente silencia el ciclo actual. Solo reaparece si la condición se cierra y vuelve a ocurrir.'
      :'Consulta el estado de cada comunicación sin exponer respuestas técnicas del proveedor.';
    return `<header class="alert-center-panel-head">
      <div><span class="alert-center-eyebrow">${state.activeView==='operational'?'Excepciones que requieren atención':'Registro de comunicaciones'}</span><h3>${state.activeView==='operational'?'Alertas operativas':'Mensajes y WhatsApp'}</h3><p>${description}</p></div>
      <div class="alert-panel-tools">${state.activeView==='operational'?alertFilterMarkup():messageFilterMarkup()}<span id="alertCenterResultCount" class="alert-result-count">${rows.length} ${label}${rows.length===1?'':'s'}${rows.length!==total?` de ${total}`:''}</span></div>
    </header>`;
  }

  function panelMarkup() {
    return `<section id="alertCenterPanel" class="alert-center-panel native-workspace-panel" role="tabpanel" aria-live="polite">
      ${collectionHeaderMarkup()}
      <div id="alertCenterResults" class="alert-center-results">${resultMarkup()}</div>
    </section>`;
  }

  function bindResultActions(container) {
    container.querySelectorAll('[data-alert-action]').forEach(button => {
      button.onclick=()=>executeAlertAction(button.dataset.alertId,button.dataset.alertAction);
    });
    container.querySelectorAll('[data-open-entity]').forEach(button => {
      button.onclick=()=>openEntity(button.dataset.openEntity);
    });
    container.querySelectorAll('[data-message-retry]').forEach(button => {
      button.onclick=()=>retryMessage(button.dataset.messageRetry);
    });
  }

  function renderResultRegion() {
    const results=$('alertCenterResults');
    if (!results) return;
    results.innerHTML=resultMarkup();
    const count=$('alertCenterResultCount');
    if (count) {
      const rows=state.activeView==='operational'?visibleAlerts():visibleMessages();
      const total=state.activeView==='operational'?state.operationalRows.length:state.messageRows.filter(row=>!isOperational(row)).length;
      const label=state.activeView==='operational'?'alerta':'mensaje';
      count.textContent=`${rows.length} ${label}${rows.length===1?'':'s'}${rows.length!==total?` de ${total}`:''}`;
    }
    bindResultActions(results);
  }

  function bindCenterEvents(section) {
    section.querySelectorAll('[data-alert-view]').forEach(button => {
      button.onclick=()=>{
        state.activeView=button.dataset.alertView;
        state.search='';
        renderCenter();
        $('alertCenterSearch')?.focus();
      };
    });
    const search=$('alertCenterSearch');
    if (search) search.oninput=event=>{
      state.search=event.target.value;
      renderResultRegion();
    };
    const alertFilter=$('operationalAlertFilter');
    if (alertFilter) {
      alertFilter.value=state.activeFilter;
      alertFilter.onchange=event=>{state.activeFilter=event.target.value;renderResultRegion();};
    }
    const messageFilter=$('messageDeliveryFilter');
    if (messageFilter) {
      messageFilter.value=state.messageFilter;
      messageFilter.onchange=event=>{state.messageFilter=event.target.value;renderResultRegion();};
    }
    const reload=$('reloadUnifiedNotifications');
    if (reload) reload.onclick=()=>loadNotifications();
    bindResultActions(section);
  }

  function renderCenter() {
    const section=$('notificationsSection');
    if (!section) return;
    section.dataset.alertOwner = 'operational-alert-center.js';
    section.setAttribute('aria-busy',state.loading?'true':'false');
    section.innerHTML=`<div class="alert-center-shell native-workspace-shell">${heroMarkup()}${commandMarkup()}${panelMarkup()}</div>`;
    bindCenterEvents(section);
  }

  function mountBell() {
    const actions=document.querySelector('.topbar-actions');
    if (!actions||$('operationalAlertBellWrap')) return;
    const wrap=document.createElement('div');
    wrap.id='operationalAlertBellWrap';
    wrap.className='alert-bell-wrap';
    wrap.innerHTML='<button type="button" id="operationalAlertBell" class="alert-bell" title="Alertas operativas" aria-label="Alertas operativas" aria-expanded="false"><span id="operationalAlertBadge" class="alert-badge hidden">0</span></button><div id="operationalAlertPopover" class="alert-popover hidden"></div>';
    actions.prepend(wrap);
    window.ExportMcaIcons?.hydrate?.(wrap);
    $('operationalAlertBell').onclick=event=>{
      event.stopPropagation();
      state.bellOpen=!state.bellOpen;
      renderPopover();
    };
    document.addEventListener('click',event=>{
      if (state.bellOpen&&!wrap.contains(event.target)) {
        state.bellOpen=false;
        renderPopover();
      }
    });
  }

  function renderBell() {
    const count=state.operationalRows.filter(unreadActive).length;
    const badge=$('operationalAlertBadge');
    if (!badge) return;
    badge.textContent=count>99?'99+':String(count);
    badge.classList.toggle('hidden',count===0);
    renderPopover();
  }

  function renderPopover() {
    const target=$('operationalAlertPopover');
    const bell=$('operationalAlertBell');
    if (!target) return;
    target.classList.toggle('hidden',!state.bellOpen);
    bell?.setAttribute('aria-expanded',state.bellOpen?'true':'false');
    if (!state.bellOpen) return;
    const active=state.operationalRows.filter(isActiveAlert).sort(sortAlerts);
    const list=active.slice(0,6);
    target.innerHTML=`<div class="alert-popover-head"><div><b>Alertas operativas</b><span>${active.length?`${active.length} activa${active.length===1?'':'s'}`:'Sin pendientes'}</span></div><button type="button" class="alert-popover-close" aria-label="Cerrar alertas" data-alert-popover-close>×</button></div><div class="alert-popover-list">${list.length?list.map(row=>`<button type="button" class="alert-popover-item" data-bell-alert="${esc(row.id)}"><b>${!row.read_at?'<span class="alert-unread-dot"></span>':''}${esc(row.title||typeLabel(row))}</b><span class="alert-item-meta">${esc(entityName(row))} · ${esc(relativeTime(row.last_triggered_at||row.created_at))}</span></button>`).join(''):'<div class="alert-center-empty alert-popover-empty"><strong>No hay alertas activas.</strong></div>'}</div><div class="alert-popover-foot"><button type="button" class="alert-primary" id="openFullAlertCenter">Abrir centro de alertas</button></div>`;
    target.querySelector('[data-alert-popover-close]').onclick=()=>{
      state.bellOpen=false;
      renderPopover();
      bell?.focus();
    };
    target.querySelectorAll('[data-bell-alert]').forEach(button=>button.onclick=async()=>{
      state.bellOpen=false;
      try { await markRead(button.dataset.bellAlert,false); }
      catch (error) { console.error('OPERATIONAL_ALERT_ACTION_FAILED',error); }
      state.activeView='operational';
      state.activeFilter='active';
      showSection('notificationsSection');
      renderCenter();
    });
    $('openFullAlertCenter').onclick=()=>{
      state.bellOpen=false;
      state.activeView='operational';
      showSection('notificationsSection');
      renderCenter();
    };
  }

  function dashboardAlerts() {
    const target=$('alerts');
    if (!target) return;
    const active=state.operationalRows.filter(isActiveAlert).sort(sortAlerts);
    const top=active.slice(0,5);
    target.className='dashboard-alert-list';
    target.innerHTML=`<div class="dashboard-alert-header"><div><h3>${active.length?`${active.length} alerta${active.length===1?'':'s'} activa${active.length===1?'':'s'}`:'Operación al día'}</h3><div class="muted">Excepciones operativas; el trabajo normal vive en Mis tareas.</div></div><button type="button" class="alt" id="dashboardOpenAlerts">Ver todas</button></div>${top.length?top.map(row=>`<article class="dashboard-alert-item ${esc(row.severity||'warning')}"><div class="severity" aria-hidden="true"></div><div><b>${!row.read_at?'<span class="alert-unread-dot"></span>':''}${esc(row.title||typeLabel(row))}</b><div class="muted alert-item-meta">${esc(entityName(row))} · ${esc(relativeTime(row.last_triggered_at||row.created_at))}</div></div><button type="button" class="alt" data-dashboard-alert="${esc(row.id)}">Revisar</button></article>`).join(''):'<div class="empty-state">No hay alertas operativas pendientes.</div>'}`;
    $('dashboardOpenAlerts').onclick=()=>{
      state.activeView='operational';
      state.activeFilter='active';
      showSection('notificationsSection');
      renderCenter();
    };
    target.querySelectorAll('[data-dashboard-alert]').forEach(button=>button.onclick=async()=>{
      try { await markRead(button.dataset.dashboardAlert,false); }
      catch (error) { console.error('OPERATIONAL_ALERT_ACTION_FAILED',error); }
      state.activeView='operational';
      state.activeFilter='active';
      showSection('notificationsSection');
      renderCenter();
    });
  }

  async function patchAlert(id,action,extra={}) {
    return api('/api/history?mode=notifications',{method:'PATCH',body:JSON.stringify({id,action,...extra})});
  }

  async function markRead(id,refresh=true) {
    const row=state.operationalRows.find(item=>String(item.id)===String(id));
    if (!row||row.read_at) return;
    await patchAlert(id,'mark_read');
    row.read_at=new Date().toISOString();
    if (refresh) {
      renderBell();
      dashboardAlerts();
      renderCenter();
    }
  }

  function managedDialog(markup,{cancelSelector,confirmSelector,readValue}) {
    return new Promise(resolve=>{
      document.querySelector('.alert-action-overlay')?.remove();
      state.lastFocused=document.activeElement;
      const overlay=document.createElement('div');
      overlay.className='alert-action-overlay';
      overlay.innerHTML=markup;
      document.body.appendChild(overlay);
      document.body.classList.add('alert-dialog-open');
      const panel=overlay.querySelector('.alert-action-panel');
      const cancel=overlay.querySelector(cancelSelector);
      const confirm=overlay.querySelector(confirmSelector);
      let finished=false;
      const focusable=()=>[...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')];
      const finish=value=>{
        if (finished) return;
        finished=true;
        document.removeEventListener('keydown',onKeydown);
        document.body.classList.remove('alert-dialog-open');
        overlay.remove();
        if (state.lastFocused?.isConnected) state.lastFocused.focus();
        state.lastFocused=null;
        resolve(value);
      };
      const onKeydown=event=>{
        if (event.key==='Escape') {
          event.preventDefault();
          finish(null);
          return;
        }
        if (event.key!=='Tab') return;
        const items=focusable();
        if (!items.length) return;
        const first=items[0];
        const last=items[items.length-1];
        if (event.shiftKey&&document.activeElement===first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey&&document.activeElement===last) {
          event.preventDefault();
          first.focus();
        }
      };
      document.addEventListener('keydown',onKeydown);
      cancel.onclick=()=>finish(null);
      overlay.onclick=event=>{if(event.target===overlay)finish(null);};
      confirm.onclick=()=>{
        const value=readValue(overlay);
        if (value!==undefined) finish(value);
      };
      setTimeout(()=>focusable()[0]?.focus(),0);
    });
  }

  function alertActionDialog(row,action) {
    const isResolve=action==='resolve';
    const markup=`<div class="alert-action-panel" role="dialog" aria-modal="true" aria-labelledby="alertActionTitle" aria-describedby="alertActionDescription">
      <span class="alert-dialog-kicker">Decisión operativa</span>
      <h3 id="alertActionTitle">${isResolve?'Resolver alerta':'Posponer alerta'}</h3>
      <p id="alertActionDescription">${esc(row.title||typeLabel(row))}. ${isResolve?'La resolución manual silencia este ciclo aunque la condición siga activa.':'La alerta volverá a pendiente cuando termine el plazo si la condición continúa.'}</p>
      ${isResolve?'<label for="alertActionReason">Motivo</label><input id="alertActionReason" value="Revisada manualmente" maxlength="240" autocomplete="off">':'<label for="alertActionHours">Posponer</label><select id="alertActionHours"><option value="1">1 hora</option><option value="4">4 horas</option><option value="12">12 horas</option><option value="24" selected>24 horas</option><option value="48">48 horas</option><option value="72">72 horas</option><option value="168">7 días</option></select>'}
      <div class="alert-action-error" id="alertActionError" role="alert"></div>
      <div class="alert-action-actions"><button type="button" class="alert-secondary" data-alert-action-cancel>Cancelar</button><button type="button" class="${isResolve?'alert-success':'alert-primary'}" data-alert-action-confirm>${isResolve?'Resolver':'Posponer'}</button></div>
    </div>`;
    return managedDialog(markup,{
      cancelSelector:'[data-alert-action-cancel]',
      confirmSelector:'[data-alert-action-confirm]',
      readValue:overlay=>{
        if (!isResolve) return {hours:Number(overlay.querySelector('#alertActionHours')?.value||24)};
        const reason=String(overlay.querySelector('#alertActionReason')?.value||'').trim();
        if (!reason) {
          overlay.querySelector('#alertActionError').textContent='Indica un motivo.';
          return undefined;
        }
        return {reason};
      }
    });
  }

  function retryMessageDialog(row) {
    const markup=`<div class="alert-action-panel" role="dialog" aria-modal="true" aria-labelledby="messageRetryTitle" aria-describedby="messageRetryDescription">
      <span class="alert-dialog-kicker">Confirmación de entrega</span>
      <h3 id="messageRetryTitle">Reintentar mensaje</h3>
      <p id="messageRetryDescription">Se volverá a intentar el envío de ${esc(typeLabel(row))} para ${esc(row.clients?.name||'el cliente')}. Esta acción no crea una tarea ni una alerta nueva.</p>
      <div class="alert-action-actions"><button type="button" class="alert-secondary" data-message-retry-cancel>Cancelar</button><button type="button" class="alert-primary" data-message-retry-confirm>Reintentar</button></div>
    </div>`;
    return managedDialog(markup,{
      cancelSelector:'[data-message-retry-cancel]',
      confirmSelector:'[data-message-retry-confirm]',
      readValue:()=>true
    });
  }

  async function executeAlertAction(id,action) {
    const row=state.operationalRows.find(item=>String(item.id)===String(id));
    if (!row||state.actionBusy) return;
    try {
      let extra={};
      if (action==='snooze'||action==='resolve') {
        const value=await alertActionDialog(row,action);
        if (!value) return;
        extra=value;
      }
      state.actionBusy=`alert:${id}`;
      renderResultRegion();
      await patchAlert(id,action,extra);
      setFeedback(action==='resolve'?'Alerta resuelta para este ciclo.':action==='snooze'?'Alerta pospuesta.':action==='reopen'?'Alerta reabierta.':'Alerta actualizada.');
      await loadNotifications({preserveFeedback:true});
    } catch (error) {
      console.error('OPERATIONAL_ALERT_ACTION_FAILED',error);
      setFeedback(safeAlertMessage(error,'No se pudo actualizar la alerta. Intenta nuevamente.','alert_action'),true);
    } finally {
      state.actionBusy='';
      if (!$('notificationsSection')?.classList.contains('hidden')) renderCenter();
    }
  }

  async function retryMessage(id) {
    const row=state.messageRows.find(item=>String(item.id)===String(id));
    if (!row||state.actionBusy) return;
    const approved=await retryMessageDialog(row);
    if (!approved) return;
    try {
      state.actionBusy=`message:${id}`;
      renderResultRegion();
      await patchAlert(id,'retry');
      setFeedback('El mensaje quedó enviado a reintento.');
      await loadNotifications({preserveFeedback:true});
    } catch (error) {
      console.error('MESSAGE_RETRY_FAILED',error);
      setFeedback(safeAlertMessage(error,'No se pudo reintentar el mensaje. Intenta nuevamente.','message_retry'),true);
    } finally {
      state.actionBusy='';
      if (!$('notificationsSection')?.classList.contains('hidden')) renderCenter();
    }
  }

  async function openEntity(id) {
    const row=state.operationalRows.find(item=>String(item.id)===String(id));
    if (!row) return;
    try { await markRead(id,false); }
    catch (error) { console.error('OPERATIONAL_ALERT_ACTION_FAILED',error); }
    if (row.entity_type==='operational_task') {
      showSection('tasksSection');
      setTimeout(()=>window.TasksWorkspace?.open?.(row.entity_id||row.payload?.task_id),50);
    } else if (row.entity_type==='shipment'||row.shipment_id) {
      showSection('containersSection');
      const shipmentId=row.shipment_id||row.entity_id;
      const value=row.shipments?.container_number||row.payload?.container_number||'';
      if ($('shipmentSearch')) {
        $('shipmentSearch').value=value;
        $('shipmentSearch').dispatchEvent(new Event('input',{bubbles:true}));
      }
      const shipment=(Array.isArray(window.shipments)?window.shipments:[]).find(item=>String(item.id)===String(shipmentId));
      if (shipment) setTimeout(()=>window.ContainersModule?.openDetails?.(shipment),50);
    } else if (row.entity_type==='client'||row.client_id) {
      showSection('clientsSection');
      const client=(Array.isArray(window.clients)?window.clients:[]).find(item=>String(item.id)===String(row.entity_id||row.client_id));
      if (client) setTimeout(()=>window.ClientsModule?.openInformation?.(client.id),50);
    }
    renderBell();
    dashboardAlerts();
  }

  async function loadNotifications({preserveFeedback=false}={}) {
    if (!token||state.loading) return false;
    state.loading=true;
    state.loadError=false;
    if (!$('notificationsSection')?.classList.contains('hidden')) renderCenter();
    try {
      const [operational,all]=await Promise.all([
        api('/api/history?mode=notifications&scope=operational'),
        api('/api/history?mode=notifications')
      ]);
      state.operationalRows=Array.isArray(operational.notifications)?operational.notifications:[];
      state.messageRows=Array.isArray(all.notifications)?all.notifications:[];
      state.loaded=true;
      state.lastUpdated=new Date().toISOString();
      if (!preserveFeedback) setFeedback('');
      renderBell();
      dashboardAlerts();
      return true;
    } catch (error) {
      console.error('UNIFIED_ALERT_CENTER_LOAD_ERROR',error);
      state.loadError=true;
      setFeedback(safeAlertMessage(error,'No se pudieron actualizar las alertas y mensajes. Intenta nuevamente.','load'),true);
      const target=$('alerts');
      if (target) target.innerHTML='<div class="empty-state">No se pudieron actualizar las alertas en este momento.</div>';
      return false;
    } finally {
      state.loading=false;
      if (!$('notificationsSection')?.classList.contains('hidden')) renderCenter();
    }
  }

  function mount() {
    mountBell();
    const nav=document.querySelector('[data-section="notificationsSection"]');
    if (nav) {
      nav.dataset.navLabel='Centro de alertas';
      nav.setAttribute('aria-label','Centro de alertas');
      nav.title='Centro de alertas';
      const label=nav.querySelector('.nav-label');
      if (label) label.textContent='Centro de alertas';
      window.ExportMcaIcons?.hydrate?.(nav);
    }
    if (window.titles) window.titles.notificationsSection='Centro de alertas';
    window.loadNotifications=loadNotifications;
    window.loadOperationalAlerts=loadNotifications;
    window.loadOperationalAlertCenter=loadNotifications;
    window.addEventListener('export-mca:section-changed',event=>{
      if (event.detail?.id==='dashboardSection') loadNotifications();
    });
    setTimeout(loadNotifications,300);
  }

  window.OperationalAlertCenter=Object.freeze({
    owner:'operational-alert-center.js',
    load:loadNotifications,
    render:renderCenter,
    visibleAlerts,
    visibleMessages,
    summaryMetrics,
    getState:publicState
  });

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
