(() => {
  const byId = id => document.getElementById(id);
  const escHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  let rows = [];
  let currentFilter = 'all';

  function statusOf(row) {
    return String(row.normalized_status || row.status || row.delivery_status || 'pending').toLowerCase();
  }

  function typeOf(row) {
    return row.notification_type || row.event_type || row.event_status || 'tracking';
  }

  function labelStatus(status) {
    const labels = { queued: 'En cola', sent: 'Enviada', delivered: 'Entregada', read: 'Leída', pending: 'Pendiente', failed: 'Error', undelivered: 'No entregada', accepted: 'Aceptada' };
    return labels[status] || status;
  }

  function render() {
    const target = byId('notificationsList');
    if (!target) return;
    let list = rows;
    if (currentFilter !== 'all') list = rows.filter(row => statusOf(row) === currentFilter);
    if (!list.length) {
      target.innerHTML = '<div class="muted">No hay notificaciones para este filtro.</div>';
      return;
    }
    target.innerHTML = `<table><thead><tr><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Contenedor</th><th>Estado</th><th>Error</th><th>Acciones</th></tr></thead><tbody>${list.map(row => {
      const status = statusOf(row);
      const canRetry = ['failed', 'undelivered', 'pending'].includes(status);
      return `<tr><td>${new Date(row.created_at).toLocaleString()}</td><td><b>${escHtml(row.clients?.name || '-')}</b><br><span class="muted">${escHtml(row.recipient || row.recipient_phone || row.clients?.phone || '')}</span></td><td>${escHtml(typeOf(row))}</td><td>${escHtml(row.shipments?.container_number || row.payload?.container_number || '-')}</td><td><span class="pill ${['sent','delivered','read','accepted','queued'].includes(status) ? 'done' : ''}">${escHtml(labelStatus(status))}</span></td><td>${escHtml(row.error_message || '-')}</td><td>${canRetry ? `<button class="alt" data-retry-notification="${escHtml(row.id)}">Reintentar</button>` : '-'}</td></tr>`;
    }).join('')}</tbody></table>`;
    target.querySelectorAll('[data-retry-notification]').forEach(button => button.onclick = () => retryNotification(button.dataset.retryNotification));
  }

  async function loadNotifications() {
    const target = byId('notificationsList');
    if (target) target.textContent = 'Cargando...';
    try {
      const result = await api('/api/history?mode=notifications');
      rows = result.notifications || [];
      render();
    } catch (error) {
      if (target) target.textContent = error.message;
    }
  }

  async function retryNotification(id) {
    if (!confirm('¿Reintentar esta notificación?')) return;
    try {
      const result = await api('/api/history?mode=notifications', { method: 'PATCH', body: JSON.stringify({ id, action: 'retry' }) });
      alert(`Notificación reenviada. Estado: ${result.status || 'queued'}`);
      await loadNotifications();
      await loadAll();
    } catch (error) {
      alert(error.message);
      await loadNotifications();
    }
  }

  function mount() {
    const section = byId('notificationsSection');
    if (!section) return;
    section.innerHTML = `<section class="card"><div class="toolbar"><div><h2 class="section-title">Centro de notificaciones</h2><div class="muted">Historial de WhatsApp, mensajes pendientes y reintentos.</div></div><button id="reloadNotifications" class="alt">Actualizar</button></div><div class="tabs" style="margin-top:14px"><button class="tab active" data-notification-filter="all">Todas</button><button class="tab" data-notification-filter="pending">Pendientes</button><button class="tab" data-notification-filter="failed">Errores</button><button class="tab" data-notification-filter="sent">Enviadas</button><button class="tab" data-notification-filter="delivered">Entregadas</button></div></section><section class="card"><div id="notificationsList">Cargando...</div></section>`;
    byId('reloadNotifications').onclick = loadNotifications;
    section.querySelectorAll('[data-notification-filter]').forEach(button => button.onclick = () => {
      currentFilter = button.dataset.notificationFilter;
      section.querySelectorAll('[data-notification-filter]').forEach(item => item.classList.toggle('active', item === button));
      render();
    });
    loadNotifications();
  }

  window.loadNotifications = loadNotifications;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();

(() => {
  const STORAGE_KEY = 'export_mca_shipment_table_v1';
  const defaultColumns = ['container','client','product','carrier','booking','bol','status','eta','shipsgo'];
  const columnLabels = {
    container: 'Contenedor', client: 'Cliente', product: 'Producto', carrier: 'Naviera', booking: 'Booking',
    bol: 'B/L', status: 'Estado', eta: 'ETA', shipsgo: 'ShipsGo'
  };
  const state = {
    sortKey: 'created_at', sortDir: 'desc', page: 1, pageSize: 10,
    client: '', carrier: '', status: '', columns: [...defaultColumns]
  };

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    Object.assign(state, saved);
    if (!Array.isArray(state.columns) || !state.columns.length) state.columns = [...defaultColumns];
  } catch {}

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function addStyles() {
    if (document.getElementById('shipmentProStyles')) return;
    const style = document.createElement('style');
    style.id = 'shipmentProStyles';
    style.textContent = `
      .shipment-pro-toolbar{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:10px;margin:14px 0}
      .shipment-pro-toolbar select,.shipment-pro-toolbar button{height:42px}
      .shipment-table-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px}
      .shipment-table-wrap table{margin:0;min-width:1050px}
      .shipment-table-wrap thead th{position:sticky;top:0;background:#f8fafc;z-index:2;white-space:nowrap}
      .shipment-sort{background:transparent;color:var(--muted);padding:0;border:0;font-size:11px;text-transform:uppercase}
      .shipment-sort.active{color:var(--navy)}
      .shipment-row:hover{background:#f8fafc}
      .shipment-main{font-size:14px;color:var(--navy)}
      .shipment-sub{display:block;margin-top:4px;color:var(--muted);font-size:11px}
      .status-chip{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:700;white-space:nowrap}
      .status-chip::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor}
      .status-ok{background:#edf9f0;color:#117a37}.status-warn{background:#fff8e8;color:#9a6700}.status-bad{background:#fff0ef;color:#b42318}.status-info{background:#edf3ff;color:#174ea6}.status-neutral{background:#f2f4f7;color:#475467}
      .tracking-chip{display:inline-block;border-radius:6px;padding:5px 7px;font-size:11px;font-weight:700}.tracking-active{background:#edf9f0;color:#117a37}.tracking-failed{background:#fff0ef;color:#b42318}.tracking-pending{background:#fff8e8;color:#9a6700}
      .eta-late{color:#b42318;font-weight:700}.eta-ok{color:#344054}
      .shipment-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap}
      .shipment-pagination{display:flex;align-items:center;gap:8px}.shipment-pagination button{padding:7px 10px}
      .column-picker{position:relative}.column-picker summary{list-style:none;cursor:pointer;border:1px solid var(--navy);border-radius:8px;padding:10px 12px;color:var(--navy);font-weight:700;background:#fff}.column-picker summary::-webkit-details-marker{display:none}
      .column-menu{position:absolute;right:0;top:46px;z-index:20;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 30px rgba(16,24,40,.15);padding:10px;min-width:190px}.column-menu label{display:flex;align-items:center;gap:8px;margin:0;padding:7px;font-weight:400}.column-menu input{width:auto}
      @media(max-width:900px){.shipment-pro-toolbar{grid-template-columns:1fr 1fr}.shipment-table-wrap{margin-left:-8px;margin-right:-8px}.shipment-footer{align-items:flex-start}}
      @media(max-width:560px){.shipment-pro-toolbar{grid-template-columns:1fr}.shipment-pagination{width:100%;justify-content:space-between}}
    `;
    document.head.appendChild(style);
  }

  function statusMeta(row) {
    const value = String(row.operational_status || row.last_status || 'Registrado').trim();
    const normalized = value.toLowerCase();
    if (row.active === false || /entregado|cerrado/.test(normalized)) return { label: value, cls: 'status-ok' };
    if (/error|fall|retras/.test(normalized)) return { label: value, cls: 'status-bad' };
    if (/liberad|destino|aduana/.test(normalized)) return { label: value, cls: 'status-warn' };
    if (/tránsito|transito|cargado|zarpe/.test(normalized)) return { label: value, cls: 'status-info' };
    return { label: value, cls: 'status-neutral' };
  }

  function trackingMeta(row) {
    const status = String(row.shipsgo_status || 'pending').toLowerCase();
    if (status === 'active') return { label: 'Activo', cls: 'tracking-active' };
    if (status === 'failed') return { label: 'Error', cls: 'tracking-failed' };
    return { label: 'Pendiente', cls: 'tracking-pending' };
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateLabel(value) {
    const date = parseDate(value);
    return date ? date.toLocaleDateString('es-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
  }

  function isLate(row) {
    const eta = parseDate(row.eta || row.estimated_arrival || row.arrival_estimate);
    return Boolean(eta && eta.getTime() < Date.now() && row.active !== false && !/entregado|liberado/i.test(row.operational_status || ''));
  }

  function valueFor(row, key) {
    const map = {
      container: row.container_number || '', client: row.clients?.name || '', product: row.product || '', carrier: row.carrier || '',
      booking: row.booking_number || '', bol: row.bol_number || '', status: row.operational_status || row.last_status || '',
      eta: row.eta || row.estimated_arrival || row.arrival_estimate || '', shipsgo: row.shipsgo_status || '', created_at: row.created_at || ''
    };
    return map[key] ?? '';
  }

  function uniqueValues(key) {
    return [...new Set((shipments || []).map(row => String(valueFor(row, key)).trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'es'));
  }

  function sortRows(list) {
    return [...list].sort((a, b) => {
      const av = valueFor(a, state.sortKey), bv = valueFor(b, state.sortKey);
      const aDate = /date|eta|created/.test(state.sortKey) ? parseDate(av)?.getTime() : null;
      const bDate = /date|eta|created/.test(state.sortKey) ? parseDate(bv)?.getTime() : null;
      const result = aDate != null || bDate != null ? (aDate || 0) - (bDate || 0) : String(av).localeCompare(String(bv), 'es', { numeric: true, sensitivity: 'base' });
      return state.sortDir === 'asc' ? result : -result;
    });
  }

  function getFilteredRows() {
    const query = $('shipmentSearch')?.value?.toLowerCase().trim() || '';
    let list = filter === 'active' ? shipments.filter(x => x.active !== false) : filter === 'delivered' ? shipments.filter(x => x.active === false) : [...shipments];
    if (query) list = list.filter(x => searchable(x).includes(query));
    if (state.client) list = list.filter(x => (x.clients?.name || '') === state.client);
    if (state.carrier) list = list.filter(x => (x.carrier || '') === state.carrier);
    if (state.status) list = list.filter(x => (x.operational_status || x.last_status || 'Registrado') === state.status);
    return sortRows(list);
  }

  function header(key) {
    const arrow = state.sortKey === key ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th><button class="shipment-sort ${state.sortKey === key ? 'active' : ''}" data-sort-shipment="${key}">${columnLabels[key]}${arrow}</button></th>`;
  }

  function cell(row, key) {
    if (key === 'container') return `<td><b class="shipment-main">${esc(row.container_number)}</b><span class="shipment-sub">${esc(row.last_location || '')}</span></td>`;
    if (key === 'client') return `<td><b>${esc(row.clients?.name || '-')}</b><span class="shipment-sub">${esc(row.clients?.company || '')}</span></td>`;
    if (key === 'product') return `<td>${esc(row.product || '-')}</td>`;
    if (key === 'carrier') return `<td>${esc(row.carrier || '-')}</td>`;
    if (key === 'booking') return `<td>${esc(row.booking_number || '-')}</td>`;
    if (key === 'bol') return `<td>${esc(row.bol_number || '-')}</td>`;
    if (key === 'status') { const meta = statusMeta(row); return `<td><span class="status-chip ${meta.cls}">${esc(meta.label)}</span></td>`; }
    if (key === 'eta') { const value = row.eta || row.estimated_arrival || row.arrival_estimate; return `<td class="${isLate(row) ? 'eta-late' : 'eta-ok'}">${dateLabel(value)}${isLate(row) ? '<span class="shipment-sub">Retrasado</span>' : ''}</td>`; }
    if (key === 'shipsgo') { const meta = trackingMeta(row); return `<td><span class="tracking-chip ${meta.cls}">${meta.label}</span>${row.shipsgo_error ? `<span class="shipment-sub" title="${esc(row.shipsgo_error)}">Revisar error</span>` : ''}</td>`; }
    return '<td>-</td>';
  }

  function renderControls() {
    const target = $('shipments');
    if (!target) return;
    let controls = document.getElementById('shipmentProControls');
    if (!controls) {
      controls = document.createElement('div');
      controls.id = 'shipmentProControls';
      target.parentElement.insertBefore(controls, target);
    }
    controls.innerHTML = `<div class="shipment-pro-toolbar">
      <select id="shipmentClientFilter"><option value="">Todos los clientes</option>${uniqueValues('client').map(v => `<option value="${esc(v)}" ${state.client === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <select id="shipmentCarrierFilter"><option value="">Todas las navieras</option>${uniqueValues('carrier').map(v => `<option value="${esc(v)}" ${state.carrier === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <select id="shipmentStatusFilter"><option value="">Todos los estados</option>${uniqueValues('status').map(v => `<option value="${esc(v)}" ${state.status === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <details class="column-picker"><summary>Columnas</summary><div class="column-menu">${defaultColumns.map(key => `<label><input type="checkbox" data-shipment-column="${key}" ${state.columns.includes(key) ? 'checked' : ''}> ${columnLabels[key]}</label>`).join('')}</div></details>
    </div>`;
    $('shipmentClientFilter').onchange = e => { state.client = e.target.value; state.page = 1; saveState(); window.renderShipments(); };
    $('shipmentCarrierFilter').onchange = e => { state.carrier = e.target.value; state.page = 1; saveState(); window.renderShipments(); };
    $('shipmentStatusFilter').onchange = e => { state.status = e.target.value; state.page = 1; saveState(); window.renderShipments(); };
    controls.querySelectorAll('[data-shipment-column]').forEach(input => input.onchange = () => {
      const selected = [...controls.querySelectorAll('[data-shipment-column]:checked')].map(item => item.dataset.shipmentColumn);
      if (!selected.length) { input.checked = true; return; }
      state.columns = selected; saveState(); window.renderShipments();
    });
  }

  window.deleteShipment = async function (id, containerNumber) {
    const confirmation = prompt(`Para eliminar ${containerNumber}, escribe ELIMINAR`);
    if (confirmation === null) return;
    if (confirmation.trim().toUpperCase() !== 'ELIMINAR') {
      alert('Eliminación cancelada. Debes escribir ELIMINAR exactamente.');
      return;
    }
    try {
      await api('/api/shipments?id=' + encodeURIComponent(id), { method: 'DELETE' });
      alert(`Contenedor ${containerNumber} eliminado del ERP.`);
      await loadAll();
      if (window.loadNotifications) await window.loadNotifications();
    } catch (error) { alert(error.message); }
  };

  function installProfessionalTable() {
    if (typeof window.renderShipments !== 'function' || typeof window.api !== 'function' || !document.getElementById('shipments')) {
      setTimeout(installProfessionalTable, 100);
      return;
    }
    addStyles();

    window.renderShipments = function () {
      renderControls();
      const target = $('shipments');
      const list = getFilteredRows();
      const totalPages = Math.max(1, Math.ceil(list.length / state.pageSize));
      if (state.page > totalPages) state.page = totalPages;
      const start = (state.page - 1) * state.pageSize;
      const pageRows = list.slice(start, start + state.pageSize);
      if (!pageRows.length) {
        target.innerHTML = '<div class="muted" style="padding:18px 0">No hay contenedores para los filtros seleccionados.</div>';
        return;
      }
      target.innerHTML = `<div class="shipment-table-wrap"><table><thead><tr>${state.columns.map(header).join('')}<th>Acciones</th></tr></thead><tbody>${pageRows.map(x => `<tr class="shipment-row">${state.columns.map(key => cell(x,key)).join('')}<td><div class="actions"><button class="alt" onclick="editShipment('${x.id}')">Editar</button><button class="alt" onclick="historyView('${x.id}','${esc(x.container_number)}')">Historial</button>${x.active === false ? `<button class="success" onclick="shipmentAction('${x.id}','reactivate')">Reactivar</button>` : `<button class="orange" onclick="shipmentAction('${x.id}','release')">Liberar</button><button class="success" onclick="shipmentAction('${x.id}','deliver')">Entregado</button>`}<button class="danger" onclick="deleteShipment('${x.id}','${esc(x.container_number)}')">Eliminar</button></div></td></tr>`).join('')}</tbody></table></div>
      <div class="shipment-footer"><div class="muted">Mostrando ${start + 1}-${Math.min(start + state.pageSize, list.length)} de ${list.length} contenedores</div><div class="shipment-pagination"><select id="shipmentPageSize" style="width:auto"><option value="10" ${state.pageSize === 10 ? 'selected' : ''}>10 por página</option><option value="25" ${state.pageSize === 25 ? 'selected' : ''}>25 por página</option><option value="50" ${state.pageSize === 50 ? 'selected' : ''}>50 por página</option></select><button class="alt" id="shipmentPrev" ${state.page <= 1 ? 'disabled' : ''}>Anterior</button><span>Página ${state.page} de ${totalPages}</span><button class="alt" id="shipmentNext" ${state.page >= totalPages ? 'disabled' : ''}>Siguiente</button></div></div>`;

      target.querySelectorAll('[data-sort-shipment]').forEach(button => button.onclick = () => {
        const key = button.dataset.sortShipment;
        if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortKey = key; state.sortDir = 'asc'; }
        saveState(); window.renderShipments();
      });
      $('shipmentPrev').onclick = () => { if (state.page > 1) { state.page--; saveState(); window.renderShipments(); } };
      $('shipmentNext').onclick = () => { if (state.page < totalPages) { state.page++; saveState(); window.renderShipments(); } };
      $('shipmentPageSize').onchange = e => { state.pageSize = Number(e.target.value); state.page = 1; saveState(); window.renderShipments(); };
    };

    $('shipmentSearch').oninput = () => { state.page = 1; window.renderShipments(); };
    document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => {
      filter = button.dataset.filter;
      state.page = 1;
      document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('active', item === button));
      window.renderShipments();
    });
    window.renderShipments();
  }

  installProfessionalTable();
})();