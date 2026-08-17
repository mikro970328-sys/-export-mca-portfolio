(() => {
  if (window.__containersModuleInstalled) return;
  window.__containersModuleInstalled = true;

  const byId = id => document.getElementById(id);
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
  let importerState = { importers: [], client_importers: [], shipment_importers: [] };

  async function request(path, options = {}) {
    const token = localStorage.getItem('export_mca_token') || '';
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
      .container-unassigned-row{background:#fffaf0}.container-client-unassigned{display:inline-block;padding:5px 9px;border-radius:999px;background:#fff0c7;color:#8a5700;font-size:11px;font-weight:900}.container-sale-note{display:block;margin-top:4px;color:#9a6700;font-size:10px;font-weight:700}
      .container-details-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}.container-detail-row{padding:11px 0;border-bottom:1px solid #e6ebf2}.container-detail-label{font-size:11px;font-weight:800;text-transform:uppercase;color:#667085;margin-bottom:4px}.container-detail-value{font-size:15px;color:#152238;word-break:break-word}
      .container-documents{grid-column:1/-1;margin-top:20px;padding-top:16px;border-top:1px solid #dfe5ee}.container-documents-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:10px}.container-documents-head h3{margin:0;color:#06204a}.container-documents-list{display:grid;gap:7px}.container-document-row{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 12px;border:1px solid #e1e7ef;border-radius:10px;background:#f8fafc}.container-document-row b{color:#06204a}.container-document-meta{font-size:11px;color:#667085;margin-top:3px}.container-document-scope{font-size:11px;font-weight:800;color:#475467}.container-document-actions{display:flex;gap:7px;justify-content:flex-end}.container-documents-empty{padding:12px;border:1px dashed #cfd7e3;border-radius:10px;color:#667085;background:#fff}.container-documents-footer{display:flex;justify-content:flex-end;margin-top:12px}.container-documents-footer button{min-width:190px}
      .container-importer-help{font-size:11px;color:var(--muted);margin-top:5px;line-height:1.45}.container-importer-pill{display:inline-flex;padding:5px 8px;border-radius:999px;background:#fff3e8;color:#9b4a00;font-size:11px;font-weight:800}
      .manual-track-overlay{position:fixed;inset:0;background:rgba(3,14,31,.58);display:flex;align-items:center;justify-content:center;padding:20px;z-index:5200}.manual-track-panel{width:100%;max-width:620px;max-height:92vh;overflow:auto;background:#fff;border-radius:18px;padding:24px;box-shadow:0 18px 48px rgba(6,32,74,.25)}.manual-track-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:18px}.manual-track-head h3{margin:0;color:#06204a;font-size:21px}.manual-track-close{background:#fff!important;color:#06204a!important;border:1px solid #dfe5ee!important;padding:8px 11px!important}.manual-track-current-box{padding:13px;border:1px solid #b8c9e4;background:#f3f7fd;border-radius:12px;margin-bottom:16px}.manual-track-current-box small{display:block;color:#667085;margin-bottom:4px}.manual-track-current-box b{color:#06204a}.manual-track-list{display:grid;gap:9px;margin:14px 0 18px}.manual-track-step{position:relative;display:grid;grid-template-columns:30px 1fr;gap:10px;align-items:center;padding:11px;border:1px solid #dfe5ee;border-radius:12px;background:#fff;cursor:pointer}.manual-track-step.current{background:#f1f8f3;border-color:#b8dfc1}.manual-track-step.selected{border:2px solid #f58220;background:#fff8f2}.manual-track-step-index{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:#edf3ff;color:#06204a;font-size:12px;font-weight:900}.manual-track-step-title{font-weight:800}.manual-track-step-note{font-size:11px;color:#667085;margin-top:2px}.manual-track-field label{display:block;margin:12px 0 6px;font-size:13px;font-weight:800}.manual-track-notify{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start;margin-top:16px;padding:13px;border:1px solid #dfe5ee;border-radius:12px;background:#fff;cursor:pointer}.manual-track-notify.disabled{opacity:.6;cursor:not-allowed}.manual-track-notify input{width:18px;height:18px;margin:2px 0 0}.manual-track-notify b{display:block;color:#06204a}.manual-track-notify span{display:block;color:#667085;font-size:11px;margin-top:3px;line-height:1.4}.manual-track-preview{margin-top:14px;padding:12px;border-left:4px solid #06204a;background:#f7f9fc;border-radius:8px;font-size:13px;line-height:1.45}.manual-track-preview.hidden{display:none}.manual-track-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:18px}.manual-track-confirm{background:#f58220!important;padding:13px!important}.manual-track-cancel{background:#fff!important;color:#06204a!important;border:1px solid #cfd7e3!important}
      @media(max-width:760px){.container-details-grid{grid-template-columns:1fr}.container-document-row{grid-template-columns:1fr}.container-document-actions{justify-content:flex-start}.container-documents-head{align-items:flex-start;flex-direction:column}.container-documents-footer{justify-content:stretch}.container-documents-footer button{width:100%}.container-actions-popover{left:12px!important;right:12px!important;bottom:12px!important;top:auto!important;width:auto!important}.manual-track-overlay{align-items:flex-end;padding:0}.manual-track-panel{border-radius:22px 22px 0 0;padding:22px 18px calc(22px + env(safe-area-inset-bottom))}.manual-track-actions{grid-template-columns:1fr}.container-actions-cell{position:sticky;right:0;background:#fff;z-index:2}}
    `;
    document.head.appendChild(style);
  }

  function rows() {
    return Array.isArray(window.shipments) ? window.shipments : (typeof shipments !== 'undefined' && Array.isArray(shipments) ? shipments : []);
  }

  function clientRows() {
    return Array.isArray(window.clients) ? window.clients : (typeof clients !== 'undefined' && Array.isArray(clients) ? clients : []);
  }

  async function loadImporterState() {
    try {
      const result = await request('/api/importers');
      importerState = {
        importers: result.importers || [],
        client_importers: result.client_importers || [],
        shipment_importers: result.shipment_importers || []
      };
      window.importerState = importerState;
      return true;
    } catch (error) {
      console.error('[containers importers]', error);
      return false;
    }
  }

  function importerById(id) {
    return importerState.importers.find(item => String(item.id) === String(id || '')) || null;
  }

  function importerIdForShipment(shipmentId) {
    return importerState.shipment_importers.find(item => String(item.shipment_id) === String(shipmentId || ''))?.importer_id || null;
  }

  function importerForShipment(shipment) {
    return importerById(importerIdForShipment(shipment?.id));
  }

  function importerIdsForClient(clientId) {
    return new Set(importerState.client_importers.filter(link => String(link.client_id) === String(clientId || '')).map(link => String(link.importer_id)));
  }

  function importerOptions(clientId = '', selected = '') {
    const linkedIds = clientId ? importerIdsForClient(clientId) : null;
    const list = importerState.importers.filter(importer => importer.active !== false && (!linkedIds || linkedIds.has(String(importer.id))));
    return `<option value="">Sin importadora definida</option>${list.map(importer => `<option value="${esc(importer.id)}" ${String(importer.id) === String(selected || '') ? 'selected' : ''}>${esc(importer.name)}</option>`).join('')}`;
  }

  function ensureRegistrationImporterField() {
    if (byId('shipmentImporter')) return;
    const clientSelect = byId('shipmentClient');
    const clientWrapper = clientSelect?.closest('div');
    if (!clientWrapper) return;
    const wrapper = document.createElement('div');
    wrapper.id = 'shipmentImporterField';
    wrapper.innerHTML = `<label for="shipmentImporter">Importadora cubana</label><select id="shipmentImporter"><option value="">Sin importadora definida</option></select><div id="shipmentImporterHelp" class="container-importer-help">Selecciona por cuál importadora entrará este contenedor.</div>`;
    clientWrapper.insertAdjacentElement('afterend', wrapper);
  }

  function clientOptions(selected = '') {
    return `<option value="">Sin cliente / Disponible para venta</option>${clientRows().map(client => `<option value="${esc(client.id)}" ${String(client.id) === String(selected) ? 'selected' : ''}>${esc(client.name)}${client.company ? ' · ' + esc(client.company) : ''}</option>`).join('')}`;
  }

  function syncClientSelect() {
    const select = byId('shipmentClient');
    if (!select) return;
    const selected = select.value;
    select.innerHTML = clientOptions(selected);
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
    syncImporterSelect();
  }

  function syncImporterSelect() {
    const select = byId('shipmentImporter');
    if (!select) return;
    const clientId = byId('shipmentClient')?.value || '';
    const selected = select.value;
    select.innerHTML = importerOptions(clientId, selected);
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
    else select.value = '';
    const help = byId('shipmentImporterHelp');
    if (!help) return;
    if (!clientId) {
      help.textContent = 'Sin cliente, puedes seleccionar cualquier importadora registrada o dejarla pendiente.';
      return;
    }
    const count = importerIdsForClient(clientId).size;
    help.textContent = count
      ? `Este cliente está registrado en ${count} importadora${count === 1 ? '' : 's'}. Selecciona la que corresponde a este contenedor.`
      : 'Este cliente no tiene importadoras registradas. Puedes dejarla pendiente y agregar sus importadoras desde Clientes.';
  }

  async function assignImporterToShipment(shipmentId, importerId) {
    const result = await request('/api/importers', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'assign_shipment', shipment_id: shipmentId, importer_id: importerId || null })
    });
    if (result.state) {
      importerState = result.state;
      window.importerState = importerState;
    } else {
      await loadImporterState();
    }
    return result;
  }

  function note(message, ok = false) {
    const target = byId('shipmentMsg');
    if (!target) return;
    target.textContent = message;
    target.className = `msg ${ok ? 'ok' : 'bad'}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('es-US', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatQuantity(shipment) {
    if (shipment.quantity === null || shipment.quantity === undefined || shipment.quantity === '') return '—';
    const number = Number(shipment.quantity);
    const value = Number.isFinite(number) ? new Intl.NumberFormat('es-US', { maximumFractionDigits: 3 }).format(number) : shipment.quantity;
    return `${value}${shipment.quantity_unit ? ' ' + shipment.quantity_unit : ''}`;
  }

  function modeLabel(shipment) {
    if (shipment.shipsgo_status === 'manual') return ['Seguimiento manual', 'manual'];
    if (shipment.shipsgo_status === 'active') return ['ShipsGo automático', ''];
    if (shipment.shipsgo_status === 'failed') return ['ShipsGo con error', 'failed'];
    return ['ShipsGo pendiente', ''];
  }

  function searchable(shipment) {
    return [
      shipment.container_number,
      shipment.booking_number,
      shipment.bol_number,
      shipment.carrier,
      shipment.product,
      shipment.quantity,
      shipment.quantity_unit,
      shipment.departure_date,
      shipment.operational_status,
      shipment.last_status,
      shipment.clients?.name,
      shipment.clients?.company,
      shipment.clients?.phone,
      importerForShipment(shipment)?.name,
      shipment.client_id ? '' : 'sin cliente disponible venta'
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function filteredRows() {
    const query = String(byId('shipmentSearch')?.value || '').trim().toLowerCase();
    let list = activeFilter === 'active'
      ? rows().filter(item => item.active !== false)
      : activeFilter === 'delivered'
        ? rows().filter(item => item.active === false)
        : [...rows()];
    if (query) list = list.filter(item => searchable(item).includes(query));
    return list;
  }

  function render() {
    const target = byId('shipments');
    if (!target) return;
    closeActionMenu();
    const list = filteredRows();
    if (!list.length) {
      target.innerHTML = '<div class="empty-state">No hay resultados.</div>';
      return;
    }

    target.innerHTML = `<table><thead><tr><th>Contenedor</th><th>Cliente</th><th>Importadora</th><th>Producto</th><th>Cantidad</th><th>Fecha de salida</th><th>Booking / B/L</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${list.map(shipment => {
      const mode = modeLabel(shipment);
      const unassigned = !shipment.client_id;
      const importer = importerForShipment(shipment);
      const client = unassigned
        ? '<span class="container-client-unassigned">SIN CLIENTE</span><span class="container-sale-note">Disponible para venta</span>'
        : esc(shipment.clients?.name || 'Cliente no disponible');
      return `<tr class="${unassigned ? 'container-unassigned-row' : ''}" data-shipment-row="${esc(shipment.id)}">
        <td><b>${esc(shipment.container_number)}</b><br><span class="muted">${esc(shipment.carrier || '')}</span></td>
        <td>${client}</td>
        <td>${importer ? `<span class="container-importer-pill">${esc(importer.name)}</span>` : '<span class="muted">Sin definir</span>'}</td>
        <td>${esc(shipment.product || '—')}</td>
        <td>${esc(formatQuantity(shipment))}</td>
        <td>${esc(formatDate(shipment.departure_date))}</td>
        <td>${esc(shipment.booking_number || '—')}<br><span class="muted">${esc(shipment.bol_number || '—')}</span></td>
        <td><span class="pill ${shipment.active === false ? 'done' : ''}">${esc(shipment.operational_status || shipment.last_status || 'Registrado')}</span><span class="container-mode ${mode[1]}">${esc(mode[0])}</span></td>
        <td class="container-actions-cell"><button type="button" class="container-actions-trigger" data-container-menu="${esc(shipment.id)}" aria-label="Acciones" title="Acciones">⋯</button></td>
      </tr>`;
    }).join('')}</tbody></table>`;
  }

  async function saveShipmentRecord() {
    const button = byId('saveShipment');
    if (!button || button.disabled) return;
    const containerNumber = norm(byId('shipmentContainer')?.value || '');
    if (!/^[A-Z]{4}\d{7}$/.test(containerNumber)) return note('El contenedor debe tener 4 letras y 7 números.');

    const quantityText = String(byId('shipmentQuantity')?.value || '').trim();
    if (quantityText && (!Number.isFinite(Number(quantityText)) || Number(quantityText) < 0)) return note('La cantidad no es válida.');

    const clientId = byId('shipmentClient')?.value || null;
    const importerId = byId('shipmentImporter')?.value || null;
    if (clientId && importerId && !importerIdsForClient(clientId).has(String(importerId))) {
      return note('La importadora seleccionada no está registrada para este cliente.');
    }

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Guardando...';
    let rollbackShipmentId = null;
    try {
      const result = await request('/api/shipments', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          container_number: containerNumber,
          booking_number: byId('shipmentBooking')?.value || '',
          bol_number: byId('shipmentBol')?.value || '',
          carrier: byId('shipmentCarrier')?.value || '',
          product: byId('shipmentProduct')?.value || '',
          quantity: quantityText || null,
          quantity_unit: byId('shipmentQuantityUnit')?.value || '',
          departure_date: byId('shipmentDepartureDate')?.value || null
        })
      });
      rollbackShipmentId = result.shipment?.id || null;
      if (rollbackShipmentId && importerId) {
        try {
          await assignImporterToShipment(rollbackShipmentId, importerId);
        } catch (assignmentError) {
          try { await request('/api/shipments?id=' + encodeURIComponent(rollbackShipmentId), { method: 'DELETE' }); }
          catch (rollbackError) { console.error('[container importer rollback]', rollbackError); }
          rollbackShipmentId = null;
          throw assignmentError;
        }
      }
      rollbackShipmentId = null;

      note(result.shipment?.client_id ? 'Contenedor registrado correctamente.' : 'Contenedor registrado sin cliente y marcado como disponible para venta.', true);
      ['shipmentContainer','shipmentBooking','shipmentBol','shipmentCarrier','shipmentProduct','shipmentQuantity','shipmentQuantityUnit','shipmentDepartureDate'].forEach(id => {
        if (byId(id)) byId(id).value = '';
      });
      if (byId('shipmentClient')) byId('shipmentClient').value = '';
      if (byId('shipmentImporter')) byId('shipmentImporter').value = '';
      if (typeof window.loadAll === 'function') {
        try { await window.loadAll(); } catch (refreshError) { console.error('[containers refresh]', refreshError); }
      }
      await loadImporterState();
      syncImporterSelect();
      render();

      if (result.shipment?.shipsgo_status === 'failed') {
        const accepted = confirm(`ShipsGo no pudo activar el tracking de ${result.shipment.container_number}.\n\n¿Deseas continuar este contenedor en modo manual?`);
        if (accepted) {
          await request('/api/tracking-mode', {
            method: 'PATCH',
            body: JSON.stringify({ id: result.shipment.id, action: 'enable_manual' })
          });
          if (typeof window.loadAll === 'function') await window.loadAll();
        }
      }
    } catch (error) {
      note(error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function findShipment(id) {
    return rows().find(item => String(item.id) === String(id));
  }

  function actionList(shipment) {
    const status = String(shipment.operational_status || shipment.last_status || '').toLowerCase();
    const delivered = shipment.active === false || status.includes('entregado');
    const released = status.includes('liberad');
    const actions = [['info', 'Información', ''], ['edit', 'Editar', ''], ['history', 'Historial', ''], ['expediente', 'Ver expediente', '']];
    if (!shipment.client_id) actions.push(['assign_client', 'Asignar cliente', 'orange']);

    if (shipment.shipsgo_status === 'manual') {
      actions.push(['manual_update', 'Actualizar / corregir estado', '']);
      actions.push([
        shipment.shipsgo_tracking_id ? 'resume_auto' : 'reconnect',
        shipment.shipsgo_tracking_id ? 'Volver a automático' : 'Reconectar ShipsGo',
        ''
      ]);
    } else {
      if (!delivered) actions.push(['enable_manual', 'Cambiar a manual', '']);
      if (shipment.shipsgo_status === 'failed') actions.push(['reconnect', 'Reconectar ShipsGo', '']);
      if (!released && !delivered) actions.push(['release', 'Liberar', 'orange']);
      if (!delivered) actions.push(['deliver', 'Entregado', 'success']);
    }
    if (delivered) actions.push(['reactivate', 'Reactivar', 'success']);
    actions.push(['delete', 'Eliminar', 'danger']);
    return actions;
  }

  function ensureMenu() {
    let menu = byId('containerActionsPopover');
    if (menu) return menu;
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
    if (window.matchMedia('(max-width:760px)').matches) return;
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
    menu.innerHTML = actions.map(([key, label, className], index) => `${key === 'delete' && index ? '<div class="container-actions-separator"></div>' : ''}<button type="button" class="${className}" data-container-action="${key}">${esc(label)}</button>`).join('');
    menu.querySelectorAll('[data-container-action]').forEach(button => button.addEventListener('click', async event => {
      event.stopPropagation();
      const action = button.dataset.containerAction;
      closeActionMenu();
      try { await executeAction(shipment, action); }
      catch (error) { alert(error.message); }
    }));
    menu.classList.remove('hidden');
    positionMenu(menu, trigger);
  }

  function detailRow(label, value) {
    return `<div class="container-detail-row"><div class="container-detail-label">${esc(label)}</div><div class="container-detail-value">${esc(value || 'No disponible')}</div></div>`;
  }

  function shipmentDocumentScope(item, shipment) {
    if (String(item.shipment_id || '') === String(shipment.id || '')) return 'Contenedor';
    if (item.bol_number && norm(item.bol_number) === norm(shipment.bol_number)) return `B/L ${item.bol_number}`;
    return 'General del expediente';
  }

  function relevantShipmentDocuments(shipment, source) {
    if (!shipment.operation_id || !Array.isArray(source)) return [];
    const bol = norm(shipment.bol_number);
    const unique = new Map();
    source.forEach(item => {
      const ownShipment = String(item.shipment_id || '') === String(shipment.id || '');
      const sameBol = Boolean(bol && item.bol_number && norm(item.bol_number) === bol);
      const general = !item.shipment_id && !item.bol_number && String(item.operation_id || '') === String(shipment.operation_id || '');
      if (ownShipment || sameBol || general) unique.set(String(item.id), item);
    });
    return [...unique.values()].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }

  function shipmentDocumentsHtml(shipment, documents, errorMessage = '') {
    if (!shipment.operation_id) {
      return `<section class="container-documents"><div class="container-documents-head"><div><h3>Documentos</h3><div class="muted">Este contenedor todavía no está vinculado a un expediente.</div></div></div><div class="container-documents-empty">Crea o vincula el expediente para guardar Factura comercial, Packing List, B/L, ficha técnica y demás documentos.</div><div class="container-documents-footer"><button id="containerOpenDocuments" class="orange" type="button">Crear expediente y agregar documentos</button></div></section>`;
    }
    const rowsHtml = documents.length ? documents.map(item => `<div class="container-document-row"><div><b>${esc(item.document_type || 'Documento')}</b><div class="container-document-meta">${esc(item.file_name || 'Archivo')}${item.created_at ? ` · ${esc(new Date(item.created_at).toLocaleDateString('es-US'))}` : ''}</div></div><div class="container-document-scope">${esc(shipmentDocumentScope(item, shipment))}</div><div class="container-document-actions">${item.signed_url ? `<button class="alt" type="button" data-container-document="${esc(item.id)}">Abrir</button>` : '<span class="muted">Sin vista</span>'}</div></div>`).join('') : `<div class="container-documents-empty">${errorMessage ? esc(errorMessage) : 'Todavía no hay documentos aplicables a este contenedor.'}</div>`;
    return `<section class="container-documents"><div class="container-documents-head"><div><h3>Documentos</h3><div class="muted">General del expediente + B/L de este contenedor + archivos propios del contenedor.</div></div><span class="pill ${documents.length ? 'done' : ''}">${documents.length} archivo${documents.length === 1 ? '' : 's'}</span></div><div class="container-documents-list">${rowsHtml}</div><div class="container-documents-footer"><button id="containerOpenDocuments" class="orange" type="button">Ver / agregar documentos</button></div></section>`;
  }

  async function openDetails(shipment) {
    const mode = modeLabel(shipment)[0];
    const client = shipment.clients || {};
    const importer = importerForShipment(shipment);
    let documents = [];
    let documentsError = '';
    if (shipment.operation_id) {
      try {
        const result = await request('/api/documents?operation_id=' + encodeURIComponent(shipment.operation_id));
        documents = relevantShipmentDocuments(shipment, result.documents || []);
      } catch (error) {
        documentsError = 'No se pudieron cargar los documentos en este momento.';
        console.error('[tracking documents]', error);
      }
    }
    const html = `<div class="container-details-grid">
      <section><h3 style="margin:0 0 8px;color:#06204a">Cliente</h3>${detailRow('Nombre', shipment.client_id ? client.name : 'SIN CLIENTE · Disponible para venta')}${detailRow('Empresa', client.company)}${detailRow('WhatsApp', client.phone)}${detailRow('Importadora de este contenedor', importer?.name)}</section>
      <section><h3 style="margin:0 0 8px;color:#06204a">Contenedor</h3>${detailRow('Número de contenedor', shipment.container_number)}${detailRow('Producto', shipment.product)}${detailRow('Cantidad', formatQuantity(shipment))}${detailRow('Fecha de salida', formatDate(shipment.departure_date))}${detailRow('Booking', shipment.booking_number)}${detailRow('B/L', shipment.bol_number)}${detailRow('Naviera', shipment.carrier)}${detailRow('Estado operativo', shipment.operational_status || shipment.last_status)}${detailRow('Ubicación', shipment.last_location)}${detailRow('Modo de tracking', mode)}</section>
      ${shipmentDocumentsHtml(shipment, documents, documentsError)}
    </div>`;
    window.openModal?.(`Detalles · ${shipment.container_number}`, html);
    const documentMap = new Map(documents.map(item => [String(item.id), item]));
    document.querySelectorAll('[data-container-document]').forEach(button => {
      button.onclick = () => {
        const item = documentMap.get(String(button.dataset.containerDocument));
        if (item?.signed_url) window.open(item.signed_url, '_blank', 'noopener');
      };
    });
    byId('containerOpenDocuments')?.addEventListener('click', () => openExpedienteShortcut(shipment), { once: true });
  }

  async function openHistory(shipment) {
    const result = await request('/api/history?shipment_id=' + encodeURIComponent(shipment.id));
    const events = [
      ...(result.events || []),
      ...(result.notifications || []).map(item => ({
        title: 'WhatsApp · ' + (item.event_type || item.event_status || 'Notificación'),
        details: item.error_message || item.status || item.delivery_status || '',
        created_at: item.created_at
      })),
      ...(result.audit_events || []).map(item => ({
        title: item.title || item.action || 'Cambio administrativo',
        details: typeof item.details === 'string' ? item.details : JSON.stringify(item.details || {}),
        created_at: item.created_at
      }))
    ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const html = events.length
      ? `<div class="timeline">${events.map(item => `<div class="event"><b>${esc(item.title || 'Evento')}</b><div>${esc(item.details || '')}</div><div class="muted">${item.created_at ? new Date(item.created_at).toLocaleString('es-US') : '—'}</div></div>`).join('')}</div>`
      : '<div class="empty-state">No hay historial disponible.</div>';
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
    if (result.notification_status === 'unavailable_recipient') return alert(`${correction}Estado actualizado. No hay un cliente con WhatsApp disponible.`);
    if (result.notification_status === 'failed') return alert(`${correction}Estado actualizado, pero falló el WhatsApp:\n${result.notification_error || 'Error desconocido'}`);
    if (result.notification_status === 'pending_template') return alert(`${correction}Estado actualizado. Falta configurar ${result.missing_variable} en Vercel para enviar el WhatsApp.`);
    if (result.notification_status === 'already_notified') return alert(`${correction}Estado actualizado. El cliente ya había recibido esta etapa y no se envió un duplicado.`);
    alert(`${correction}Estado actualizado y WhatsApp enviado.\nEstado: ${result.notification_status || 'queued'}`);
  }

  function openManualWorkflow(shipment) {
    closeManualWorkflow();
    const currentIndex = currentEventIndex(shipment);
    const currentLabel = currentIndex >= 0 ? EVENTS[currentIndex].label : (shipment.last_status || shipment.operational_status || 'Registrado');
    const defaultIndex = currentIndex >= 0 ? currentIndex : 0;
    const defaultEvent = EVENTS[defaultIndex];
    const hasRecipient = Boolean(shipment.client_id && shipment.clients?.active && shipment.clients?.phone);
    const overlay = document.createElement('div');
    overlay.className = 'manual-track-overlay';
    overlay.innerHTML = `<div class="manual-track-panel" role="dialog" aria-modal="true" aria-label="Actualizar o corregir tracking manual">
      <div class="manual-track-head"><div><h3>Actualizar / corregir tracking</h3><div class="muted">${esc(shipment.container_number)}</div></div><button type="button" class="manual-track-close">Cerrar</button></div>
      <div class="manual-track-current-box"><small>Estado actual en el ERP</small><b>${esc(currentLabel)}</b><div class="muted" style="margin-top:5px">Puedes seleccionar cualquier etapa, incluso una anterior, para corregir un error.</div></div>
      <div class="manual-track-list">${EVENTS.map((event, index) => {
        const isCurrent = index === currentIndex;
        const note = isCurrent ? 'Estado actual' : currentIndex >= 0 && index < currentIndex ? 'Etapa anterior · disponible para corrección' : 'Disponible para selección';
        return `<label class="manual-track-step ${isCurrent ? 'current selected' : ''}" data-manual-event-index="${index}"><div class="manual-track-step-index">${isCurrent ? '●' : index + 1}</div><div><div class="manual-track-step-title">${esc(event.label)}</div><div class="manual-track-step-note">${esc(note)}</div></div><input style="position:absolute;opacity:0;pointer-events:none" type="radio" name="manualTrackingEvent" value="${event.key}" ${index === defaultIndex ? 'checked' : ''}></label>`;
      }).join('')}</div>
      <div class="manual-track-field"><label for="manualTrackingLocation">Puerto o ubicación</label><input id="manualTrackingLocation" placeholder="Opcional" value="${esc(shipment.last_location || '')}"></div>
      <label class="manual-track-notify ${hasRecipient ? '' : 'disabled'}" for="manualTrackingNotify"><input id="manualTrackingNotify" type="checkbox" ${hasRecipient ? '' : 'disabled'}><div><b>Enviar WhatsApp al cliente</b><span>${hasRecipient ? 'Opcional. El cambio de estado se guarda aunque no envíes WhatsApp.' : 'Asigna un cliente con WhatsApp para habilitar esta opción.'}</span></div></label>
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
      const notify = Boolean(notifyCheckbox?.checked);
      preview?.classList.toggle('hidden', !notify);
      confirmButton.textContent = notify ? 'Guardar y enviar WhatsApp' : 'Guardar estado';
    };
    notifyCheckbox?.addEventListener('change', syncNotificationUi);
    syncNotificationUi();

    confirmButton.onclick = async () => {
      const selectedKey = overlay.querySelector('input[name="manualTrackingEvent"]:checked')?.value;
      const selected = EVENTS.find(event => event.key === selectedKey);
      if (!selected) return alert('Selecciona un evento.');
      const notifyWhatsApp = Boolean(notifyCheckbox?.checked);
      const newIndex = EVENTS.findIndex(event => event.key === selected.key);
      const rollback = currentIndex >= 0 && newIndex < currentIndex;
      const accepted = confirm(`${rollback ? `Vas a corregir el estado de “${currentLabel}” a “${selected.label}”.` : `¿Confirmar “${selected.label}” para ${shipment.container_number}?`}\n\n${notifyWhatsApp ? 'También se enviará WhatsApp al cliente.' : 'No se enviará WhatsApp.'}`);
      if (!accepted) return;
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

  function openEditor(shipment, focus = null) {
    if (!window.ShipmentEditor?.open) throw new Error('El editor de contenedores no está disponible.');
    window.ShipmentEditor.open(shipment.id, { focus });
  }

  async function openExpedienteShortcut(shipment) {
    if (!window.ExpedientesModule?.open) throw new Error('El módulo de Expedientes no está disponible.');

    if (shipment.operation_id) {
      return window.ExpedientesModule.open(shipment.operation_id);
    }

    if (!shipment.client_id) {
      alert('Este contenedor todavía no tiene cliente. Primero asigna el cliente y luego podrás crear su expediente desde este mismo acceso.');
      return openEditor(shipment, 'client');
    }

    const clientName = shipment.clients?.name || 'este cliente';
    const accepted = confirm(`${shipment.container_number} todavía no tiene expediente.\n\n¿Crear un expediente para ${clientName} y vincular este contenedor automáticamente?`);
    if (!accepted) return;

    const result = await request('/api/operations', {
      method: 'POST',
      body: JSON.stringify({
        client_id: shipment.client_id,
        shipment_id: shipment.id,
        notes: `Creado desde Tracking · ${shipment.container_number}`
      })
    });
    const operationId = result.operation?.id;
    if (!operationId) throw new Error('No se pudo crear el expediente.');

    if (typeof window.loadAll === 'function') await window.loadAll();
    if (typeof window.ExpedientesModule.reload === 'function') await window.ExpedientesModule.reload();
    return window.ExpedientesModule.open(operationId);
  }

  async function deleteShipmentRecord(shipment) {
    const confirmation = prompt(`Para eliminar definitivamente ${shipment.container_number} del ERP y ShipsGo, escribe ELIMINAR`);
    if (confirmation !== 'ELIMINAR') return;
    await request('/api/shipments?id=' + encodeURIComponent(shipment.id), { method: 'DELETE' });
    alert(`Contenedor ${shipment.container_number} eliminado.`);
    if (typeof window.loadAll === 'function') await window.loadAll();
    if (typeof window.loadNotifications === 'function') await window.loadNotifications();
  }

  async function executeAction(shipment, action) {
    if (action === 'info') return openDetails(shipment);
    if (action === 'history') return openHistory(shipment);
    if (action === 'edit') return openEditor(shipment);
    if (action === 'assign_client') return openEditor(shipment, 'client');
    if (action === 'expediente') return openExpedienteShortcut(shipment);
    if (action === 'manual_update') return openManualWorkflow(shipment);

    if (action === 'enable_manual') {
      if (!confirm(`¿Cambiar ${shipment.container_number} a seguimiento manual?\n\nShipsGo dejará de controlar los eventos hasta que vuelvas a automático.`)) return;
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

    if (['release', 'deliver', 'reactivate'].includes(action)) {
      const labels = { release: 'liberar', deliver: 'marcar como entregado', reactivate: 'reactivar' };
      if (!confirm(`¿Confirmar ${labels[action]} el contenedor ${shipment.container_number}?`)) return;
      const result = await request('/api/shipments', { method: 'PATCH', body: JSON.stringify({ id: shipment.id, action }) });
      if (result.notification_status && result.notification_status !== 'not_requested') alert('Estado actualizado. Notificación: ' + result.notification_status);
      if (typeof window.loadAll === 'function') await window.loadAll();
      if (typeof window.loadNotifications === 'function') await window.loadNotifications();
      return;
    }

    if (action === 'delete') return deleteShipmentRecord(shipment);
  }

  function bind() {
    byId('saveShipment')?.addEventListener('click', saveShipmentRecord);
    byId('shipmentClient')?.addEventListener('change', syncImporterSelect);
    byId('shipmentSearch')?.addEventListener('input', render);
    document.querySelectorAll('[data-container-filter]').forEach(button => button.addEventListener('click', () => {
      activeFilter = button.dataset.containerFilter;
      document.querySelectorAll('[data-container-filter]').forEach(item => item.classList.toggle('active', item === button));
      render();
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

  function syncData() {
    syncClientSelect();
    syncImporterSelect();
    render();
  }

  async function refreshImporters() {
    await loadImporterState();
    syncImporterSelect();
    render();
  }

  async function mount() {
    if (!byId('registerContainerSection') || !byId('containersSection') || !byId('shipments') || !byId('saveShipment')) {
      console.error('CONTAINERS_STATIC_STRUCTURE_MISSING');
      return;
    }
    installStyles();
    ensureRegistrationImporterField();
    await loadImporterState();
    bind();
    syncData();
    window.addEventListener('export-mca:data-loaded', syncData);
    window.addEventListener('export-mca:clients-changed', syncClientSelect);
    window.addEventListener('export-mca:importers-changed', refreshImporters);
    window.ContainersModule = Object.freeze({ render, syncClients: syncClientSelect, syncImporters: refreshImporters, openManualWorkflow, openDetails, owner: 'containers-module.js' });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();