(() => {
  'use strict';

  const state = {
    initialized: false,
    operations: []
  };

  const byId = id => document.getElementById(id);
  const money = value => new Intl.NumberFormat('es-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));

  function requireDependency(name, value) {
    if (typeof value !== 'function') {
      throw new Error(`OPERATIONS_DEPENDENCY_MISSING:${name}`);
    }
    return value;
  }

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

  function detailHtml(operation) {
    const sale = Number(operation.sale_total || 0);
    const cost = Number(operation.cost_total || 0);
    const expenses = Number(operation.expense_total || 0);
    const paid = Number(operation.paid_total || 0);
    const profit = sale - cost - expenses;

    return `<div class="grid"><div><b>Código</b><div>${operation.operation_code || '-'}</div></div><div><b>Estado</b><div>${operation.status || '-'}</div></div><div><b>Cliente</b><div>${operation.client?.name || '-'}</div></div><div><b>Contenedor</b><div>${operation.container_number || '-'}</div></div><div><b>Booking</b><div>${operation.booking_number || '-'}</div></div><div><b>B/L</b><div>${operation.bol_number || '-'}</div></div><div><b>Ruta</b><div>${operation.origin_port || '-'} → ${operation.destination_port || '-'}</div></div><div><b>ETD / ETA</b><div>${operation.etd || '-'} / ${operation.eta || '-'}</div></div></div>
      <div class="stats" style="grid-template-columns:repeat(4,1fr);margin-top:18px"><div class="stat"><span>Venta</span><b>${money(sale)}</b></div><div class="stat"><span>Costos</span><b>${money(cost + expenses)}</b></div><div class="stat"><span>Utilidad</span><b>${money(profit)}</b></div><div class="stat"><span>Pendiente</span><b>${money(sale - paid)}</b></div></div>
      <h3>Mercancía</h3>${(operation.items || []).length ? `<table><thead><tr><th>Descripción</th><th>Cantidad</th><th>Unidad</th><th>Costo</th><th>Venta</th></tr></thead><tbody>${operation.items.map(item => `<tr><td>${item.description}</td><td>${item.quantity}</td><td>${item.unit || '-'}</td><td>${money(Number(item.quantity || 0) * Number(item.unit_cost || 0))}</td><td>${money(Number(item.quantity || 0) * Number(item.unit_price || 0))}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">Sin mercancía registrada.</div>'}`;
  }

  function renderList() {
    const target = byId('erpOperationsList');
    if (!target) return;

    if (!state.operations.length) {
      target.textContent = 'No hay expedientes registrados.';
      return;
    }

    target.innerHTML = `<table><thead><tr><th>Expediente</th><th>Cliente</th><th>Contenedor</th><th>Estado</th><th>Venta</th><th>Pendiente</th><th>Acciones</th></tr></thead><tbody>${state.operations.map(operation => `<tr><td><b>${operation.operation_code || '-'}</b><br><span class="muted">${new Date(operation.created_at).toLocaleDateString()}</span></td><td>${operation.client?.name || '-'}</td><td>${operation.container_number || '-'}</td><td><span class="pill">${operation.status || '-'}</span></td><td>${money(operation.sale_total)}</td><td>${money(Number(operation.sale_total || 0) - Number(operation.paid_total || 0))}</td><td><button class="alt" data-open-operation="${operation.id}">Abrir</button></td></tr>`).join('')}</tbody></table>`;

    target.querySelectorAll('[data-open-operation]').forEach(button => {
      button.onclick = () => openOperation(button.dataset.openOperation);
    });
  }

  async function loadOperations() {
    const api = requireDependency('api', window.api);

    try {
      const result = await api('/api/operations');
      state.operations = result.operations || [];
      renderList();
      return state.operations;
    } catch (error) {
      const target = byId('erpOperationsList');
      if (target) target.textContent = error.message;
      return [];
    }
  }

  async function openOperation(id) {
    const api = requireDependency('api', window.api);
    const openModal = requireDependency('openModal', window.openModal);

    try {
      const result = await api('/api/operations?id=' + encodeURIComponent(id));
      openModal('Expediente · ' + (result.operation?.operation_code || ''), detailHtml(result.operation || {}));
    } catch (error) {
      alert(error.message);
    }
  }

  function buildPayload() {
    const itemDescription = byId('erpItemDescription').value.trim();

    return {
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
      items: itemDescription ? [{
        description: itemDescription,
        quantity: byId('erpItemQuantity').value,
        unit: byId('erpItemUnit').value,
        unit_cost: byId('erpItemCost').value,
        unit_price: byId('erpItemPrice').value,
        packages: byId('erpItemPackages').value,
        net_weight_kg: byId('erpItemNet').value,
        gross_weight_kg: byId('erpItemGross').value
      }] : []
    };
  }

  function resetForm() {
    [
      'erpIncoterm', 'erpOrigin', 'erpDestination', 'erpContainer',
      'erpSeal', 'erpBooking', 'erpBol', 'erpVessel', 'erpVoyage',
      'erpEtd', 'erpEta', 'erpNotes', 'erpItemDescription', 'erpItemUnit',
      'erpItemCost', 'erpItemPrice', 'erpItemPackages', 'erpItemNet',
      'erpItemGross'
    ].forEach(id => {
      const element = byId(id);
      if (element) element.value = '';
    });

    const quantity = byId('erpItemQuantity');
    if (quantity) quantity.value = '1';
  }

  async function saveOperation() {
    const api = requireDependency('api', window.api);
    const note = requireDependency('note', window.note);

    try {
      const result = await api('/api/operations', {
        method: 'POST',
        body: JSON.stringify(buildPayload())
      });

      note('erpMsg', `Expediente ${result.operation.operation_code} creado correctamente.`, true);
      resetForm();
      await loadOperations();
    } catch (error) {
      note('erpMsg', error.message);
    }
  }

  function bindEvents() {
    const saveButton = byId('saveErpOperation');
    const reloadButton = byId('reloadOperations');

    if (saveButton) saveButton.onclick = saveOperation;
    if (reloadButton) reloadButton.onclick = loadOperations;

    window.addEventListener('export-mca:clients-changed', loadOperations);
  }

  async function init() {
    if (state.initialized) return;

    const section = byId('newOperationsSection');
    if (!section) throw new Error('OPERATIONS_SECTION_MISSING');

    section.innerHTML = formHtml();

    if (typeof window.fillClientSelects === 'function') {
      window.fillClientSelects();
    }

    bindEvents();
    state.initialized = true;
    await loadOperations();
  }

  function destroy() {
    window.removeEventListener('export-mca:clients-changed', loadOperations);
    state.operations = [];
    state.initialized = false;
  }

  window.OperationsModule = Object.freeze({
    init,
    destroy,
    reload: loadOperations,
    open: openOperation,
    getState: () => ({
      initialized: state.initialized,
      operations: [...state.operations]
    })
  });
})();
