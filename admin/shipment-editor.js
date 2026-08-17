(() => {
  if (window.ShipmentEditor) return;

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const norm = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
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

  function installStyles() {
    if (byId('shipmentEditorStyles')) return;
    const style = document.createElement('style');
    style.id = 'shipmentEditorStyles';
    style.textContent = `
      .shipment-editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px}.shipment-editor-grid .full{grid-column:1/-1}.shipment-editor-grid label{margin-top:0}.shipment-editor-section{margin-top:22px;padding-top:18px;border-top:1px solid var(--line)}.shipment-editor-section h3{margin:0 0 14px;color:var(--navy)}.shipment-editor-info{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.shipment-editor-card{padding:12px;border:1px solid var(--line);border-radius:10px;background:#f8fafc}.shipment-editor-card b{display:block;color:var(--navy);margin-bottom:4px}.shipment-editor-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}.shipment-editor-error{padding:10px 12px;margin-bottom:14px;border-radius:8px;background:#fff0ef;border:1px solid #efb0aa;color:var(--bad)}.shipment-editor-help{font-size:11px;color:var(--muted);margin-top:5px}
      @media(max-width:720px){.shipment-editor-grid,.shipment-editor-info{grid-template-columns:1fr}.shipment-editor-grid .full{grid-column:auto}.shipment-editor-footer{display:grid;grid-template-columns:1fr}.shipment-editor-footer button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function clientOptions(selected) {
    return `<option value="">Sin cliente / Disponible para venta</option>${clientRows().map(client => `<option value="${esc(client.id)}" ${String(client.id) === String(selected || '') ? 'selected' : ''}>${esc(client.name)}${client.company ? ' · ' + esc(client.company) : ''}</option>`).join('')}`;
  }

  function importerIdForShipment(shipmentId) {
    return importerState().shipment_importers?.find(item => String(item.shipment_id) === String(shipmentId || ''))?.importer_id || null;
  }

  function importerIdsForClient(clientId) {
    return new Set((importerState().client_importers || []).filter(link => String(link.client_id) === String(clientId || '')).map(link => String(link.importer_id)));
  }

  function importerOptions(clientId, selected) {
    const linkedIds = clientId ? importerIdsForClient(clientId) : null;
    const list = (importerState().importers || []).filter(importer => importer.active !== false && (!linkedIds || linkedIds.has(String(importer.id))));
    return `<option value="">Sin importadora definida</option>${list.map(importer => `<option value="${esc(importer.id)}" ${String(importer.id) === String(selected || '') ? 'selected' : ''}>${esc(importer.name)}</option>`).join('')}`;
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

  function formatTrackingMode(shipment) {
    if (shipment.shipsgo_status === 'manual') return 'Manual';
    if (shipment.shipsgo_status === 'active') return 'ShipsGo automático';
    if (shipment.shipsgo_status === 'failed') return 'ShipsGo con error';
    return shipment.shipsgo_status || 'Pendiente';
  }

  function html(shipment) {
    const status = shipment.operational_status || shipment.last_status || 'Registrado';
    const importerId = importerIdForShipment(shipment.id);
    return `<div id="shipmentEditorMessage"></div>
      <div class="shipment-editor-grid">
        <div><label>Cliente</label><select id="editorClient">${clientOptions(shipment.client_id)}</select><div class="shipment-editor-help">Puede quedar sin cliente hasta que el contenedor sea vendido.</div></div>
        <div><label>Importadora cubana</label><select id="editorImporter">${importerOptions(shipment.client_id, importerId)}</select><div id="editorImporterHelp" class="shipment-editor-help">La importadora pertenece a este contenedor, no a todo el expediente.</div></div>
        <div><label>Número de contenedor *</label><input id="editorContainer" value="${esc(shipment.container_number)}" maxlength="11"></div>
        <div><label>Producto</label><input id="editorProduct" value="${esc(shipment.product || '')}"></div>
        <div><label>Cantidad</label><input id="editorQuantity" type="number" min="0" step="0.001" value="${esc(shipment.quantity ?? '')}"></div>
        <div><label>Unidad</label><input id="editorQuantityUnit" value="${esc(shipment.quantity_unit || '')}" placeholder="paneles, cajas, galones, unidades"></div>
        <div><label>Fecha de salida</label><input id="editorDepartureDate" type="date" value="${esc(shipment.departure_date || '')}"><div class="shipment-editor-help">Fecha manual indicada por Export MCA.</div></div>
        <div><label>Naviera</label><input id="editorCarrier" value="${esc(shipment.carrier || '')}"></div>
        <div><label>Booking</label><input id="editorBooking" value="${esc(shipment.booking_number || '')}"></div>
        <div><label>B/L</label><input id="editorBol" value="${esc(shipment.bol_number || '')}"></div>
        <div><label>Estado operativo</label><select id="editorStatus">${statuses(status)}</select></div>
      </div>
      <section class="shipment-editor-section"><h3>Tracking</h3><div class="shipment-editor-info">
        <div class="shipment-editor-card"><b>Modo</b>${esc(formatTrackingMode(shipment))}</div>
        <div class="shipment-editor-card"><b>Último estado</b>${esc(shipment.last_status || shipment.operational_status || '—')}</div>
        <div class="shipment-editor-card"><b>Ubicación</b>${esc(shipment.last_location || '—')}</div>
        <div class="shipment-editor-card"><b>ShipsGo ID</b>${esc(shipment.shipsgo_tracking_id || '—')}</div>
        <div class="shipment-editor-card"><b>Vínculo</b>${esc(shipment.shipsgo_link_mode || '—')}</div>
        <div class="shipment-editor-card"><b>Error ShipsGo</b>${esc(shipment.shipsgo_error || '—')}</div>
      </div></section>
      <div class="shipment-editor-footer"><button id="shipmentEditorCancel" class="alt" type="button">Cancelar</button><button id="shipmentEditorSave" class="orange" type="button">Guardar cambios</button></div>`;
  }

  function syncImporterSelect() {
    const select = byId('editorImporter');
    if (!select) return;
    const clientId = byId('editorClient')?.value || '';
    const selected = select.value;
    select.innerHTML = importerOptions(clientId, selected);
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
    else select.value = '';
    const help = byId('editorImporterHelp');
    if (!help) return;
    if (!clientId) {
      help.textContent = 'Sin cliente, puedes mantener una importadora registrada o dejarla pendiente.';
      return;
    }
    const count = importerIdsForClient(clientId).size;
    help.textContent = count
      ? `El cliente está registrado en ${count} importadora${count === 1 ? '' : 's'}.`
      : 'Este cliente no tiene importadoras registradas. Agrégalas desde Clientes o deja este campo pendiente.';
  }

  function setError(message = '') {
    const target = byId('shipmentEditorMessage');
    if (!target) return;
    target.className = message ? 'shipment-editor-error' : '';
    target.textContent = message;
  }

  function validate() {
    const container = norm(byId('editorContainer')?.value || '');
    if (!/^[A-Z]{4}\d{7}$/.test(container)) return 'El contenedor debe tener 4 letras y 7 números.';
    if (rows().some(item => item.id !== current.id && item.active !== false && norm(item.container_number) === container)) return 'Ese número de contenedor ya está registrado en otra operación activa.';
    const quantity = String(byId('editorQuantity')?.value || '').trim();
    if (quantity && (!Number.isFinite(Number(quantity)) || Number(quantity) < 0)) return 'La cantidad no es válida.';
    const clientId = byId('editorClient')?.value || '';
    const importerId = byId('editorImporter')?.value || '';
    if (clientId && importerId && !importerIdsForClient(clientId).has(String(importerId))) return 'La importadora seleccionada no está registrada para ese cliente.';
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
      await request('/api/shipments', { method: 'PATCH', body: JSON.stringify(payload()) });
      const importerResult = await request('/api/importers', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'assign_shipment', shipment_id: current.id, importer_id: byId('editorImporter')?.value || null })
      });
      if (importerResult.state) window.importerState = importerResult.state;
      if (typeof window.loadAll === 'function') await window.loadAll();
      await window.ContainersModule?.syncImporters?.();
      window.closeModal?.();
    } catch (error) {
      setError(error.message);
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
    await ensureImporterState();
    installStyles();
    window.openModal?.(`Editar contenedor · ${shipment.container_number}`, html(shipment));
    byId('shipmentEditorCancel').onclick = () => window.closeModal?.();
    byId('shipmentEditorSave').onclick = save;
    byId('editorClient')?.addEventListener('change', syncImporterSelect);
    document.querySelectorAll('#modal input,#modal select').forEach(field => field.addEventListener('input', () => setError('')));
    syncImporterSelect();
    if (options.focus === 'client') byId('editorClient')?.focus();
    else byId('editorContainer')?.focus();
  }

  window.ShipmentEditor = Object.freeze({ open, owner: 'containers-module.js' });
})();