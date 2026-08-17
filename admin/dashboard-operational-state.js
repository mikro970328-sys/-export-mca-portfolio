(() => {
  if (window.__dashboardOperationalStateInstalled) return;
  window.__dashboardOperationalStateInstalled = true;

  const byId = id => document.getElementById(id);
  const escHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt',"'":'&#39;','"':'&quot;' }[c]));

  function ensureDashboardStructure() {
    const section = byId('dashboardSection');
    if (!section) return false;
    if (section.dataset.dashboardOwner === 'operational-v2') return true;

    section.dataset.dashboardOwner = 'operational-v2';
    section.innerHTML = `
      <section class="card dashboard-hero">
        <h1>Centro de Operaciones</h1>
        <p>Lo importante de la operación, organizado para actuar rápido.</p>
        <div class="dashboard-meta">
          <span class="dashboard-chip" id="dashboardDate"></span>
          <span class="dashboard-chip">Admin Portal</span>
          <span class="dashboard-chip" id="dashboardFreshness">Actualizando…</span>
        </div>
      </section>

      <section class="card">
        <div class="section-head"><h3>Acciones rápidas</h3><span class="muted">Ir directo a la tarea que necesitas.</span></div>
        <div class="dashboard-quick-actions">
          <button type="button" class="alt" data-dashboard-section="registerContainerSection">＋ Registrar contenedor</button>
          <button type="button" class="alt" data-dashboard-section="containersSection">◎ Abrir Tracking</button>
          <button type="button" class="alt" data-dashboard-section="newOperationsSection">▤ Ver expedientes</button>
          <button type="button" class="alt" data-dashboard-section="notificationsSection">✉ Centro de alertas</button>
        </div>
      </section>

      <section id="stats" class="stats"></section>

      <section class="dashboard-grid">
        <section class="card">
          <div class="section-head"><h3>Actividad reciente</h3><button class="alt" id="dashboardOpenContainers">Ver contenedores</button></div>
          <div id="recentActivity" class="activity-list"></div>
        </section>
        <section class="card">
          <div class="section-head"><h3>Expedientes</h3><button class="alt" id="dashboardOpenOperations">Abrir expedientes</button></div>
          <div id="dashboardOperationSummary" class="status-list"></div>
        </section>
      </section>

      <section class="card">
        <div class="section-head"><h3>Alertas que requieren atención</h3></div>
        <div id="alerts" class="dashboard-alert-list"><div class="empty-state">Cargando alertas operativas…</div></div>
      </section>`;

    const date = byId('dashboardDate');
    if (date) date.textContent = new Date().toLocaleDateString('es-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    byId('dashboardOpenContainers')?.addEventListener('click', () => showSection('containersSection'));
    byId('dashboardOpenOperations')?.addEventListener('click', () => showSection('newOperationsSection'));
    section.querySelectorAll('[data-dashboard-section]').forEach(button => {
      button.addEventListener('click', () => showSection(button.dataset.dashboardSection));
    });

    return true;
  }

  function renderStats(payload) {
    const target = byId('stats');
    if (!target) return;
    const stats = payload.stats || {};
    const cards = [
      ['Clientes', stats.clients, 'Base activa', ''],
      ['Contenedores activos', stats.active, 'Operaciones abiertas', 'orange'],
      ['En tránsito', stats.in_transit, 'Movimiento marítimo', ''],
      ['En destino', stats.at_destination, 'Pendientes de proceso', 'warn'],
      ['Esperando liberación', stats.awaiting_release, 'Requieren seguimiento', 'warn'],
      ['Liberados', stats.released, 'Listos para entrega', 'green'],
      ['Entregados', stats.delivered, 'Operaciones completadas', 'green'],
      ['Total registrados', stats.total, 'Histórico completo', '']
    ];

    target.innerHTML = cards.map(card => `<div class="stat ${card[3]}"><span>${card[0]}</span><b>${Number(card[1] || 0)}</b><small>${card[2]}</small></div>`).join('');
  }

  function renderRecentActivity(payload) {
    const target = byId('recentActivity');
    if (!target) return;
    const rows = Array.isArray(payload.recent_activity) ? payload.recent_activity : [];

    target.innerHTML = rows.length
      ? rows.map(item => `<button type="button" class="activity-item dashboard-activity-button" data-dashboard-section="containersSection"><div class="activity-icon">▣</div><div><div class="activity-title">${escHtml(item.container_number || 'Contenedor')}</div><div class="activity-sub">${escHtml(item.client_name || 'Sin cliente')} · ${escHtml(item.operational_status || 'Registrado')}</div></div><div class="activity-time">${item.updated_at ? new Date(item.updated_at).toLocaleDateString('es-US') : '-'}</div></button>`).join('')
      : '<div class="empty-state">No hay actividad reciente.</div>';

    target.querySelectorAll('[data-dashboard-section]').forEach(button => {
      button.addEventListener('click', () => showSection(button.dataset.dashboardSection));
    });
  }

  function renderOperationSummary(payload) {
    const target = byId('dashboardOperationSummary');
    if (!target) return;
    const operations = payload.operations || {};
    const rows = [
      ['Expedientes activos', operations.active, 'En curso actualmente'],
      ['Sin contenedores vinculados', operations.incomplete, 'Conviene revisar estos expedientes'],
      ['Expedientes cerrados', operations.closed, 'Histórico completado']
    ];

    target.innerHTML = rows.map(row => `<button type="button" class="status-row dashboard-status-button" data-dashboard-section="newOperationsSection"><div class="status-top"><b>${row[0]}</b><span>${Number(row[1] || 0)}</span></div><div class="muted" style="margin-top:6px">${row[2]}</div></button>`).join('');
    target.querySelectorAll('[data-dashboard-section]').forEach(button => {
      button.addEventListener('click', () => showSection(button.dataset.dashboardSection));
    });
  }

  function renderFreshness(payload) {
    const target = byId('dashboardFreshness');
    if (!target) return;
    const generated = payload.generated_at ? new Date(payload.generated_at) : null;
    target.textContent = generated && !Number.isNaN(generated.getTime())
      ? `Actualizado ${generated.toLocaleTimeString('es-US', { hour: '2-digit', minute: '2-digit' })}`
      : 'Datos actualizados';
  }

  function renderUnifiedDashboard(payload = {}) {
    if (!ensureDashboardStructure()) return false;
    renderStats(payload);
    renderRecentActivity(payload);
    renderOperationSummary(payload);
    renderFreshness(payload);
    return true;
  }

  window.renderDashboardDetails = () => renderUnifiedDashboard(window.__lastDashboardPayload || {});
  window.renderStats = payload => {
    window.__lastDashboardPayload = payload || {};
    renderUnifiedDashboard(window.__lastDashboardPayload);
  };
  window.initializeOperationalDashboard = () => renderUnifiedDashboard(window.__lastDashboardPayload || {});
  window.DashboardOperationalState = Object.freeze({
    owner: 'dashboard-operational-state.js',
    source: 'api/dashboard.js',
    render: renderUnifiedDashboard
  });

  ensureDashboardStructure();
})();
