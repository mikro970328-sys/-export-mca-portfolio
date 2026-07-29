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
  function installShipmentDelete() {
    if (typeof window.renderShipments !== 'function' || typeof window.api !== 'function') {
      setTimeout(installShipmentDelete, 100);
      return;
    }

    window.deleteShipment = async function (id, containerNumber) {
      const confirmation = prompt(`Para eliminar ${containerNumber}, escribe ELIMINAR`);
      if (confirmation === null) return;
      if (confirmation.trim().toUpperCase() !== 'ELIMINAR') {
        alert('Eliminación cancelada. Debes escribir ELIMINAR exactamente.');
        return;
      }
      try {
        await api('/api/delete-shipment?id=' + encodeURIComponent(id), { method: 'DELETE' });
        alert(`Contenedor ${containerNumber} eliminado del ERP.`);
        await loadAll();
        if (window.loadNotifications) await window.loadNotifications();
      } catch (error) {
        alert(error.message);
      }
    };

    window.renderShipments = function () {
      const q = $('shipmentSearch').value.toLowerCase().trim();
      let list = filter === 'active' ? shipments.filter(x => x.active !== false) : filter === 'delivered' ? shipments.filter(x => x.active === false) : shipments;
      if (q) list = list.filter(x => searchable(x).includes(q));
      $('shipments').innerHTML = list.length ? `<table><thead><tr><th>Contenedor</th><th>Cliente</th><th>Booking/B-L</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${list.map(x => `<tr><td><b>${esc(x.container_number)}</b><br><span class="muted">${esc(x.carrier || '')}</span></td><td>${esc(x.clients?.name || '-')}</td><td>${esc(x.booking_number || '-')}<br>${esc(x.bol_number || '-')}</td><td><span class="pill ${x.active === false ? 'done' : ''}">${esc(x.operational_status || x.last_status || 'Registrado')}</span></td><td><div class="actions"><button class="alt" onclick="editShipment('${x.id}')">Editar</button><button class="alt" onclick="historyView('${x.id}','${esc(x.container_number)}')">Historial</button>${x.active === false ? `<button class="success" onclick="shipmentAction('${x.id}','reactivate')">Reactivar</button>` : `<button class="orange" onclick="shipmentAction('${x.id}','release')">Liberar</button><button class="success" onclick="shipmentAction('${x.id}','deliver')">Entregado</button>`}<button class="danger" onclick="deleteShipment('${x.id}','${esc(x.container_number)}')">Eliminar</button></div></td></tr>`).join('')}</tbody></table>` : 'No hay resultados.';
    };

    window.renderShipments();
  }

  installShipmentDelete();
})();
