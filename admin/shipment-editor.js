(() => {
  const byId = id => document.getElementById(id);
  const escEditor = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  let editorShipment = null;
  let dirty = false;
  let saving = false;

  function addEditorStyles() {
    if (byId('shipmentEditorStyles')) return;
    const style = document.createElement('style');
    style.id = 'shipmentEditorStyles';
    style.textContent = `
      #modal.shipment-editor-modal{backdrop-filter:blur(5px);background:rgba(5,18,42,.58)}
      #modal.shipment-editor-modal .modalbox{max-width:1080px;width:min(96vw,1080px);max-height:92vh;padding:0;overflow:hidden;box-shadow:0 24px 70px rgba(5,18,42,.32)}
      .shipment-editor-head{padding:22px 24px 18px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,#fff,#f7f9fc)}
      .shipment-editor-title{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
      .shipment-editor-title h2{margin:0;color:var(--navy);font-size:22px}.shipment-editor-code{font-size:13px;color:var(--muted);margin-top:5px}
      .shipment-editor-tabs{display:flex;gap:6px;padding:12px 24px;border-bottom:1px solid var(--line);background:#fff;overflow:auto}
      .shipment-editor-tab{background:#fff;color:var(--muted);border:1px solid transparent;white-space:nowrap}
      .shipment-editor-tab.active{color:var(--navy);background:#edf3ff;border-color:#c9d8f2}
      .shipment-editor-body{padding:22px 24px;overflow:auto;max-height:62vh;background:#fff}
      .shipment-editor-panel{display:none}.shipment-editor-panel.active{display:block}
      .shipment-editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 18px}
      .shipment-editor-grid .full{grid-column:1/-1}.shipment-editor-grid label{margin-top:0}
      .shipment-editor-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 24px;border-top:1px solid var(--line);background:#f8fafc}
      .shipment-editor-actions{display:flex;gap:10px;flex-wrap:wrap}.shipment-editor-status{min-height:18px}
      .editor-readonly{padding:12px;border:1px solid var(--line);border-radius:8px;background:#f8fafc;min-height:44px}
      .editor-info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .editor-info-card{border:1px solid var(--line);border-radius:10px;padding:14px;background:#fff}.editor-info-card b{display:block;color:var(--navy);margin-bottom:5px}
      .editor-warning{padding:11px 13px;border-radius:8px;background:#fff8e8;border:1px solid #f3d59c;color:#7a5200;margin-bottom:15px}
      .editor-error{padding:11px 13px;border-radius:8px;background:#fff0ef;border:1px solid #efb0aa;color:var(--bad);margin-bottom:15px}
      .editor-success{padding:11px 13px;border-radius:8px;background:#edf9f0;border:1px solid #9bd3aa;color:var(--ok);margin-bottom:15px}
      @media(max-width:700px){.shipment-editor-grid,.editor-info-grid{grid-template-columns:1fr}.shipment-editor-grid .full{grid-column:auto}.shipment-editor-head,.shipment-editor-tabs,.shipment-editor-body,.shipment-editor-footer{padding-left:16px;padding-right:16px}.shipment-editor-footer{align-items:flex-start;flex-direction:column}.shipment-editor-actions{width:100%}.shipment-editor-actions button{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function clientOptions(selectedId) {
    return (clients || []).map(client => `<option value="${escEditor(client.id)}" ${String(client.id) === String(selectedId) ? 'selected' : ''}>${escEditor(client.name)}${client.company ? ' · ' + escEditor(client.company) : ''}</option>`).join('');
  }

  function statusOptions(current) {
    const standard = ['Registrado','Booking confirmado','Cargado','En tránsito','En destino','Esperando liberación','Liberado','Entregado'];
    const values = [...new Set([current, ...standard].filter(Boolean))];
    return values.map(value => `<option ${value === current ? 'selected' : ''}>${escEditor(value)}</option>`).join('');
  }

  function editorHtml(shipment) {
    const trackingStatus = shipment.shipsgo_status || 'pending';
    const client = shipment.clients || {};
    return `<div class="shipment-editor-head">
      <div class="shipment-editor-title"><div><h2>Editar contenedor</h2><div class="shipment-editor-code">${escEditor(shipment.container_number)} · ${escEditor(shipment.carrier || 'Sin naviera')}</div></div><button id="shipmentEditorClose" class="alt">Cerrar</button></div>
    </div>
    <div class="shipment-editor-tabs">
      <button class="shipment-editor-tab active" data-editor-tab="general">General</button>
      <button class="shipment-editor-tab" data-editor-tab="tracking">Tracking</button>
      <button class="shipment-editor-tab" data-editor-tab="client">Cliente</button>
      <button class="shipment-editor-tab" data-editor-tab="history">Historial</button>
    </div>
    <div class="shipment-editor-body">
      <div id="shipmentEditorMessage"></div>
      <section class="shipment-editor-panel active" data-editor-panel="general">
        <div class="shipment-editor-grid">
          <div><label>Cliente *</label><select id="editorClient"><option value="">Seleccionar cliente</option>${clientOptions(shipment.client_id)}</select></div>
          <div><label>Número de contenedor *</label><input id="editorContainer" value="${escEditor(shipment.container_number)}" maxlength="11" autocomplete="off"></div>
          <div><label>Producto</label><input id="editorProduct" value="${escEditor(shipment.product || '')}"></div>
          <div><label>Naviera</label><input id="editorCarrier" value="${escEditor(shipment.carrier || '')}"></div>
          <div><label>Booking</label><input id="editorBooking" value="${escEditor(shipment.booking_number || '')}"></div>
          <div><label>Bill of Lading (B/L)</label><input id="editorBol" value="${escEditor(shipment.bol_number || '')}"></div>
          <div class="full"><label>Estado operativo</label><select id="editorStatus">${statusOptions(shipment.operational_status || shipment.last_status || 'Registrado')}</select></div>
        </div>
      </section>
      <section class="shipment-editor-panel" data-editor-panel="tracking">
        ${shipment.shipsgo_error ? `<div class="editor-error"><b>Error de ShipsGo</b><div>${escEditor(shipment.shipsgo_error)}</div></div>` : ''}
        <div class="editor-info-grid">
          <div class="editor-info-card"><b>Estado de tracking</b><div>${escEditor(trackingStatus)}</div></div>
          <div class="editor-info-card"><b>ID de ShipsGo</b><div>${escEditor(shipment.shipsgo_tracking_id || '-')}</div></div>
          <div class="editor-info-card"><b>Última ubicación</b><div>${escEditor(shipment.last_location || '-')}</div></div>
          <div class="editor-info-card"><b>Último evento</b><div>${escEditor(shipment.last_status || shipment.operational_status || '-')}</div></div>
          <div class="editor-info-card"><b>Última actualización</b><div>${shipment.updated_at ? new Date(shipment.updated_at).toLocaleString() : '-'}</div></div>
          <div class="editor-info-card"><b>Modo de vínculo</b><div>${escEditor(shipment.shipsgo_link_mode || '-')}</div></div>
        </div>
        <div style="margin-top:16px"><button id="editorRetryShipsGo" class="alt">Actualizar / reintentar ShipsGo</button></div>
      </section>
      <section class="shipment-editor-panel" data-editor-panel="client">
        <div class="editor-info-grid">
          <div class="editor-info-card"><b>Nombre</b><div>${escEditor(client.name || '-')}</div></div>
          <div class="editor-info-card"><b>Empresa</b><div>${escEditor(client.company || '-')}</div></div>
          <div class="editor-info-card"><b>WhatsApp</b><div>${escEditor(client.phone || '-')}</div></div>
          <div class="editor-info-card"><b>Correo</b><div>${escEditor(client.email || '-')}</div></div>
        </div>
        <div style="margin-top:16px"><button id="editorOpenClient" class="alt" ${shipment.client_id ? '' : 'disabled'}>Abrir historial del cliente</button></div>
      </section>
      <section class="shipment-editor-panel" data-editor-panel="history">
        <div class="editor-warning"><b>Punto 3 reservado.</b><div>Esta pestaña queda preparada para integrar el timeline visual completo en la siguiente fase.</div></div>
        <button id="editorOpenCurrentHistory" class="alt">Ver historial actual</button>
      </section>
    </div>
    <div class="shipment-editor-footer">
      <div id="shipmentEditorStatus" class="shipment-editor-status muted">Los cambios se registrarán en la auditoría del ERP.</div>
      <div class="shipment-editor-actions"><button id="shipmentEditorCancel" class="alt">Cancelar</button><button id="shipmentEditorSave" class="orange">Guardar cambios</button></div>
    </div>`;
  }

  function setMessage(type, text) {
    const target = byId('shipmentEditorMessage');
    if (!target) return;
    target.className = type ? `editor-${type}` : '';
    target.textContent = text || '';
  }

  function normalizeContainer(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function validate() {
    const clientId = byId('editorClient').value;
    const container = normalizeContainer(byId('editorContainer').value);
    if (!clientId) return 'Selecciona un cliente.';
    if (!/^[A-Z]{4}\d{7}$/.test(container)) return 'El contenedor debe tener 4 letras y 7 números.';
    const duplicate = (shipments || []).find(item => item.id !== editorShipment.id && normalizeContainer(item.container_number) === container);
    if (duplicate) return 'Ese número de contenedor ya está registrado.';
    return '';
  }

  function currentPayload() {
    return {
      id: editorShipment.id,
      client_id: byId('editorClient').value,
      container_number: normalizeContainer(byId('editorContainer').value),
      product: byId('editorProduct').value.trim(),
      carrier: byId('editorCarrier').value.trim(),
      booking_number: byId('editorBooking').value.trim(),
      bol_number: byId('editorBol').value.trim(),
      operational_status: byId('editorStatus').value.trim()
    };
  }

  function closeEditor(force = false) {
    if (!force && dirty && !confirm('Hay cambios sin guardar. ¿Cerrar de todas formas?')) return;
    dirty = false;
    editorShipment = null;
    byId('modal')?.classList.remove('shipment-editor-modal');
    closeModal();
  }

  function bindEditor() {
    byId('shipmentEditorClose').onclick = () => closeEditor();
    byId('shipmentEditorCancel').onclick = () => closeEditor();
    document.querySelectorAll('[data-editor-tab]').forEach(button => button.onclick = () => {
      document.querySelectorAll('[data-editor-tab]').forEach(item => item.classList.toggle('active', item === button));
      document.querySelectorAll('[data-editor-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.editorPanel === button.dataset.editorTab));
    });
    document.querySelectorAll('#modal input,#modal select').forEach(field => field.addEventListener('input', () => { dirty = true; setMessage('', ''); }));

    byId('editorRetryShipsGo').onclick = async () => {
      const button = byId('editorRetryShipsGo');
      button.disabled = true;
      button.textContent = 'Actualizando...';
      try {
        await api('/api/shipments', { method: 'PATCH', body: JSON.stringify({ id: editorShipment.id, action: 'retry_shipsgo' }) });
        setMessage('success', 'ShipsGo fue actualizado correctamente.');
        await loadAll();
        editorShipment = shipments.find(item => item.id === editorShipment.id) || editorShipment;
      } catch (error) { setMessage('error', error.message); }
      finally { button.disabled = false; button.textContent = 'Actualizar / reintentar ShipsGo'; }
    };

    byId('editorOpenClient').onclick = () => {
      const client = (clients || []).find(item => String(item.id) === String(editorShipment.client_id));
      closeEditor(true);
      if (client) clientHistory(client.id, client.name);
    };
    byId('editorOpenCurrentHistory').onclick = () => {
      const shipment = editorShipment;
      closeEditor(true);
      historyView(shipment.id, shipment.container_number);
    };

    byId('shipmentEditorSave').onclick = async () => {
      if (saving) return;
      const error = validate();
      if (error) { setMessage('error', error); return; }
      saving = true;
      const button = byId('shipmentEditorSave');
      button.disabled = true;
      button.textContent = 'Guardando...';
      try {
        await api('/api/shipments', { method: 'PATCH', body: JSON.stringify(currentPayload()) });
        dirty = false;
        setMessage('success', 'Cambios guardados correctamente.');
        await loadAll();
        setTimeout(() => closeEditor(true), 450);
      } catch (errorSave) { setMessage('error', errorSave.message); }
      finally { saving = false; button.disabled = false; button.textContent = 'Guardar cambios'; }
    };
  }

  function installEditor() {
    if (typeof window.api !== 'function' || typeof window.openModal !== 'function') {
      setTimeout(installEditor, 100);
      return;
    }
    addEditorStyles();
    window.editShipment = function (id) {
      const shipment = (shipments || []).find(item => String(item.id) === String(id));
      if (!shipment) return alert('No se encontró el contenedor. Actualiza la página e inténtalo nuevamente.');
      editorShipment = shipment;
      dirty = false;
      openModal('', editorHtml(shipment));
      byId('modalTitle').parentElement.style.display = 'none';
      byId('modal').classList.add('shipment-editor-modal');
      bindEditor();
      setTimeout(() => byId('editorContainer')?.focus(), 50);
    };

    const originalCloseModal = window.closeModal;
    window.closeModal = function () {
      const modal = byId('modal');
      if (modal?.classList.contains('shipment-editor-modal') && editorShipment) return closeEditor();
      return originalCloseModal();
    };

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && byId('modal')?.classList.contains('shipment-editor-modal')) {
        event.preventDefault();
        closeEditor();
      }
    });
  }

  installEditor();
})();
