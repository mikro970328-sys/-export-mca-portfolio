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

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('es-US');
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function clientFor(shipment) {
    return (window.clients || []).find(client => client.id === shipment?.client_id) || null;
  }

  function clientLabel(client) {
    if (!client) return 'Sin cliente';
    return `${client.name || 'Cliente'}${client.company ? ` · ${client.company}` : ''}`;
  }

  function quantityLabel(shipment) {
    if (shipment?.quantity === null || shipment?.quantity === undefined || shipment?.quantity === '') return '—';
    const numeric = Number(shipment.quantity);
    const quantity = Number.isFinite(numeric) ? numeric.toLocaleString('es-US', { maximumFractionDigits: 3 }) : String(shipment.quantity);
    return `${quantity}${shipment.quantity_unit ? ` ${shipment.quantity_unit}` : ''}`;
  }

  function sectionHtml() {
    return `<section class="card">
      <div class="toolbar">
        <div>
          <h2 class="section-title">Expedientes de exportación</h2>
          <div class="muted">Archivo documental por contenedor. Ningún documento es obligatorio.</div>
        </div>
        <button id="reloadExpedientes" class="alt" type="button">Actualizar</button>
      </div>
      <input id="expedientesSearch" class="search" style="margin-top:14px" placeholder="Buscar por contenedor, cliente, empresa, producto, booking o B/L">
      <div id="expedientesMsg" class="msg"></div>
      <div id="expedientesList" style="margin-top:12px">Cargando...</div>
    </section>`;
  }

  function documentsForShipment(shipmentId) {
    return state.documents.filter(document => document.shipment_id === shipmentId);
  }

  function matchesSearch(shipment) {
    const search = state.search.trim().toLowerCase();
    if (!search) return true;
    const client = clientFor(shipment);
    return [
      shipment.container_number,
      shipment.product,
      shipment.booking_number,
      shipment.bol_number,
      shipment.carrier,
      client?.name,
      client?.company,
      client?.mipyme_name,
      client?.importer_name
    ].some(value => String(value || '').toLowerCase().includes(search));
  }

  function renderList() {
    const target = byId('expedientesList');
    if (!target) return;

    const shipments = (window.shipments || []).filter(matchesSearch);
    if (!Array.isArray(window.shipments)) {
      target.textContent = 'Esperando los contenedores registrados...';
      return;
    }

    if (!shipments.length) {
      target.innerHTML = '<div class="empty-state">No hay contenedores que coincidan con la búsqueda.</div>';
      return;
    }

    target.innerHTML = `<table>
      <thead><tr><th>Contenedor</th><th>Cliente</th><th>Producto</th><th>Documentos</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${shipments.map(shipment => {
        const client = clientFor(shipment);
        const count = documentsForShipment(shipment.id).length;
        return `<tr>
          <td><b>${esc(shipment.container_number || '—')}</b><br><span class="muted">${esc(shipment.booking_number || shipment.bol_number || '')}</span></td>
          <td>${esc(clientLabel(client))}</td>
          <td>${esc(shipment.product || '—')}<br><span class="muted">${esc(quantityLabel(shipment))}</span></td>
          <td><span class="pill ${count ? 'done' : ''}">${count ? `${count} cargado${count === 1 ? '' : 's'}` : 'Sin documentos'}</span></td>
          <td>${esc(shipment.operational_status || shipment.last_status || 'Registrado')}</td>
          <td><button class="alt" type="button" data-open-expediente="${esc(shipment.id)}">Abrir expediente</button></td>
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
      const msg = byId('expedientesMsg');
      if (msg) msg.textContent = '';
      renderList();
      return state.documents;
    } catch (error) {
      const msg = byId('expedientesMsg');
      if (msg) {
        msg.textContent = error.message;
        msg.className = 'msg bad';
      }
      renderList();
      return [];
    }
  }

  function documentListHtml(documents) {
    if (!documents.length) {
      return '<div class="empty-state">Todavía no hay documentos cargados. No hay documentos obligatorios.</div>';
    }

    return `<table>
      <thead><tr><th>Tipo</th><th>Archivo</th><th>Versión</th><th>Subido</th><th>Por</th><th>Acción</th></tr></thead>
      <tbody>${documents.map(document => `<tr>
        <td><b>${esc(document.document_type || 'Documento')}</b>${document.notes ? `<br><span class="muted">${esc(document.notes)}</span>` : ''}</td>
        <td>${esc(document.file_name || 'Archivo')}<br><span class="muted">${esc(formatBytes(document.file_size_bytes))}</span></td>
        <td>v${esc(document.version || 1)}</td>
        <td>${esc(formatDate(document.created_at))}</td>
        <td>${esc(document.uploaded_by_username || 'Administrador')}</td>
        <td>${document.signed_url ? `<button class="alt" type="button" data-open-document="${esc(document.id)}">Abrir</button>` : '<span class="muted">No disponible</span>'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }

  function expedienteHtml(shipment, client, documents) {
    const standardOptions = documentTypes.map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('');

    return `<section>
      <div class="grid">
        <div><b>Contenedor</b><div>${esc(shipment.container_number || '—')}</div></div>
        <div><b>Cliente</b><div>${esc(clientLabel(client))}</div></div>
        <div><b>Producto</b><div>${esc(shipment.product || '—')}</div></div>
        <div><b>Cantidad</b><div>${esc(quantityLabel(shipment))}</div></div>
        <div><b>Booking</b><div>${esc(shipment.booking_number || '—')}</div></div>
        <div><b>B/L</b><div>${esc(shipment.bol_number || '—')}</div></div>
        <div><b>Naviera</b><div>${esc(shipment.carrier || '—')}</div></div>
        <div><b>Fecha de salida</b><div>${esc(shipment.departure_date || '—')}</div></div>
      </div>
    </section>
    <section style="margin-top:24px">
      <div class="toolbar"><div><h3 style="margin:0">Documentos</h3><div class="muted">Sube solamente lo que necesites. Ningún tipo es obligatorio.</div></div></div>
      <div id="expedienteDocuments">${documentListHtml(documents)}</div>
    </section>
    <section class="card" style="margin-top:20px;box-shadow:none">
      <h3 style="margin-top:0">Subir documento</h3>
      <div class="grid">
        <div><label>Tipo de documento</label><select id="expedienteDocumentType">${standardOptions}<option value="__other__">Otro documento...</option></select></div>
        <div id="expedienteCustomTypeWrap" class="hidden"><label>Nombre del documento</label><input id="expedienteCustomType" maxlength="80" placeholder="Ej. Homologación Cuba"></div>
        <div><label>Archivo</label><input id="expedienteFile" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.txt"></div>
        <div><label>Nota opcional</label><input id="expedienteDocumentNotes" maxlength="1000" placeholder="Ej. Aprobado 12/08/2026"></div>
      </div>
      <div style="margin-top:14px"><button id="uploadExpedienteDocument" class="orange" type="button">Subir documento</button></div>
      <div id="expedienteUploadMsg" class="msg"></div>
    </section>`;
  }

  function bindDocumentOpeners(documents) {
    const byDocumentId = new Map(documents.map(document => [document.id, document]));
    document.querySelectorAll('[data-open-document]').forEach(button => {
      button.onclick = () => {
        const item = byDocumentId.get(button.dataset.openDocument);
        if (item?.signed_url) window.open(item.signed_url, '_blank', 'noopener');
      };
    });
  }

  async function openExpediente(shipmentId) {
    const shipment = (window.shipments || []).find(item => item.id === shipmentId);
    if (!shipment) {
      alert('No se encontró el contenedor.');
      return;
    }

    try {
      const result = await api(`/api/documents?shipment_id=${encodeURIComponent(shipmentId)}`);
      const documents = result.documents || [];
      const client = clientFor(shipment);

      if (typeof window.openModal !== 'function') throw new Error('EXPEDIENTES_MODAL_MISSING');
      window.openModal(`Expediente · ${shipment.container_number || ''}`, expedienteHtml(shipment, client, documents));

      bindDocumentOpeners(documents);

      const typeSelect = byId('expedienteDocumentType');
      const customWrap = byId('expedienteCustomTypeWrap');
      if (typeSelect && customWrap) {
        typeSelect.onchange = () => customWrap.classList.toggle('hidden', typeSelect.value !== '__other__');
      }

      const uploadButton = byId('uploadExpedienteDocument');
      if (uploadButton) uploadButton.onclick = () => uploadDocument(shipmentId);
    } catch (error) {
      alert(error.message);
    }
  }

  async function discardPreparedUpload(shipmentId, storagePath) {
    if (!storagePath) return;
    try {
      await api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({ action: 'discard_upload', shipment_id: shipmentId, storage_path: storagePath })
      });
    } catch {}
  }

  async function uploadDocument(shipmentId) {
    const typeSelect = byId('expedienteDocumentType');
    const customType = byId('expedienteCustomType');
    const fileInput = byId('expedienteFile');
    const notesInput = byId('expedienteDocumentNotes');
    const button = byId('uploadExpedienteDocument');
    const msg = byId('expedienteUploadMsg');

    const selectedType = typeSelect?.value === '__other__' ? customType?.value.trim() : typeSelect?.value;
    const file = fileInput?.files?.[0];

    if (!selectedType) {
      if (msg) { msg.textContent = 'Escribe el nombre del documento.'; msg.className = 'msg bad'; }
      return;
    }
    if (!file) {
      if (msg) { msg.textContent = 'Selecciona un archivo.'; msg.className = 'msg bad'; }
      return;
    }

    if (button) button.disabled = true;
    if (msg) { msg.textContent = 'Subiendo documento...'; msg.className = 'msg'; }

    let prepared = null;
    try {
      const response = await api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          action: 'prepare_upload',
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
        await discardPreparedUpload(shipmentId, prepared.storage_path);
        throw new Error(`No se pudo subir el archivo${detail ? ` · ${detail.slice(0, 180)}` : ''}`);
      }

      await api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          action: 'finalize_upload',
          shipment_id: shipmentId,
          document_type: prepared.document_type,
          file_name: prepared.file_name,
          mime_type: prepared.mime_type,
          file_size_bytes: prepared.file_size_bytes,
          notes: prepared.notes,
          storage_path: prepared.storage_path
        })
      });

      await loadDocumentIndex();
      await openExpediente(shipmentId);
      const success = byId('expedienteUploadMsg');
      if (success) { success.textContent = 'Documento cargado correctamente.'; success.className = 'msg ok'; }
    } catch (error) {
      if (prepared?.storage_path && !String(error.message || '').includes('finalize')) {
        // The API also cleans storage if final database registration fails.
      }
      if (msg && document.body.contains(msg)) {
        msg.textContent = error.message;
        msg.className = 'msg bad';
      } else {
        alert(error.message);
      }
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
