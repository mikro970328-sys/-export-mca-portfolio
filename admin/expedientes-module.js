(() => {
  'use strict';

  const state = { initialized: false, operations: [], documents: [], tab: 'active', search: '' };
  const byId = id => document.getElementById(id);
  const api = (...args) => {
    if (typeof window.api !== 'function') throw new Error('EXPEDIENTES_API_MISSING');
    return window.api(...args);
  };
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
  const bolKey = value => String(value || '').trim().toUpperCase();

  const documentTypes = [
    'Oferta','Factura comercial','Packing List','B/L','Ficha técnica del producto','Certificado de origen','Certificado sanitario','Permiso / Licencia','COA / Certificado de análisis','Fotos del producto / embalaje'
  ];

  function installStyles() {
    if (byId('expedientesModuleStyles')) return;
    const style = document.createElement('style');
    style.id = 'expedientesModuleStyles';
    style.textContent = `
      .exp-tabs{display:flex;gap:8px;flex-wrap:wrap}.exp-tabs button{min-width:110px}.exp-tabs button.active{background:#06204a!important;color:#fff!important;border-color:#06204a!important}
      .exp-list{display:grid;gap:8px;margin-top:14px}.exp-list-head{display:grid;grid-template-columns:minmax(170px,1.25fr) minmax(150px,1fr) minmax(110px,.8fr) minmax(210px,1.5fr) auto;gap:12px;align-items:center;padding:0 14px 6px;color:#667085;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.exp-row{display:grid;grid-template-columns:minmax(170px,1.25fr) minmax(150px,1fr) minmax(110px,.8fr) minmax(210px,1.5fr) auto;gap:12px;align-items:center;border:1px solid #dfe5ee;border-radius:11px;padding:11px 14px;background:#fff;transition:border-color .15s ease,box-shadow .15s ease}.exp-row:hover{border-color:#b8c9e4;box-shadow:0 5px 14px rgba(6,32,74,.05)}.exp-row-primary{min-width:0}.exp-code{font-size:11px;font-weight:900;color:#667085;text-transform:uppercase;letter-spacing:.04em}.exp-client{font-size:15px;font-weight:900;color:#06204a;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.exp-row-company{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.exp-row-stats{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.exp-row-actions{display:flex;justify-content:flex-end}.exp-row-actions button{white-space:nowrap;padding:8px 11px}.exp-list-count{margin-top:10px;color:#667085;font-size:12px}.exp-stats{display:flex;gap:7px;flex-wrap:wrap;margin:13px 0}
      .exp-summary{border:1px solid #e3e8ef;border-radius:14px;padding:14px;background:#f8fafc;margin-top:14px}.exp-summary-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.exp-summary-actions{display:flex;gap:8px;flex-wrap:wrap}.exp-summary-label{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;color:#667085;margin-top:14px}.exp-container-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.exp-container-chips .pill{background:#fff;border:1px solid #dfe5ee;color:#344054}
      .exp-section{margin-top:18px}.exp-section-title{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:8px}
      .exp-folder{border:1px solid #dfe5ee;border-radius:12px;background:#fff;margin-top:12px;overflow:hidden}.exp-folder.shared{border-color:#b8c9e4}.exp-folder-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:14px 16px;cursor:pointer;user-select:none;transition:background .15s ease,border-color .15s ease}.exp-folder-head:hover{background:#f8fafc}.exp-folder-head:focus-visible{outline:3px solid rgba(6,32,74,.18);outline-offset:-3px}.exp-folder-title{display:flex;align-items:center;gap:9px;font-weight:800;color:#06204a;font-size:15px}.exp-folder-arrow{display:inline-flex;width:18px;justify-content:center;font-size:12px;color:#667085;font-weight:900}.exp-folder-meta{font-size:12px;color:#667085;margin:3px 0 0 27px}.exp-folder-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}.exp-folder-actions button{cursor:pointer}.exp-folder-body{margin:0 14px 14px 38px;border:1px solid #dfe5ee;border-left:4px solid #cbd5e1;border-radius:10px;padding:12px 14px;background:#f8fafc}.exp-folder-body-actions{display:flex;justify-content:flex-end;margin:0 0 10px}.exp-folder-body-actions button{padding:8px 10px!important}
      .exp-shared-badge{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;background:#edf3ff;color:#244a83;font-size:11px;font-weight:900}.exp-shared-context{border:1px solid #b8c9e4;background:#f3f7fd;border-radius:10px;padding:10px 12px;margin:4px 0 12px}.exp-shared-context b{color:#06204a}.exp-shared-grid{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.exp-shared-item{font-size:11px;background:#fff;border:1px solid #d9e3f2;border-radius:8px;padding:5px 7px;color:#475467}
      .exp-group-label{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800;color:#475467;margin:12px 0 8px}.exp-group-label .arrow{font-size:16px;color:#98a2b3}.exp-doc-row{display:grid;grid-template-columns:minmax(150px,1fr) minmax(160px,1.4fr) auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid #e6ebf2}.exp-doc-row:first-child{border-top:0}.exp-doc-actions{display:flex;gap:7px;justify-content:flex-end;flex-wrap:wrap}.exp-doc-shared{display:inline-block;margin-left:6px;font-size:10px;font-weight:900;color:#244a83;background:#edf3ff;border-radius:999px;padding:3px 6px;vertical-align:middle}
      .exp-container-card{margin-top:9px;padding:11px 12px;border:1px solid #e1e7ef;border-radius:10px;background:#fff}.exp-container-belongs{font-size:11px;font-weight:800;color:#667085;text-transform:uppercase;letter-spacing:.03em;margin-bottom:5px}.exp-container-line{display:grid;grid-template-columns:minmax(150px,1fr) auto;gap:12px;align-items:center}.exp-container-actions{display:flex;gap:7px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.exp-container-files{margin:9px 0 0 18px;padding:4px 0 0 12px;border-left:2px solid #d0d5dd}
      .exp-delivered-note{font-size:12px;color:#667085;margin-top:9px}.exp-manage-table-wrap{overflow:auto;margin-top:12px}.exp-available{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;margin-top:10px}.exp-available-item{border:1px solid #e6ebf2;border-radius:10px;padding:10px}.exp-upload-target{padding:10px 12px;border:1px solid #dfe5ee;border-radius:10px;background:#f8fafc;margin-bottom:12px}.exp-share-option{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start;padding:12px;border:1px solid #b8c9e4;background:#f3f7fd;border-radius:10px;margin-top:12px}.exp-share-option input{width:18px;height:18px;margin-top:2px}.exp-share-option b{display:block;color:#06204a}.exp-share-option span{display:block;color:#667085;font-size:11px;margin-top:3px;line-height:1.4}
      .exp-subview-head{display:flex;align-items:center;gap:10px}.exp-back-button{width:42px;height:42px;min-width:42px;padding:0!important;display:inline-grid;place-items:center;border-radius:999px!important;font-size:22px;line-height:1;background:#fff!important;color:#06204a!important;border:1px solid #cfd7e3!important}.exp-back-button:hover{background:#f4f7fb!important}.exp-back-button:focus-visible{outline:3px solid rgba(6,32,74,.18);outline-offset:2px}
      .exp-client-picker{position:relative}.exp-client-picker-results{display:grid;gap:7px;margin-top:8px;max-height:280px;overflow:auto}.exp-client-picker-option{width:100%!important;text-align:left!important;display:block!important;background:#fff!important;color:#152238!important;border:1px solid #dfe5ee!important;border-radius:10px!important;padding:10px 12px!important}.exp-client-picker-option:hover,.exp-client-picker-option:focus{background:#f4f7fb!important;border-color:#b8c9e4!important}.exp-client-picker-option b{display:block;color:#06204a}.exp-client-picker-option span{display:block;color:#667085;font-size:12px;margin-top:3px}.exp-client-picker-selected{margin-top:8px;padding:10px 12px;border:1px solid #b8c9e4;border-radius:10px;background:#f3f7fd}.exp-client-picker-selected b{color:#06204a}.exp-client-picker-empty{padding:10px 12px;color:#667085;font-size:12px;border:1px dashed #d0d5dd;border-radius:10px;margin-top:8px}
      @media(max-width:900px){.exp-list-head{display:none}.exp-row{grid-template-columns:minmax(0,1fr) auto;gap:9px}.exp-row-company,.exp-row-status,.exp-row-stats{grid-column:1}.exp-row-actions{grid-column:2;grid-row:1/5;align-self:center}.exp-row-stats{margin-top:2px}}
      @media(max-width:700px){.exp-row{grid-template-columns:1fr}.exp-row-actions{grid-column:1;grid-row:auto;justify-content:flex-start}.exp-folder-head,.exp-doc-row,.exp-container-line{grid-template-columns:1fr}.exp-folder-actions,.exp-doc-actions,.exp-container-actions{justify-content:flex-start}.exp-folder-body{margin-left:18px}.exp-folder-meta{margin-left:27px}.exp-client-picker-results{max-height:220px}.exp-folder-body-actions{justify-content:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function allClients() { return Array.isArray(window.clients) ? window.clients : []; }
  function allShipments() { return Array.isArray(window.shipments) ? window.shipments : []; }
  function allOperationShipments(operation) {
    if (Array.isArray(operation?.shipments)) return operation.shipments;
    return allShipments().filter(shipment => String(shipment.operation_id || '') === String(operation?.id || ''));
  }
  function normalizedTrackingStatus(shipment) { return `${shipment?.operational_status || ''} ${shipment?.last_status || ''}`.trim().toLowerCase(); }
  function isShipmentDelivered(shipment) {
    const status = normalizedTrackingStatus(shipment);
    return shipment?.active === false || status.includes('entregado') || status.includes('delivered');
  }
  function isDelivered(operation) { return operation?.status === 'delivered' || operation?.status === 'closed'; }
  function operationShipments(operation) {
    const shipments = allOperationShipments(operation);
    return isDelivered(operation) ? shipments : shipments.filter(shipment => !isShipmentDelivered(shipment));
  }
  function availableShipments(operation) {
    return allShipments().filter(shipment => String(shipment.client_id || '') === String(operation.client_id || '') && !shipment.operation_id && !isShipmentDelivered(shipment));
  }
  function clientForOperation(operation) { return operation?.client || allClients().find(client => String(client.id) === String(operation?.client_id)) || null; }
  function clientForShipment(shipment) { return shipment?.clients || allClients().find(client => String(client.id) === String(shipment?.client_id)) || null; }
  function distinctBols(shipments) {
    const map = new Map();
    shipments.forEach(shipment => { const raw = String(shipment.bol_number || '').trim(); if (raw) map.set(bolKey(raw), raw); });
    return [...map.values()];
  }
  function blContext(bolNumber) {
    const key = bolKey(bolNumber);
    if (!key) return { bol_number: '', shipments: [], clients: [], client_count: 0, container_count: 0, shared: false };
    const shipments = allShipments().filter(shipment => bolKey(shipment.bol_number) === key);
    const clientMap = new Map();
    shipments.forEach(shipment => {
      if (!shipment.client_id) return;
      const client = clientForShipment(shipment);
      clientMap.set(String(shipment.client_id), client || { id: shipment.client_id, name: 'Cliente' });
    });
    return { bol_number: String(bolNumber || '').trim(), shipments, clients: [...clientMap.values()], client_count: clientMap.size, container_count: shipments.length, shared: clientMap.size > 1 };
  }
  function sharedBolsForOperation(operation) { return distinctBols(operationShipments(operation)).filter(bol => blContext(bol).shared); }
  function documentsForOperation(operation, source = state.documents) {
    const allBols = new Set(distinctBols(allOperationShipments(operation)).map(bolKey));
    const unique = new Map();
    source.forEach(item => {
      const own = String(item.operation_id || '') === String(operation.id || '');
      const shared = Boolean(item.shared_bl) && item.bol_number && allBols.has(bolKey(item.bol_number));
      if (own || shared) unique.set(String(item.id), item);
    });
    return [...unique.values()];
  }
  function visibleDocuments(operation, documents) {
    if (isDelivered(operation)) return documents;
    const visibleShipments = operationShipments(operation);
    const shipmentIds = new Set(visibleShipments.map(shipment => String(shipment.id)));
    const bolNumbers = new Set(distinctBols(visibleShipments).map(bolKey));
    return documents.filter(item => {
      if (item.shipment_id) return shipmentIds.has(String(item.shipment_id));
      if (item.bol_number) return bolNumbers.has(bolKey(item.bol_number));
      return String(item.operation_id || '') === String(operation.id || '');
    });
  }
  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('es-US');
  }
  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  function hiddenDeliveredCount(operation) { return isDelivered(operation) ? 0 : allOperationShipments(operation).filter(isShipmentDelivered).length; }
  function operationTimestamp(operation) {
    const values = [operation.updated_at, operation.created_at, ...allOperationShipments(operation).flatMap(shipment => [shipment.updated_at, shipment.created_at])].filter(Boolean);
    const times = values.map(value => new Date(value).getTime()).filter(Number.isFinite);
    return times.length ? Math.max(...times) : 0;
  }
  function statusLabel(operation) {
    if (isDelivered(operation)) return 'Entregado';
    const shipments = allOperationShipments(operation);
    if (shipments.length) {
      const statuses = shipments.map(normalizedTrackingStatus);
      if (shipments.every(isShipmentDelivered)) return 'Listo para archivar';
      if (statuses.some(status => status.includes('liberado') || status.includes('released'))) return 'Liberado';
      if (statuses.some(status => status.includes('arrib') || status.includes('destino') || status.includes('descarg') || status.includes('discharg'))) return 'En destino';
      if (statuses.some(status => status.includes('tránsito') || status.includes('transit') || status.includes('salid') || status.includes('depart'))) return 'En tránsito';
      return 'Contenedores asignados';
    }
    const docs = documentsForOperation(operation);
    return docs.some(item => String(item.document_type || '').trim().toLowerCase() === 'oferta') ? 'Cotización' : 'Preparación';
  }
  function textMessage(element, text, kind = '') {
    if (!element) return;
    element.textContent = text;
    element.className = `msg${kind ? ` ${kind}` : ''}`;
  }

  function sectionHtml() {
    return `<section class="card"><div class="toolbar"><div><h2 class="section-title">Expedientes de exportación</h2><div class="muted">Busca operaciones actuales o históricas por cliente, expediente, contenedor, producto o B/L.</div></div><button id="newExpediente" class="orange" type="button">Nuevo expediente</button></div><input id="expedientesSearch" class="search" style="margin-top:14px" placeholder="Buscar por cliente, expediente, contenedor, producto o B/L"><div class="toolbar" style="margin-top:12px;align-items:center"><div class="exp-tabs"><button id="expTabActive" class="alt active" type="button">Activos</button><button id="expTabDelivered" class="alt" type="button">Entregados</button><button id="expTabAll" class="alt" type="button">Todos</button></div><button id="reloadExpedientes" class="alt" type="button">Actualizar</button></div><div id="expedientesMsg" class="msg"></div><div id="expedientesList"></div></section>`;
  }
  function matchesSearch(operation) {
    const search = state.search.trim().toLowerCase();
    if (!search) return true;
    const client = clientForOperation(operation);
    const values = [operation.operation_code, client?.name, client?.company, client?.mipyme_name, client?.phone, ...allOperationShipments(operation).flatMap(shipment => [shipment.container_number, shipment.bol_number, shipment.booking_number, shipment.product])];
    return values.some(value => String(value || '').toLowerCase().includes(search));
  }
  function operationRow(operation) {
    const client = clientForOperation(operation);
    const shipments = operationShipments(operation);
    const allShipmentsForOperation = allOperationShipments(operation);
    const docs = visibleDocuments(operation, documentsForOperation(operation));
    const bols = distinctBols(shipments);
    const delivered = isDelivered(operation);
    const dateValue = operationTimestamp(operation);
    return `<article class="exp-row" data-expediente-row="${esc(operation.id)}"><div class="exp-row-primary"><div class="exp-code">${esc(operation.operation_code || 'Expediente')}</div><div class="exp-client">${esc(client?.name || 'Cliente')}</div></div><div class="exp-row-company"><b>${esc(client?.company || client?.mipyme_name || '—')}</b>${dateValue ? `<div class="muted">Último movimiento ${esc(formatDate(new Date(dateValue).toISOString()))}</div>` : ''}</div><div class="exp-row-status"><span class="pill ${delivered ? 'done' : ''}">${esc(statusLabel(operation))}</span></div><div class="exp-row-stats"><span class="pill">${allShipmentsForOperation.length} cont.</span><span class="pill">${distinctBols(allShipmentsForOperation).length} B/L</span><span class="pill ${docs.length ? 'done' : ''}">${docs.length} doc.</span>${!delivered && hiddenDeliveredCount(operation) ? `<span class="pill">${hiddenDeliveredCount(operation)} entregado${hiddenDeliveredCount(operation) === 1 ? '' : 's'} oculto${hiddenDeliveredCount(operation) === 1 ? '' : 's'}</span>` : ''}</div><div class="exp-row-actions"><button class="alt" type="button" data-open-expediente="${esc(operation.id)}">Abrir</button></div></article>`;
  }
  function renderList() {
    const target = byId('expedientesList');
    if (!target) return;
    let operations = state.operations.filter(operation => {
      if (state.tab === 'all') return operation.status !== 'cancelled';
      if (state.tab === 'delivered') return isDelivered(operation);
      return !isDelivered(operation) && operation.status !== 'cancelled';
    }).filter(matchesSearch);
    operations = [...operations].sort((a,b) => operationTimestamp(b) - operationTimestamp(a));
    if (!operations.length) {
      const text = state.search.trim() ? 'No hay expedientes que coincidan con la búsqueda.' : state.tab === 'delivered' ? 'No hay expedientes entregados.' : state.tab === 'all' ? 'No hay expedientes registrados.' : 'No hay expedientes activos.';
      target.innerHTML = `<div class="empty-state" style="margin-top:14px">${text}</div>`;
      return;
    }
    target.innerHTML = `<div class="exp-list-count">${operations.length} expediente${operations.length === 1 ? '' : 's'}</div><div class="exp-list"><div class="exp-list-head"><span>Expediente / cliente</span><span>Empresa / fecha</span><span>Estado</span><span>Resumen</span><span></span></div>${operations.map(operationRow).join('')}</div>`;
    target.querySelectorAll('[data-open-expediente]').forEach(button => { button.onclick = () => openExpediente(button.dataset.openExpediente); });
  }
  async function loadData() {
    try {
      const [operationsResult, documentsResult] = await Promise.all([api('/api/operations'), api('/api/documents')]);
      state.operations = operationsResult.operations || [];
      state.documents = documentsResult.documents || [];
      textMessage(byId('expedientesMsg'), '');
      renderList();
      return true;
    } catch (error) {
      textMessage(byId('expedientesMsg'), error.message || 'No se pudieron cargar los expedientes.', 'bad');
      renderList();
      return false;
    }
  }

  function normalizeClientSearch(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  function clientSearchText(client) { return normalizeClientSearch([client.name, client.phone, client.company, client.mipyme_name, client.email].filter(Boolean).join(' ')); }
  function clientPickerOption(client) {
    const secondary = [client.company, client.mipyme_name, client.phone, client.email].filter(Boolean).join(' · ');
    return `<button type="button" class="exp-client-picker-option" data-exp-client-choice="${esc(client.id)}"><b>${esc(client.name || 'Cliente')}</b><span>${esc(secondary || 'Sin datos adicionales')}</span></button>`;
  }
  function renderClientPickerResults(query = '') {
    const target = byId('newExpedienteClientResults');
    if (!target) return;
    const normalized = normalizeClientSearch(query);
    let matches = allClients();
    if (normalized) matches = matches.filter(client => clientSearchText(client).includes(normalized));
    matches = matches.slice(0,20);
    target.innerHTML = matches.length ? matches.map(clientPickerOption).join('') : '<div class="exp-client-picker-empty">No se encontraron clientes con esa búsqueda.</div>';
    target.querySelectorAll('[data-exp-client-choice]').forEach(button => { button.onclick = () => selectExpedienteClient(button.dataset.expClientChoice); });
  }
  function selectExpedienteClient(clientId) {
    const client = allClients().find(item => String(item.id) === String(clientId));
    const hidden = byId('newExpedienteClient');
    const selected = byId('newExpedienteClientSelected');
    const search = byId('newExpedienteClientSearch');
    const results = byId('newExpedienteClientResults');
    if (!hidden || !selected) return;
    hidden.value = client?.id || '';
    selected.innerHTML = client ? `<div class="exp-client-picker-selected"><b>${esc(client.name || 'Cliente')}</b><div class="muted">${esc([client.company, client.mipyme_name, client.phone].filter(Boolean).join(' · ') || 'Cliente seleccionado')}</div></div>` : '';
    if (client && search) search.value = client.name || '';
    if (results) results.innerHTML = '';
    textMessage(byId('newExpedienteMsg'), '');
  }
  function bindExpedienteClientPicker(selectedClientId = '') {
    const search = byId('newExpedienteClientSearch');
    if (!search) return;
    if (selectedClientId) selectExpedienteClient(selectedClientId); else renderClientPickerResults('');
    search.addEventListener('input', () => {
      const hidden = byId('newExpedienteClient');
      const selected = byId('newExpedienteClientSelected');
      if (hidden) hidden.value = '';
      if (selected) selected.innerHTML = '';
      renderClientPickerResults(search.value);
    });
    search.addEventListener('focus', () => renderClientPickerResults(search.value));
  }
  function newExpedienteHtml(selectedClientId = '') {
    return `<div><label for="newExpedienteClientSearch">Cliente</label><div class="exp-client-picker"><input id="newExpedienteClientSearch" autocomplete="off" placeholder="Buscar por nombre, teléfono, empresa, MIPYME o correo"><input id="newExpedienteClient" type="hidden" value="${esc(selectedClientId)}"><div id="newExpedienteClientSelected"></div><div id="newExpedienteClientResults" class="exp-client-picker-results"></div></div><label style="margin-top:12px">Nota opcional</label><input id="newExpedienteNotes" maxlength="2000" placeholder="Ej. Compra de paneles agosto 2026"><div class="toolbar" style="justify-content:flex-end;margin-top:16px"><button id="createExpediente" class="orange" type="button">Crear expediente</button></div><div id="newExpedienteMsg" class="msg"></div></div>`;
  }
  function openNewExpediente(selectedClientId = '') {
    if (typeof window.openModal !== 'function') return;
    window.openModal('Nuevo expediente de exportación', newExpedienteHtml(selectedClientId));
    bindExpedienteClientPicker(selectedClientId);
    const button = byId('createExpediente');
    if (button) button.onclick = createExpediente;
    byId('newExpedienteClientSearch')?.focus();
  }
  async function createExpediente() {
    const clientId = byId('newExpedienteClient')?.value || '';
    const notes = byId('newExpedienteNotes')?.value || '';
    const button = byId('createExpediente');
    const msg = byId('newExpedienteMsg');
    if (!clientId) return textMessage(msg, 'Busca y selecciona un cliente antes de crear el expediente.', 'bad');
    if (button?.disabled) return;
    button.disabled = true;
    textMessage(msg, 'Creando expediente...');
    try {
      const result = await api('/api/operations', { method:'POST', body:JSON.stringify({ client_id:clientId, notes }) });
      await loadData();
      if (typeof window.closeModal === 'function') window.closeModal();
      if (result.operation?.id) openExpediente(result.operation.id);
    } catch (error) {
      button.disabled = false;
      textMessage(msg, error.message || 'No se pudo crear el expediente.', 'bad');
    }
  }

  function documentRow(item) {
    return `<div class="exp-doc-row"><div><b>${esc(item.document_type || 'Documento')}</b>${item.shared_bl ? '<span class="exp-doc-shared">COMPARTIDO</span>' : ''}${item.notes ? `<div class="muted">${esc(item.notes)}</div>` : ''}</div><div>${esc(item.file_name || 'Archivo')}<div class="muted">v${esc(item.version || 1)} · ${esc(formatBytes(item.file_size_bytes))} · ${esc(formatDate(item.created_at))}</div></div><div class="exp-doc-actions">${item.signed_url ? `<button class="alt" type="button" data-open-document="${esc(item.id)}">Abrir</button>` : ''}<button class="danger" type="button" data-delete-document="${esc(item.id)}">Borrar</button></div></div>`;
  }
  function documentBlock(documents, emptyText) { return documents.length ? documents.map(documentRow).join('') : `<div class="muted" style="padding:4px 0">${esc(emptyText)}</div>`; }
  function sharedContextHtml(context) {
    if (!context?.shared) return '';
    const items = context.shipments.map(shipment => { const client = clientForShipment(shipment); return `<span class="exp-shared-item">${esc(client?.name || 'Cliente')} · ${esc(shipment.container_number || 'Contenedor')}</span>`; }).join('');
    return `<div class="exp-shared-context"><b>B/L compartido detectado automáticamente</b><div class="muted">${context.client_count} clientes · ${context.container_count} contenedores registrados con este mismo B/L.</div><div class="exp-shared-grid">${items}</div></div>`;
  }
  function folderHtml({ id,title,meta,documents,uploadScope,uploadLabel,children='',sharedContext=null }) {
    const addAction = uploadScope ? `<div class="exp-folder-body-actions"><button class="orange" type="button" data-upload-scope="${esc(uploadScope)}" data-upload-label="${esc(uploadLabel || title)}">+ Agregar documento</button></div>` : '';
    return `<div class="exp-folder ${sharedContext?.shared ? 'shared' : ''}"><div class="exp-folder-head" data-folder-toggle="${esc(id)}" role="button" tabindex="0" aria-expanded="false" aria-controls="${esc(id)}"><div><div class="exp-folder-title"><span id="${esc(id)}-arrow" class="exp-folder-arrow">▶</span><span>${esc(title)}</span>${sharedContext?.shared ? `<span class="exp-shared-badge">Compartido · ${sharedContext.client_count} clientes</span>` : ''}</div><div class="exp-folder-meta">${esc(meta)}</div></div><div class="exp-folder-actions"><span class="pill ${documents.length ? 'done' : ''}">${documents.length} archivo${documents.length === 1 ? '' : 's'}</span></div></div><div id="${esc(id)}" class="exp-folder-body hidden">${addAction}${sharedContextHtml(sharedContext)}${documentBlock(documents,'No hay documentos cargados todavía.')}${children}</div></div>`;
  }
  function applicableDocumentsForShipment(shipment, documents) {
    const shipmentId = String(shipment?.id || '');
    const shipmentBol = bolKey(shipment?.bol_number);
    return documents.filter(item => {
      if (item.shipment_id) return String(item.shipment_id) === shipmentId;
      if (item.bol_number) return Boolean(shipmentBol) && bolKey(item.bol_number) === shipmentBol;
      return !item.shipment_id && !item.bol_number;
    });
  }
  function containerRowsHtml(shipments, documents, groupLabel) {
    if (!shipments.length) return '<div class="muted">No hay contenedores en este grupo.</div>';
    return shipments.map(shipment => {
      const ownDocs = documents.filter(item => String(item.shipment_id || '') === String(shipment.id));
      const applicableDocs = applicableDocumentsForShipment(shipment, documents);
      const downloadAction = applicableDocs.length ? `<button class="alt" type="button" data-download-shipment-docs="${esc(shipment.id)}">Descargar todo (${applicableDocs.length})</button>` : '';
      return `<div class="exp-container-card"><div class="exp-container-belongs">${esc(groupLabel)}</div><div class="exp-container-line"><div><b>${esc(shipment.container_number || '—')}</b><div class="muted">${esc(shipment.product || 'Sin producto')}${shipment.operational_status ? ` · ${esc(shipment.operational_status)}` : ''}</div></div><div class="exp-container-actions"><span class="pill ${ownDocs.length ? 'done' : ''}">${ownDocs.length} archivo${ownDocs.length === 1 ? '' : 's'}</span>${downloadAction}<button class="orange" type="button" data-upload-scope="shipment:${esc(shipment.id)}" data-upload-label="Contenedor ${esc(shipment.container_number || '')}">+ Agregar documento</button></div></div>${ownDocs.length ? `<div class="exp-container-files">${ownDocs.map(documentRow).join('')}</div>` : ''}</div>`;
    }).join('');
  }
  function documentFoldersHtml(operation, allDocuments) {
    const shipments = operationShipments(operation);
    const documents = visibleDocuments(operation, allDocuments);
    const generalDocs = documents.filter(item => !item.bol_number && !item.shipment_id && String(item.operation_id || '') === String(operation.id));
    let html = folderHtml({ id:'exp-folder-general', title:'Documentos generales', meta:'Oferta, factura, ficha técnica, permisos y documentos que aplican a todo el envío.', documents:generalDocs, uploadScope:'general', uploadLabel:'Documentos generales' });
    const groups = new Map();
    shipments.forEach(shipment => {
      const raw = String(shipment.bol_number || '').trim();
      const key = raw ? bolKey(raw) : '__pending__';
      if (!groups.has(key)) groups.set(key,{ bol:raw || null, shipments:[] });
      groups.get(key).shipments.push(shipment);
    });
    documents.forEach(item => { if (item.shipment_id || !item.bol_number) return; const key=bolKey(item.bol_number); if (key && !groups.has(key)) groups.set(key,{ bol:item.bol_number, shipments:[] }); });
    const ordered = [...groups.values()].sort((a,b) => !a.bol ? 1 : !b.bol ? -1 : a.bol.localeCompare(b.bol));
    ordered.forEach((group,index) => {
      const context = group.bol ? blContext(group.bol) : null;
      const groupDocs = group.bol ? documents.filter(item => !item.shipment_id && bolKey(item.bol_number) === bolKey(group.bol)) : [];
      const containerDocCount = group.shipments.reduce((sum,shipment) => sum + documents.filter(item => String(item.shipment_id || '') === String(shipment.id)).length,0);
      const title = group.bol ? `B/L ${group.bol}` : 'Pendiente de B/L';
      const meta = group.bol ? `${group.shipments.length} contenedor${group.shipments.length === 1 ? '' : 'es'} · ${containerDocCount} documento${containerDocCount === 1 ? '' : 's'} en sus contenedores` : `${group.shipments.length} contenedor${group.shipments.length === 1 ? '' : 'es'} todavía sin número de B/L`;
      const childTitle = group.shipments.length ? `<div class="exp-group-label"><span class="arrow">↳</span><span>${group.bol ? 'Contenedores en este B/L' : 'Contenedores pendientes de B/L'}</span></div>` : '';
      const groupLabel = group.bol ? `B/L ${group.bol}` : 'Pendiente de B/L';
      html += folderHtml({ id:`exp-folder-bl-${index}`, title, meta, documents:groupDocs, uploadScope:group.bol ? `bol:${group.bol}` : null, uploadLabel:group.bol ? `B/L ${group.bol}` : null, sharedContext:context, children:`${childTitle}${containerRowsHtml(group.shipments,documents,groupLabel)}` });
    });
    if (!ordered.length) html += '<div class="empty-state" style="margin-top:10px">Cuando asignes contenedores activos, aquí aparecerán sus documentos organizados por B/L.</div>';
    return html;
  }
  function expedienteHtml(operation, rawDocuments) {
    const client = clientForOperation(operation);
    const shipments = operationShipments(operation);
    const documents = visibleDocuments(operation, rawDocuments);
    const bols = distinctBols(shipments);
    const shared = sharedBolsForOperation(operation);
    const hiddenDelivered = hiddenDeliveredCount(operation);
    const delivered = isDelivered(operation);
    const containerChips = shipments.length ? `<div class="exp-summary-label">Contenedores del expediente</div><div class="exp-container-chips">${shipments.map(shipment => `<span class="pill">${esc(shipment.container_number || '—')} · ${shipment.bol_number ? `B/L ${esc(shipment.bol_number)}` : 'B/L pendiente'}</span>`).join('')}</div>` : '<div class="muted" style="margin-top:10px">No quedan contenedores activos en este expediente.</div>';
    return `<section><div class="toolbar"><div><div class="exp-code">${esc(operation.operation_code || 'Expediente')}</div><h2 style="margin:3px 0">${esc(client?.name || 'Cliente')}</h2><div class="muted">${esc(client?.company || '')}</div></div><span class="pill ${delivered ? 'done' : ''}">${esc(statusLabel(operation))}</span></div><div class="exp-summary"><div class="exp-summary-top"><div class="exp-stats" style="margin:0"><span class="pill">${shipments.length} contenedor${shipments.length === 1 ? '' : 'es'}${delivered ? '' : ' activos'}</span><span class="pill">${bols.length} B/L</span><span class="pill ${documents.length ? 'done' : ''}">${documents.length} documento${documents.length === 1 ? '' : 's'}</span>${shared.length ? `<span class="exp-shared-badge">${shared.length} B/L compartido${shared.length === 1 ? '' : 's'}</span>` : ''}</div><div class="exp-summary-actions"><button id="manageExpContainers" class="alt" type="button">Gestionar contenedores</button><button id="toggleExpDelivered" class="${delivered ? 'alt' : 'orange'}" type="button">${delivered ? 'Reabrir expediente' : 'Marcar entregado'}</button></div></div>${containerChips}${hiddenDelivered ? `<div class="exp-delivered-note">${hiddenDelivered} contenedor${hiddenDelivered === 1 ? '' : 'es'} ya entregado${hiddenDelivered === 1 ? '' : 's'} se oculta${hiddenDelivered === 1 ? '' : 'n'} automáticamente.</div>` : ''}${operation.notes ? `<div class="muted" style="margin-top:8px">${esc(operation.notes)}</div>` : ''}</div></section><section class="exp-section"><div class="exp-section-title"><div><h3 style="margin:0">Documentos del envío</h3><div class="muted">Abre una carpeta para ver o agregar documentos.</div></div></div>${documentFoldersHtml(operation,rawDocuments)}</section><div id="expDocumentsMsg" class="msg"></div>`;
  }
  function manageContainersHtml(operation) {
    const assigned=operationShipments(operation), available=availableShipments(operation), hiddenDelivered=hiddenDeliveredCount(operation);
    return `<div><div class="exp-subview-head"><button id="backToExpediente" class="exp-back-button" type="button" aria-label="Volver al expediente" title="Volver al expediente">←</button><div><div class="exp-code">${esc(operation.operation_code || 'Expediente')}</div><h3 style="margin:3px 0">Gestionar contenedores</h3></div></div>${hiddenDelivered ? `<div class="exp-delivered-note">${hiddenDelivered} contenedor${hiddenDelivered === 1 ? '' : 'es'} entregado${hiddenDelivered === 1 ? '' : 's'} no aparece${hiddenDelivered === 1 ? '' : 'n'} aquí.</div>` : ''}<div class="exp-section"><b>Asignados activos</b>${assigned.length ? `<div class="exp-manage-table-wrap"><table><thead><tr><th>Contenedor</th><th>Producto</th><th>B/L</th><th></th></tr></thead><tbody>${assigned.map(shipment => `<tr><td><b>${esc(shipment.container_number || '—')}</b></td><td>${esc(shipment.product || '—')}</td><td>${esc(shipment.bol_number || 'Pendiente')}${shipment.bol_number && blContext(shipment.bol_number).shared ? '<br><span class="exp-shared-badge">Compartido</span>' : ''}</td><td><button class="alt" type="button" data-unassign-shipment="${esc(shipment.id)}">Quitar</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="muted" style="margin-top:8px">No hay contenedores activos asignados.</div>'}</div><div class="exp-section"><b>Disponibles de este cliente</b>${available.length ? `<div class="exp-available">${available.map(shipment => `<div class="exp-available-item"><b>${esc(shipment.container_number || 'Contenedor')}</b><div class="muted">${esc(shipment.product || 'Sin producto')} · B/L ${esc(shipment.bol_number || 'pendiente')}</div>${shipment.bol_number && blContext(shipment.bol_number).shared ? `<div style="margin-top:6px"><span class="exp-shared-badge">B/L compartido · ${blContext(shipment.bol_number).client_count} clientes</span></div>` : ''}<button class="orange" style="margin-top:8px" type="button" data-assign-shipment="${esc(shipment.id)}">Agregar</button></div>`).join('')}</div>` : '<div class="muted" style="margin-top:8px">No hay otros contenedores activos disponibles de este cliente.</div>'}</div></div>`;
  }
  function scopeFromValue(value,label) {
    const scope=String(value || 'general');
    if (scope.startsWith('bol:')) { const bol=scope.slice(4); return { bol_number:bol, shipment_id:null, label, relation:blContext(bol) }; }
    if (scope.startsWith('shipment:')) return { bol_number:null, shipment_id:scope.slice(9), label, relation:null };
    return { bol_number:null, shipment_id:null, label:label || 'Documentos generales', relation:null };
  }
  function uploadTypeOptions(target) {
    const types = target.bol_number ? ['B/L','Factura comercial','Packing List',...documentTypes.filter(type => !['B/L','Factura comercial','Packing List'].includes(type))] : documentTypes;
    return types.map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('');
  }
  function uploadHtml(target) {
    const shared=Boolean(target.bol_number && target.relation?.shared);
    return `<div><div class="exp-subview-head"><button id="backToExpediente" class="exp-back-button" type="button" aria-label="Volver al expediente" title="Volver al expediente">←</button><div><h3 style="margin:0">Subir documento</h3><div class="muted">Nada es obligatorio.</div></div></div><div class="exp-upload-target" style="margin-top:14px"><div class="exp-code">Guardar en</div><b>${esc(target.label)}</b>${shared ? `<div class="muted" style="margin-top:4px">B/L detectado en ${target.relation.client_count} clientes y ${target.relation.container_count} contenedores.</div>` : ''}</div><div class="grid"><div><label>Tipo</label><select id="expDocumentType">${uploadTypeOptions(target)}<option value="__other__">Otro documento...</option></select></div><div id="expCustomTypeWrap" class="hidden"><label>Nombre del documento</label><input id="expCustomType" maxlength="80" placeholder="Ej. Homologación Cuba"></div><div><label>Archivo</label><input id="expFile" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.txt"></div><div><label>Nota opcional</label><input id="expDocumentNotes" maxlength="1000" placeholder="Ej. Factura final, ficha técnica aprobada..."></div></div>${shared ? `<label class="exp-share-option"><input id="expSharedBl" type="checkbox" checked><span><b>Documento compartido para este B/L</b><span>Se almacena una sola vez y aparece en los expedientes de todos los clientes que tengan el B/L ${esc(target.bol_number)}. Desmarca esta opción si el archivo pertenece solamente a este cliente.</span></span></label>` : ''}<button id="uploadExpDocument" class="orange" style="margin-top:14px" type="button">Subir documento</button><div id="expUploadMsg" class="msg"></div></div>`;
  }
  function bindDocumentActions(operation,documents) {
    const map=new Map(documents.map(item => [String(item.id),item]));
    document.querySelectorAll('[data-open-document]').forEach(button => { button.onclick=() => { const item=map.get(String(button.dataset.openDocument)); if (item?.signed_url) window.open(item.signed_url,'_blank','noopener'); }; });
    document.querySelectorAll('[data-delete-document]').forEach(button => { button.onclick=() => { const item=map.get(String(button.dataset.deleteDocument)); if (item) deleteDocument(operation,item,button); }; });
  }
  function filenameFromDisposition(disposition, fallback = 'Documentos_contenedor.zip') {
    const value = String(disposition || '');
    const utf = value.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf?.[1]) {
      try { return decodeURIComponent(utf[1].trim()); } catch {}
    }
    const plain = value.match(/filename="?([^";]+)"?/i);
    return plain?.[1]?.trim() || fallback;
  }
  async function downloadShipmentDocuments(shipmentId, button) {
    const id = String(shipmentId || '').trim();
    if (!id) return;
    const authToken = localStorage.getItem('export_mca_token') || '';
    if (!authToken) return alert('Tu sesión no está disponible. Inicia sesión nuevamente.');
    const previousLabel = button?.textContent || 'Descargar todo';
    if (button) { button.disabled = true; button.textContent = 'Preparando ZIP...'; }
    try {
      const response = await fetch(`/api/document-bundle?shipment_id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo preparar la documentación del contenedor.');
      }
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get('Content-Disposition'));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      alert(error.message || 'No se pudo descargar la documentación del contenedor.');
    } finally {
      if (button && document.body.contains(button)) { button.disabled = false; button.textContent = previousLabel; }
    }
  }
  function toggleFolder(header) {
    const body=byId(header?.dataset.folderToggle);
    if (!header || !body) return;
    const opening=body.classList.contains('hidden');
    body.classList.toggle('hidden',!opening);
    header.setAttribute('aria-expanded',String(opening));
    const arrow=byId(`${header.dataset.folderToggle}-arrow`);
    if (arrow) arrow.textContent=opening ? '▼' : '▶';
  }
  function bindExpedienteActions(operation,documents) {
    bindDocumentActions(operation,documents);
    const statusButton=byId('toggleExpDelivered'); if (statusButton) statusButton.onclick=() => setOperationStatus(operation,isDelivered(operation) ? 'draft' : 'delivered');
    const manageButton=byId('manageExpContainers'); if (manageButton) manageButton.onclick=() => openManageContainers(operation.id);
    document.querySelectorAll('[data-folder-toggle]').forEach(header => {
      header.onclick=event => {
        if (event.target.closest('[data-upload-scope]')) return;
        toggleFolder(header);
      };
      header.onkeydown=event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target.closest('[data-upload-scope]')) return;
        event.preventDefault();
        toggleFolder(header);
      };
    });
    document.querySelectorAll('[data-upload-scope]').forEach(button => {
      button.onclick=event => {
        event.stopPropagation();
        openUploadModal(operation,scopeFromValue(button.dataset.uploadScope,button.dataset.uploadLabel));
      };
    });
    document.querySelectorAll('[data-download-shipment-docs]').forEach(button => {
      button.onclick=event => {
        event.stopPropagation();
        downloadShipmentDocuments(button.dataset.downloadShipmentDocs, button);
      };
    });
  }
  async function openExpediente(operationId) {
    try {
      const [operationResult,documentResult]=await Promise.all([api(`/api/operations?id=${encodeURIComponent(operationId)}`),api(`/api/documents?operation_id=${encodeURIComponent(operationId)}`)]);
      const operation=operationResult.operation, documents=documentResult.documents || [];
      if (!operation) throw new Error('Expediente no encontrado');
      if (typeof window.openModal !== 'function') throw new Error('EXPEDIENTES_MODAL_MISSING');
      window.openModal(`Expediente · ${operation.operation_code || ''}`,expedienteHtml(operation,documents));
      bindExpedienteActions(operation,documents);
    } catch (error) { alert(error.message || 'No se pudo abrir el expediente.'); }
  }
  async function openManageContainers(operationId) {
    try {
      const result=await api(`/api/operations?id=${encodeURIComponent(operationId)}`), operation=result.operation;
      if (!operation) throw new Error('Expediente no encontrado');
      window.openModal(`Contenedores · ${operation.operation_code || ''}`,manageContainersHtml(operation));
      byId('backToExpediente')?.addEventListener('click',() => openExpediente(operation.id),{ once:true });
      document.querySelectorAll('[data-assign-shipment]').forEach(button => { button.onclick=() => assignShipment(operation,button.dataset.assignShipment,button); });
      document.querySelectorAll('[data-unassign-shipment]').forEach(button => { button.onclick=() => unassignShipment(operation,button.dataset.unassignShipment,button); });
    } catch (error) { alert(error.message || 'No se pudieron gestionar los contenedores.'); }
  }
  function openUploadModal(operation,target) {
    if (typeof window.openModal !== 'function') return;
    window.openModal(`Subir documento · ${operation.operation_code || ''}`,uploadHtml(target));
    byId('backToExpediente')?.addEventListener('click',() => openExpediente(operation.id),{ once:true });
    const type=byId('expDocumentType'), custom=byId('expCustomTypeWrap'), shared=byId('expSharedBl');
    if (type && custom) type.onchange=() => { custom.classList.toggle('hidden',type.value !== '__other__'); if (shared) shared.checked=type.value === 'B/L'; };
    const uploadButton=byId('uploadExpDocument'); if (uploadButton) uploadButton.onclick=() => uploadDocument(operation,target);
  }
  async function assignShipment(operation,shipmentId,button) {
    if (button?.disabled) return; button.disabled=true;
    try { await api('/api/operations',{ method:'PATCH',body:JSON.stringify({ action:'assign_shipment',operation_id:operation.id,shipment_id:shipmentId }) }); if (typeof window.loadAll === 'function') await window.loadAll(); await loadData(); await openManageContainers(operation.id); }
    catch (error) { button.disabled=false; alert(error.message || 'No se pudo agregar el contenedor.'); }
  }
  async function unassignShipment(operation,shipmentId,button) {
    if (!window.confirm('¿Quitar este contenedor del expediente? El contenedor no se borrará del Tracking.')) return;
    if (button?.disabled) return; button.disabled=true;
    try { await api('/api/operations',{ method:'PATCH',body:JSON.stringify({ action:'unassign_shipment',operation_id:operation.id,shipment_id:shipmentId }) }); if (typeof window.loadAll === 'function') await window.loadAll(); await loadData(); await openManageContainers(operation.id); }
    catch (error) { button.disabled=false; alert(error.message || 'No se pudo quitar el contenedor.'); }
  }
  async function setOperationStatus(operation,status) {
    const button=byId('toggleExpDelivered'); if (button?.disabled) return; button.disabled=true;
    try { await api('/api/operations',{ method:'PATCH',body:JSON.stringify({ action:'set_status',operation_id:operation.id,status }) }); state.tab=status === 'delivered' ? 'delivered' : 'active'; await loadData(); updateTabs(); if (typeof window.closeModal === 'function') window.closeModal(); }
    catch (error) { button.disabled=false; alert(error.message || 'No se pudo actualizar el estado del expediente.'); }
  }
  async function deleteDocument(operation,item,button) {
    const warning=item.shared_bl ? `¿Borrar "${item.file_name || item.document_type || 'este documento'}"?\n\nEste archivo está compartido por el B/L ${item.bol_number || ''}. Se eliminará de todos los expedientes que lo muestran.` : `¿Borrar "${item.file_name || item.document_type || 'este documento'}"?\n\nEl archivo será eliminado del expediente.`;
    if (!window.confirm(warning)) return; if (button?.disabled) return; button.disabled=true;
    try { await api('/api/documents',{ method:'DELETE',body:JSON.stringify({ document_id:item.id }) }); await loadData(); await openExpediente(operation.id); textMessage(byId('expDocumentsMsg'),'Documento eliminado correctamente.','ok'); }
    catch (error) { if (button && document.body.contains(button)) button.disabled=false; alert(error.message || 'No se pudo eliminar el documento.'); }
  }
  async function discardPreparedUpload(operationId,storagePath) {
    if (!storagePath) return;
    try { await api('/api/documents',{ method:'POST',body:JSON.stringify({ action:'discard_upload',operation_id:operationId,storage_path:storagePath }) }); } catch {}
  }
  async function uploadDocument(operation,target) {
    const typeSelect=byId('expDocumentType'), customType=byId('expCustomType'), file=byId('expFile')?.files?.[0], notes=byId('expDocumentNotes')?.value || '', button=byId('uploadExpDocument'), msg=byId('expUploadMsg');
    const selectedType=typeSelect?.value === '__other__' ? customType?.value.trim() : typeSelect?.value, sharedBl=Boolean(byId('expSharedBl')?.checked);
    if (!selectedType) return textMessage(msg,'Escribe el nombre del documento.','bad');
    if (!file) return textMessage(msg,'Selecciona un archivo.','bad');
    if (button?.disabled) return; button.disabled=true; textMessage(msg,'Subiendo documento...');
    let prepared=null;
    try {
      const response=await api('/api/documents',{ method:'POST',body:JSON.stringify({ action:'prepare_upload',operation_id:operation.id,bol_number:target.bol_number,shipment_id:target.shipment_id,shared_bl:sharedBl,document_type:selectedType,file_name:file.name,mime_type:file.type,file_size_bytes:file.size,notes }) });
      prepared=response.upload;
      const form=new FormData(); form.append('cacheControl','3600'); form.append('',file);
      const storageResponse=await fetch(prepared.signed_url,{ method:'PUT',headers:{ 'x-upsert':'false' },body:form });
      if (!storageResponse.ok) { const detail=await storageResponse.text().catch(() => ''); await discardPreparedUpload(operation.id,prepared.storage_path); throw new Error(`No se pudo subir el archivo${detail ? ` · ${detail.slice(0,180)}` : ''}`); }
      await api('/api/documents',{ method:'POST',body:JSON.stringify({ action:'finalize_upload',operation_id:prepared.operation_id,bol_number:prepared.bol_number,shipment_id:prepared.shipment_id,shared_bl:prepared.shared_bl,document_type:prepared.document_type,file_name:prepared.file_name,mime_type:prepared.mime_type,file_size_bytes:prepared.file_size_bytes,notes:prepared.notes,storage_path:prepared.storage_path }) });
      await loadData(); await openExpediente(operation.id);
    } catch (error) { if (msg && document.body.contains(msg)) textMessage(msg,error.message,'bad'); else alert(error.message); }
    finally { if (button && document.body.contains(button)) button.disabled=false; }
  }
  function updateTabs() {
    byId('expTabActive')?.classList.toggle('active',state.tab === 'active');
    byId('expTabDelivered')?.classList.toggle('active',state.tab === 'delivered');
    byId('expTabAll')?.classList.toggle('active',state.tab === 'all');
  }
  function bindEvents() {
    const newButton=byId('newExpediente'); if (newButton) newButton.onclick=() => openNewExpediente();
    const reloadButton=byId('reloadExpedientes'); if (reloadButton) reloadButton.onclick=loadData;
    const activeButton=byId('expTabActive'); if (activeButton) activeButton.onclick=() => { state.tab='active'; updateTabs(); renderList(); };
    const deliveredButton=byId('expTabDelivered'); if (deliveredButton) deliveredButton.onclick=() => { state.tab='delivered'; updateTabs(); renderList(); };
    const allButton=byId('expTabAll'); if (allButton) allButton.onclick=() => { state.tab='all'; updateTabs(); renderList(); };
    const search=byId('expedientesSearch'); if (search) search.oninput=() => { state.search=search.value || ''; renderList(); };
    window.addEventListener('export-mca:data-loaded', loadData);
    window.addEventListener('export-mca:clients-changed', loadData);
  }
  async function init() {
    if (state.initialized) return true;
    const section=byId('newOperationsSection'); if (!section) throw new Error('EXPEDIENTES_SECTION_MISSING');
    installStyles(); section.innerHTML=sectionHtml(); bindEvents(); state.initialized=true; await loadData(); return true;
  }
  function destroy() {
    window.removeEventListener('export-mca:data-loaded',loadData);
    window.removeEventListener('export-mca:clients-changed',loadData);
    state.operations=[]; state.documents=[]; state.search=''; state.tab='active'; state.initialized=false;
  }
  window.ExpedientesModule = Object.freeze({ init,destroy,reload:loadData,open:openExpediente,getState:() => ({ initialized:state.initialized,operations:[...state.operations],documents:[...state.documents],tab:state.tab,search:state.search }) });
})();