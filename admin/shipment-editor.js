(() => {
  if (window.ShipmentEditor) return;

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const norm = value => String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const validReference = value => Boolean(value) && value.length <= 40 && /^[A-Z0-9][A-Z0-9 ._/-]*$/.test(value);
  const SAFE_EDITOR_ERRORS = new Set([
    'No tienes permiso para realizar esta acción',
    'No autorizado',
    'El contenedor ya no está disponible',
    'La mercancía y el cliente se toman de la venta o cargue. Corrígelos en esa operación.',
    'La nota puede tener hasta 4,000 caracteres.',
    'Esa referencia ya está registrada en otra operación activa.'
  ]);
  let current = null;
  let currentImporterName = '';
  let saving = false;

  function rows() {
    return Array.isArray(window.shipments) ? window.shipments : (typeof shipments !== 'undefined' && Array.isArray(shipments) ? shipments : []);
  }

  function clientRows() {
    return Array.isArray(window.clients) ? window.clients : (typeof clients !== 'undefined' && Array.isArray(clients) ? clients : []);
  }

  function importerState() {
    return window.importerState || { importers: [], client_importers: [], shipment_importers: [] };
  }

  async function request(path, options = {}) {
    const startedAt = window.ExportMcaPerformance?.now?.();
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
    window.ExportMcaPerformance?.request?.(path, options.method || 'GET', response, startedAt);
    if (!response.ok) throw new Error(data.error || data.details || 'Error');
    return data;
  }

  async function ensureImporterState() {
    const state = importerState();
    if (Array.isArray(state.importers) && state.importers.length) return state;
    const result = await request('/api/importers');
    window.importerState = {
      importers: result.importers || [],
      client_importers: result.client_importers || [],
      shipment_importers: result.shipment_importers || []
    };
    return window.importerState;
  }

  function safeEditorMessage(error, fallback = 'No se pudieron guardar los cambios. Intenta nuevamente.') {
    const message = String(error?.message || '').trim();
    return SAFE_EDITOR_ERRORS.has(message) ? message : fallback;
  }

  function clientOptions(selected) {
    return `<option value="">Sin cliente</option>${clientRows().map(client => `<option value="${esc(client.id)}" ${String(client.id) === String(selected || '') ? 'selected' : ''}>${esc(client.name)}${client.company ? ' · ' + esc(client.company) : ''}</option>`).join('')}`;
  }

  function importerIdForShipment(shipmentId) {
    const shipment = rows().find(item => String(item.id) === String(shipmentId));
    return shipment?.importer_id || importerState().shipment_importers?.find(item => String(item.shipment_id) === String(shipmentId || ''))?.importer_id || null;
  }

  function importerNameForShipment(shipmentId) {
    const shipment = rows().find(item => String(item.id) === String(shipmentId));
    if (shipment?.importer?.name) return shipment.importer.name;
    const importerId = importerIdForShipment(shipmentId);
    return importerState().importers?.find(item => String(item.id) === String(importerId || ''))?.name || '';
  }

  function importerSuggestions() {
    return (importerState().importers || [])
      .filter(importer => importer.active !== false)
      .map(importer => `<option value="${esc(importer.name)}"></option>`)
      .join('');
  }

  function statuses(selected) {
    const values = [...new Set([
      selected,
      'Registrado',
      'Booking confirmado',
      'Cargado en el buque',
      'Salió del puerto',
      'Llegó al puerto',
      'Descargado del buque',
      'Liberado',
      'Entregado'
    ].filter(Boolean))];
    return values.map(value => `<option ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('');
  }

  function linkedCargo(shipment) {
    return shipment.cargo?.linked || ['direct','warehouse'].includes(shipment.fulfillment?.mode);
  }

  function cargoHtml(shipment) {
    const format = value => new Intl.NumberFormat('es-US',{maximumFractionDigits:3}).format(Number(value) || 0);
    const items = shipment.cargo?.items || [];
    if (!items.length) return `<div class="shipment-editor-card"><b>${esc(shipment.product || 'Mercancía vinculada')}</b><span>La carga se administra desde la venta o cargue.</span></div>`;
    return items.map(item => `<div class="shipment-editor-card shipment-editor-cargo-card"><b>${esc(item.product_name)}</b><span>${esc(format(item.quantity))} ${esc(item.unit)} · ${esc(format(item.pallets))} pallets</span><small>${esc((item.sales_orders || []).map(sale => sale.so_number).join(' · ') || 'Cargue de almacén')}${item.sku ? ' · '+esc(item.sku) : ''}</small></div>`).join('');
  }

  function html(shipment) {
    const status = shipment.operational_status || shipment.last_status || 'Registrado';
    const importerName = importerNameForShipment(shipment.id);
    const linked = linkedCargo(shipment);
    const referenceHelp = 'Referencia operativa del ERP. Puede ser un número ISO real o una referencia provisional mientras la naviera entrega el número definitivo.';
    return `<div class="shipment-editor" data-owner="shipment-editor.js">
      <header class="shipment-editor-summary"><div><span>Operación marítima</span><strong>${esc(shipment.container_number)}</strong><small>Edita únicamente información confirmada.</small></div><span class="shipment-editor-status">${esc(status)}</span></header>
      <div id="shipmentEditorMessage" role="status" aria-live="polite"></div>
      <section class="shipment-editor-section" aria-labelledby="shipmentEditorAssignmentTitle"><div class="shipment-editor-section-head"><div><h3 id="shipmentEditorAssignmentTitle">Asignación comercial</h3><p>Cliente comprador e importadora cubana vinculados a esta operación.</p></div></div><div class="shipment-editor-grid">
        ${linked ? `<div class="shipment-editor-card"><b>Cliente</b><span>${esc(shipment.clients?.company || shipment.clients?.name || 'Sin cliente')}</span></div><div class="shipment-editor-card"><b>Importadora cubana</b><span>${esc(importerName || 'Sin definir')}</span></div>` : `<label class="shipment-editor-field" for="editorClient"><span>Cliente</span><select id="editorClient">${clientOptions(shipment.client_id)}</select><small>Si proviene de una venta o cargue, debe coincidir con esa operación.</small></label>
        <label class="shipment-editor-field" for="editorImporter"><span>Importadora cubana</span><input id="editorImporter" list="editorImporterOptions" value="${esc(importerName)}" placeholder="Ej. Quimimport, Servoven"><datalist id="editorImporterOptions">${importerSuggestions()}</datalist><small>No depende de las importadoras donde esté registrado el cliente y puede corregirse sin cambiar su ficha.</small></label>`}
      </div></section>
      <section class="shipment-editor-section" aria-labelledby="shipmentEditorTransportTitle"><div class="shipment-editor-section-head"><div><h3 id="shipmentEditorTransportTitle">Identificación y transporte</h3><p>Referencias emitidas por la naviera y estado operativo interno.</p></div></div><div class="shipment-editor-grid">
        <label class="shipment-editor-field full" for="editorContainer"><span>Referencia / Nº contenedor *</span><input id="editorContainer" value="${esc(shipment.container_number)}" maxlength="40" autocomplete="off"><small>${esc(referenceHelp)}</small></label>
        <label class="shipment-editor-field" for="editorCarrier"><span>Naviera</span><input id="editorCarrier" value="${esc(shipment.carrier || '')}"></label>
        <label class="shipment-editor-field" for="editorDepartureDate"><span>Fecha de salida</span><input id="editorDepartureDate" type="date" value="${esc(shipment.departure_date || '')}"><small>Fecha manual indicada por Export MCA.</small></label>
        <label class="shipment-editor-field" for="editorBooking"><span>Booking</span><input id="editorBooking" value="${esc(shipment.booking_number || '')}"></label>
        <label class="shipment-editor-field" for="editorBol"><span>B/L</span><input id="editorBol" value="${esc(shipment.bol_number || '')}"><small>Puede quedar vacío hasta que la naviera lo emita.</small></label>
        <label class="shipment-editor-field full" for="editorStatus"><span>Estado operativo</span><select id="editorStatus">${statuses(status)}</select></label>
      </div></section>
      <section class="shipment-editor-section" aria-labelledby="shipmentEditorCargoTitle"><div class="shipment-editor-section-head"><div><h3 id="shipmentEditorCargoTitle">Mercancía del contenedor</h3><p>${linked ? 'Se toma automáticamente de la venta o cargue. Cantidades asignadas a este contenedor.' : 'Descripción y cantidad transportada.'}</p></div></div><div class="shipment-editor-grid">
        ${linked ? cargoHtml(shipment) : `
        <label class="shipment-editor-field full" for="editorProduct"><span>Producto</span><input id="editorProduct" value="${esc(shipment.product || '')}"></label>
        <label class="shipment-editor-field" for="editorQuantity"><span>Cantidad</span><input id="editorQuantity" type="number" min="0" step="0.001" value="${esc(shipment.quantity ?? '')}"></label>
        <label class="shipment-editor-field" for="editorQuantityUnit"><span>Unidad</span><input id="editorQuantityUnit" value="${esc(shipment.quantity_unit || '')}" placeholder="paneles, cajas, galones, unidades"></label>`}
      </div></section>
      <section class="shipment-editor-section"><label class="shipment-editor-field full" for="editorNote"><span>Agregar nota al historial (opcional)</span><textarea id="editorNote" rows="3" maxlength="4000" placeholder="Observaciones sobre este contenedor"></textarea><small>La nota se guarda aparte de la mercancía.</small></label></section>
      <section class="shipment-editor-section shipment-editor-tracking" aria-labelledby="shipmentEditorTrackingTitle"><div class="shipment-editor-section-head"><div><h3 id="shipmentEditorTrackingTitle">Seguimiento ERP</h3><p>Estado observado antes de guardar esta edición.</p></div></div><div class="shipment-editor-info">
        <div class="shipment-editor-card"><b>Fuente</b><span>Export MCA ERP</span></div>
        <div class="shipment-editor-card"><b>Último estado</b><span>${esc(shipment.last_status || shipment.operational_status || '—')}</span></div>
        <div class="shipment-editor-card"><b>Ubicación</b><span>${esc(shipment.last_location || '—')}</span></div>
        <div class="shipment-editor-card"><b>Último evento</b><span>${esc(shipment.last_event_at ? new Date(shipment.last_event_at).toLocaleString('es-US') : '—')}</span></div>
        <div class="shipment-editor-card"><b>Salida</b><span>${esc(shipment.departure_date || '—')}</span></div>
        <div class="shipment-editor-card"><b>Estado</b><span>${esc(status)}</span></div>
      </div></section>
      <footer class="shipment-editor-footer"><button id="shipmentEditorCancel" class="alt" type="button">Cancelar</button><button id="shipmentEditorSave" class="orange" type="button">Guardar cambios</button></footer>
    </div>`;
  }

  function setError(message = '') {
    const target = byId('shipmentEditorMessage');
    if (!target) return;
    target.className = message ? 'shipment-editor-error' : '';
    target.textContent = message;
  }

  function validate() {
    const reference = norm(byId('editorContainer')?.value || '');
    if (!validReference(reference)) return 'La referencia no es válida. Usa letras/números y, si necesitas, espacios, guion, punto, slash o underscore.';
    if (rows().some(item => item.id !== current.id && item.active !== false && norm(item.container_number) === reference)) return 'Esa referencia ya está registrada en otra operación activa.';
    const quantity = String(byId('editorQuantity')?.value || '').trim();
    if (quantity && (!Number.isFinite(Number(quantity)) || Number(quantity) < 0)) return 'La cantidad no es válida.';
    return '';
  }

  function payload() {
    const quantity = String(byId('editorQuantity')?.value || '').trim();
    const values = {
      client_id: byId('editorClient')?.value || null,
      container_number: norm(byId('editorContainer')?.value || ''),
      product: String(byId('editorProduct')?.value || '').trim(),
      quantity: quantity || null,
      quantity_unit: String(byId('editorQuantityUnit')?.value || '').trim(),
      departure_date: byId('editorDepartureDate')?.value || null,
      carrier: String(byId('editorCarrier')?.value || '').trim(),
      booking_number: String(byId('editorBooking')?.value || '').trim(),
      bol_number: String(byId('editorBol')?.value || '').trim(),
      operational_status: String(byId('editorStatus')?.value || '').trim()
    };
    const original = {
      client_id: current.client_id || null,
      container_number: norm(current.container_number || ''),
      product: String(current.product || '').trim(),
      quantity: current.quantity == null ? '' : String(current.quantity),
      quantity_unit: String(current.quantity_unit || '').trim(),
      departure_date: String(current.departure_date || ''),
      carrier: String(current.carrier || '').trim(),
      booking_number: String(current.booking_number || '').trim(),
      bol_number: String(current.bol_number || '').trim(),
      operational_status: String(current.operational_status || current.last_status || 'Registrado').trim()
    };
    const changed = { id: current.id };
    for (const [key, value] of Object.entries(values)) {
      if (linkedCargo(current) && ['client_id','product','quantity','quantity_unit'].includes(key)) continue;
      if (String(value ?? '') !== String(original[key] ?? '')) changed[key] = value;
    }
    const note = String(byId('editorNote')?.value || '').trim();
    if (note) changed.note = note;
    return changed;
  }

  function updateCachedShipment(shipmentUpdate = null, importerAssignment = null) {
    if (!current) return;
    const next = { ...current, ...(shipmentUpdate || {}) };
    if (shipmentUpdate && Object.prototype.hasOwnProperty.call(shipmentUpdate, 'client_id') && !Object.prototype.hasOwnProperty.call(shipmentUpdate, 'clients')) {
      const clientId = shipmentUpdate.client_id;
      next.clients = clientId
        ? clientRows().find(client => String(client.id) === String(clientId)) || null
        : null;
    }
    if (shipmentUpdate && Object.prototype.hasOwnProperty.call(shipmentUpdate, 'importer_id') && String(shipmentUpdate.importer_id || '') !== String(current.importer_id || '')) {
      const state = window.importerState;
      if (state && Array.isArray(state.shipment_importers)) {
        const importerState = {
          ...state,
          shipment_importers: [
            ...state.shipment_importers.filter(item => String(item.shipment_id) !== String(next.id)),
            ...(shipmentUpdate.importer_id ? [{ shipment_id:next.id, importer_id:shipmentUpdate.importer_id }] : [])
          ]
        };
        window.importerState = importerState;
        window.ContainersModule?.syncImporters?.(importerState)?.catch?.(error => console.error('[shipment editor importer refresh]', error));
      }
    }
    if (importerAssignment && Object.prototype.hasOwnProperty.call(importerAssignment, 'importer_id')) {
      next.importer_id = importerAssignment.importer_id;
      next.importer = importerState().importers?.find(item => String(item.id) === String(importerAssignment.importer_id)) || null;
    }
    const updatedRows = rows().map(item => String(item.id) === String(next.id) ? next : item);
    try {
      if (typeof shipments !== 'undefined') shipments = updatedRows;
    } catch {}
    window.shipments = updatedRows;
    current = next;
    window.ContainersModule?.render?.();
  }

  async function save() {
    if (saving) return;
    const error = validate();
    if (error) return setError(error);
    const changes = payload();
    const shipmentChanged = Object.keys(changes).length > 1;
    const importerName = String(byId('editorImporter')?.value || '').trim();
    const importerChanged = !linkedCargo(current) && Boolean(byId('editorImporter')) && norm(importerName) !== norm(currentImporterName);
    if (!shipmentChanged && !importerChanged) {
      window.closeModal?.();
      return;
    }

    saving = true;
    const saveStartedAt = window.ExportMcaPerformance?.now?.();
    const button = byId('shipmentEditorSave');
    button.disabled = true;
    button.textContent = 'Guardando...';
    setError('');
    try {
      let shipmentResult = null;
      if (shipmentChanged) {
        shipmentResult = await request('/api/shipments', { method:'PATCH', body:JSON.stringify(changes) });
        updateCachedShipment(shipmentResult.shipment || null);
      }

      let importerResult = null;
      if (importerChanged) {
        importerResult = await request('/api/importers', {
          method:'PATCH',
          body:JSON.stringify({ action:'assign_shipment', shipment_id:current.id, importer_name:importerName })
        });
        if (importerResult.assignment) updateCachedShipment(null, importerResult.assignment);
        if (importerResult.state) {
          window.importerState = importerResult.state;
          await window.ContainersModule?.syncImporters?.(importerResult.state);
        }
      }

      currentImporterName = importerName;
      window.closeModal?.();
      window.ExportMcaPerformance?.duration?.('save', saveStartedAt);
      const dashboard = byId('dashboardSection');
      if (dashboard && !dashboard.classList.contains('hidden')) {
        window.ExportMcaAdminData?.loadDashboard?.().catch(error => console.error('[shipment editor dashboard refresh]', error));
      }
    } catch (error) {
      console.error('SHIPMENT_EDITOR_SAVE_FAILED', error);
      setError(safeEditorMessage(error));
    } finally {
      saving = false;
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = 'Guardar cambios';
      }
    }
  }
  async function open(id, options = {}) {
    const shipment = rows().find(item => String(item.id) === String(id));
    if (!shipment) throw new Error('No se encontró el contenedor.');
    current = shipment;
    try {
      if (!linkedCargo(shipment)) await ensureImporterState();
      currentImporterName = importerNameForShipment(shipment.id);
    } catch (error) {
      console.error('SHIPMENT_EDITOR_IMPORTERS_LOAD_FAILED', error);
      throw new Error('No se pudo preparar el editor de contenedores. Intenta nuevamente.');
    }
    window.openModal?.(`Editar contenedor · ${shipment.container_number}`, html(shipment));
    byId('shipmentEditorCancel').onclick = () => window.closeModal?.();
    byId('shipmentEditorSave').onclick = save;
    document.querySelectorAll('#modal input,#modal select,#modal textarea').forEach(field => field.addEventListener('input', () => setError('')));
    if (options.focus === 'client') byId('editorClient')?.focus();
    else byId('editorContainer')?.focus();
  }

  window.ShipmentEditor = Object.freeze({ open, owner:'containers-module.js' });
})();
