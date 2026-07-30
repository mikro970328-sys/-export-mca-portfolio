(() => {
  if (window.__dashboardOperationalStateInstalled) return;
  window.__dashboardOperationalStateInstalled = true;

  const byId = id => document.getElementById(id);
  const escHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  function removeDistributionSection() {
    const distribution = byId('statusDistribution');
    const card = distribution?.closest('section.card');
    const grid = card?.parentElement;

    if (card) card.remove();
    if (grid?.classList.contains('dashboard-grid')) {
      grid.style.gridTemplateColumns = '1fr';
    }
  }

  function classifyShipment(shipment) {
    const status = normalize(shipment.operational_status || shipment.last_status || 'registrado');

    if (shipment.active === false || /entreg|delivered|cerrad|closed/.test(status)) return 'delivered';
    if (/esperando liberacion|awaiting release|pendiente de liberacion/.test(status)) return 'awaitingRelease';
    if (/liberad|released|disponible para entrega|available for delivery/.test(status)) return 'released';
    if (/destino|destination|arribo|arrived|descargad|discharged/.test(status)) return 'atDestination';
    if (/transit|transito|salio del puerto|salida del puerto|cargado en el buque|loaded on vessel|en navegacion|navegando|transbordo|transshipment|zarpo|zarpado|booking confirmado|cargado/.test(status)) return 'inTransit';
    return shipment.active === false ? 'delivered' : 'activeOther';
  }

  function calculateOperationalStats(rows = []) {
    const result = {
      total: rows.length,
      active: 0,
      inTransit: 0,
      atDestination: 0,
      awaitingRelease: 0,
      released: 0,
      delivered: 0,
      activeOther: 0
    };

    rows.forEach(shipment => {
      const group = classifyShipment(shipment);
      if (shipment.active !== false && group !== 'delivered') result.active += 1;
      result[group] += 1;
    });

    return result;
  }

  function renderRecentActivity(rows) {
    const target = byId('recentActivity');
    if (!target) return;
    const recent = [...rows]
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
      .slice(0, 6);

    target.innerHTML = recent.length
      ? recent.map(item => `<div class="activity-item"><div class="activity-icon">▣</div><div><div class="activity-title">${escHtml(item.container_number)}</div><div class="activity-sub">${escHtml(item.clients?.name || 'Sin cliente')} · ${escHtml(item.operational_status || item.last_status || 'Registrado')}</div></div><div class="activity-time">${item.updated_at || item.created_at ? new Date(item.updated_at || item.created_at).toLocaleDateString('es-US') : '-'}</div></div>`).join('')
      : '<div class="empty-state">No hay actividad reciente.</div>';
  }

  function renderUnifiedDashboard(apiDashboard = {}) {
    removeDistributionSection();

    const rows = Array.isArray(window.shipments) ? window.shipments : (typeof shipments !== 'undefined' && Array.isArray(shipments) ? shipments : []);
    const stats = calculateOperationalStats(rows);
    const apiStats = apiDashboard.stats || {};
    const target = byId('stats');

    if (target) {
      const cards = [
        ['Clientes', Number(apiStats.clients || 0), 'Base activa', ''],
        ['Contenedores activos', stats.active, 'Operaciones abiertas', 'orange'],
        ['En tránsito', stats.inTransit, 'Movimiento marítimo', ''],
        ['En destino', stats.atDestination, 'Pendientes de proceso', 'warn'],
        ['Esperando liberación', stats.awaitingRelease, 'Requieren seguimiento', 'warn'],
        ['Liberados', stats.released, 'Listos para entrega', 'green'],
        ['Entregados', stats.delivered, 'Operaciones completadas', 'green'],
        ['Total registrados', stats.total, 'Histórico completo', '']
      ];
      target.innerHTML = cards.map(card => `<div class="stat ${card[3]}"><span>${card[0]}</span><b>${card[1]}</b><small>${card[2]}</small></div>`).join('');
    }

    renderRecentActivity(rows);
    return stats;
  }

  window.calculateOperationalStats = calculateOperationalStats;
  window.renderDashboardDetails = () => renderUnifiedDashboard(window.__lastDashboardPayload || {});
  window.renderStats = payload => {
    window.__lastDashboardPayload = payload || {};
    renderUnifiedDashboard(window.__lastDashboardPayload);
  };

  const installRefresh = () => {
    if (typeof window.loadAll !== 'function' || window.__dashboardLoadAllWrapped) return false;
    window.__dashboardLoadAllWrapped = true;
    const original = window.loadAll;
    window.loadAll = async function (...args) {
      const result = await original.apply(this, args);
      renderUnifiedDashboard(window.__lastDashboardPayload || {});
      return result;
    };
    return true;
  };

  if (!installRefresh()) {
    const timer = setInterval(() => {
      if (installRefresh()) clearInterval(timer);
    }, 100);
    setTimeout(() => clearInterval(timer), 10000);
  }

  removeDistributionSection();

  queueMicrotask(() => {
    if (typeof window.loadAll === 'function') window.loadAll();
    else renderUnifiedDashboard({});
  });
})();