(() => {
  if (window.__dashboardOperationalStateInstalled) return;
  window.__dashboardOperationalStateInstalled = true;

  const byId = id => document.getElementById(id);
  const escHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));

  function openSection(sectionId) {
    if (typeof window.showSection === 'function') window.showSection(sectionId);
  }

  function openTracking(filter = null, search = '') {
    openSection('containersSection');

    if (filter) {
      const control = document.querySelector(`[data-container-filter="${filter}"]`);
      if (control) control.click();
    }

    const searchInput = byId('shipmentSearch');
    if (searchInput) {
      searchInput.value = search;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      if (search) searchInput.focus({ preventScroll: true });
    }
  }

  function openRecentShipment(containerNumber) {
    if (!containerNumber) return openTracking('all');
    openTracking('all', containerNumber);
  }

  function activateInteractiveElement(element, action) {
    if (!element || typeof action !== 'function') return;
    element.setAttribute('role', 'link');
    element.setAttribute('tabindex', '0');
    element.classList.add('dashboard-context-link');
    element.addEventListener('click', action);
    element.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      action();
    });
  }

  function ensureDashboardStructure() {
    const section = byId('dashboardSection');
    if (!section) return false;
    if (section.dataset.dashboardOwner === 'operational-v3') return true;

    section.dataset.dashboardOwner = 'operational-v3';
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
    byId('dashboardOpenContainers')?.addEventListener('click', () => openTracking('active'));
    byId('dashboardOpenOperations')?.addEventListener('click', () => openSection('newOperationsSection'));
    return true;
  }

  function renderStats(payload) {
    const target = byId('stats');
    if (!target) return;
    const stats = payload.stats || {};
    const cards = [
      ['Clientes', stats.clients, 'Base activa', '', () => openSection('clientsSection'), 'Abrir clientes'],
      ['Contenedores activos', stats.active, 'Operaciones abiertas', 'orange', () => openTracking('active'), 'Abrir contenedores activos'],
      ['En tránsito', stats.in_transit, 'Movimiento marítimo', '', () => openTracking('active'), 'Abrir Tracking'],
      ['En destino', stats.at_destination, 'Pendientes de proceso', 'warn', () => openTracking('active'), 'Abrir Tracking'],
      ['Esperando liberación', stats.awaiting_release, 'Requieren seguimiento', 'warn', () => openTracking('active'), 'Abrir Tracking'],
      ['Liberados', stats.released, 'Listos para entrega', 'green', () => openTracking('active'), 'Abrir Tracking'],
      ['Entregados', stats.delivered, 'Operaciones completadas', 'green', () => openTracking('delivered'), 'Ver contenedores entregados'],
      ['Total registrados', stats.total, 'Histórico completo', '', () => openTracking('all'), 'Ver todos los contenedores']
    ];

    target.innerHTML = cards.map((card, index) => `<div class="stat ${card[3]}" data-dashboard-stat="${index}" aria-label="${escHtml(card[5])}"><span>${card[0]}</span><b>${Number(card[1] || 0)}</b><small>${card[2]}</small></div>`).join('');
    cards.forEach((card, index) => activateInteractiveElement(target.querySelector(`[data-dashboard-stat="${index}"]`), card[4]));
  }

  function renderRecentActivity(payload) {
    const target = byId('recentActivity');
    if (!target) return;
    const rows = Array.isArray(payload.recent_activity) ? payload.recent_activity : [];
    target.innerHTML = rows.length
      ? rows.map((item, index) => `<div class="activity-item" data-dashboard-recent="${index}" aria-label="Abrir ${escHtml(item.container_number || 'contenedor')} en Tracking"><div class="activity-icon">▣</div><div><div class="activity-title">${escHtml(item.container_number || 'Contenedor')}</div><div class="activity-sub">${escHtml(item.client_name || 'Sin cliente')} · ${escHtml(item.operational_status || 'Registrado')}</div></div><div class="activity-time">${item.updated_at ? new Date(item.updated_at).toLocaleDateString('es-US') : '-'}</div></div>`).join('')
      : '<div class="empty-state">No hay actividad reciente.</div>';

    rows.forEach((item, index) => activateInteractiveElement(
      target.querySelector(`[data-dashboard-recent="${index}"]`),
      () => openRecentShipment(item.container_number)
    ));
  }

  function renderOperationSummary(payload) {
    const target = byId('dashboardOperationSummary');
    if (!target) return;
    const operations = payload.operations || {};
    const rows = [
      ['Expedientes activos', operations.active, 'En curso actualmente'],
      ['Sin contenedores vinculados', operations.incomplete, 'Conviene revisar estos expedientes'],
      ['Expedientes finalizados', operations.closed, 'Todos sus contenedores fueron entregados']
    ];
    target.innerHTML = rows.map((row, index) => `<div class="status-row" data-dashboard-operation="${index}" aria-label="Abrir expedientes"><div class="status-top"><b>${row[0]}</b><span>${Number(row[1] || 0)}</span></div><div class="muted" style="margin-top:6px">${row[2]}</div></div>`).join('');
    rows.forEach((row, index) => activateInteractiveElement(target.querySelector(`[data-dashboard-operation="${index}"]`), () => openSection('newOperationsSection')));
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
  window.DashboardOperationalState = Object.freeze({ owner: 'dashboard-operational-state.js', source: 'api/dashboard.js', render: renderUnifiedDashboard });
  ensureDashboardStructure();
})();
