(() => {
  'use strict';

  const state = {
    initialized: false,
    documents: [],
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

  function allClients() {
    return Array.isArray(window.clients) ? window.clients : [];
  }

  function allShipments() {
    return Array.isArray(window.shipments) ? window.shipments : [];
  }

  function documentsForClient(clientId) {
    return state.documents.filter(document => String(document.client_id || '') === String(clientId));
  }

  function shipmentsForClient(clientId) {
    return allShipments().filter(shipment => String(shipment.client_id || '') === String(clientId));
  }

  function shipmentById(id) {
    return allShipments().find(shipment => String(shipment.id) === String(id)) || null;
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

  function quantityLabel(shipment) {
    if (shipment?.quantity === null || shipment?.quantity === undefined || shipment?.quantity === '') return '—';
    const numeric = Number(shipment.quantity);
    const quantity = Number.isFinite(numeric)
      ? numeric.toLocaleString('es-US', { maximumFractionDigits: 3 })
      : String(shipment.quantity);
    return `${quantity}${shipment.quantity_unit ? ` ${shipment.quantity_unit}` : ''}`;
  }

  function hasOffer(documents) {
    return documents.some(document => String(document.document_type || '').trim().toLowerCase() === 'oferta');
  }

  function clientStage(client) {
    const documents = documentsForClient(client.id);
    const shipments = shipmentsForClient(client.id);
    if (shipments.length) return `${shipments.length} contenedor${shipments.length === 1 ? '' : 'es'} asignado${shipments.length === 1 ? '' : 's'}`;
    if (hasOffer(documents)) return 'Oferta / negociación';
    if (documents.length) return 'Documentación iniciada';
    return 'Cliente registrado';
  }

  function matchesSearch(client) {
    const search = state.search.trim().toLowerCase();
    if (!search) return true;
    const shipments = shipmentsForClient(client.id);
    return [
      client.name,
      client.company,
      client.mipyme_name,
      client.importer_name,
      client.email,
      client.phone,
      ...shipments.flatMap(shipment => [
        shipment.container_number,
        shipment.product,
        shipment.booking_number,
        shipment.bol_number,
        shipment.carrier
      ])
    ].some(value => String(value || '').toLowerCase().includes(search));
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
          <div class="muted">Cada cliente tiene su expediente desde que se registra. Los contenedores aparecen aquí cuando se le asignan.</div>
        </div>
        <button id="reloadExpedientes" class="alt" type="button">Actualizar</button>
      </div>
      <input id="expedientesSearch" class="search" style="margin-top:14px" placeholder="Buscar por cliente, empresa, contenedor, producto, booking o B/L">
      <div id="expedientesMsg" class="msg"></div>
      <div id="expedientesList" style="margin-top:12px">Cargando...</div>
    </section>`;
  }

  function renderList() {
    const target = byId('expedientesList');
    if (!target) return;

    if (!Array.isArray(window.clients)) {
      target.textContent = 'Esperando los clientes registrados...';
      return;
    }

    const clients = allClients().filter(matchesSearch);
    if (!clients.length) {
      target.innerHTML = '<div class="empty-state">No hay clientes que coincidan con la búsqueda.</div>';
      return;
    }

    target.innerHTML = `<table>
      <thead><tr><th>Cliente</th><th>Empresa</th><th>Proceso</th><th>Contenedores</th><th>Documentos</th><th>Acciones</th></tr></thead>
      <tbody>${clients.map(client => {
        const shipments = shipmentsForClient(client.id);
        const documents = documentsForClient(client.id);
        return `<tr>
          <td><b>${esc(client.name || 'Cliente')}</b>${client.mipyme_name ? `<br><span class="muted">${esc(client.mipyme_name)}</span>` : ''}</td>
          <td>${esc(client.company || '—')}</td>
          <td><span class="pill ${shipments.length ? 'done' : ''}">${esc(clientStage(client))}</span></td>
          <td>${shipments.length ? shipments.map(shipment => `<span class="pill">${esc(shipment.container_number || '—')}</span>`).join(' ') : '<span class="muted">Aún sin asignar</span>'}</td>
          <td>${documents.length ? `<span class="pill done">${documents.length} cargado${documents.length === 1 ? '' : 's'}</span>` : '<span class="muted">Sin documentos</span>'}</td>
          <td><button class="alt" type="button" data-open-expediente="${esc(client.id)}">Abrir expediente</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;

    target.querySelectorAll('[data-open-expediente]').forEach(button => {
      button.onclick = () => openExpediente(button.dataset.openExpediente);
    });
  }

  async function loadDocumentIndex() {
    try {
      const result = await api('/api/documents');
      state.documents = result.documents || [];
      textMessage(byId('expedientesMsg'), '');
      renderList();
      return state.documents;
    } catch (error) {
      textMessage(byId('expedientesMsg'), error.message, 'bad');
      renderList();
      return [];
    }
  }

  function processHtml(client, documents, shipments) {
    const offerLoaded = hasOffer(documents);
    return `<section class="card" style="box-shadow:none;margin-bottom:18px">
      <div class="toolbar"><div><h3 style="margin:0">Proceso</h3><div class="muted">Vista informativa. Nada de esto es obligatorio ni bloquea el expediente.</div></div></div>
      <div class="grid" style="margin-top:12px">
        <div><b>Cliente</b><div><span class="pill done">Registrado</span></div></div>
        <div><b>Oferta</b><div><span class="pill ${offerLoaded ? 'done' : ''}">${offerLoaded ? 'Cargada' : 'No cargada'}</span></div></div>
        <div><b>Contenedores</b><div><span class="pill ${shipments.length ? 'done' : ''}">${shipments.length ? `${shipments.length} asignado${shipments.length === 1 ? '' : 's'}` : 'Aún sin asignar'}</span></div></div>
        <div><b>Documentos</b><div><span class="pill ${documents.length ? 'done' : ''}">${documents.length ? `${documents.length} cargado${documents.length === 1 ? '' : 's'}` : 'Sin documentos'}</span></div></div>
      </div>
    </section>`;
  }

  function containersHtml(shipments) {
    if (!shipments.length) {
      return '<div class="empty-state">Este cliente todavía no tiene contenedores asignados. Cuando se le asigne uno en Registrar contenedor, aparecerá aquí automáticamente.</div>';
    }
    return `<table>
      <thead><tr><th>Contenedor</th><th>Producto</th><th>Cantidad</th><th>Booking / B/L</th><th>Estado</th></tr></thead>
      <tbody>${shipments.map(shipment => `<tr>
        <td><b>${esc(shipment.container_number || '—')}</b></td>
        <td>${esc(shipment.product || '—')}</td>
        <td>${esc(quantityLabel(shipment))}</td>
        <td>${esc(shipment.booking_number || '—')}<br><span class="muted">${esc(shipment.bol_number || '')}</span></td>
        <td>${esc(shipment.operational_status || shipment.last_status || 'Registrado')}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }

  function documentListHtml(documents) {
    if (!documents.length) {
      return '<div class="empty-state">Todavía no hay documentos cargados. Ningún documento es obligatorio.</div>';
    }

    return `<table>
      <thead><tr><th>Tipo</th><th>Archivo</th><th>Relacionado con</th><th>Versión</th><th>Subido</th><th>Por</th><th>Acciones</th></tr></thead>
      <tbody>${documents.map(document => {
        const shipment = document.shipment_id ? shipmentById(document.shipment_id) : null;
        return `<tr>
          <td><b>${esc(document.document_type || 'Documento')}</b>${document.notes ? `<br><span class="muted">${esc(document.notes)}</span>` : ''}</td>
          <td>${esc(document.file_name || 'Archivo')}<br><span class="muted">${esc(formatBytes(document.file_size_bytes))}</span></td>
          <td>${shipment ? esc(shipment.container_number || 'Contenedor') : '<span class="muted">General del cliente</span>'}</td>
          <td>v${esc(document.version || 1)}</td>
          <td>${esc(formatDate(document.created_at))}</td>
          <td>${esc(document.uploaded_by_username || 'Administrador')}</td>
          <td><div class="actions">
            ${document.signed_url ? `<button class="alt" type="button" data-open-document="${esc(document.id)}">Abrir</button>` : ''}
            <button class="danger" type="button" data-delete-document="${esc(document.id)}">Borrar</button>
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  function uploadHtml(shipments) {
    const standardOptions = documentTypes.map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('');
    const shipmentOptions = shipments.map(shipment => `<option value="${esc(shipment.id)}">${esc(shipment.container_number || 'Contenedor')} · ${esc(shipment.product || 'Sin producto')}</option>`).join('');
    return `<section class="card" style="margin-top:20px;box-shadow:none">
      <h3 style="margin-top:0">Subir documento</h3>
      <div class="muted" style="margin-bottom:10px">El documento pertenece al cliente. Si aplica a un contenedor específico, puedes relacionarlo de forma opcional.</div>
      <div class="grid">
        <div><label>Tipo de documento</label><select id="expedienteDocumentType">${standardOptions}<option value="__other__">Otro documento...</option></select></div>
        <div id="expedienteCustomTypeWrap" class="hidden"><label>Nombre del documento</label><input id="expedienteCustomType" maxlength="80" placeholder="Ej. Homologación Cuba"></div>
        <div><label>Relacionado con contenedor</label><select id="expedienteShipment"><option value="">General del cliente / Sin contenedor</option>${shipmentOptions}</select></div>
        <div><label>Archivo</label><input id="expedienteFile" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.txt"></div>
        <div><label>Nota opcional</label><input id="expedienteDocumentNotes" maxlength="1000" placeholder="Ej. Oferta inicial, homologación aprobada, etc."></div>
      </div>
      <div style="margin-top:14px"><button id="uploadExpedienteDocument" class="orange" type="button">Subir documento</button></div>
      <div id="expedienteUploadMsg" class="msg"></div>
    </section>`;
  }

  function expedienteHtml(client, documents, shipments) {
    return `<section>
      <div class="grid">
        <div><b>Cliente</b><div>${esc(client.name || '—')}</div></div>
        <div><b>Empresa</b><div>${esc(client.company || '—')}</div></div>
        <div><b>MIPYME</b><div>${esc(client.mipyme_name || '—')}</div></div>
        <div><b>Importadora</b><div>${esc(client.importer_name || '—')}</div></div>
        <div><b>Correo</b><div>${esc(client.email || '—')}</div></div>
        <div><b>WhatsApp</b><div>${esc(client.phone || '—')}</div></div>
      </div>
    </section>
    <div style="margin-top:20px">${processHtml(client, documents, shipments)}</div>
    <section style="margin-top:22px">
      <div class="toolbar"><div><h3 style="margin:0">Contenedores asignados</h3><div class="muted">Lectura desde Registrar contenedor / Tracking.</div></div></div>
      <div style="margin-top:10px">${containersHtml(shipments)}</div>
    </section>
    <section style="margin-top:24px">
      <div class="toolbar"><div><h3 style="margin:0">Documentos</h3><div class="muted">Oferta, factura, Packing List, B/L, ficha técnica, permisos y cualquier otro archivo. Nada es obligatorio.</div></div></div>
      <div id="expedienteDocumentsMsg" class="msg"></div>
      <div id="expedienteDocuments">${documentListHtml(documents)}</div>
    </section>
    ${uploadHtml(shipments)}`;
  }

  function bindDocumentActions(documents, clientId) {
    const byDocumentId = new Map(documents.map(document => [document.id, document]));

    document.querySelectorAll('[data-open-document]').forEach(button => {
      button.onclick = () => {
        const item = byDocumentId.get(button.dataset.openDocument);
        if (item?.signed_url) window.open(item.signed_url, '_blank', 'noopener');
      };
    });

    document.querySelectorAll('[data-delete-document]').forEach(button => {
      button.onclick = () => {
        const item = byDocumentId.get(button.dataset.deleteDocument);
        if (item) deleteDocument(clientId, item, button);
      };
    });
  }

  async function openExpediente(clientId) {
    const client = allClients().find(item => String(item.id) === String(clientId));
    if (!client) return alert('No se encontró el cliente.');

    try {
      const result = await api(`/api/documents?client_id=${encodeURIComponent(clientId)}`);
      const documents = result.documents || [];
      const shipments = shipmentsForClient(clientId);

      if (typeof window.openModal !== 'function') throw new Error('EXPEDIENTES_MODAL_MISSING');
      window.openModal(`Expediente · ${client.name || 'Cliente'}`, expedienteHtml(client, documents, shipments));

      bindDocumentActions(documents, clientId);

      const typeSelect = byId('expedienteDocumentType');
      const customWrap = byId('expedienteCustomTypeWrap');
      if (typeSelect && customWrap) {
        typeSelect.onchange = () => customWrap.classList.toggle('hidden', typeSelect.value !== '__other__');
      }

      const uploadButton = byId('uploadExpedienteDocument');
      if (uploadButton) uploadButton.onclick = () => uploadDocument(clientId);
    } catch (error) {
      alert(error.message);
    }
  }

  async function deleteDocument(clientId, item, button) {
    const confirmed = window.confirm(`¿Borrar "${item.file_name || item.document_type || 'este documento'}"?\n\nEl archivo será eliminado del expediente del cliente.`);
    if (!confirmed) return;

    button.disabled = true;
    textMessage(byId('expedienteDocumentsMsg'), 'Eliminando documento...');

    try {
      await api('/api/documents', {
        method: 'DELETE',
        body: JSON.stringify({ document_id: item.id })
      });
      await loadDocumentIndex();
      await openExpediente(clientId);
      textMessage(byId('expedienteDocumentsMsg'), 'Documento eliminado correctamente.', 'ok');
    } catch (error) {
      if (document.body.contains(button)) button.disabled = false;
      textMessage(byId('expedienteDocumentsMsg'), error.message || 'No se pudo eliminar el documento.', 'bad');
    }
  }

  async function discardPreparedUpload(clientId, storagePath) {
    if (!storagePath) return;
    try {
      await api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({ action: 'discard_upload', client_id: clientId, storage_path: storagePath })
      });
    } catch {}
  }

  async function uploadDocument(clientId) {
    const typeSelect = byId('expedienteDocumentType');
    const customType = byId('expedienteCustomType');
    const shipmentSelect = byId('expedienteShipment');
    const fileInput = byId('expedienteFile');
    const notesInput = byId('expedienteDocumentNotes');
    const button = byId('uploadExpedienteDocument');
    const msg = byId('expedienteUploadMsg');

    const selectedType = typeSelect?.value === '__other__' ? customType?.value.trim() : typeSelect?.value;
    const shipmentId = shipmentSelect?.value || null;
    const file = fileInput?.files?.[0];

    if (!selectedType) {
      textMessage(msg, 'Escribe el nombre del documento.', 'bad');
      return;
    }
    if (!file) {
      textMessage(msg, 'Selecciona un archivo.', 'bad');
      return;
    }

    if (button) button.disabled = true;
    textMessage(msg, 'Subiendo documento...');

    let prepared = null;
    try {
      const response = await api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          action: 'prepare_upload',
          client_id: clientId,
          shipment_id: shipmentId,
          document_type: selectedType,
          file_name: file.name,
          mime_type: file.type,
          file_size_bytes: file.size,
          notes: notesInput?.value || ''
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
        await discardPreparedUpload(clientId, prepared.storage_path);
        throw new Error(`No se pudo subir el archivo${detail ? ` · ${detail.slice(0, 180)}` : ''}`);
      }

      await api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          action: 'finalize_upload',
          client_id: prepared.client_id,
          shipment_id: prepared.shipment_id,
          document_type: prepared.document_type,
          file_name: prepared.file_name,
          mime_type: prepared.mime_type,
          file_size_bytes: prepared.file_size_bytes,
          notes: prepared.notes,
          storage_path: prepared.storage_path
        })
      });

      await loadDocumentIndex();
      await openExpediente(clientId);
      textMessage(byId('expedienteUploadMsg'), 'Documento cargado correctamente.', 'ok');
    } catch (error) {
      if (msg && document.body.contains(msg)) textMessage(msg, error.message, 'bad');
      else alert(error.message);
    } finally {
      if (button && document.body.contains(button)) button.disabled = false;
    }
  }

  function bindEvents() {
    const search = byId('expedientesSearch');
    const reload = byId('reloadExpedientes');

    if (search) {
      search.oninput = () => {
        state.search = search.value || '';
        renderList();
      };
    }
    if (reload) reload.onclick = loadDocumentIndex;

    window.addEventListener('export-mca:data-loaded', renderList);
    window.addEventListener('export-mca:clients-changed', renderList);
  }

  async function init() {
    if (state.initialized) return true;
    const section = byId('newOperationsSection');
    if (!section) throw new Error('EXPEDIENTES_SECTION_MISSING');

    section.innerHTML = sectionHtml();
    bindEvents();
    state.initialized = true;
    loadDocumentIndex();
    return true;
  }

  function destroy() {
    window.removeEventListener('export-mca:data-loaded', renderList);
    window.removeEventListener('export-mca:clients-changed', renderList);
    state.documents = [];
    state.search = '';
    state.initialized = false;
  }

  window.ExpedientesModule = Object.freeze({
    init,
    destroy,
    reload: loadDocumentIndex,
    open: openExpediente,
    getState: () => ({ initialized: state.initialized, documents: [...state.documents], search: state.search })
  });
})();
