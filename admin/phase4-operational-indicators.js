(() => {
  if (window.__phase4OperationalIndicatorsInstalled) return;
  window.__phase4OperationalIndicatorsInstalled = true;

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
  let alerts = [];
  let shipmentFilter = 'all';

  const active = row => ['pending','snoozed'].includes(String(row.normalized_alert_status || row.alert_status || '').toLowerCase());
  const severityWeight = value => ({ critical:3, warning:2, info:1 })[String(value || '').toLowerCase()] || 1;
  const severityClass = value => String(value || 'warning').toLowerCase();
  const entityId = row => row.entity_id || (row.entity_type === 'shipment' ? row.shipment_id : row.client_id);

  function addStyles() {
    if ($('phase4IndicatorStyles')) return;
    const style = document.createElement('style');
    style.id = 'phase4IndicatorStyles';
    style.textContent = `
      .op-indicator{display:inline-flex;align-items:center;gap:7px;margin-left:7px;vertical-align:middle}
      .op-dot{width:10px;height:10px;border-radius:50%;display:inline-block;box-shadow:0 0 0 3px rgba(0,0,0,.04)}
      .op-dot.critical{background:#b42318}.op-dot.warning{background:#d97706}.op-dot.info{background:#2563eb}.op-dot.ok{background:#15803d}.op-dot.snoozed{background:#667085}
      .op-count{min-width:21px;height:21px;padding:0 6px;border-radius:999px;background:#fff0ef;color:#b42318;border:1px solid #efb0aa;font-size:11px;font-weight:900;display:inline-grid;place-items:center}
      .op-health{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:25px;padding:0 7px;border-radius:999px;font-size:11px;font-weight:900;margin-left:7px}
      .op-health.good{background:#edf9f0;color:#117a37}.op-health.warn{background:#fff8e8;color:#9a6700}.op-health.bad{background:#fff0ef;color:#b42318}
      tr.op-row-warning{background:#fffdf7!important;box-shadow:inset 4px 0 #d97706}
      tr.op-row-critical{background:#fff8f7!important;box-shadow:inset 4px 0 #b42318}
      .op-alert-action{display:none!important}
      .phase4-filterbar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px}
      .phase4-filterbar button{background:#fff;color:var(--navy);border:1px solid var(--line);padding:8px 11px;font-size:12px}
      .phase4-filterbar button.active{background:var(--navy);color:#fff;border-color:var(--navy)}
      .phase4-dashboard-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}
      .phase4-dashboard-summary button{background:#fff;color:var(--text);border:1px solid var(--line);padding:12px;text-align:left}
      .phase4-dashboard-summary b{display:block;font-size:22px;color:var(--navy)}
      .phase4-dashboard-summary span{font-size:11px;color:var(--muted)}
      .activity-alert-chip{display:inline-flex;align-items:center;gap:5px;margin-left:6px;padding:3px 7px;border-radius:999px;background:#fff8e8;color:#9a6700;font-size:10px;font-weight:800}
      .activity-alert-chip.critical{background:#fff0ef;color:#b42318}
      @media(max-width:700px){.phase4-dashboard-summary{grid-template-columns:1fr 1fr}.op-health{margin-left:4px}.op-indicator{margin-left:4px}.phase4-filterbar{overflow:auto;flex-wrap:nowrap;padding-bottom:3px}.phase4-filterbar button{white-space:nowrap}}
    `;
    document.head.appendChild(style);
  }

  function grouped(type) {
    const map = new Map();
    alerts.filter(row => active(row) && row.entity_type === type).forEach(row => {
      const id = entityId(row);
      if (!id) return;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(row);
    });
    return map;
  }

  function meta(rows = []) {
    if (!rows.length) return { count:0, severity:'ok', score:100 };
    const sorted = [...rows].sort((a,b) => severityWeight(b.severity) - severityWeight(a.severity));
    const severity = severityClass(sorted[0].severity);
    const penalty = rows.reduce((sum,row) => sum + (severityWeight(row.severity) === 3 ? 35 : severityWeight(row.severity) === 2 ? 18 : 8), 0);
    return { count:rows.length, severity, score:Math.max(0,100-penalty) };
  }

  function healthClass(score) { return score >= 85 ? 'good' : score >= 60 ? 'warn' : 'bad'; }

  function addIndicator(cell, info, label) {
    if (!cell || cell.querySelector(':scope .op-indicator')) return;
    const wrap = document.createElement('span');
    wrap.className = 'op-indicator';
    wrap.title = info.count ? `${info.count} alerta${info.count === 1 ? '' : 's'} activa${info.count === 1 ? '' : 's'} · Salud ${info.score}` : 'Sin alertas activas';
    wrap.innerHTML = `<span class="op-dot ${esc(info.severity)}"></span>${info.count ? `<span class="op-count">${info.count}</span>` : ''}<span class="op-health ${healthClass(info.score)}">${info.score}</span>`;
    cell.appendChild(wrap);
    if (label) wrap.setAttribute('aria-label', label);
  }

  function addAlertAction(actions, type, id) {
    if (!actions || !id || actions.querySelector(`[data-op-alert-entity="${id}"]`)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'alt op-alert-action';
    button.dataset.opAlertEntity = id;
    button.textContent = '🔔 Ver alertas';
    button.onclick = () => {
      window.showSection?.('notificationsSection');
      setTimeout(() => {
        const section = $('notificationsSection');
        const search = section?.querySelector('input[type="search"], input[placeholder*="Buscar"]');
        if (search) { search.value = id; search.dispatchEvent(new Event('input', { bubbles:true })); }
      }, 100);
    };
    actions.insertBefore(button, actions.firstChild);
  }

  function decorateClients() {
    const map = grouped('client');
    document.querySelectorAll('#clients tbody tr').forEach(row => {
      row.classList.remove('op-row-warning','op-row-critical');
      const actionSource = row.querySelector('button[onclick*="editClient"],button[onclick*="clientHistory"]');
      const match = actionSource?.getAttribute('onclick')?.match(/\('([^']+)'/);
      const id = match?.[1];
      const info = meta(map.get(id) || []);
      const first = row.querySelector('td:first-child');
      addIndicator(first, info, `Estado operativo del cliente: ${info.score}`);
      if (info.severity === 'critical') row.classList.add('op-row-critical');
      else if (info.severity === 'warning') row.classList.add('op-row-warning');
      if (info.count) addAlertAction(row.querySelector('td:last-child .actions'), 'client', id);
    });
  }

  function shipmentIdFromRow(row) {
    const source = row.querySelector('button[onclick*="editShipment"],button[onclick*="historyView"],button[onclick*="shipmentAction"]');
    return source?.getAttribute('onclick')?.match(/\('([^']+)'/)?.[1] || null;
  }

  function decorateShipments() {
    const map = grouped('shipment');
    document.querySelectorAll('#shipments tbody tr').forEach(row => {
      row.classList.remove('op-row-warning','op-row-critical');
      const id = shipmentIdFromRow(row);
      const info = meta(map.get(id) || []);
      const first = row.querySelector('td:first-child');
      addIndicator(first, info, `Estado operativo del contenedor: ${info.score}`);
      row.dataset.operationalSeverity = info.severity;
      if (info.severity === 'critical') row.classList.add('op-row-critical');
      else if (info.severity === 'warning') row.classList.add('op-row-warning');
      if (info.count) addAlertAction(row.querySelector('td:last-child .actions'), 'shipment', id);
      const visible = shipmentFilter === 'all' || shipmentFilter === info.severity || (shipmentFilter === 'alerts' && info.count > 0);
      row.style.display = visible ? '' : 'none';
    });
  }

  function ensureShipmentFilters() {
    const host = $('shipments')?.parentElement;
    if (!host || $('phase4ShipmentFilters')) return;
    const bar = document.createElement('div');
    bar.id = 'phase4ShipmentFilters';
    bar.className = 'phase4-filterbar';
    bar.innerHTML = `<button class="active" data-op-filter="all">Todos</button><button data-op-filter="alerts">Con alertas</button><button data-op-filter="critical">Críticos</button><button data-op-filter="warning">Advertencias</button><button data-op-filter="ok">Normales</button>`;
    host.insertBefore(bar, $('shipments'));
    bar.querySelectorAll('[data-op-filter]').forEach(button => button.onclick = () => {
      shipmentFilter = button.dataset.opFilter;
      bar.querySelectorAll('[data-op-filter]').forEach(item => item.classList.toggle('active', item === button));
      decorateShipments();
    });
  }

  function decorateDashboard() {
    const activeRows = alerts.filter(active);
    const critical = activeRows.filter(row => severityClass(row.severity) === 'critical').length;
    const warning = activeRows.filter(row => severityClass(row.severity) === 'warning').length;
    const snoozed = activeRows.filter(row => String(row.alert_status).toLowerCase() === 'snoozed').length;
    const unread = activeRows.filter(row => !row.read_at).length;
    const target = $('alerts');
    if (target && !$('phase4DashboardSummary')) {
      const summary = document.createElement('div');
      summary.id = 'phase4DashboardSummary';
      summary.className = 'phase4-dashboard-summary';
      target.prepend(summary);
    }
    const summary = $('phase4DashboardSummary');
    if (summary) {
      summary.innerHTML = `<button data-open-alerts><b>${critical}</b><span>Críticas</span></button><button data-open-alerts><b>${warning}</b><span>Advertencias</span></button><button data-open-alerts><b>${snoozed}</b><span>Pospuestas</span></button><button data-open-alerts><b>${unread}</b><span>Sin leer</span></button>`;
      summary.querySelectorAll('[data-open-alerts]').forEach(button => button.onclick = () => window.showSection?.('notificationsSection'));
    }

    const shipmentMap = grouped('shipment');
    document.querySelectorAll('#recentActivity .activity-item').forEach(item => {
      item.querySelector('.activity-alert-chip')?.remove();
      const container = item.querySelector('.activity-title')?.textContent?.trim();
      const shipment = (window.shipments || []).find(row => row.container_number === container);
      const info = meta(shipmentMap.get(shipment?.id) || []);
      if (!info.count) return;
      const chip = document.createElement('span');
      chip.className = `activity-alert-chip ${info.severity}`;
      chip.textContent = `${info.count} alerta${info.count === 1 ? '' : 's'}`;
      item.querySelector('.activity-title')?.appendChild(chip);
    });
  }

  function decorateAll() {
    addStyles();
    ensureShipmentFilters();
    decorateClients();
    decorateShipments();
    decorateDashboard();
  }

  async function load() {
    if (!window.token && !localStorage.getItem('export_mca_token')) return;
    try {
      const result = await window.api('/api/history?mode=notifications&scope=operational');
      alerts = result.notifications || [];
      window.__phase4OperationalAlerts = alerts;
      decorateAll();
    } catch (error) {
      console.warn('PHASE4_INDICATORS_LOAD_FAILED', error.message);
    }
  }

  const observer = new MutationObserver(() => requestAnimationFrame(decorateAll));
  observer.observe(document.body, { childList:true, subtree:true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  window.addEventListener('focus', load);
  window.loadPhase4Indicators = load;
  setTimeout(load, 800);
  setInterval(load, 5 * 60 * 1000);
})();