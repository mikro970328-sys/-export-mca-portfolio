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
    'Esa referencia ya está registrada en otra operación activa.'
  ]);
  let current = null;
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
    return importerState().shipment_importers?.find(item => String(item.shipment_id) === String(shipmentId || ''))?.importer_id || null;
  }

  function importerNameForShipment(shipmentId) {
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

  function html(shipment) {
    const status = shipment.operational_status || shipment.last_status || 'Registrado';
    const importerName = importerNameForShipment(shipment.id);
    const referenceHelp = 'Referencia operativa del ERP. Puede ser un número ISO real o una referencia provisional mientras la naviera entrega el número definitivo.';
    return `<div id="shipmentEditorMessage"></div>
      <div class="shipment-editor-grid">
        <div><label>Cliente</label><select id="editorClient">${clientOptions(shipment.client_id)}</select><div class="shipment-editor-help">Si el contenedor proviene de una venta/cargue, el cliente debe heredarse de esa operación.</div></div>
        <div><label>Importadora cubana</label><input id="editorImporter" list="editorImporterOptions" value="${esc(importerName)}" placeholder="Ej. Quimimport, Servoven"><datalist id="editorImporterOptions">${importerSuggestions()}</datalist><div class="shipment-editor-help">No depende de las importadoras donde esté registrado el cliente. Se hereda como valor inicial desde la venta/cargue y puede corregirse después.</div></div>
        <div><label>Referencia / Nº contenedor *</label><input id="editorContainer" value="${esc(shipment.container_number)}" maxlength="40"><div class="shipment-editor-help">${esc(referenceHelp)}</div></div>
        <div><label>Producto</label><input id="editorProduct" value="${esc(shipment.product || '')}"></div>
        <div><label>Cantidad</label><input id="editorQuantity" type="number" min="0" step="0.001" value="${esc(shipment.quantity ?? '')}"></div>
        <div><label>Unidad</label><input id="editorQuantityUnit" value="${esc(shipment.quantity_unit || '')}" placeholder="paneles, cajas, galones, unidades"></div>
        <div><label>Fecha de salida</label><input id="editorDepartureDate" type="date" value="${esc(shipment.departure_date || '')}"><div class="shipment-editor-help">Fecha manual indicada por Export MCA.</div></div>
        <div><label>Naviera</label><input id="editorCarrier" value="${esc(shipment.carrier || '')}"></div>
        <div><label>Booking</label><input id="editorBooking" value="${esc(shipment.booking_number || '')}"></div>
        <div><label>B/L</label><input id="editorBol" value="${esc(shipment.bol_number || '')}"><div class="shipment-editor-help">Puede quedar vacío hasta que la naviera lo emita.</div></div>
        <div><label>Estado operativo</label><select id="editorStatus">${statuses(status)}</select></div>
      </div>
      <section class="shipment-editor-section"><h3>Seguimiento ERP</h3><div class="shipment-editor-info">
        <div class="shipment-editor-card"><b>Fuente</b>Export MCA ERP</div>
        <div class="shipment-editor-card"><b>Último estado</b>${esc(shipment.last_status || shipment.operational_status || '—')}</div>
        <div class="shipment-editor-card"><b>Ubicación</b>${esc(shipment.last_location || '—')}</div>
        <div class="shipment-editor-card"><b>Último evento</b>${esc(shipment.last_event_at ? new Date(shipment.last_event_at).toLocaleString('es-US') : '—')}</div>
        <div class="shipment-editor-card"><b>Salida</b>${esc(shipment.departure_date || '—')}</div>
        <div class="shipment-editor-card"><b>Estado</b>${esc(status)}</div>
      </div></section>
      <div class="shipment-editor-footer"><button id="shipmentEditorCancel" class="alt" type="button">Cancelar</button><button id="shipmentEditorSave" class="orange" type="button">Guardar cambios</button></div>`;
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
    return {
      id: current.id,
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
  }

  async function save() {
    if (saving) return;
    const error = validate();
    if (error) return setError(error);
    saving = true;
    const button = byId('shipmentEditorSave');
    button.disabled = true;
    button.textContent = 'Guardando...';
    setError('');
    try {
      await request('/api/shipments', { method:'PATCH', body:JSON.stringify(payload()) });
      const importerResult = await request('/api/importers', {
        method:'PATCH',
        body:JSON.stringify({ action:'assign_shipment', shipment_id:current.id, importer_name:String(byId('editorImporter')?.value || '').trim() })
      });
      if (importerResult.state) window.importerState = importerResult.state;
      if (typeof window.loadAll === 'function') await window.loadAll();
      await window.ContainersModule?.syncImporters?.();
      window.closeModal?.();
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
      await ensureImporterState();
    } catch (error) {
      console.error('SHIPMENT_EDITOR_IMPORTERS_LOAD_FAILED', error);
      throw new Error('No se pudo preparar el editor de contenedores. Intenta nuevamente.');
    }
    window.openModal?.(`Editar contenedor · ${shipment.container_number}`, html(shipment));
    byId('shipmentEditorCancel').onclick = () => window.closeModal?.();
    byId('shipmentEditorSave').onclick = save;
    document.querySelectorAll('#modal input,#modal select').forEach(field => field.addEventListener('input', () => setError('')));
    if (options.focus === 'client') byId('editorClient')?.focus();
    else byId('editorContainer')?.focus();
  }

  window.ShipmentEditor = Object.freeze({ open, owner:'containers-module.js' });
})();
