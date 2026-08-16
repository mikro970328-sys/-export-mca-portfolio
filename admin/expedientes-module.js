(() => {
  'use strict';

  const state = {
    initialized: false,
    operations: [],
    documents: [],
    tab: 'active',
    search: ''
  };

  const byId = id => document.getElementById(id);
  const api = (...args) => {
    if (typeof window.api !== 'function') throw new Error('EXPEDIENTES_API_MISSING');
    return window.api(...args);
  };
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  const documentTypes = [
    'Oferta',
    'Factura comercial',
    'Packing List',
    'B/L',
    'Ficha técnica del producto',
    'Certificado de origen',
    'Certificado sanitario',
    'Permiso / Licencia',
    'COA / Certificado de análisis',
    'Fotos del producto / embalaje'
  ];

  function installStyles() {
    if (byId('expedientesModuleStyles')) return;
    const style = document.createElement('style');
    style.id = 'expedientesModuleStyles';
    style.textContent = `
      .exp-tabs{display:flex;gap:8px;flex-wrap:wrap}
      .exp-tabs button{min-width:120px}
      .exp-tabs button.active{background:#06204a!important;color:#fff!important;border-color:#06204a!important}
      .exp-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:14px}
      .exp-card{border:1px solid #dfe5ee;border-radius:14px;padding:16px;background:#fff}
      .exp-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      .exp-code{font-size:12px;font-weight:800;color:#667085;text-transform:uppercase;letter-spacing:.04em}
      .exp-client{font-size:18px;font-weight:800;color:#06204a;margin-top:3px}
      .exp-stats{display:flex;gap:7px;flex-wrap:wrap;margin:13px 0}
      .exp-client-ready{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid #e6ebf2;border-radius:10px;margin-top:8px}
      .exp-summary{border:1px solid #e3e8ef;border-radius:14px;padding:14px;background:#f8fafc;margin-top:14px}
      .exp-summary-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .exp-summary-actions{display:flex;gap:8px;flex-wrap:wrap}
      .exp-container-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
      .exp-section{margin-top:18px}
      .exp-section-title{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:8px}
      .exp-folder{border:1px solid #dfe5ee;border-radius:12px;background:#fff;margin-top:10px;overflow:hidden}
      .exp-folder-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:13px 14px}
      .exp-folder-title{font-weight:800;color:#06204a;font-size:15px}
      .exp-folder-meta{font-size:12px;color:#667085;margin-top:2px}
      .exp-folder-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}
      .exp-folder-body{border-top:1px solid #e7ebf0;padding:12px 14px;background:#fbfcfe}
      .exp-doc-row{display:grid;grid-template-columns:minmax(150px,1fr) minmax(160px,1.4fr) auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid #e6ebf2}
      .exp-doc-row:first-child{border-top:0}
      .exp-doc-actions{display:flex;gap:7px;justify-content:flex-end;flex-wrap:wrap}
      .exp-container-line{display:grid;grid-template-columns:minmax(150px,1fr) auto;gap:12px;align-items:center;padding:11px 0;border-top:1px solid #e6ebf2}
      .exp-container-line:first-child{border-top:0}
      .exp-container-actions{display:flex;gap:7px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
      .exp-container-files{margin:0 0 6px 18px;padding-left:12px;border-left:2px solid #e5eaf0}
      .exp-manage-table-wrap{overflow:auto;margin-top:12px}
      .exp-available{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;margin-top:10px}
      .exp-available-item{border:1px solid #e6ebf2;border-radius:10px;padding:10px}
      .exp-upload-target{padding:10px 12px;border:1px solid #dfe5ee;border-radius:10px;background:#f8fafc;margin-bottom:12px}
      .exp-backbar{display:flex;justify-content:flex-end;margin-top:14px}
      @media(max-width:700px){
        .exp-cards{grid-template-columns:1fr}
        .exp-folder-head,.exp-doc-row,.exp-container-line{grid-template-columns:1fr}
        .exp-folder-actions,.exp-doc-actions,.exp-container-actions{justify-content:flex-start}
      }
    `;
    document.head.appendChild(style);
  }

  function allClients() {
    return Array.isArray(window.clients) ? window.clients : [];
  }

  function allShipments() {
    return Array.isArray(window.shipments) ? window.shipments : [];
  }

  function operationShipments(operation) {
    if (Array.isArray(operation?.shipments)) return operation.shipments;
    return allShipments().filter(shipment => String(shipment.operation_id || '') === String(operation?.id || ''));
  }

  function operationDocuments(operationId) {
    return state.documents.filter(document => String(document.operation_id || '') === String(operationId));
  }

  function availableShipments(operation) {
    return allShipments().filter(shipment =>
      String(shipment.client_id || '') === String(operation.client_id || '') &&
      !shipment.operation_id
    );
  }

  function clientForOperation(operation) {
    return operation?.client || allClients().find(client => String(client.id) === String(operation?.client_id)) || null;
  }

  function isDelivered(operation) {
    return operation?.status === 'delivered' || operation?.status === 'closed';
  }

  function distinctBols(shipments) {
    return [...new Set(shipments.map(shipment => String(shipment.bol_number || '').trim()).filter(Boolean))];
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

  function normalizedTrackingStatus(shipment) {
    return `${shipment?.operational_status || ''} ${shipment?.last_status || ''}`.trim().toLowerCase();
  }

  function statusLabel(operation) {
    if (isDelivered(operation)) return 'Entregado';
    const shipments = operationShipments(operation);
    if (shipments.length) {
      const statuses = shipments.map(normalizedTrackingStatus);
      if (statuses.every(status => status.includes('entregado') || status.includes('delivered'))) return 'Listo para archivar';
      if (statuses.some(status => status.includes('liberado') || status.includes('released'))) return 'Liberado';
      if (statuses.some(status => status.includes('arrib') || status.includes('destino') || status.includes('descarg') || status.includes('discharg'))) return 'En destino';
      if (statuses.some(status => status.includes('tránsito') || status.includes('transit') || status.includes('salid') || status.includes('depart'))) return 'En tránsito';
      return 'Contenedores asignados';
    }
    const hasOffer = operationDocuments(operation.id).some(document => String(document.document_type || '').trim().toLowerCase() === 'oferta');
    return hasOffer ? 'Cotización' : 'Preparación';
  }

  function matchesSearch(operation) {
    const search = state.search.trim().toLowerCase();
    if (!search) return true;
    const client = clientForOperation(operation);
    const values = [
      operation.operation_code,
      client?.name,
      client?.company,
      ...operationShipments(operation).flatMap(shipment => [
        shipment.container_number,
        shipment.bol_number,
        shipment.booking_number,
        shipment.product
      ])
    ];
    return values.some(value => String(value || '').toLowerCase().includes(search));
  }

  function textMessage(element, text, kind = '') {
    if (!element) return;
    element.textContent = text;
    element.className = `msg${kind ? ` ${kind}` : ''}`;
  }

  function sectionHtml() {
    return `<section class="card">
      <div class="toolbar">
        <div>
          <h2 class="section-title">Expedientes de exportación</h2>
          <div class="muted">Un expediente por compra o envío. Los documentos quedan organizados por B/L y por contenedor.</div>
        </div>
        <button id="newExpediente" class="orange" type="button">Nuevo expediente</button>
      </div>
      <div class="toolbar" style="margin-top:14px;align-items:center">
        <div class="exp-tabs">
          <button id="expTabActive" class="alt active" type="button">Activos</button>
          <button id="expTabDelivered" class="alt" type="button">Entregados</button>
        </div>
        <button id="reloadExpedientes" class="alt" type="button">Actualizar</button>
      </div>
      <input id="expedientesSearch" class="search" style="margin-top:14px" placeholder="Buscar por cliente, expediente, contenedor, producto o B/L">
      <div id="expedientesMsg" class="msg"></div>
      <div id="expedientesList"></div>
    </section>`;
  }

  function clientsWithoutActiveOperation() {
    const activeClientIds = new Set(
      state.operations.filter(operation => !isDelivered(operation) && operation.status !== 'cancelled')
        .map(operation => String(operation.client_id))
    );
    return allClients().filter(client => !activeClientIds.has(String(client.id)));
  }

  function operationCard(operation) {
    const client = clientForOperation(operation);
    const shipments = operationShipments(operation);
    const documents = operationDocuments(operation.id);
    const bols = distinctBols(shipments);
    return `<article class="exp-card">
      <div class="exp-card-head">
        <div>
          <div class="exp-code">${esc(operation.operation_code || 'Expediente')}</div>
          <div class="exp-client">${esc(client?.name || 'Cliente')}</div>
          <div class="muted">${esc(client?.company || '')}</div>
        </div>
        <span class="pill ${isDelivered(operation) ? 'done' : ''}">${esc(statusLabel(operation))}</span>
      </div>
      <div class="exp-stats">
        <span class="pill">${shipments.length} contenedor${shipments.length === 1 ? '' : 'es'}</span>
        <span class="pill">${bols.length} B/L</span>
        <span class="pill ${documents.length ? 'done' : ''}">${documents.length} documento${documents.length === 1 ? '' : 's'}</span>
      </div>
      <button class="alt" type="button" data-open-expediente="${esc(operation.id)}">Abrir expediente</button>
    </article>`;
  }

  function renderList() {
    const target = byId('expedientesList');
    if (!target) return;

    let operations = state.operations.filter(operation =>
      state.tab === 'delivered' ? isDelivered(operation) : !isDelivered(operation) && operation.status !== 'cancelled'
    );
    operations = operations.filter(matchesSearch);

    const cards = operations.length
      ? `<div class="exp-cards">${operations.map(operationCard).join('')}</div>`
      : `<div class="empty-state" style="margin-top:14px">${state.tab === 'delivered' ? 'No hay expedientes entregados.' : 'No hay expedientes activos que coincidan con la búsqueda.'}</div>`;

    let ready = '';
    if (state.tab === 'active' && !state.search.trim()) {
      const clients = clientsWithoutActiveOperation();
      if (clients.length) {
        ready = `<div class="exp-section">
          <h3 style="margin-bottom:4px">Clientes sin envío activo</h3>
          <div class="muted">El cliente existe, pero todavía no tiene un expediente activo.</div>
          ${clients.map(client => `<div class="exp-client-ready">
            <div><b>${esc(client.name || 'Cliente')}</b>${client.company ? `<div class="muted">${esc(client.company)}</div>` : ''}</div>
            <button class="alt" type="button" data-start-client="${esc(client.id)}">Iniciar expediente</button>
          </div>`).join('')}
        </div>`;
      }
    }

    target.innerHTML = cards + ready;
    target.querySelectorAll('[data-open-expediente]').forEach(button => {
      button.onclick = () => openExpediente(button.dataset.openExpediente);
    });
    target.querySelectorAll('[data-start-client]').forEach(button => {
      button.onclick = () => openNewExpediente(button.dataset.startClient);
    });
  }

  async function loadData() {
    try {
      const [operationsResult, documentsResult] = await Promise.all([
        api('/api/operations'),
        api('/api/documents')
      ]);
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

  function newExpedienteHtml(selectedClientId = '') {
    const options = allClients().map(client => `<option value="${esc(client.id)}" ${String(client.id) === String(selectedClientId) ? 'selected' : ''}>${esc(client.name || 'Cliente')}${client.company ? ` · ${esc(client.company)}` : ''}</option>`).join('');
    return `<div>
      <label>Cliente</label>
      <select id="newExpedienteClient"><option value="">Selecciona un cliente</option>${options}</select>
      <label style="margin-top:12px">Nota opcional</label>
      <input id="newExpedienteNotes" maxlength="2000" placeholder="Ej. Compra de paneles agosto 2026">
      <div class="toolbar" style="justify-content:flex-end;margin-top:16px">
        <button id="createExpediente" class="orange" type="button">Crear expediente</button>
      </div>
      <div id="newExpedienteMsg" class="msg"></div>
    </div>`;
  }

  function openNewExpediente(selectedClientId = '') {
    if (typeof window.openModal !== 'function') return;
    window.openModal('Nuevo expediente de exportación', newExpedienteHtml(selectedClientId));
    const button = byId('createExpediente');
    if (button) button.onclick = createExpediente;
  }

  async function createExpediente() {
    const clientId = byId('newExpedienteClient')?.value || '';
    const notes = byId('newExpedienteNotes')?.value || '';
    const button = byId('createExpediente');
    const msg = byId('newExpedienteMsg');
    if (!clientId) return textMessage(msg, 'Selecciona un cliente.', 'bad');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    textMessage(msg, 'Creando expediente...');
    try {
      const result = await api('/api/operations', {
        method: 'POST',
        body: JSON.stringify({ client_id: clientId, notes })
      });
      await loadData();
      if (typeof window.closeModal === 'function') window.closeModal();
      if (result.operation?.id) openExpediente(result.operation.id);
    } catch (error) {
      if (button) button.disabled = false;
      textMessage(msg, error.message || 'No se pudo crear el expediente.', 'bad');
    }
  }

  function documentRow(item) {
    return `<div class="exp-doc-row">
      <div><b>${esc(item.document_type || 'Documento')}</b>${item.notes ? `<div class="muted">${esc(item.notes)}</div>` : ''}</div>
      <div>${esc(item.file_name || 'Archivo')}<div class="muted">v${esc(item.version || 1)} · ${esc(formatBytes(item.file_size_bytes))} · ${esc(formatDate(item.created_at))}</div></div>
      <div class="exp-doc-actions">
        ${item.signed_url ? `<button class="alt" type="button" data-open-document="${esc(item.id)}">Abrir</button>` : ''}
        <button class="danger" type="button" data-delete-document="${esc(item.id)}">Borrar</button>
      </div>
    </div>`;
  }

  function documentBlock(documents, emptyText) {
    return documents.length ? documents.map(documentRow).join('') : `<div class="muted" style="padding:4px 0">${esc(emptyText)}</div>`;
  }

  function folderHtml({ id, title, meta, documents, uploadScope, uploadLabel, children = '' }) {
    return `<div class="exp-folder">
      <div class="exp-folder-head">
        <div>
          <div class="exp-folder-title">${esc(title)}</div>
          <div class="exp-folder-meta">${esc(meta)}</div>
        </div>
        <div class="exp-folder-actions">
          <span class="pill ${documents.length ? 'done' : ''}">${documents.length} archivo${documents.length === 1 ? '' : 's'}</span>
          <button class="alt" type="button" data-toggle-folder="${esc(id)}">Ver</button>
          ${uploadScope ? `<button class="orange" type="button" data-upload-scope="${esc(uploadScope)}" data-upload-label="${esc(uploadLabel || title)}">Subir</button>` : ''}
        </div>
      </div>
      <div id="${esc(id)}" class="exp-folder-body hidden">
        ${documentBlock(documents, 'Sin archivos cargados.')}
        ${children}
      </div>
    </div>`;
  }

  function containerRowsHtml(shipments, documents) {
    if (!shipments.length) return '<div class="muted">No hay contenedores en este grupo.</div>';
    return shipments.map(shipment => {
      const ownDocs = documents.filter(item => String(item.shipment_id || '') === String(shipment.id));
      return `<div>
        <div class="exp-container-line">
          <div>
            <b>${esc(shipment.container_number || '—')}</b>
            <div class="muted">${esc(shipment.product || 'Sin producto')}${shipment.operational_status ? ` · ${esc(shipment.operational_status)}` : ''}</div>
          </div>
          <div class="exp-container-actions">
            <span class="pill ${ownDocs.length ? 'done' : ''}">${ownDocs.length} archivo${ownDocs.length === 1 ? '' : 's'}</span>
            <button class="orange" type="button" data-upload-scope="shipment:${esc(shipment.id)}" data-upload-label="Contenedor ${esc(shipment.container_number || '')}">Subir al contenedor</button>
          </div>
        </div>
        ${ownDocs.length ? `<div class="exp-container-files">${ownDocs.map(documentRow).join('')}</div>` : ''}
      </div>`;
    }).join('');
  }

  function documentFoldersHtml(operation, documents) {
    const shipments = operationShipments(operation);
    const generalDocs = documents.filter(item => !item.bol_number && !item.shipment_id);
    let html = folderHtml({
      id: 'exp-folder-general',
      title: 'General del expediente',
      meta: 'Oferta, ficha técnica, permisos y documentos que aplican a todo el envío.',
      documents: generalDocs,
      uploadScope: 'general',
      uploadLabel: 'General del expediente'
    });

    const groups = new Map();
    shipments.forEach(shipment => {
      const bol = String(shipment.bol_number || '').trim();
      const key = bol || '__pending__';
      if (!groups.has(key)) groups.set(key, { bol: bol || null, shipments: [] });
      groups.get(key).shipments.push(shipment);
    });
    documents.forEach(item => {
      if (item.shipment_id || !item.bol_number) return;
      const bol = String(item.bol_number).trim();
      if (bol && !groups.has(bol)) groups.set(bol, { bol, shipments: [] });
    });

    const ordered = [...groups.values()].sort((a, b) => {
      if (!a.bol) return 1;
      if (!b.bol) return -1;
      return a.bol.localeCompare(b.bol);
    });

    ordered.forEach((group, index) => {
      const sharedDocs = group.bol
        ? documents.filter(item => !item.shipment_id && String(item.bol_number || '') === group.bol)
        : [];
      const containerDocCount = group.shipments.reduce((sum, shipment) => (
        sum + documents.filter(item => String(item.shipment_id || '') === String(shipment.id)).length
      ), 0);
      const title = group.bol ? `B/L ${group.bol}` : 'Sin B/L';
      const meta = group.bol
        ? `${group.shipments.length} contenedor${group.shipments.length === 1 ? '' : 'es'} · ${containerDocCount} archivo${containerDocCount === 1 ? '' : 's'} en contenedores`
        : `${group.shipments.length} contenedor${group.shipments.length === 1 ? '' : 'es'} pendientes de B/L`;
      const childTitle = group.shipments.length ? '<div class="exp-code" style="margin:10px 0 2px">Contenedores</div>' : '';
      html += folderHtml({
        id: `exp-folder-bl-${index}`,
        title,
        meta,
        documents: sharedDocs,
        uploadScope: group.bol ? `bol:${group.bol}` : null,
        uploadLabel: group.bol ? `B/L ${group.bol}` : null,
        children: `${childTitle}${containerRowsHtml(group.shipments, documents)}`
      });
    });

    if (!ordered.length) {
      html += '<div class="empty-state" style="margin-top:10px">Cuando asignes contenedores, aquí aparecerán organizados por B/L.</div>';
    }
    return html;
  }

  function expedienteHtml(operation, documents) {
    const client = clientForOperation(operation);
    const shipments = operationShipments(operation);
    const delivered = isDelivered(operation);
    const bols = distinctBols(shipments);
    return `<section>
      <div class="toolbar">
        <div>
          <div class="exp-code">${esc(operation.operation_code || 'Expediente')}</div>
          <h2 style="margin:3px 0">${esc(client?.name || 'Cliente')}</h2>
          <div class="muted">${esc(client?.company || '')}</div>
        </div>
        <span class="pill ${delivered ? 'done' : ''}">${esc(statusLabel(operation))}</span>
      </div>

      <div class="exp-summary">
        <div class="exp-summary-top">
          <div class="exp-stats" style="margin:0">
            <span class="pill">${shipments.length} contenedor${shipments.length === 1 ? '' : 'es'}</span>
            <span class="pill">${bols.length} B/L</span>
            <span class="pill ${documents.length ? 'done' : ''}">${documents.length} documento${documents.length === 1 ? '' : 's'}</span>
          </div>
          <div class="exp-summary-actions">
            <button id="manageExpContainers" class="alt" type="button">Gestionar contenedores</button>
            <button id="toggleExpDelivered" class="${delivered ? 'alt' : 'orange'}" type="button">${delivered ? 'Reabrir expediente' : 'Marcar entregado'}</button>
          </div>
        </div>
        ${shipments.length ? `<div class="exp-container-chips">${shipments.map(shipment => `<span class="pill">${esc(shipment.container_number || '—')}</span>`).join('')}</div>` : '<div class="muted" style="margin-top:8px">Todavía no hay contenedores asignados.</div>'}
        ${operation.notes ? `<div class="muted" style="margin-top:8px">${esc(operation.notes)}</div>` : ''}
      </div>
    </section>

    <section class="exp-section">
      <div class="exp-section-title">
        <div>
          <h3 style="margin:0">Documentos</h3>
          <div class="muted">Abre solo la carpeta que necesites. Nada es obligatorio.</div>
        </div>
      </div>
      ${documentFoldersHtml(operation, documents)}
    </section>
    <div id="expDocumentsMsg" class="msg"></div>`;
  }

  function manageContainersHtml(operation) {
    const assigned = operationShipments(operation);
    const available = availableShipments(operation);
    return `<div>
      <div class="toolbar">
        <div>
          <div class="exp-code">${esc(operation.operation_code || 'Expediente')}</div>
          <h3 style="margin:3px 0">Gestionar contenedores</h3>
        </div>
        <button id="backToExpediente" class="alt" type="button">Volver al expediente</button>
      </div>

      <div class="exp-section">
        <b>Asignados</b>
        ${assigned.length ? `<div class="exp-manage-table-wrap"><table>
          <thead><tr><th>Contenedor</th><th>Producto</th><th>B/L</th><th></th></tr></thead>
          <tbody>${assigned.map(shipment => `<tr>
            <td><b>${esc(shipment.container_number || '—')}</b></td>
            <td>${esc(shipment.product || '—')}</td>
            <td>${esc(shipment.bol_number || 'Pendiente')}</td>
            <td><button class="alt" type="button" data-unassign-shipment="${esc(shipment.id)}">Quitar</button></td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="muted" style="margin-top:8px">No hay contenedores asignados.</div>'}
      </div>

      <div class="exp-section">
        <b>Disponibles de este cliente</b>
        ${available.length ? `<div class="exp-available">${available.map(shipment => `<div class="exp-available-item">
          <b>${esc(shipment.container_number || 'Contenedor')}</b>
          <div class="muted">${esc(shipment.product || 'Sin producto')} · B/L ${esc(shipment.bol_number || 'pendiente')}</div>
          <button class="orange" style="margin-top:8px" type="button" data-assign-shipment="${esc(shipment.id)}">Agregar</button>
        </div>`).join('')}</div>` : '<div class="muted" style="margin-top:8px">No hay otros contenedores disponibles de este cliente.</div>'}
      </div>
    </div>`;
  }

  function uploadHtml(target) {
    const typeOptions = documentTypes.map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('');
    return `<div>
      <div class="toolbar">
        <div>
          <h3 style="margin:0">Subir documento</h3>
          <div class="muted">Nada es obligatorio.</div>
        </div>
        <button id="backToExpediente" class="alt" type="button">Volver al expediente</button>
      </div>
      <div class="exp-upload-target"><div class="exp-code">Guardar en</div><b>${esc(target.label)}</b></div>
      <div class="grid">
        <div><label>Tipo</label><select id="expDocumentType">${typeOptions}<option value="__other__">Otro documento...</option></select></div>
        <div id="expCustomTypeWrap" class="hidden"><label>Nombre del documento</label><input id="expCustomType" maxlength="80" placeholder="Ej. Homologación Cuba"></div>
        <div><label>Archivo</label><input id="expFile" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.txt"></div>
        <div><label>Nota opcional</label><input id="expDocumentNotes" maxlength="1000" placeholder="Ej. Factura final, ficha técnica aprobada..."></div>
      </div>
      <button id="uploadExpDocument" class="orange" style="margin-top:14px" type="button">Subir documento</button>
      <div id="expUploadMsg" class="msg"></div>
    </div>`;
  }

  function scopeFromValue(value, label) {
    const scope = String(value || 'general');
    if (scope.startsWith('bol:')) return { bol_number: scope.slice(4), shipment_id: null, label };
    if (scope.startsWith('shipment:')) return { bol_number: null, shipment_id: scope.slice(9), label };
    return { bol_number: null, shipment_id: null, label: label || 'General del expediente' };
  }

  function bindDocumentActions(operation, documents) {
    const map = new Map(documents.map(item => [String(item.id), item]));
    document.querySelectorAll('[data-open-document]').forEach(button => {
      button.onclick = () => {
        const item = map.get(String(button.dataset.openDocument));
        if (item?.signed_url) window.open(item.signed_url, '_blank', 'noopener');
      };
    });
    document.querySelectorAll('[data-delete-document]').forEach(button => {
      button.onclick = () => {
        const item = map.get(String(button.dataset.deleteDocument));
        if (item) deleteDocument(operation, item, button);
      };
    });
  }

  function bindExpedienteActions(operation, documents) {
    bindDocumentActions(operation, documents);

    const statusButton = byId('toggleExpDelivered');
    if (statusButton) statusButton.onclick = () => setOperationStatus(operation, isDelivered(operation) ? 'draft' : 'delivered');
    const manageButton = byId('manageExpContainers');
    if (manageButton) manageButton.onclick = () => openManageContainers(operation.id);

    document.querySelectorAll('[data-toggle-folder]').forEach(button => {
      button.onclick = () => {
        const body = byId(button.dataset.toggleFolder);
        if (!body) return;
        const opening = body.classList.contains('hidden');
        body.classList.toggle('hidden', !opening);
        button.textContent = opening ? 'Cerrar' : 'Ver';
      };
    });

    document.querySelectorAll('[data-upload-scope]').forEach(button => {
      button.onclick = () => openUploadModal(operation, scopeFromValue(button.dataset.uploadScope, button.dataset.uploadLabel));
    });
  }

  async function openExpediente(operationId) {
    try {
      const [operationResult, documentResult] = await Promise.all([
        api(`/api/operations?id=${encodeURIComponent(operationId)}`),
        api(`/api/documents?operation_id=${encodeURIComponent(operationId)}`)
      ]);
      const operation = operationResult.operation;
      const documents = documentResult.documents || [];
      if (!operation) throw new Error('Expediente no encontrado');
      if (typeof window.openModal !== 'function') throw new Error('EXPEDIENTES_MODAL_MISSING');
      window.openModal(`Expediente · ${operation.operation_code || ''}`, expedienteHtml(operation, documents));
      bindExpedienteActions(operation, documents);
    } catch (error) {
      alert(error.message || 'No se pudo abrir el expediente.');
    }
  }

  async function openManageContainers(operationId) {
    try {
      const result = await api(`/api/operations?id=${encodeURIComponent(operationId)}`);
      const operation = result.operation;
      if (!operation) throw new Error('Expediente no encontrado');
      window.openModal(`Contenedores · ${operation.operation_code || ''}`, manageContainersHtml(operation));
      byId('backToExpediente')?.addEventListener('click', () => openExpediente(operation.id), { once: true });
      document.querySelectorAll('[data-assign-shipment]').forEach(button => {
        button.onclick = () => assignShipment(operation, button.dataset.assignShipment, button);
      });
      document.querySelectorAll('[data-unassign-shipment]').forEach(button => {
        button.onclick = () => unassignShipment(operation, button.dataset.unassignShipment, button);
      });
    } catch (error) {
      alert(error.message || 'No se pudieron gestionar los contenedores.');
    }
  }

  function openUploadModal(operation, target) {
    if (typeof window.openModal !== 'function') return;
    window.openModal(`Subir documento · ${operation.operation_code || ''}`, uploadHtml(target));
    byId('backToExpediente')?.addEventListener('click', () => openExpediente(operation.id), { once: true });
    const type = byId('expDocumentType');
    const custom = byId('expCustomTypeWrap');
    if (type && custom) type.onchange = () => custom.classList.toggle('hidden', type.value !== '__other__');
    const uploadButton = byId('uploadExpDocument');
    if (uploadButton) uploadButton.onclick = () => uploadDocument(operation, target);
  }

  async function assignShipment(operation, shipmentId, button) {
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      await api('/api/operations', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'assign_shipment', operation_id: operation.id, shipment_id: shipmentId })
      });
      if (typeof window.loadAll === 'function') await window.loadAll();
      await loadData();
      await openManageContainers(operation.id);
    } catch (error) {
      if (button) button.disabled = false;
      alert(error.message || 'No se pudo agregar el contenedor.');
    }
  }

  async function unassignShipment(operation, shipmentId, button) {
    if (!window.confirm('¿Quitar este contenedor del expediente? El contenedor no se borrará del Tracking.')) return;
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      await api('/api/operations', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'unassign_shipment', operation_id: operation.id, shipment_id: shipmentId })
      });
      if (typeof window.loadAll === 'function') await window.loadAll();
      await loadData();
      await openManageContainers(operation.id);
    } catch (error) {
      if (button) button.disabled = false;
      alert(error.message || 'No se pudo quitar el contenedor.');
    }
  }

  async function setOperationStatus(operation, status) {
    const button = byId('toggleExpDelivered');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      await api('/api/operations', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'set_status', operation_id: operation.id, status })
      });
      state.tab = status === 'delivered' ? 'delivered' : 'active';
      await loadData();
      updateTabs();
      renderList();
      if (typeof window.closeModal === 'function') window.closeModal();
    } catch (error) {
      if (button) button.disabled = false;
      alert(error.message || 'No se pudo actualizar el estado del expediente.');
    }
  }

  async function deleteDocument(operation, item, button) {
    if (!window.confirm(`¿Borrar "${item.file_name || item.document_type || 'este documento'}"?\n\nEl archivo será eliminado del expediente.`)) return;
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      await api('/api/documents', {
        method: 'DELETE',
        body: JSON.stringify({ document_id: item.id })
      });
      await loadData();
      await openExpediente(operation.id);
      textMessage(byId('expDocumentsMsg'), 'Documento eliminado correctamente.', 'ok');
    } catch (error) {
      if (button && document.body.contains(button)) button.disabled = false;
      alert(error.message || 'No se pudo eliminar el documento.');
    }
  }

  async function discardPreparedUpload(operationId, storagePath) {
    if (!storagePath) return;
    try {
      await api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({ action: 'discard_upload', operation_id: operationId, storage_path: storagePath })
      });
    } catch {}
  }

  async function uploadDocument(operation, target) {
    const typeSelect = byId('expDocumentType');
    const customType = byId('expCustomType');
    const file = byId('expFile')?.files?.[0];
    const notes = byId('expDocumentNotes')?.value || '';
    const button = byId('uploadExpDocument');
    const msg = byId('expUploadMsg');
    const selectedType = typeSelect?.value === '__other__' ? customType?.value.trim() : typeSelect?.value;

    if (!selectedType) return textMessage(msg, 'Escribe el nombre del documento.', 'bad');
    if (!file) return textMessage(msg, 'Selecciona un archivo.', 'bad');
    if (button?.disabled) return;

    if (button) button.disabled = true;
    textMessage(msg, 'Subiendo documento...');
    let prepared = null;
    try {
      const response = await api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          action: 'prepare_upload',
          operation_id: operation.id,
          bol_number: target.bol_number,
          shipment_id: target.shipment_id,
          document_type: selectedType,
          file_name: file.name,
          mime_type: file.type,
          file_size_bytes: file.size,
          notes
        })
      });
      prepared = response.upload;

      const form = new FormData();
      form.append('cacheControl', '3600');
      form.append('', file);
      const storageResponse = await fetch(prepared.signed_url, {
        method: 'PUT',
        headers: { 'x-upsert': 'false' },
        body: form
      });
      if (!storageResponse.ok) {
        const detail = await storageResponse.text().catch(() => '');
        await discardPreparedUpload(operation.id, prepared.storage_path);
        throw new Error(`No se pudo subir el archivo${detail ? ` · ${detail.slice(0, 180)}` : ''}`);
      }

      await api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          action: 'finalize_upload',
          operation_id: prepared.operation_id,
          bol_number: prepared.bol_number,
          shipment_id: prepared.shipment_id,
          document_type: prepared.document_type,
          file_name: prepared.file_name,
          mime_type: prepared.mime_type,
          file_size_bytes: prepared.file_size_bytes,
          notes: prepared.notes,
          storage_path: prepared.storage_path
        })
      });

      await loadData();
      await openExpediente(operation.id);
    } catch (error) {
      if (msg && document.body.contains(msg)) textMessage(msg, error.message, 'bad');
      else alert(error.message);
    } finally {
      if (button && document.body.contains(button)) button.disabled = false;
    }
  }

  function updateTabs() {
    byId('expTabActive')?.classList.toggle('active', state.tab === 'active');
    byId('expTabDelivered')?.classList.toggle('active', state.tab === 'delivered');
  }

  function bindEvents() {
    const newButton = byId('newExpediente');
    if (newButton) newButton.onclick = () => openNewExpediente();
    const reloadButton = byId('reloadExpedientes');
    if (reloadButton) reloadButton.onclick = loadData;
    const activeButton = byId('expTabActive');
    if (activeButton) activeButton.onclick = () => { state.tab = 'active'; updateTabs(); renderList(); };
    const deliveredButton = byId('expTabDelivered');
    if (deliveredButton) deliveredButton.onclick = () => { state.tab = 'delivered'; updateTabs(); renderList(); };
    const search = byId('expedientesSearch');
    if (search) search.oninput = () => { state.search = search.value || ''; renderList(); };

    window.addEventListener('export-mca:data-loaded', loadData);
    window.addEventListener('export-mca:clients-changed', loadData);
  }

  async function init() {
    if (state.initialized) return true;
    const section = byId('newOperationsSection');
    if (!section) throw new Error('EXPEDIENTES_SECTION_MISSING');
    installStyles();
    section.innerHTML = sectionHtml();
    bindEvents();
    state.initialized = true;
    await loadData();
    return true;
  }

  function destroy() {
    window.removeEventListener('export-mca:data-loaded', loadData);
    window.removeEventListener('export-mca:clients-changed', loadData);
    state.operations = [];
    state.documents = [];
    state.search = '';
    state.tab = 'active';
    state.initialized = false;
  }

  window.ExpedientesModule = Object.freeze({
    init,
    destroy,
    reload: loadData,
    open: openExpediente,
    getState: () => ({
      initialized: state.initialized,
      operations: [...state.operations],
      documents: [...state.documents],
      tab: state.tab,
      search: state.search
    })
  });
})();
