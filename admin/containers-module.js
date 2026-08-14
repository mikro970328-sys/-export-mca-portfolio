(() => {
  if (window.__containersModuleInstalled) return;
  window.__containersModuleInstalled = true;

  const byId = id => document.getElementById(id);
  const token = () => localStorage.getItem('export_mca_token') || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const norm = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const EVENTS = [
    { key: 'load', label: 'Cargado en el buque' },
    { key: 'departed', label: 'Salió del puerto' },
    { key: 'arrived', label: 'Llegó al puerto' },
    { key: 'discharged', label: 'Descargado del buque' },
    { key: 'released', label: 'Liberado' },
    { key: 'delivered', label: 'Entregado' }
  ];

  let activeFilter = 'active';
  let menuShipmentId = null;
  let menuTrigger = null;
  let editorPromise = null;

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token()}`,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.details || 'Error');
    return data;
  }

  function installStyles() {
    if (byId('containersModuleStyles')) return;
    const style = document.createElement('style');
    style.id = 'containersModuleStyles';
    style.textContent = `
      .container-actions-cell{width:1%;white-space:nowrap;text-align:right}
      .container-actions-trigger{width:40px!important;height:38px!important;padding:0!important;border:1px solid #cfd7e3!important;border-radius:10px!important;background:#fff!important;color:#06204a!important;font-size:23px!important;line-height:1!important;display:inline-grid!important;place-items:center!important}
      .container-actions-popover{position:fixed;z-index:5100;width:min(300px,calc(100vw - 24px));background:#fff;border:1px solid #dfe5ee;border-radius:14px;box-shadow:0 18px 48px rgba(6,32,74,.22);padding:8px}
      .container-actions-popover.hidden{display:none!important}.container-actions-popover button{width:100%;display:flex;align-items:center;gap:11px;padding:12px 13px;border:0;border-radius:9px;background:#fff;color:#152238;text-align:left;font-size:14px;font-weight:700}.container-actions-popover button:hover{background:#f4f7fb}.container-actions-popover button.danger{color:#b42318}.container-actions-popover button.orange{color:#d66a00}.container-actions-popover button.success{color:#117a37}.container-actions-separator{height:1px;background:#e8edf4;margin:6px 4px}
      .container-mode{display:block;margin-top:5px;font-size:11px;color:#667085}.container-mode.manual{color:#9a6700}.container-mode.failed{color:#b42318}
      .container-details-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}.container-detail-row{padding:11px 0;border-bottom:1px solid #e6ebf2}.container-detail-label{font-size:11px;font-weight:800;text-transform:uppercase;color:#667085;margin-bottom:4px}.container-detail-value{font-size:15px;color:#152238;word-break:break-word}
      .manual-track-overlay{position:fixed;inset:0;background:rgba(3,14,31,.58);display:flex;align-items:flex-end;justify-content:center;padding:0;z-index:5200}.manual-track-panel{width:100%;max-width:620px;max-height:92vh;overflow:auto;background:#fff;border-radius:22px 22px 0 0;padding:22px 18px calc(22px + env(safe-area-inset-bottom));box-shadow:0 -18px 48px rgba(6,32,74,.25)}
      .manual-track-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:18px}.manual-track-head h3{margin:0;color:#06204a;font-size:21px}.manual-track-close{background:#fff!important;color:#06204a!important;border:1px solid #dfe5ee!important;padding:8px 11px!important}
      .manual-track-current-box{padding:13px;border:1px solid #b8c9e4;background:#f3f7fd;border-radius:12px;margin-bottom:16px}.manual-track-current-box small{display:block;color:#667085;margin-bottom:4px}.manual-track-current-box b{color:#06204a}
      .manual-track-list{display:grid;gap:9px;margin:14px 0 18px}.manual-track-step{position:relative;display:grid;grid-template-columns:30px 1fr;gap:10px;align-items:center;padding:11px;border:1px solid #dfe5ee;border-radius:12px;background:#fff;cursor:pointer;transition:border-color .12s,background .12s}.manual-track-step:hover{border-color:#9fb3cf}.manual-track-step.current{background:#edf3ff;border-color:#9db7df}.manual-track-step.selected{border:2px solid #f58220;background:#fff8f2}.manual-track-step-index{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:#edf3ff;color:#06204a;font-size:12px;font-weight:900}.manual-track-step.current .manual-track-step-index{background:#06204a;color:#fff}.manual-track-step.selected .manual-track-step-index{background:#f58220;color:#fff}.manual-track-step-title{font-weight:800}.manual-track-step-note{font-size:11px;color:#667085;margin-top:2px}.manual-track-step.current .manual-track-step-note{color:#174ea6;font-weight:700}
      .manual-track-field label{display:block;margin:12px 0 6px;font-size:13px;font-weight:800}.manual-track-notify{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start;margin-top:16px;padding:13px;border:1px solid #dfe5ee;border-radius:12px;background:#fff;cursor:pointer}.manual-track-notify input{width:18px;height:18px;margin:2px 0 0}.manual-track-notify b{display:block;color:#06204a}.manual-track-notify span{display:block;color:#667085;font-size:11px;margin-top:3px;line-height:1.4}.manual-track-preview{margin-top:14px;padding:12px;border-left:4px solid #06204a;background:#f7f9fc;border-radius:8px;font-size:13px;line-height:1.45}.manual-track-preview.hidden{display:none}.manual-track-actions{display:grid;grid-template-columns:1fr;gap:9px;margin-top:18px}.manual-track-confirm{background:#f58220!important;padding:13px!important}.manual-track-cancel{background:#fff!important;color:#06204a!important;border:1px solid #cfd7e3!important}
      @media(max-width:700px){.container-details-grid{grid-template-columns:1fr}.container-actions-popover{left:12px!important;right:12px!important;bottom:12px!important;top:auto!important;width:auto!important}.manual-track-overlay{align-items:flex-end}.container-actions-cell{position:sticky;right:0;background:#fff;z-index:2}}
      @media(min-width:700px){.manual-track-overlay{align-items:center;padding:20px}.manual-track-panel{border-radius:18px;padding:24px}.manual-track-actions{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
  }

  function registerHtml() {
    return `<section class="card"><h2>Registrar contenedor</h2>
      <label>Cliente *</label><select id="shipmentClient"><option value="">Seleccionar cliente</option></select>
      <label>Número de contenedor *</label><input id="shipmentContainer" placeholder="ABCD1234567" maxlength="11">
      <label>Booking</label><input id="shipmentBooking">
      <label>B/L</label><input id="shipmentBol">
      <label>Naviera</label><input id="shipmentCarrier" placeholder="Crowley">
      <label>Producto</label><input id="shipmentProduct">
      <div style="margin-top:14px"><button id="saveShipment" class="orange" type="button">Guardar contenedor</button></div>
      <div id="shipmentMsg" class="msg" role="status" aria-live="polite"></div>
    </section>`;
  }

  function trackingHtml() {
    return `<section class="card"><h2>Tracking</h2>
      <input id="shipmentSearch" class="search" placeholder="Buscar cliente, contenedor, booking, B/L o producto">
      <div class="tabs" style="margin-top:12px">
        <button class="tab active" type="button" data-container-filter="active">Activos</button>
        <button class="tab" type="button" data-container-filter="delivered">Entregados</button>
        <button class="tab" type="button" data-container-filter="all">Todos</button>
      </div>
      <div id="shipments"></div>
    </section>`;
  }

  function ensureSections() {
    const trackingSection = byId('containersSection');
    if (!trackingSection) return false;
    const main = trackingSection.parentElement;
    let registerSection = byId('registerContainerSection');
    if (!registerSection) {
      registerSection = document.createElement('section');
      registerSection.id = 'registerContainerSection';
      registerSection.className = 'app-section hidden';
      main.insertBefore(registerSection, trackingSection);
    }
    registerSection.innerHTML = registerHtml();
    trackingSection.innerHTML = trackingHtml();

    const trackingNav = document.querySelector('[data-section="containersSection"]');
    if (trackingNav) {
      trackingNav.textContent = 'Tracking';
      let registerNav = document.querySelector('[data-section="registerContainerSection"]');
      if (!registerNav) {
        registerNav = document.createElement('button');
        registerNav.type = 'button';
        registerNav.dataset.section = 'registerContainerSection';
        registerNav.textContent = 'Registrar contenedor';
        trackingNav.parentElement.insertBefore(registerNav, trackingNav);
      }
      if (registerNav.dataset.containersModuleBound !== '1') {
        registerNav.dataset.containersModuleBound = '1';
        registerNav.addEventListener('click', () => window.showSection?.('registerContainerSection'));
      }
    }

    try {
      titles.registerContainerSection = 'Registrar contenedor';
      titles.containersSection = 'Tracking';
    } catch {}
    return true;
  }

  function clientOptions() {
    const rows = typeof clients !== 'undefined' && Array.isArray(clients) ? clients : [];
    return '<option value="">Seleccionar cliente</option>' + rows.map(client => `<option value="${esc(client.id)}">${esc(client.name)}${client.company ? ' · ' + esc(client.company) : ''}</option>`).join('');
  }

  function fillShipmentClientSelect() {
    const select = byId('shipmentClient');
    if (!select) return;
    const selected = select.value;
    select.innerHTML = clientOptions();
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
  }

  function note(message, ok = false) {
    const target = byId('shipmentMsg');
    if (!target) return;
    target.textContent = message;
    target.className = `msg ${ok ? 'ok' : 'bad'}`;
  }

  async function activateManual(shipment) {
    if (!confirm(`ShipsGo no pudo activar el tracking de ${shipment.container_number}.\n\n¿Deseas continuar este contenedor en modo manual?`)) return;
    await request('/api/tracking-mode', { method: 'PATCH', body: JSON.stringify({ id: shipment.id, action: 'enable_manual' }) });
    alert('Seguimiento manual activado. Tú controlarás las actualizaciones de este contenedor.');
  }

  async function saveShipmentRecord() {
    const button = byId('saveShipment');
    if (!button || button.disabled) return;
    const clientId = byId('shipmentClient')?.value || '';
    const containerNumber = norm(byId('shipmentContainer')?.value || '');
    if (!clientId) return note('Selecciona un cliente.');
    if (!/^[A-Z]{4}\d{7}$/.test(containerNumber)) return note('El contenedor debe tener 4 letras y 7 números.');

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Guardando...';
    try {
      const result = await request('/api/shipments', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          container_number: containerNumber,
          booking_number: byId('shipmentBooking')?.value || '',
          bol_number: byId('shipmentBol')?.value || '',
          carrier: byId('shipmentCarrier')?.value || '',
          product: byId('shipmentProduct')?.value || ''
        })
      });
      note('Contenedor registrado correctamente.', true);
      ['shipmentContainer','shipmentBooking','shipmentBol','shipmentCarrier','shipmentProduct'].forEach(id => { if (byId(id)) byId(id).value = ''; });
      if (typeof window.loadAll === 'function') await window.loadAll();
      if (result.shipment?.shipsgo_status === 'failed') {
        await activateManual(result.shipment);
        if (typeof window.loadAll === 'function') await window.loadAll();
      }
    } catch (error) {
      note(error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function modeLabel(shipment) {
    if (shipment.shipsgo_status === 'manual') return ['Seguimiento manual', 'manual'];
    if (shipment.shipsgo_status === 'active') return ['ShipsGo automático', ''];
    if (shipment.shipsgo_status === 'failed') return ['ShipsGo con error', 'failed'];
    return ['ShipsGo pendiente', ''];
  }

  function searchable(shipment) {
    return [shipment.container_number, shipment.booking_number, shipment.bol_number, shipment.carrier, shipment.product, shipment.operational_status, shipment.last_status, shipment.clients?.name, shipment.clients?.company, shipment.clients?.phone].filter(Boolean).join(' ').toLowerCase();
  }

  function filteredShipments() {
    const rows = typeof shipments !== 'undefined' && Array.isArray(shipments) ? shipments : [];
    const q = String(byId('shipmentSearch')?.value || '').toLowerCase().trim();
    let list = activeFilter === 'active' ? rows.filter(row => row.active !== false) : activeFilter === 'delivered' ? rows.filter(row => row.active === false) : [...rows];
    if (q) list = list.filter(row => searchable(row).includes(q));
    return list;
  }

  function renderShipmentTable() {
    const target = byId('shipments');
    if (!target) return;
    closeActionMenu();
    const list = filteredShipments();
    if (!list.length) {
      target.innerHTML = '<div class="empty-state">No hay resultados.</div>';
      return;
    }
    target.innerHTML = `<table><thead><tr><th>Contenedor</th><th>Cliente</th><th>Booking/B-L</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${list.map(shipment => {
      const mode = modeLabel(shipment);
      return `<tr data-shipment-row="${esc(shipment.id)}"><td><b>${esc(shipment.container_number)}</b><br><span class="muted">${esc(shipment.carrier || '')}</span></td><td>${esc(shipment.clients?.name || '-')}</td><td>${esc(shipment.booking_number || '-')}<br>${esc(shipment.bol_number || '-')}</td><td><span class="pill ${shipment.active === false ? 'done' : ''}">${esc(shipment.operational_status || shipment.last_status || 'Registrado')}</span><span class="container-mode ${mode[1]}">${esc(mode[0])}</span></td><td class="container-actions-cell"><button type="button" class="container-actions-trigger" data-container-menu="${esc(shipment.id)}" aria-label="Acciones" title="Acciones">⋯</button></td></tr>`;
    }).join('')}</tbody></table>`;
  }

  function findShipment(id) {
    const rows = typeof shipments !== 'undefined' && Array.isArray(shipments) ? shipments : [];
    return rows.find(row => String(row.id) === String(id));
  }

  function actionList(shipment) {
    const status = String(shipment.operational_status || shipment.last_status || '').toLowerCase();
    const delivered = shipment.active === false || status.includes('entregado');
    const released = status.includes('liberad');
    const actions = [['info', 'Información', ''], ['edit', 'Editar', ''], ['history', 'Historial', '']];
    if (shipment.shipsgo_status === 'manual') {
      actions.push(['manual_update', 'Actualizar / corregir estado', '']);
      actions.push([shipment.shipsgo_tracking_id ? 'resume_auto' : 'reconnect', shipment.shipsgo_tracking_id ? 'Volver a automático' : 'Reconectar ShipsGo', '']);
    } else {
      if (!delivered) actions.push(['enable_manual', 'Cambiar a manual', '']);
      if (shipment.shipsgo_status === 'failed') actions.push(['reconnect', 'Reconectar ShipsGo', '']);
      if (!released && !delivered) actions.push(['release', 'Liberar', 'orange']);
      if (!delivered) actions.push(['deliver', 'Entregado', 'success']);
    }
    if (delivered && shipment.shipsgo_status !== 'manual') actions.push(['reactivate', 'Reactivar', 'success']);
    actions.push(['delete', 'Eliminar', 'danger']);
    return actions;
  }

  function ensureMenu() {
    let menu = byId('containerActionsPopover');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'containerActionsPopover';
      menu.className = 'container-actions-popover hidden';
      menu.setAttribute('role', 'menu');
      document.body.appendChild(menu);
      document.addEventListener('click', event => {
        if (!menu.classList.contains('hidden') && !menu.contains(event.target) && !menuTrigger?.contains(event.target)) closeActionMenu();
      });
      window.addEventListener('resize', closeActionMenu);
      window.addEventListener('scroll', closeActionMenu, true);
    }
    return menu;
  }

  function closeActionMenu() {
    const menu = byId('containerActionsPopover');
    menu?.classList.add('hidden');
    if (menu) menu.innerHTML = '';
    menuShipmentId = null;
    menuTrigger = null;
  }

  function positionMenu(menu, trigger) {
    if (window.matchMedia('(max-width:700px)').matches) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
    menu.style.left = `${left}px`;
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.top = '0px';
    menu.classList.remove('hidden');
    const height = menu.offsetHeight;
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 8);
    menu.style.top = `${top}px`;
  }

  function openActionMenu(shipment, trigger) {
    const menu = ensureMenu();
    if (menuShipmentId === shipment.id && !menu.classList.contains('hidden')) return closeActionMenu();
    closeActionMenu();
    menuShipmentId = shipment.id;
    menuTrigger = trigger;
    const actions = actionList(shipment);
    menu.innerHTML = actions.map(([key, label, cls], index) => `${key === 'delete' && index ? '<div class="container-actions-separator"></div>' : ''}<button type="button" class="${cls}" data-container-action="${key}">${esc(label)}</button>`).join('');
    menu.querySelectorAll('[data-container-action]').forEach(button => button.addEventListener('click', async event => {
      event.stopPropagation();
      const action = button.dataset.containerAction;
      closeActionMenu();
      try { await executeAction(shipment, action); } catch (error) { alert(error.message); }
    }));
    menu.classList.remove('hidden');
    positionMenu(menu, trigger);
  }

  function detailRow(label, value) {
    return `<div class="container-detail-row"><div class="container-detail-label">${esc(label)}</div><div class="container-detail-value">${esc(value || 'No disponible')}</div></div>`;
  }

  function openDetails(shipment) {
    const mode = modeLabel(shipment)[0];
    const client = shipment.clients || {};
    const html = `<div class="container-details-grid"><section><h3 style="margin:0 0 8px;color:#06204a">Cliente</h3>${detailRow('Nombre', client.name)}${detailRow('Empresa', client.company)}${detailRow('WhatsApp', client.phone)}</section><section><h3 style="margin:0 0 8px;color:#06204a">Contenedor</h3>${detailRow('Número de contenedor', shipment.container_number)}${detailRow('Producto', shipment.product)}${detailRow('Booking', shipment.booking_number)}${detailRow('B/L', shipment.bol_number)}${detailRow('Naviera', shipment.carrier)}${detailRow('Estado operativo', shipment.operational_status || shipment.last_status)}${detailRow('Ubicación', shipment.last_location)}${detailRow('Modo de tracking', mode)}</section></div>`;
    if (typeof window.openModal === 'function') window.openModal(`Detalles · ${shipment.container_number}`, html);
  }

  async function openHistory(shipment) {
    const result = await request('/api/history?shipment_id=' + encodeURIComponent(shipment.id));
    const events = [...(result.events || []), ...(result.notifications || []).map(n => ({ title: 'WhatsApp · ' + (n.event_type || n.event_status || 'Notificación'), details: n.error_message || n.status || n.delivery_status || '', created_at: n.created_at })), ...(result.audit_events || []).map(a => ({ title: a.title || a.action || 'Cambio administrativo', details: typeof a.details === 'string' ? a.details : JSON.stringify(a.details || {}), created_at: a.created_at }))].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const html = events.length ? `<div class="timeline">${events.map(event => `<div class="event"><b>${esc(event.title || 'Evento')}</b><div>${esc(event.details || '')}</div><div class="muted">${event.created_at ? new Date(event.created_at).toLocaleString('es-US') : '-'}</div></div>`).join('')}</div>` : '<div class="empty-state">No hay historial disponible.</div>';
    window.openModal?.(`Historial · ${shipment.container_number}`, html);
  }

  function currentEventIndex(shipment) {
    const status = String(shipment.last_status || shipment.operational_status || '').trim().toLowerCase();
    return EVENTS.findIndex(event => event.label.toLowerCase() === status);
  }

  function closeManualWorkflow() {
    document.querySelector('.manual-track-overlay')?.remove();
  }

  function showManualResult(result) {
    const correction = result.correction_type === 'rollback' ? 'Corrección guardada. ' : '';
    if (result.notification_status === 'not_requested') return alert(`${correction}Estado actualizado. No se envió WhatsApp al cliente.`);
    if (result.notification_status === 'unavailable_recipient') return alert(`${correction}Estado actualizado, pero no se pudo enviar WhatsApp:\n${result.notification_error || 'El cliente no tiene un WhatsApp activo.'}`);
    if (result.notification_status === 'failed') return alert(`${correction}Estado actualizado, pero falló el WhatsApp:\n${result.notification_error || 'Error desconocido'}`);
    if (result.notification_status === 'pending_template') return alert(`${correction}Estado actualizado. Falta configurar ${result.missing_variable} en Vercel para enviar el WhatsApp.`);
    if (result.notification_status === 'already_notified') return alert(`${correction}Estado actualizado. El cliente ya había recibido esta etapa y no se envió un WhatsApp duplicado.`);
    alert(`${correction}Estado actualizado y WhatsApp enviado.\nEstado: ${result.notification_status || 'queued'}`);
  }

  function openManualWorkflow(shipment) {
    closeManualWorkflow();
    const currentIndex = currentEventIndex(shipment);
    const currentLabel = currentIndex >= 0 ? EVENTS[currentIndex].label : (shipment.last_status || shipment.operational_status || 'Registrado');
    const defaultIndex = currentIndex >= 0 ? currentIndex : 0;
    const defaultEvent = EVENTS[defaultIndex];
    const overlay = document.createElement('div');
    overlay.className = 'manual-track-overlay';
    overlay.innerHTML = `<div class="manual-track-panel" role="dialog" aria-modal="true" aria-label="Actualizar o corregir tracking manual">
      <div class="manual-track-head"><div><h3>Actualizar / corregir tracking</h3><div class="muted">${esc(shipment.container_number)}</div></div><button type="button" class="manual-track-close">Cerrar</button></div>
      <div class="manual-track-current-box"><small>Estado actual en el ERP</small><b>${esc(currentLabel)}</b><div class="muted" style="margin-top:5px">Puedes seleccionar cualquier etapa, incluso una anterior, para corregir un error.</div></div>
      <div class="manual-track-list">${EVENTS.map((event, index) => {
        const isCurrent = index === currentIndex;
        const note = isCurrent ? 'Estado actual' : currentIndex >= 0 && index < currentIndex ? 'Etapa anterior · disponible para corrección' : 'Disponible para selección';
        return `<label class="manual-track-step ${isCurrent ? 'current selected' : ''}" data-manual-event-index="${index}">
          <div class="manual-track-step-index">${isCurrent ? '●' : index + 1}</div>
          <div><div class="manual-track-step-title">${esc(event.label)}</div><div class="manual-track-step-note">${esc(note)}</div></div>
          <input style="position:absolute;opacity:0;pointer-events:none" type="radio" name="manualTrackingEvent" value="${event.key}" ${index === defaultIndex ? 'checked' : ''}>
        </label>`;
      }).join('')}</div>
      <div class="manual-track-field"><label for="manualTrackingLocation">Puerto o ubicación</label><input id="manualTrackingLocation" placeholder="Opcional" value="${esc(shipment.last_location || '')}"></div>
      <label class="manual-track-notify" for="manualTrackingNotify"><input id="manualTrackingNotify" type="checkbox"><div><b>Enviar WhatsApp al cliente</b><span>Opcional. El cambio de estado se guarda aunque no envíes WhatsApp.</span></div></label>
      <div id="manualTrackingWhatsappPreview" class="manual-track-preview hidden"><b>Vista previa del WhatsApp</b><br>Contenedor: ${esc(shipment.container_number)}<br>Estado: <span id="manualTrackingPreviewStatus">${esc(defaultEvent.label)}</span></div>
      <div class="manual-track-actions"><button type="button" class="manual-track-confirm">Guardar estado</button><button type="button" class="manual-track-cancel">Cancelar</button></div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('.manual-track-close').onclick = closeManualWorkflow;
    overlay.querySelector('.manual-track-cancel').onclick = closeManualWorkflow;
    overlay.addEventListener('click', event => { if (event.target === overlay) closeManualWorkflow(); });

    const selectedIndex = () => EVENTS.findIndex(event => event.key === overlay.querySelector('input[name="manualTrackingEvent"]:checked')?.value);
    const syncSelectionUi = () => {
      const index = selectedIndex();
      overlay.querySelectorAll('.manual-track-step').forEach(step => step.classList.toggle('selected', Number(step.dataset.manualEventIndex) === index));
      const previewStatus = overlay.querySelector('#manualTrackingPreviewStatus');
      if (previewStatus && EVENTS[index]) previewStatus.textContent = EVENTS[index].label;
    };

    overlay.querySelectorAll('.manual-track-step').forEach(step => step.addEventListener('click', () => {
      const radio = step.querySelector('input[type="radio"]');
      if (!radio) return;
      radio.checked = true;
      syncSelectionUi();
    }));

    const notifyCheckbox = overlay.querySelector('#manualTrackingNotify');
    const preview = overlay.querySelector('#manualTrackingWhatsappPreview');
    const confirmButton = overlay.querySelector('.manual-track-confirm');
    const syncNotificationUi = () => {
      const notify = Boolean(notifyCheckbox.checked);
      preview.classList.toggle('hidden', !notify);
      const index = selectedIndex();
      const isRollback = currentIndex >= 0 && index >= 0 && index < currentIndex;
      confirmButton.textContent = notify
        ? (isRollback ? 'Corregir y enviar WhatsApp' : 'Guardar y enviar WhatsApp')
        : (isRollback ? 'Guardar corrección' : 'Guardar estado');
    };
    notifyCheckbox.addEventListener('change', syncNotificationUi);
    overlay.querySelectorAll('.manual-track-step').forEach(step => step.addEventListener('click', syncNotificationUi));
    syncSelectionUi();
    syncNotificationUi();

    confirmButton.onclick = async () => {
      const index = selectedIndex();
      const selected = EVENTS[index];
      if (!selected) return alert('Selecciona un evento.');
      const notifyWhatsApp = Boolean(notifyCheckbox.checked);
      const isRollback = currentIndex >= 0 && index < currentIndex;
      const isSame = currentIndex >= 0 && index === currentIndex;
      const actionText = isRollback
        ? `Vas a corregir el estado de “${currentLabel}” a “${selected.label}”. Los hitos posteriores quedarán revertidos en el ERP.`
        : isSame
          ? `Vas a guardar nuevamente “${selected.label}”. Esto permite corregir la ubicación u otros datos de esta etapa.`
          : `Vas a actualizar el estado a “${selected.label}”.`;
      const messageText = notifyWhatsApp ? '\n\nTambién se intentará enviar el WhatsApp correspondiente.' : '\n\nNo se enviará WhatsApp.';
      if (!confirm(`${actionText}${messageText}`)) return;

      try {
        confirmButton.disabled = true;
        confirmButton.textContent = notifyWhatsApp ? 'Guardando y enviando...' : 'Guardando...';
        const result = await request('/api/manual-tracking-event', {
          method: 'PATCH',
          body: JSON.stringify({
            id: shipment.id,
            event: selected.key,
            location: String(overlay.querySelector('#manualTrackingLocation')?.value || '').trim(),
            notify_whatsapp: notifyWhatsApp
          })
        });
        closeManualWorkflow();
        showManualResult(result);
        if (typeof window.loadAll === 'function') await window.loadAll();
        if (typeof window.loadNotifications === 'function') await window.loadNotifications();
      } catch (error) {
        alert(error.message);
        confirmButton.disabled = false;
        syncNotificationUi();
      }
    };
  }

  function ensureShipmentEditor() {
    const isModernEditor = () => typeof window.editShipment === 'function' && !/prompt\(['\"]Contenedor/.test(String(window.editShipment));
    if (isModernEditor()) {
      try { window.editShipment.__containersOwner = true; } catch {}
      return Promise.resolve();
    }
    if (editorPromise) return editorPromise;
    editorPromise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled || !isModernEditor()) return false;
        settled = true;
        try { window.editShipment.__containersOwner = true; } catch {}
        resolve();
        return true;
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(new Error('No se pudo cargar el editor de contenedores.'));
      };
      let existing = document.querySelector('script[data-shipment-editor]');
      if (!existing) {
        existing = document.createElement('script');
        existing.src = '/admin/shipment-editor.js?v=20260814-containers-owner1';
        existing.dataset.shipmentEditor = 'containers-module';
        document.head.appendChild(existing);
      }
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', fail, { once: true });
      if (finish()) return;
      const started = Date.now();
      const timer = setInterval(() => {
        if (finish()) return clearInterval(timer);
        if (Date.now() - started > 3000) { clearInterval(timer); fail(); }
      }, 50);
    });
    return editorPromise;
  }

  async function executeAction(shipment, action) {
    if (action === 'info') return openDetails(shipment);
    if (action === 'history') return openHistory(shipment);
    if (action === 'edit') { await ensureShipmentEditor(); return window.editShipment(shipment.id); }
    if (action === 'manual_update') return openManualWorkflow(shipment);
    if (action === 'enable_manual') {
      if (!confirm(`¿Cambiar ${shipment.container_number} a seguimiento manual?\n\nShipsGo dejará de controlar los eventos. En cada actualización podrás decidir si deseas enviar WhatsApp al cliente.`)) return;
      await request('/api/tracking-mode', { method: 'PATCH', body: JSON.stringify({ id: shipment.id, action: 'enable_manual' }) });
      alert('Seguimiento manual activado.');
      return window.loadAll?.();
    }
    if (action === 'resume_auto') {
      if (!confirm(`¿Volver ${shipment.container_number} al seguimiento automático?`)) return;
      await request('/api/tracking-mode', { method: 'PATCH', body: JSON.stringify({ id: shipment.id, action: 'enable_auto' }) });
      alert('Seguimiento automático reanudado.');
      return window.loadAll?.();
    }
    if (action === 'reconnect') {
      if (!confirm(`¿Reintentar ShipsGo para ${shipment.container_number}?`)) return;
      await request('/api/shipments', { method: 'PATCH', body: JSON.stringify({ id: shipment.id, action: 'retry_shipsgo' }) });
      alert('ShipsGo quedó conectado y el seguimiento automático está activo.');
      return window.loadAll?.();
    }
    if (['release','deliver','reactivate'].includes(action)) {
      const labels = { release: 'liberar', deliver: 'marcar como entregado', reactivate: 'reactivar' };
      if (!confirm(`¿Confirmar ${labels[action]} el contenedor ${shipment.container_number}?`)) return;
      const result = await request('/api/shipments', { method: 'PATCH', body: JSON.stringify({ id: shipment.id, action }) });
      if (result.notification_status) alert('Estado actualizado. Notificación: ' + result.notification_status);
      await window.loadAll?.();
      if (typeof window.loadNotifications === 'function') await window.loadNotifications();
      return;
    }
    if (action === 'delete') return deleteShipmentRecord(shipment);
  }

  async function deleteShipmentRecord(shipment) {
    const confirmation = prompt(`Para eliminar definitivamente ${shipment.container_number} del ERP y ShipsGo, escribe ELIMINAR`);
    if (confirmation !== 'ELIMINAR') return;
    await request('/api/shipments?id=' + encodeURIComponent(shipment.id), { method: 'DELETE' });
    alert(`Contenedor ${shipment.container_number} eliminado.`);
    await window.loadAll?.();
    if (typeof window.loadNotifications === 'function') await window.loadNotifications();
  }

  function bindTrackingEvents() {
    byId('shipmentSearch')?.addEventListener('input', renderShipmentTable);
    document.querySelectorAll('[data-container-filter]').forEach(button => button.addEventListener('click', () => {
      activeFilter = button.dataset.containerFilter;
      document.querySelectorAll('[data-container-filter]').forEach(item => item.classList.toggle('active', item === button));
      renderShipmentTable();
    }));
    byId('shipments')?.addEventListener('click', event => {
      const trigger = event.target.closest('[data-container-menu]');
      if (trigger) {
        event.stopPropagation();
        const shipment = findShipment(trigger.dataset.containerMenu);
        if (shipment) openActionMenu(shipment, trigger);
        return;
      }
      const row = event.target.closest('[data-shipment-row]');
      if (!row || event.target.closest('button,a,input,select,textarea')) return;
      const shipment = findShipment(row.dataset.shipmentRow);
      if (shipment) openDetails(shipment);
    });
  }

  function exposeOwnership() {
    window.renderShipments = renderShipmentTable;
    try { renderShipments = renderShipmentTable; } catch {}
    window.deleteShipment = async id => {
      const shipment = findShipment(id);
      if (shipment) return deleteShipmentRecord(shipment);
    };
    window.__containersModule = { render: renderShipmentTable, openManualWorkflow, openDetails, owner: 'containers-module.js' };
  }

  function mount() {
    if (!ensureSections()) return;
    installStyles();
    exposeOwnership();
    fillShipmentClientSelect();
    byId('saveShipment')?.addEventListener('click', saveShipmentRecord);
    bindTrackingEvents();
    window.addEventListener('export-mca:clients-changed', fillShipmentClientSelect);
    renderShipmentTable();
    ensureShipmentEditor().catch(error => console.warn('SHIPMENT_EDITOR_LOAD_FAILED', error.message));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
