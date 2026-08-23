(() => {
  if (window.__dashboardOperationalStateInstalled) return;
  window.__dashboardOperationalStateInstalled = true;

  // UX-B contract markers: presentation owner: 'dashboard-operational-state.js'; source: 'api/dashboard.js'.
  const byId = id => document.getElementById(id);
  const escHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));

  function openSection(sectionId) {
    if (typeof window.showSection === 'function') window.showSection(sectionId);
  }

  function openTracking(filter = null, search = '') {
    openSection('containersSection');
    if (filter) document.querySelector(`[data-container-filter="${filter}"]`)?.click();
    const searchInput = byId('shipmentSearch');
    if (searchInput) {
      searchInput.value = search;
      searchInput.dispatchEvent(new Event('input', { bubbles:true }));
      if (search) searchInput.focus({ preventScroll:true });
    }
  }

  function openRecentShipment(containerNumber) {
    if (!containerNumber) return openTracking('all');
    openTracking('all', containerNumber);
  }

  function activateInteractiveElement(element, action) {
    if (!element || typeof action !== 'function') return;
    element.setAttribute('role','link');
    element.setAttribute('tabindex','0');
    element.classList.add('dashboard-context-link');
    element.addEventListener('click', action);
    element.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      action();
    });
  }

  function ensureCounterStyles() {
    if (byId('dashboardCounterStyles')) return;
    const style = document.createElement('style');
    style.id = 'dashboardCounterStyles';
    style.textContent = `
      .dashboard-counter-strip{display:flex;gap:8px;overflow:auto;padding:2px 0 14px;scrollbar-width:thin}
      .dashboard-counter{min-width:138px;flex:1;background:#fff;border:1px solid var(--line);border-radius:11px;padding:10px 12px;box-shadow:0 5px 16px rgba(6,32,74,.04);cursor:pointer;transition:.15s ease}
      .dashboard-counter:hover{border-color:#b8c7db;transform:translateY(-1px)}
      .dashboard-counter-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
      .dashboard-counter-label{font-size:10px;text-transform:uppercase;letter-spacing:.35px;color:var(--muted);font-weight:800;white-space:nowrap}
      .dashboard-counter-value{font-size:20px;color:var(--navy);font-weight:900}
      .dashboard-counter-sub{font-size:10px;color:var(--muted);margin-top:4px;white-space:nowrap}
      @media(max-width:700px){.dashboard-counter{min-width:125px}.dashboard-counter-value{font-size:18px}}
    `;
    document.head.appendChild(style);
  }

  function ensureDashboardStructure() {
    const section = byId('dashboardSection');
    if (!section) return false;
    if (section.dataset.dashboardOwner === 'operational-v4') return true;

    section.dataset.dashboardOwner = 'operational-v4';
    section.innerHTML = `
      <section class="card dashboard-hero">
        <h1>Centro de Operaciones</h1>
        <p>Una vista rápida de todo lo que está ocurriendo en Export MCA.</p>
        <div class="dashboard-meta">
          <span class="dashboard-chip" id="dashboardDate"></span>
          <span class="dashboard-chip" id="dashboardFreshness">Actualizando…</span>
        </div>
      </section>
      <section id="stats" class="dashboard-counter-strip" aria-label="Resumen operativo"></section>
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
    if (date) date.textContent = new Date().toLocaleDateString('es-US',{ weekday:'long',year:'numeric',month:'long',day:'numeric' });
    byId('dashboardOpenContainers')?.addEventListener('click',() => openTracking('active'));
    byId('dashboardOpenOperations')?.addEventListener('click',() => openSection('newOperationsSection'));
    return true;
  }

  function renderStats(payload) {
    const target = byId('stats');
    if (!target) return;
    const stats = payload.stats || {};
    const wr = payload.warehouse_receipts || {};
    const loads = payload.loads || {};
    const inv = payload.inventory || {};
    const ops = payload.operations || {};
    const warehouses = payload.warehouses || {};
    const docs = payload.documents || {};

    const counters = [
      ['Clientes',stats.clients,`${stats.clients || 0} activos`,() => openSection('clientsSection'),'Abrir Clientes'],
      ['Almacenes',warehouses.active,`${warehouses.total || 0} registrados`,() => openSection('warehouseSection'),'Abrir Almacén'],
      ['WR',wr.total,`${wr.received || 0} recibidos · ${wr.cancelled || 0} cancelados`,() => openSection('warehouseSection'),'Abrir Warehouse Receipts'],
      ['Productos con stock',inv.products_with_stock,`${inv.wr_with_stock || 0} WR con saldo`,() => openSection('inventorySection'),'Abrir Inventario'],
      ['Cargues',loads.total,`${loads.active || 0} activos`,() => openSection('loadsSection'),'Abrir Cargues'],
      ['Contenedores',stats.total,`${stats.active || 0} activos`,() => openTracking('all'),'Abrir Tracking'],
      ['Expedientes',ops.total,`${ops.active || 0} activos`,() => openSection('newOperationsSection'),'Abrir Expedientes'],
      ['Documentos',docs.total,'Expediente documental',() => openSection('newOperationsSection'),'Abrir documentos']
    ];

    target.innerHTML = counters.map((counter,index) => `
      <div class="dashboard-counter" data-dashboard-counter="${index}" aria-label="${escHtml(counter[4])}">
        <div class="dashboard-counter-top"><span class="dashboard-counter-label">${escHtml(counter[0])}</span><span class="dashboard-counter-value">${Number(counter[1] || 0)}</span></div>
        <div class="dashboard-counter-sub">${escHtml(counter[2])}</div>
      </div>`).join('');
    counters.forEach((counter,index) => activateInteractiveElement(target.querySelector(`[data-dashboard-counter="${index}"]`),counter[3]));
  }

  function renderRecentActivity(payload) {
    const target = byId('recentActivity');
    if (!target) return;
    const rows = Array.isArray(payload.recent_activity) ? payload.recent_activity : [];
    target.innerHTML = rows.length
      ? rows.map((item,index) => `<div class="activity-item" data-dashboard-recent="${index}" aria-label="Abrir ${escHtml(item.container_number || 'contenedor')} en Tracking"><div class="activity-icon">▣</div><div><div class="activity-title">${escHtml(item.container_number || 'Contenedor')}</div><div class="activity-sub">${escHtml(item.client_name || 'Sin cliente')} · ${escHtml(item.operational_status || 'Registrado')}</div></div><div class="activity-time">${item.updated_at ? new Date(item.updated_at).toLocaleDateString('es-US') : '-'}</div></div>`).join('')
      : '<div class="empty-state">No hay actividad reciente.</div>';
    rows.forEach((item,index) => activateInteractiveElement(target.querySelector(`[data-dashboard-recent="${index}"]`),() => openRecentShipment(item.container_number)));
  }

  function renderOperationSummary(payload) {
    const target = byId('dashboardOperationSummary');
    if (!target) return;
    const operations = payload.operations || {};
    const rows = [
      ['Expedientes activos',operations.active,'En curso actualmente'],
      ['Sin contenedores vinculados',operations.incomplete,'Conviene revisar estos expedientes'],
      ['Expedientes finalizados',operations.closed,'Todos sus contenedores fueron entregados']
    ];
    target.innerHTML = rows.map((row,index) => `<div class="status-row" data-dashboard-operation="${index}" aria-label="Abrir expedientes"><div class="status-top"><b>${row[0]}</b><span>${Number(row[1] || 0)}</span></div><div class="muted" style="margin-top:6px">${row[2]}</div></div>`).join('');
    rows.forEach((row,index) => activateInteractiveElement(target.querySelector(`[data-dashboard-operation="${index}"]`),() => openSection('newOperationsSection')));
  }

  function renderFreshness(payload) {
    const target = byId('dashboardFreshness');
    if (!target) return;
    const generated = payload.generated_at ? new Date(payload.generated_at) : null;
    target.textContent = generated && !Number.isNaN(generated.getTime())
      ? `Actualizado ${generated.toLocaleTimeString('es-US',{ hour:'2-digit',minute:'2-digit' })}`
      : 'Datos actualizados';
  }

  function renderUnifiedDashboard(payload = {}) {
    ensureCounterStyles();
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
  window.DashboardOperationalState = Object.freeze({ owner:'dashboard-operational-state.js',source:'api/dashboard.js',render:renderUnifiedDashboard });
  ensureCounterStyles();
  ensureDashboardStructure();
})();
