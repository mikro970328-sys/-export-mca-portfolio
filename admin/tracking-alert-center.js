(() => {
  if (window.__trackingAlertCenterInstalled) return;
  window.__trackingAlertCenterInstalled = true;

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  let alerts = [];

  const style = document.createElement('style');
  style.textContent = `
    .tracking-alert-bell{position:relative;width:42px;height:42px;padding:0!important;border-radius:50%!important;background:#fff!important;color:#06204a!important;border:1px solid #dfe5ee!important;font-size:20px!important}
    .tracking-alert-count{position:absolute;top:-5px;right:-5px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:#b42318;color:#fff;font-size:11px;display:grid;place-items:center;font-weight:800}
    .tracking-alert-popover{position:fixed;right:18px;top:78px;width:min(390px,calc(100vw - 24px));max-height:70vh;overflow:auto;background:#fff;border:1px solid #dfe5ee;border-radius:14px;box-shadow:0 20px 60px rgba(6,32,74,.22);z-index:1700;padding:12px}
    .tracking-alert-popover.hidden{display:none!important}
    .tracking-alert-item{border:1px solid #e4e9f1;border-radius:11px;padding:12px;margin-top:10px;background:#fff}
    .tracking-alert-item.critical{border-color:#efb0aa;background:#fff7f6}
    .tracking-alert-item.warning{border-color:#f3d59c;background:#fffaf0}
    .tracking-alert-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
    .tracking-alert-title{font-weight:800;color:#06204a}
    .tracking-alert-meta{font-size:12px;color:#667085;margin-top:5px;line-height:1.45}
    .tracking-alert-actions{display:flex;gap:8px;margin-top:10px}
    .tracking-alert-actions button{padding:8px 10px;font-size:12px}
    .dashboard-tracking-alerts{margin-top:18px}
    .dashboard-tracking-alerts .alert-summary{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:10px}
    .dashboard-tracking-alerts .alert-summary div{border:1px solid #dfe5ee;border-radius:10px;padding:12px;background:#fff}
    @media(max-width:600px){.tracking-alert-popover{right:12px;top:72px}.dashboard-tracking-alerts .alert-summary{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  async function request(path, options = {}) {
    const token = localStorage.getItem('export_mca_token') || '';
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.details || 'Error');
    return data;
  }

  function levelOf(row) { return row.payload?.alert_level || row.event_status || 'warning'; }

  function ensureBell() {
    const actions = document.querySelector('.topbar-actions');
    if (!actions || byId('trackingAlertBell')) return;
    const button = document.createElement('button');
    button.id = 'trackingAlertBell';
    button.className = 'tracking-alert-bell';
    button.type = 'button';
    button.setAttribute('aria-label', 'Alertas de tracking');
    button.innerHTML = '🔔<span id="trackingAlertCount" class="tracking-alert-count hidden">0</span>';
    actions.prepend(button);

    const popover = document.createElement('div');
    popover.id = 'trackingAlertPopover';
    popover.className = 'tracking-alert-popover hidden';
    document.body.appendChild(popover);

    button.onclick = event => {
      event.stopPropagation();
      popover.classList.toggle('hidden');
      renderPopover();
    };
    document.addEventListener('click', event => {
      if (!popover.contains(event.target) && event.target !== button) popover.classList.add('hidden');
    });
  }

  function renderPopover() {
    const popover = byId('trackingAlertPopover');
    if (!popover) return;
    if (!alerts.length) {
      popover.innerHTML = '<div class="toolbar"><b>Alertas de tracking</b></div><div class="muted" style="padding:18px 4px">No hay alertas pendientes.</div>';
      return;
    }
    popover.innerHTML = `<div class="toolbar"><b>Alertas de tracking</b><button class="alt" data-open-notifications>Ver todas</button></div>${alerts.map(row => {
      const level = levelOf(row);
      const p = row.payload || {};
      return `<div class="tracking-alert-item ${esc(level)}"><div class="tracking-alert-head"><div><div class="tracking-alert-title">${esc(p.container_number || row.shipments?.container_number || 'Contenedor')}</div><div class="tracking-alert-meta">${esc(p.title || 'Sin actualización de tracking')}<br>${esc(String(p.hours_without_update || 0))} h sin actualización · Repetición ${esc(String(p.repeat_count || 1))}</div></div><span class="pill">${level === 'critical' ? 'Crítica' : 'Preventiva'}</span></div><div class="tracking-alert-actions"><button class="orange" data-manual-shipment="${esc(row.shipment_id)}">Pasar a manual</button><button class="alt" data-resolve-alert="${esc(row.id)}">Marcar atendida</button></div></div>`;
    }).join('')}`;

    popover.querySelector('[data-open-notifications]')?.addEventListener('click', () => window.showSection?.('notificationsSection'));
    popover.querySelectorAll('[data-resolve-alert]').forEach(button => button.onclick = () => resolveAlert(button.dataset.resolveAlert));
    popover.querySelectorAll('[data-manual-shipment]').forEach(button => button.onclick = () => enableManual(button.dataset.manualShipment));
  }

  function renderDashboardCard() {
    const dashboard = byId('dashboardSection');
    if (!dashboard) return;
    let card = byId('dashboardTrackingAlerts');
    if (!card) {
      card = document.createElement('section');
      card.id = 'dashboardTrackingAlerts';
      card.className = 'card dashboard-tracking-alerts';
      dashboard.appendChild(card);
    }
    const warning = alerts.filter(row => levelOf(row) !== 'critical').length;
    const critical = alerts.filter(row => levelOf(row) === 'critical').length;
    card.innerHTML = `<div class="section-head"><div><h3>Alertas de tracking</h3><div class="muted">Contenedores automáticos sin actualización.</div></div><button class="alt" data-view-alerts>Ver alertas</button></div><div class="alert-summary"><div><b style="font-size:24px;color:#9a6700">${warning}</b><div class="muted">Más de 6 horas</div></div><div><b style="font-size:24px;color:#b42318">${critical}</b><div class="muted">Más de 12 horas</div></div></div>`;
    card.querySelector('[data-view-alerts]').onclick = () => {
      byId('trackingAlertPopover')?.classList.remove('hidden');
      renderPopover();
    };
  }

  async function resolveAlert(id) {
    await request('/api/tracking-alerts', { method: 'PATCH', body: JSON.stringify({ id, action: 'resolve' }) });
    await loadAlerts();
  }

  async function enableManual(shipmentId) {
    if (!confirm('¿Pasar este contenedor a seguimiento manual?')) return;
    await request('/api/tracking-mode', { method: 'PATCH', body: JSON.stringify({ id: shipmentId, action: 'enable_manual' }) });
    const related = alerts.filter(row => row.shipment_id === shipmentId);
    await Promise.all(related.map(row => request('/api/tracking-alerts', { method: 'PATCH', body: JSON.stringify({ id: row.id, action: 'resolve' }) })));
    if (typeof window.loadAll === 'function') await window.loadAll();
    await loadAlerts();
  }

  async function loadAlerts() {
    ensureBell();
    try {
      const result = await request('/api/tracking-alerts');
      alerts = result.alerts || [];
      const count = byId('trackingAlertCount');
      if (count) {
        count.textContent = String(alerts.length);
        count.classList.toggle('hidden', !alerts.length);
      }
      renderPopover();
      renderDashboardCard();
    } catch (error) {
      console.warn('TRACKING_ALERT_CENTER_FAILED', error.message);
    }
  }

  window.loadTrackingAlerts = loadAlerts;
  ensureBell();
  loadAlerts();
  setInterval(loadAlerts, 5 * 60 * 1000);
})();
