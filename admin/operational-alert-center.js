(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  let operationalRows = [];
  let messageRows = [];
  let activeView = 'operational';
  let activeFilter = 'active';
  let bellOpen = false;

  function addStyles() {
    if ($('operationalAlertStyles')) return;
    const style = document.createElement('style');
    style.id = 'operationalAlertStyles';
    style.textContent = `
      .alert-bell-wrap{position:relative}.alert-bell{position:relative;width:42px;height:42px;padding:0!important;display:grid;place-items:center;font-size:19px}.alert-badge{position:absolute;right:-5px;top:-6px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:#b42318;color:#fff;font-size:10px;font-weight:900;display:grid;place-items:center;border:2px solid #fff}.alert-badge.hidden{display:none!important}
      .alert-popover{position:absolute;right:0;top:50px;width:min(410px,calc(100vw - 24px));background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 22px 55px rgba(16,24,40,.22);z-index:1300;overflow:hidden}.alert-popover-head{display:flex;justify-content:space-between;align-items:center;padding:15px 16px;border-bottom:1px solid var(--line)}.alert-popover-list{max-height:420px;overflow:auto;padding:8px}.alert-popover-item{width:100%;display:block;text-align:left;background:#fff!important;color:var(--text)!important;border:0!important;border-bottom:1px solid var(--line)!important;border-radius:0!important;padding:12px!important}.alert-popover-item:last-child{border-bottom:0!important}.alert-popover-item:hover{background:#f8fafc!important}.alert-popover-foot{padding:12px;border-top:1px solid var(--line)}.alert-popover-foot button{width:100%}
      .alert-summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}.alert-summary{border:1px solid var(--line);border-radius:12px;padding:15px;background:#fff}.alert-summary span{display:block;color:var(--muted);font-size:11px;font-weight:800;text-transform:uppercase}.alert-summary b{display:block;font-size:26px;color:var(--navy);margin-top:5px}.alert-summary.critical{border-left:4px solid #b42318}.alert-summary.warning{border-left:4px solid #d99a1f}.alert-summary.snoozed{border-left:4px solid #667085}.alert-summary.unread{border-left:4px solid var(--navy)}
      .alert-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px}.alert-toolbar select{width:auto;min-width:170px}.alert-card-list{display:grid;gap:12px}.operational-alert-card{border:1px solid var(--line);border-radius:13px;padding:16px;background:#fff;display:grid;grid-template-columns:10px 1fr auto;gap:14px;align-items:start}.alert-severity-bar{width:10px;min-height:100%;border-radius:999px;background:#d99a1f}.operational-alert-card.critical .alert-severity-bar{background:#b42318}.operational-alert-card.info .alert-severity-bar{background:#174ea6}.operational-alert-card.snoozed{opacity:.72}.alert-card-title{font-size:15px;font-weight:900;color:var(--navy)}.alert-card-message{margin-top:5px;color:#344054;font-size:13px}.alert-card-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.alert-meta-chip{padding:5px 8px;border-radius:999px;background:#f2f4f7;color:#475467;font-size:11px}.alert-card-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.alert-card-actions button{padding:8px 10px;font-size:11px}.alert-unread-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#b42318;margin-right:6px}
      .dashboard-alert-list{display:grid;gap:10px}.dashboard-alert-item{display:grid;grid-template-columns:8px 1fr auto;gap:12px;padding:13px;border:1px solid var(--line);border-radius:11px;background:#fff;align-items:center}.dashboard-alert-item .severity{width:8px;height:100%;min-height:44px;border-radius:999px;background:#d99a1f}.dashboard-alert-item.critical .severity{background:#b42318}.dashboard-alert-item button{padding:7px 9px;font-size:11px}.dashboard-alert-header{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}.dashboard-alert-header h3{margin:0;color:var(--navy)}
      .notification-view-tabs{display:flex;gap:8px;flex-wrap:wrap}.notification-view-tabs button.active{background:var(--navy);color:#fff}.message-table-wrap{overflow:auto}.message-table-wrap table{min-width:850px}
      @media(max-width:900px){.alert-summary-grid{grid-template-columns:repeat(2,1fr)}.operational-alert-card{grid-template-columns:8px 1fr}.alert-card-actions{grid-column:2;justify-content:flex-start}.alert-toolbar select{width:100%}.alert-popover{position:fixed;right:12px;left:12px;top:76px;width:auto}.dashboard-alert-item{grid-template-columns:7px 1fr}.dashboard-alert-item button{grid-column:2;justify-self:start}}
      @media(max-width:520px){.alert-summary-grid{grid-template-columns:1fr 1fr}.alert-summary b{font-size:22px}}
    `;
    document.head.appendChild(style);
  }

  const isOperational = row => row.notification_scope === 'operational';
  const alertStatus = row => String(row.normalized_alert_status || row.alert_status || (row.resolved_at ? 'resolved' : 'pending')).toLowerCase();
  const messageStatus = row => String(row.normalized_status || row.status || row.delivery_status || 'pending').toLowerCase();
  const isActiveAlert = row => ['pending', 'snoozed'].includes(alertStatus(row));
  const unreadActive = row => isActiveAlert(row) && !row.read_at;

  function severityLabel(value) {
    return ({ critical: 'Crítica', warning: 'Advertencia', info: 'Información' })[String(value || '').toLowerCase()] || 'Advertencia';
  }

  function statusLabel(value) {
    return ({ pending: 'Pendiente', snoozed: 'Pospuesta', resolved: 'Resuelta', failed: 'Error', sent: 'Enviada', queued: 'En cola', delivered: 'Entregada', read: 'Leída', accepted: 'Aceptada', undelivered: 'No entregada' })[String(value || '').toLowerCase()] || value || 'Pendiente';
  }

  function typeLabel(row) {
    const type = row.notification_type || row.event_type || row.event_status || '';
    return ({ client_without_shipment: 'Cliente sin contenedor', shipment_stale_tracking: 'Tracking sin actualización', tracking_stale: 'Tracking sin actualización', welcome: 'Bienvenida', registered: 'Contenedor registrado', release: 'Liberación', delivered: 'Entrega', tracking: 'Tracking' })[type] || type || 'Notificación';
  }

  function relativeTime(value) {
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) return '-';
    const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    return `hace ${days} día${days === 1 ? '' : 's'}`;
  }

  function entityName(row) {
    if (row.entity_type === 'shipment' || row.shipment_id) return row.shipments?.container_number || row.payload?.container_number || 'Contenedor';
    return row.clients?.name || row.payload?.client_name || 'Cliente';
  }

  function mountBell() {
    const actions = document.querySelector('.topbar-actions');
    if (!actions || $('operationalAlertBellWrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'operationalAlertBellWrap';
    wrap.className = 'alert-bell-wrap';
    wrap.innerHTML = `<button id="operationalAlertBell" class="alert-bell" title="Alertas operativas" aria-label="Alertas operativas">🔔<span id="operationalAlertBadge" class="alert-badge hidden">0</span></button><div id="operationalAlertPopover" class="alert-popover hidden"></div>`;
    actions.prepend(wrap);
    $('operationalAlertBell').onclick = event => { event.stopPropagation(); bellOpen = !bellOpen; renderPopover(); };
    document.addEventListener('click', event => {
      if (bellOpen && !$('operationalAlertBellWrap')?.contains(event.target)) { bellOpen = false; renderPopover(); }
    });
  }

  function renderBell() {
    const count = operationalRows.filter(unreadActive).length;
    const badge = $('operationalAlertBadge');
    if (!badge) return;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('hidden', count === 0);
    renderPopover();
  }

  function renderPopover() {
    const target = $('operationalAlertPopover');
    if (!target) return;
    target.classList.toggle('hidden', !bellOpen);
    if (!bellOpen) return;
    const list = operationalRows.filter(isActiveAlert).sort(sortAlerts).slice(0, 6);
    target.innerHTML = `<div class="alert-popover-head"><b>Alertas operativas</b><span class="muted">${list.length ? operationalRows.filter(isActiveAlert).length + ' activas' : 'Sin pendientes'}</span></div><div class="alert-popover-list">${list.length ? list.map(row => `<button class="alert-popover-item" data-bell-alert="${esc(row.id)}"><b>${!row.read_at ? '<span class="alert-unread-dot"></span>' : ''}${esc(row.title || typeLabel(row))}</b><div class="muted" style="margin-top:4px">${esc(entityName(row))} · ${esc(relativeTime(row.last_triggered_at || row.created_at))}</div></button>`).join('') : '<div class="empty-state">No hay alertas operativas activas.</div>'}</div><div class="alert-popover-foot"><button class="alt" id="openFullAlertCenter">Abrir centro de alertas</button></div>`;
    target.querySelectorAll('[data-bell-alert]').forEach(button => button.onclick = async () => {
      bellOpen = false;
      await markRead(button.dataset.bellAlert, false);
      activeView = 'operational';
      activeFilter = 'active';
      showSection('notificationsSection');
      renderCenter();
    });
    $('openFullAlertCenter').onclick = () => { bellOpen = false; activeView = 'operational'; showSection('notificationsSection'); renderCenter(); };
  }

  function sortAlerts(a, b) {
    const severityWeight = { critical: 3, warning: 2, info: 1 };
    const severityDiff = (severityWeight[b.severity] || 0) - (severityWeight[a.severity] || 0);
    if (severityDiff) return severityDiff;
    return new Date(b.last_triggered_at || b.created_at || 0) - new Date(a.last_triggered_at || a.created_at || 0);
  }

  function dashboardAlerts() {
    const target = $('alerts');
    if (!target) return;
    const active = operationalRows.filter(isActiveAlert).sort(sortAlerts);
    const top = active.slice(0, 5);
    target.className = 'dashboard-alert-list';
    target.innerHTML = `<div class="dashboard-alert-header"><div><h3>${active.length ? `${active.length} alerta${active.length === 1 ? '' : 's'} activa${active.length === 1 ? '' : 's'}` : 'Operación al día'}</h3><div class="muted">Incidencias generadas automáticamente por el ERP.</div></div><button class="alt" id="dashboardOpenAlerts">Ver todas</button></div>${top.length ? top.map(row => `<div class="dashboard-alert-item ${esc(row.severity || 'warning')}"><div class="severity"></div><div><b>${!row.read_at ? '<span class="alert-unread-dot"></span>' : ''}${esc(row.title || typeLabel(row))}</b><div class="muted" style="margin-top:4px">${esc(entityName(row))} · ${esc(relativeTime(row.last_triggered_at || row.created_at))}</div></div><button class="alt" data-dashboard-alert="${esc(row.id)}">Revisar</button></div>`).join('') : '<div class="empty-state">No hay alertas operativas pendientes.</div>'}`;
    $('dashboardOpenAlerts').onclick = () => { activeView = 'operational'; activeFilter = 'active'; showSection('notificationsSection'); renderCenter(); };
    target.querySelectorAll('[data-dashboard-alert]').forEach(button => button.onclick = async () => {
      await markRead(button.dataset.dashboardAlert, false);
      activeView = 'operational'; activeFilter = 'active'; showSection('notificationsSection'); renderCenter();
    });
  }

  function operationalSummary() {
    const active = operationalRows.filter(isActiveAlert);
    const critical = active.filter(row => row.severity === 'critical').length;
    const warning = active.filter(row => row.severity === 'warning').length;
    const snoozed = active.filter(row => alertStatus(row) === 'snoozed').length;
    const unread = active.filter(row => !row.read_at).length;
    return `<div class="alert-summary-grid"><div class="alert-summary critical"><span>Críticas</span><b>${critical}</b></div><div class="alert-summary warning"><span>Advertencias</span><b>${warning}</b></div><div class="alert-summary snoozed"><span>Pospuestas</span><b>${snoozed}</b></div><div class="alert-summary unread"><span>Sin leer</span><b>${unread}</b></div></div>`;
  }

  function filteredAlerts() {
    if (activeFilter === 'active') return operationalRows.filter(isActiveAlert).sort(sortAlerts);
    if (activeFilter === 'pending') return operationalRows.filter(row => alertStatus(row) === 'pending').sort(sortAlerts);
    if (activeFilter === 'snoozed') return operationalRows.filter(row => alertStatus(row) === 'snoozed').sort(sortAlerts);
    if (activeFilter === 'resolved') return operationalRows.filter(row => alertStatus(row) === 'resolved').sort(sortAlerts);
    if (activeFilter === 'critical') return operationalRows.filter(row => isActiveAlert(row) && row.severity === 'critical').sort(sortAlerts);
    return [...operationalRows].sort(sortAlerts);
  }

  function alertCard(row) {
    const status = alertStatus(row);
    const active = isActiveAlert(row);
    const canOpen = row.entity_type === 'shipment' || row.entity_type === 'client' || row.shipment_id || row.client_id;
    return `<article class="operational-alert-card ${esc(row.severity || 'warning')} ${status === 'snoozed' ? 'snoozed' : ''}"><div class="alert-severity-bar"></div><div><div class="alert-card-title">${!row.read_at ? '<span class="alert-unread-dot"></span>' : ''}${esc(row.title || typeLabel(row))}</div><div class="alert-card-message">${esc(row.message || row.payload?.message || typeLabel(row))}</div><div class="alert-card-meta"><span class="alert-meta-chip">${esc(severityLabel(row.severity))}</span><span class="alert-meta-chip">${esc(statusLabel(status))}</span><span class="alert-meta-chip">${esc(entityName(row))}</span><span class="alert-meta-chip">${esc(relativeTime(row.last_triggered_at || row.created_at))}</span>${Number(row.occurrence_count || 1) > 1 ? `<span class="alert-meta-chip">${Number(row.occurrence_count)} avisos</span>` : ''}${row.snoozed_until ? `<span class="alert-meta-chip">Hasta ${new Date(row.snoozed_until).toLocaleString('es-US')}</span>` : ''}</div></div><div class="alert-card-actions">${!row.read_at ? `<button class="alt" data-alert-action="mark_read" data-alert-id="${esc(row.id)}">Leída</button>` : ''}${active ? `<button class="alt" data-alert-action="snooze" data-alert-id="${esc(row.id)}">Posponer</button><button class="success" data-alert-action="resolve" data-alert-id="${esc(row.id)}">Resolver</button>` : `<button class="alt" data-alert-action="reopen" data-alert-id="${esc(row.id)}">Reabrir</button>`}${canOpen ? `<button class="orange" data-open-entity="${esc(row.id)}">Abrir</button>` : ''}</div></article>`;
  }

  function messagesHtml() {
    const rows = messageRows.filter(row => !isOperational(row));
    return `<section class="card"><div class="toolbar"><div><h2 style="margin:0;color:var(--navy)">Mensajes y WhatsApp</h2><div class="muted">Historial de comunicaciones enviadas a clientes.</div></div><button id="reloadUnifiedNotifications" class="alt">Actualizar</button></div></section><section class="card"><div class="message-table-wrap">${rows.length ? `<table><thead><tr><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Contenedor</th><th>Estado</th><th>Error</th><th>Acciones</th></tr></thead><tbody>${rows.map(row => { const status = messageStatus(row); const canRetry = ['failed','undelivered','pending'].includes(status); return `<tr><td>${new Date(row.created_at).toLocaleString('es-US')}</td><td><b>${esc(row.clients?.name || '-')}</b><br><span class="muted">${esc(row.recipient || row.recipient_phone || row.clients?.phone || '')}</span></td><td>${esc(typeLabel(row))}</td><td>${esc(row.shipments?.container_number || row.payload?.container_number || '-')}</td><td><span class="pill ${['sent','delivered','read','accepted','queued'].includes(status) ? 'done' : ''}">${esc(statusLabel(status))}</span></td><td>${esc(row.error_message || '-')}</td><td>${canRetry ? `<button class="alt" data-message-retry="${esc(row.id)}">Reintentar</button>` : '-'}</td></tr>`; }).join('')}</tbody></table>` : '<div class="empty-state">No hay mensajes registrados.</div>'}</div></section>`;
  }

  function renderCenter() {
    const section = $('notificationsSection');
    if (!section) return;
    const header = `<section class="card"><div class="toolbar"><div><h2 style="margin:0;color:var(--navy)">Centro de alertas y comunicaciones</h2><div class="muted">Control operativo interno y registro de mensajes enviados.</div></div><div class="notification-view-tabs"><button class="alt ${activeView === 'operational' ? 'active' : ''}" data-alert-view="operational">Alertas operativas</button><button class="alt ${activeView === 'messages' ? 'active' : ''}" data-alert-view="messages">Mensajes WhatsApp</button></div></div></section>`;
    if (activeView === 'messages') {
      section.innerHTML = header + messagesHtml();
    } else {
      const list = filteredAlerts();
      section.innerHTML = header + operationalSummary() + `<section class="card"><div class="toolbar"><div><h3 style="margin:0;color:var(--navy)">Alertas operativas</h3><div class="muted">Se resuelven automáticamente cuando desaparece la condición.</div></div><button id="reloadUnifiedNotifications" class="alt">Actualizar</button></div><div class="alert-toolbar"><select id="operationalAlertFilter"><option value="active">Activas</option><option value="critical">Críticas</option><option value="pending">Pendientes</option><option value="snoozed">Pospuestas</option><option value="resolved">Resueltas</option><option value="all">Todas</option></select></div></section><section class="card"><div class="alert-card-list">${list.length ? list.map(alertCard).join('') : '<div class="empty-state">No hay alertas para este filtro.</div>'}</div></section>`;
      $('operationalAlertFilter').value = activeFilter;
      $('operationalAlertFilter').onchange = event => { activeFilter = event.target.value; renderCenter(); };
    }
    section.querySelectorAll('[data-alert-view]').forEach(button => button.onclick = () => { activeView = button.dataset.alertView; renderCenter(); });
    const reload = $('reloadUnifiedNotifications'); if (reload) reload.onclick = loadNotifications;
    section.querySelectorAll('[data-alert-action]').forEach(button => button.onclick = () => executeAlertAction(button.dataset.alertId, button.dataset.alertAction));
    section.querySelectorAll('[data-open-entity]').forEach(button => button.onclick = () => openEntity(button.dataset.openEntity));
    section.querySelectorAll('[data-message-retry]').forEach(button => button.onclick = () => retryMessage(button.dataset.messageRetry));
  }

  async function patchAlert(id, action, extra = {}) {
    return api('/api/history?mode=notifications', { method: 'PATCH', body: JSON.stringify({ id, action, ...extra }) });
  }

  async function markRead(id, refresh = true) {
    const row = operationalRows.find(item => item.id === id);
    if (!row || row.read_at) return;
    await patchAlert(id, 'mark_read');
    row.read_at = new Date().toISOString();
    if (refresh) { renderBell(); dashboardAlerts(); renderCenter(); }
  }

  async function executeAlertAction(id, action) {
    try {
      let extra = {};
      if (action === 'snooze') {
        const selected = prompt('¿Cuántas horas deseas posponerla?', '24');
        if (selected === null) return;
        extra.hours = Number(selected);
      }
      if (action === 'resolve') {
        const reason = prompt('Motivo de resolución', 'Revisada manualmente');
        if (reason === null) return;
        extra.reason = reason;
      }
      await patchAlert(id, action, extra);
      await loadNotifications();
    } catch (error) { alert(error.message); }
  }

  async function retryMessage(id) {
    if (!confirm('¿Reintentar este mensaje?')) return;
    try { await patchAlert(id, 'retry'); await loadNotifications(); } catch (error) { alert(error.message); }
  }

  async function openEntity(id) {
    const row = operationalRows.find(item => item.id === id);
    if (!row) return;
    try { await markRead(id, false); } catch {}
    if (row.entity_type === 'shipment' || row.shipment_id) {
      showSection('containersSection');
      const value = row.shipments?.container_number || row.payload?.container_number || '';
      if ($('shipmentSearch')) { $('shipmentSearch').value = value; $('shipmentSearch').dispatchEvent(new Event('input', { bubbles: true })); }
    } else {
      showSection('clientsSection');
      const client = clients.find(item => item.id === (row.entity_id || row.client_id));
      if (client) setTimeout(() => clientHistory(client.id, client.name), 50);
    }
    renderBell(); dashboardAlerts();
  }

  async function loadNotifications() {
    if (!token) return;
    try {
      const [operational, all] = await Promise.all([
        api('/api/history?mode=notifications&scope=operational'),
        api('/api/history?mode=notifications')
      ]);
      operationalRows = operational.notifications || [];
      messageRows = all.notifications || [];
      renderBell();
      dashboardAlerts();
      if (!$('notificationsSection')?.classList.contains('hidden')) renderCenter();
    } catch (error) {
      console.error('UNIFIED_ALERT_CENTER_LOAD_ERROR', error);
      const target = $('alerts');
      if (target) target.innerHTML = `<div class="empty-state">No se pudieron cargar las alertas: ${esc(error.message)}</div>`;
    }
  }

  function mount() {
    addStyles();
    mountBell();
    const nav = document.querySelector('[data-section="notificationsSection"]');
    if (nav) {
      nav.dataset.navLabel = 'Centro de alertas';
      nav.setAttribute('aria-label', 'Centro de alertas');
      nav.title = 'Centro de alertas';
      const icon = nav.querySelector('.nav-icon');
      const label = nav.querySelector('.nav-label');
      if (icon) icon.textContent = '🔔';
      if (label) label.textContent = 'Centro de alertas';
    }
    window.loadNotifications = loadNotifications;
    window.loadOperationalAlerts = loadNotifications;
    window.addEventListener('export-mca:section-changed', event => {
      if (event.detail?.id === 'dashboardSection') loadNotifications();
    });
    setTimeout(loadNotifications, 300);
    setInterval(loadNotifications, 5 * 60 * 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
