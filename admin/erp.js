(() => {
  const byId = id => document.getElementById(id);
  const money = value => new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
  let operations = [];

  function formHtml() {
    return `<section class="card"><div class="toolbar"><div><h2 class="section-title">Nuevo expediente de exportación</h2><div class="muted">Crea una operación completa con logística, mercancía y control financiero.</div></div><button id="reloadOperations" class="alt">Actualizar expedientes</button></div>
      <div class="grid" style="margin-top:14px">
        <div><label>Cliente *</label><select id="erpClient"></select></div>
        <div><label>Estado</label><select id="erpStatus"><option value="draft">Borrador</option><option value="confirmed">Confirmado</option><option value="purchased">Comprado</option><option value="booked">Reservado</option><option value="in_transit">En tránsito</option><option value="at_destination">En destino</option><option value="released">Liberado</option><option value="delivered">Entregado</option><option value="closed">Cerrado</option></select></div>
        <div><label>Incoterm</label><input id="erpIncoterm" placeholder="CFR, CIF, FCA..."></div>
        <div><label>Moneda</label><select id="erpCurrency"><option>USD</option><option>EUR</option></select></div>
        <div><label>Puerto de origen</label><input id="erpOrigin" placeholder="Port Everglades"></div>
        <div><label>Puerto de destino</label><input id="erpDestination" placeholder="Mariel"></div>
        <div><label>Contenedor</label><input id="erpContainer" placeholder="ABCD1234567"></div>
        <div><label>Sello</label><input id="erpSeal"></div>
        <div><label>Booking</label><input id="erpBooking"></div>
        <div><label>B/L</label><input id="erpBol"></div>
        <div><label>Buque</label><input id="erpVessel"></div>
        <div><label>Viaje</label><input id="erpVoyage"></div>
        <div><label>ETD</label><input id="erpEtd" type="date"></div>
        <div><label>ETA</label><input id="erpEta" type="date"></div>
      </div>
      <label>Notas</label><textarea id="erpNotes" style="width:100%;min-height:90px;padding:11px;border:1px solid #cfd7e3;border-radius:8px;font:inherit"></textarea>
      <h3 style="margin-top:22px">Mercancía inicial</h3>
      <div class="grid">
        <div><label>Descripción</label><input id="erpItemDescription" placeholder="Panel Boviet 615W"></div>
        <div><label>Cantidad</label><input id="erpItemQuantity" type="number" step="0.01" value="1"></div>
        <div><label>Unidad</label><input id="erpItemUnit" placeholder="paneles, litros, sacos"></div>
        <div><label>Costo unitario</label><input id="erpItemCost" type="number" step="0.01"></div>
        <div><label>Precio unitario</label><input id="erpItemPrice" type="number" step="0.01"></div>
        <div><label>Bultos</label><input id="erpItemPackages" type="number"></div>
        <div><label>Peso neto kg</label><input id="erpItemNet" type="number" step="0.01"></div>
        <div><label>Peso bruto kg</label><input id="erpItemGross" type="number" step="0.01"></div>
      </div>
      <div style="margin-top:16px"><button id="saveErpOperation" class="orange">Crear expediente</button></div><div id="erpMsg" class="msg"></div>
    </section>
    <section class="card"><h2 class="section-title">Expedientes</h2><div id="erpOperationsList">Cargando...</div></section>`;
  }

  function detailHtml(op) {
    const sale = Number(op.sale_total || 0), cost = Number(op.cost_total || 0), expenses = Number(op.expense_total || 0), paid = Number(op.paid_total || 0);
    const profit = sale - cost - expenses;
    return `<div class="grid"><div><b>Código</b><div>${op.operation_code || '-'}</div></div><div><b>Estado</b><div>${op.status || '-'}</div></div><div><b>Cliente</b><div>${op.client?.name || '-'}</div></div><div><b>Contenedor</b><div>${op.container_number || '-'}</div></div><div><b>Booking</b><div>${op.booking_number || '-'}</div></div><div><b>B/L</b><div>${op.bol_number || '-'}</div></div><div><b>Ruta</b><div>${op.origin_port || '-'} → ${op.destination_port || '-'}</div></div><div><b>ETD / ETA</b><div>${op.etd || '-'} / ${op.eta || '-'}</div></div></div>
      <div class="stats" style="grid-template-columns:repeat(4,1fr);margin-top:18px"><div class="stat"><span>Venta</span><b>${money(sale)}</b></div><div class="stat"><span>Costos</span><b>${money(cost + expenses)}</b></div><div class="stat"><span>Utilidad</span><b>${money(profit)}</b></div><div class="stat"><span>Pendiente</span><b>${money(sale - paid)}</b></div></div>
      <h3>Mercancía</h3>${(op.items || []).length ? `<table><thead><tr><th>Descripción</th><th>Cantidad</th><th>Unidad</th><th>Costo</th><th>Venta</th></tr></thead><tbody>${op.items.map(i => `<tr><td>${i.description}</td><td>${i.quantity}</td><td>${i.unit || '-'}</td><td>${money(Number(i.quantity || 0) * Number(i.unit_cost || 0))}</td><td>${money(Number(i.quantity || 0) * Number(i.unit_price || 0))}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">Sin mercancía registrada.</div>'}`;
  }

  function renderList() {
    const target = byId('erpOperationsList');
    if (!target) return;
    if (!operations.length) { target.textContent = 'No hay expedientes registrados.'; return; }
    target.innerHTML = `<table><thead><tr><th>Expediente</th><th>Cliente</th><th>Contenedor</th><th>Estado</th><th>Venta</th><th>Pendiente</th><th>Acciones</th></tr></thead><tbody>${operations.map(op => `<tr><td><b>${op.operation_code || '-'}</b><br><span class="muted">${new Date(op.created_at).toLocaleDateString()}</span></td><td>${op.client?.name || '-'}</td><td>${op.container_number || '-'}</td><td><span class="pill">${op.status || '-'}</span></td><td>${money(op.sale_total)}</td><td>${money(Number(op.sale_total || 0) - Number(op.paid_total || 0))}</td><td><button class="alt" data-open-operation="${op.id}">Abrir</button></td></tr>`).join('')}</tbody></table>`;
    target.querySelectorAll('[data-open-operation]').forEach(btn => btn.onclick = () => openOperation(btn.dataset.openOperation));
  }

  async function loadOperations() {
    try {
      const result = await api('/api/operations');
      operations = result.operations || [];
      renderList();
    } catch (error) {
      const target = byId('erpOperationsList');
      if (target) target.textContent = error.message;
    }
  }

  async function openOperation(id) {
    try {
      const result = await api('/api/operations?id=' + encodeURIComponent(id));
      openModal('Expediente · ' + (result.operation?.operation_code || ''), detailHtml(result.operation || {}));
    } catch (error) { alert(error.message); }
  }

  async function saveOperation() {
    const itemDescription = byId('erpItemDescription').value.trim();
    const payload = {
      client_id: byId('erpClient').value,
      status: byId('erpStatus').value,
      incoterm: byId('erpIncoterm').value,
      currency: byId('erpCurrency').value,
      origin_port: byId('erpOrigin').value,
      destination_port: byId('erpDestination').value,
      container_number: byId('erpContainer').value,
      seal_number: byId('erpSeal').value,
      booking_number: byId('erpBooking').value,
      bol_number: byId('erpBol').value,
      vessel_name: byId('erpVessel').value,
      voyage_number: byId('erpVoyage').value,
      etd: byId('erpEtd').value,
      eta: byId('erpEta').value,
      notes: byId('erpNotes').value,
      items: itemDescription ? [{ description: itemDescription, quantity: byId('erpItemQuantity').value, unit: byId('erpItemUnit').value, unit_cost: byId('erpItemCost').value, unit_price: byId('erpItemPrice').value, packages: byId('erpItemPackages').value, net_weight_kg: byId('erpItemNet').value, gross_weight_kg: byId('erpItemGross').value }] : []
    };
    try {
      const result = await api('/api/operations', { method: 'POST', body: JSON.stringify(payload) });
      note('erpMsg', `Expediente ${result.operation.operation_code} creado correctamente.`, true);
      ['erpIncoterm','erpOrigin','erpDestination','erpContainer','erpSeal','erpBooking','erpBol','erpVessel','erpVoyage','erpEtd','erpEta','erpNotes','erpItemDescription','erpItemUnit','erpItemCost','erpItemPrice','erpItemPackages','erpItemNet','erpItemGross'].forEach(id => byId(id).value = '');
      byId('erpItemQuantity').value = '1';
      await loadOperations();
    } catch (error) { note('erpMsg', error.message); }
  }

  function installShipmentDelete() {
    window.deleteShipment = async function (id, containerNumber) {
      const confirmation = prompt(`Para eliminar definitivamente ${containerNumber} del ERP, escribe ELIMINAR`);
      if (confirmation !== 'ELIMINAR') return;
      try {
        await api('/api/shipments?id=' + encodeURIComponent(id), { method: 'DELETE' });
        alert(`Contenedor ${containerNumber} eliminado del ERP.`);
        await loadAll();
        if (window.loadNotifications) window.loadNotifications();
      } catch (error) {
        alert(error.message);
      }
    };

    const addButtons = () => {
      const target = byId('shipments');
      if (!target) return;
      target.querySelectorAll('tbody tr').forEach(row => {
        const containerNumber = row.querySelector('td b')?.textContent?.trim();
        const shipment = Array.isArray(shipments) ? shipments.find(item => item.container_number === containerNumber) : null;
        const actions = row.querySelector('.actions');
        if (!shipment || !actions || actions.querySelector('[data-delete-shipment]')) return;
        const button = document.createElement('button');
        button.className = 'danger';
        button.textContent = 'Eliminar';
        button.dataset.deleteShipment = shipment.id;
        button.onclick = () => window.deleteShipment(shipment.id, shipment.container_number);
        actions.appendChild(button);
      });
    };

    const target = byId('shipments');
    if (target) {
      new MutationObserver(addButtons).observe(target, { childList: true, subtree: true });
      addButtons();
    }
  }

  function mount() {
    const section = byId('newOperationsSection');
    if (!section) return;
    section.innerHTML = formHtml();
    const fillClients = () => { const select = byId('erpClient'); if (select) select.innerHTML = '<option value="">Seleccionar</option>' + clients.map(c => `<option value="${c.id}">${c.name}</option>`).join(''); };
    fillClients();
    byId('saveErpOperation').onclick = saveOperation;
    byId('reloadOperations').onclick = loadOperations;
    loadOperations();
    installShipmentDelete();
    const oldLoadAll = window.loadAll;
    if (typeof oldLoadAll === 'function') window.loadAll = async function () { await oldLoadAll(); fillClients(); await loadOperations(); };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
