(() => {
  'use strict';

  if (window.__suppliersModuleInstalled) return;
  window.__suppliersModuleInstalled = true;

  const $ = id => document.getElementById(id);
  const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';
  const state = {
    suppliers:[],
    view:'active',
    query:'',
    editingId:null,
    detailId:null,
    writeAccess:false,
    loading:false,
    started:false
  };
  const modalTriggers = new Map();
  let decisionResolver = null;
  let decisionPreviousFocus = null;

  const token = () => localStorage.getItem('export_mca_token') || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[character]));
  const SAFE_SUPPLIER_ERRORS = new Set([
    'El nombre del proveedor es obligatorio',
    'Ya existe un proveedor con ese nombre',
    'Proveedor no encontrado',
    'Falta el proveedor',
    'Acción de proveedor inválida',
    'No tienes permiso para realizar esta acción',
    'No autorizado',
    'Sesión no autorizada',
    'La sesión expiró o fue revocada'
  ]);

  function redirectToAdminLogin() {
    localStorage.removeItem('export_mca_token');
    localStorage.removeItem('export_mca_user');
    if (embeddedMode && window.top !== window) window.top.location.replace('/admin/index.html');
    else location.replace('/admin/index.html');
  }

  function safeSupplierMessage(error, fallback = 'No se pudo completar la acción. Intenta nuevamente.') {
    const detail = String(error?.message || '').trim();
    if (/sesión vencida|unauthorized|no autorizado|sesión no autorizada|sesión expiró/i.test(detail)) {
      return 'Tu sesión venció. Inicia sesión nuevamente.';
    }
    return SAFE_SUPPLIER_ERRORS.has(detail) ? detail : fallback;
  }

  function supplierError(context, error) {
    console.error(`SUPPLIERS_${String(context || 'UI').toUpperCase()}_FAILED`, error);
  }

  function feedback(message = '', tone = '') {
    const node = $('supplierMessage');
    if (!node) return;
    node.textContent = message;
    node.className = `suppliers-feedback ${message ? tone : ''}`.trim();
  }

  function formMessage(message = '', tone = '') {
    const node = $('supplierFormMessage');
    if (!node) return;
    node.textContent = message;
    node.className = `suppliers-form-message ${message ? tone : ''}`.trim();
  }

  async function request(path, options = {}) {
    const headers = {
      ...(token() ? { Authorization:`Bearer ${token()}` } : {}),
      ...(options.body ? { 'Content-Type':'application/json' } : {}),
      ...(options.headers || {})
    };
    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      redirectToAdminLogin();
      throw new Error('Sesión vencida');
    }
    if (!response.ok) throw new Error(data.error || 'No se pudo procesar Proveedores');
    return data;
  }

  function findSupplier(id) {
    return state.suppliers.find(item => String(item.id) === String(id)) || null;
  }

  function supplierSearchText(item) {
    return [item.name,item.legal_name,item.country,item.tax_id,item.email,item.phone,item.address]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('es');
  }

  function visibleSuppliers() {
    const query = state.query.trim().toLocaleLowerCase('es');
    return state.suppliers.filter(item => {
      const statusMatch = state.view === 'all'
        || (state.view === 'active' ? item.active !== false : item.active === false);
      return statusMatch && (!query || supplierSearchText(item).includes(query));
    });
  }

  function applyAccess() {
    $('newSupplier').hidden = state.writeAccess !== true;
    $('suppliersReadOnlyNote').hidden = state.writeAccess === true;
    $('editSupplierFromDetail').hidden = state.writeAccess !== true;
  }

  function renderMetrics() {
    const active = state.suppliers.filter(item => item.active !== false).length;
    const inactive = state.suppliers.length - active;
    const contact = state.suppliers.filter(item => Boolean(item.email || item.phone)).length;
    $('supplierTotalMetric').textContent = state.suppliers.length.toLocaleString('es-US');
    $('supplierActiveMetric').textContent = active.toLocaleString('es-US');
    $('supplierInactiveMetric').textContent = inactive.toLocaleString('es-US');
    $('supplierContactMetric').textContent = contact.toLocaleString('es-US');
  }

  function renderTabs() {
    document.querySelectorAll('[data-view]').forEach(button => {
      const active = button.dataset.view === state.view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }

  function actionMarkup(item) {
    const id = esc(item.id);
    const writable = state.writeAccess === true;
    const toggleLabel = item.active === false ? 'Reactivar' : 'Desactivar';
    return `<div class="supplier-card-actions">
      <button type="button" class="btn" data-supplier-action="detail" data-supplier-id="${id}">Ver</button>
      ${writable ? `<button type="button" class="btn" data-supplier-action="edit" data-supplier-id="${id}">Editar</button><button type="button" class="btn ${item.active === false ? '' : 'danger'}" data-supplier-action="toggle" data-supplier-id="${id}">${toggleLabel}</button>` : ''}
    </div>`;
  }

  function supplierCard(item) {
    const identity = String(item.name || '?').trim();
    const country = item.country || 'País no registrado';
    const tax = item.tax_id || 'Sin Tax ID / EIN';
    const contact = item.email || item.phone || 'Sin contacto registrado';
    const secondaryContact = item.email && item.phone ? item.phone : 'Correo o teléfono de contacto';
    return `<article class="supplier-card" data-supplier-row="${esc(item.id)}">
      <div class="supplier-identity">
        <span class="supplier-avatar" aria-hidden="true">${esc(identity.charAt(0).toUpperCase() || '?')}</span>
        <div><strong class="supplier-name">${esc(item.name || 'Proveedor sin nombre')}</strong><span class="supplier-meta">${esc(item.legal_name || 'Sin razón social registrada')}</span></div>
      </div>
      <div class="supplier-card-section"><span class="supplier-card-label">Ubicación e identidad</span><strong>${esc(country)}</strong><span class="supplier-meta">${esc(tax)}</span></div>
      <div class="supplier-card-section supplier-card-contact"><span class="supplier-card-label">Contacto</span><strong>${esc(contact)}</strong><span class="supplier-meta">${esc(secondaryContact)}</span></div>
      <div class="supplier-card-control"><span class="supplier-status ${item.active === false ? 'inactive' : ''}">${item.active === false ? 'Inactivo' : 'Activo'}</span>${actionMarkup(item)}</div>
    </article>`;
  }

  function emptyMarkup() {
    const hasRows = state.suppliers.length > 0;
    if (hasRows) {
      return '<div class="suppliers-empty"><strong>No encontramos coincidencias</strong><span>Prueba otro término o cambia el estado seleccionado.</span></div>';
    }
    const action = state.writeAccess
      ? '<button type="button" class="btn primary" data-empty-action="new">Registrar primer proveedor</button>'
      : '';
    return `<div class="suppliers-empty"><strong>No hay proveedores registrados</strong><span>Cuando exista información maestra, aparecerá en este directorio.</span>${action}</div>`;
  }

  function renderList() {
    const list = visibleSuppliers();
    $('supplierResultCount').textContent = `${list.length.toLocaleString('es-US')} ${list.length === 1 ? 'proveedor' : 'proveedores'}`;
    $('supplierList').innerHTML = list.length ? list.map(supplierCard).join('') : emptyMarkup();
    $('supplierList').setAttribute('aria-busy', 'false');
  }

  function render() {
    applyAccess();
    renderMetrics();
    renderTabs();
    renderList();
  }

  function renderLoading() {
    $('supplierResultCount').textContent = 'Consultando…';
    $('supplierList').setAttribute('aria-busy', 'true');
    $('supplierList').innerHTML = '<div class="suppliers-loading" role="status"><span class="suppliers-spinner" aria-hidden="true"></span>Consultando proveedores…</div>';
  }

  function renderLoadError() {
    $('supplierResultCount').textContent = 'No disponible';
    $('supplierList').setAttribute('aria-busy', 'false');
    $('supplierList').innerHTML = '<div class="suppliers-empty"><strong>No se pudo mostrar el directorio</strong><span>La información no fue modificada. Intenta cargarla nuevamente.</span><button type="button" class="btn primary" data-empty-action="retry">Reintentar</button></div>';
  }

  function updateReadTime() {
    const now = new Date();
    $('suppliersLastUpdated').textContent = `Actualizado ${now.toLocaleTimeString('es-US',{hour:'numeric',minute:'2-digit'})}`;
  }

  async function load(announce = false) {
    if (state.loading) return;
    if (!token()) {
      if (embeddedMode && window.top !== window) return;
      redirectToAdminLogin();
      return;
    }
    state.loading = true;
    $('refreshSuppliers').disabled = true;
    renderLoading();
    if (!announce) feedback();
    try {
      const data = await request('/api/suppliers');
      state.suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
      state.writeAccess = data.write_access === true;
      render();
      updateReadTime();
      if (announce) feedback('Directorio actualizado.', 'good');
    } catch (error) {
      supplierError('load', error);
      renderLoadError();
      feedback(safeSupplierMessage(error, 'No se pudo cargar Proveedores. Intenta actualizar nuevamente.'), 'bad');
    } finally {
      state.loading = false;
      $('refreshSuppliers').disabled = false;
    }
  }

  function syncBodyModalState() {
    document.body.classList.toggle('suppliers-modal-open', Boolean(document.querySelector('.supplier-modal:not(.hidden)')));
  }

  function openModal(id, focusSelector) {
    const modal = $(id);
    if (!modal) return;
    modalTriggers.set(id, document.activeElement);
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    syncBodyModalState();
    setTimeout(() => modal.querySelector(focusSelector)?.focus(), 0);
  }

  function closeModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    syncBodyModalState();
    const trigger = modalTriggers.get(id);
    modalTriggers.delete(id);
    if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
  }

  function detailField(label, value, wide = false) {
    return `<div class="supplier-detail-field ${wide ? 'wide' : ''}"><b>${esc(label)}</b><span>${esc(value || 'No registrado')}</span></div>`;
  }

  function openDetails(id) {
    const item = findSupplier(id);
    if (!item) return feedback('El proveedor ya no está disponible.', 'bad');
    state.detailId = item.id;
    $('supplierDetailTitle').textContent = item.name || 'Detalle de proveedor';
    $('supplierDetailBody').innerHTML = [
      detailField('Razón social', item.legal_name),
      detailField('Estado', item.active === false ? 'Inactivo' : 'Activo'),
      detailField('País', item.country),
      detailField('Tax ID / EIN', item.tax_id),
      detailField('Correo', item.email),
      detailField('Teléfono', item.phone),
      detailField('Dirección', item.address, true),
      detailField('Notas', item.notes, true)
    ].join('');
    $('editSupplierFromDetail').hidden = state.writeAccess !== true;
    openModal('supplierDetailModal', '[data-close="detail"]');
  }

  function fillForm(item = null) {
    $('supplierName').value = item?.name || '';
    $('supplierLegalName').value = item?.legal_name || '';
    $('supplierCountry').value = item?.country || '';
    $('supplierTaxId').value = item?.tax_id || '';
    $('supplierEmail').value = item?.email || '';
    $('supplierPhone').value = item?.phone || '';
    $('supplierAddress').value = item?.address || '';
    $('supplierNotes').value = item?.notes || '';
  }

  function openSupplier(id = null) {
    if (state.writeAccess !== true) {
      feedback('No tienes permiso para modificar proveedores.', 'bad');
      return false;
    }
    const item = id === null ? null : findSupplier(id);
    if (id !== null && !item) {
      feedback('El proveedor ya no está disponible.', 'bad');
      return false;
    }
    state.editingId = item?.id || null;
    $('supplierModalTitle').textContent = item ? `Editar ${item.name}` : 'Nuevo proveedor';
    $('saveSupplier').textContent = item ? 'Guardar cambios' : 'Guardar proveedor';
    fillForm(item);
    formMessage();
    openModal('supplierModal', '#supplierName');
    return true;
  }

  function supplierPayload() {
    return {
      name:$('supplierName').value,
      legal_name:$('supplierLegalName').value,
      country:$('supplierCountry').value,
      tax_id:$('supplierTaxId').value,
      email:$('supplierEmail').value,
      phone:$('supplierPhone').value,
      address:$('supplierAddress').value,
      notes:$('supplierNotes').value
    };
  }

  async function saveSupplier(event) {
    event.preventDefault();
    if (state.writeAccess !== true) return formMessage('No tienes permiso para modificar proveedores.');
    const form = $('supplierForm');
    if (typeof form.checkValidity === 'function' && !form.checkValidity()) {
      form.reportValidity?.();
      return formMessage('Completa el nombre y revisa los datos del proveedor.');
    }
    const button = $('saveSupplier');
    if (button.disabled) return;
    button.disabled = true;
    const defaultLabel = state.editingId ? 'Guardar cambios' : 'Guardar proveedor';
    button.textContent = 'Guardando…';
    formMessage('Guardando proveedor…', 'good');
    try {
      const body = supplierPayload();
      if (state.editingId) {
        body.id = state.editingId;
        body.action = 'update';
      }
      await request('/api/suppliers', {
        method:state.editingId ? 'PATCH' : 'POST',
        body:JSON.stringify(body)
      });
      closeModal('supplierModal');
      const changed = Boolean(state.editingId);
      state.editingId = null;
      await load(false);
      feedback(changed ? 'Proveedor actualizado.' : 'Proveedor registrado.', 'good');
      window.dispatchEvent(new CustomEvent('export-mca:suppliers-changed'));
    } catch (error) {
      supplierError('save', error);
      formMessage(safeSupplierMessage(error, 'No se pudo guardar el proveedor. Revisa los datos e intenta nuevamente.'));
    } finally {
      button.disabled = false;
      button.textContent = defaultLabel;
    }
  }

  function finishDecision(value) {
    const resolve = decisionResolver;
    decisionResolver = null;
    closeModal('supplierDecision');
    if (decisionPreviousFocus instanceof HTMLElement && decisionPreviousFocus.isConnected) decisionPreviousFocus.focus();
    decisionPreviousFocus = null;
    resolve?.(Boolean(value));
  }

  function decision({ title, message, confirmLabel }) {
    if (decisionResolver) finishDecision(false);
    decisionPreviousFocus = document.activeElement;
    $('supplierDecisionTitle').textContent = title;
    $('supplierDecisionText').textContent = message;
    $('supplierDecisionConfirm').textContent = confirmLabel;
    openModal('supplierDecision', '#supplierDecisionCancel');
    return new Promise(resolve => { decisionResolver = resolve; });
  }

  async function toggleSupplier(id) {
    if (state.writeAccess !== true) return feedback('No tienes permiso para modificar proveedores.', 'bad');
    const item = findSupplier(id);
    if (!item) return feedback('El proveedor ya no está disponible.', 'bad');
    const nextActive = item.active === false;
    const approved = await decision({
      title:nextActive ? `Reactivar ${item.name}` : `Desactivar ${item.name}`,
      message:nextActive
        ? 'El proveedor volverá a estar disponible para nuevas operaciones.'
        : 'El proveedor dejará de estar disponible para nuevas operaciones, pero su historial se conservará.',
      confirmLabel:nextActive ? 'Reactivar proveedor' : 'Desactivar proveedor'
    });
    if (!approved) return;
    try {
      await request('/api/suppliers', {
        method:'PATCH',
        body:JSON.stringify({ action:'set_active', id:item.id, active:nextActive })
      });
      await load(false);
      feedback(nextActive ? 'Proveedor reactivado.' : 'Proveedor desactivado.', 'good');
      window.dispatchEvent(new CustomEvent('export-mca:suppliers-changed'));
    } catch (error) {
      supplierError('toggle', error);
      feedback(safeSupplierMessage(error, 'No se pudo cambiar el estado del proveedor. Intenta nuevamente.'), 'bad');
    }
  }

  function onSupplierListClick(event) {
    const retry = event.target.closest('[data-empty-action="retry"]');
    if (retry) return load(true);
    const create = event.target.closest('[data-empty-action="new"]');
    if (create) return openSupplier();
    const button = event.target.closest('[data-supplier-action]');
    if (!button) return;
    const id = button.dataset.supplierId;
    if (button.dataset.supplierAction === 'detail') openDetails(id);
    if (button.dataset.supplierAction === 'edit') openSupplier(id);
    if (button.dataset.supplierAction === 'toggle') toggleSupplier(id);
  }

  function closeSupplierEditor() {
    state.editingId = null;
    closeModal('supplierModal');
  }

  function closeSupplierDetail() {
    state.detailId = null;
    closeModal('supplierDetailModal');
  }

  function bindEvents() {
    $('refreshSuppliers').addEventListener('click', () => load(true));
    $('newSupplier').addEventListener('click', () => openSupplier());
    $('supplierForm').addEventListener('submit', saveSupplier);
    $('supplierSearch').addEventListener('input', event => {
      state.query = event.target.value;
      renderList();
    });
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
      state.view = button.dataset.view;
      renderTabs();
      renderList();
    }));
    $('supplierList').addEventListener('click', onSupplierListClick);
    document.querySelectorAll('[data-close="supplier"]').forEach(button => button.addEventListener('click', closeSupplierEditor));
    document.querySelectorAll('[data-close="detail"]').forEach(button => button.addEventListener('click', closeSupplierDetail));
    $('editSupplierFromDetail').addEventListener('click', () => {
      const id = state.detailId;
      closeSupplierDetail();
      if (id !== null) openSupplier(id);
    });
    $('supplierDecisionCancel').addEventListener('click', () => finishDecision(false));
    $('supplierDecisionConfirm').addEventListener('click', () => finishDecision(true));
    ['supplierModal','supplierDetailModal','supplierDecision'].forEach(id => {
      $(id).addEventListener('click', event => {
        if (event.target !== $(id)) return;
        if (id === 'supplierDecision') finishDecision(false);
        if (id === 'supplierModal') closeSupplierEditor();
        if (id === 'supplierDetailModal') closeSupplierDetail();
      });
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!$('supplierDecision').classList.contains('hidden')) return finishDecision(false);
      if (!$('supplierDetailModal').classList.contains('hidden')) return closeSupplierDetail();
      if (!$('supplierModal').classList.contains('hidden')) closeSupplierEditor();
    });
  }

  function handleStoredSession(event) {
    if (event.key !== 'export_mca_token' || !event.newValue || state.started) return;
    window.removeEventListener('storage', handleStoredSession);
    startSuppliers();
  }

  function startSuppliers() {
    if (state.started) return;
    if (!token()) {
      if (embeddedMode && window.top !== window) {
        $('suppliersLastUpdated').textContent = 'Esperando sesión segura…';
        window.addEventListener('storage', handleStoredSession);
        return;
      }
      redirectToAdminLogin();
      return;
    }
    state.started = true;
    load(false);
  }

  bindEvents();
  window.load = () => load(false);
  window.SuppliersModule = Object.freeze({
    owner:'suppliers.js',
    source:'api/suppliers.js',
    refresh:() => load(false),
    openSupplier,
    openDetails
  });
  startSuppliers();
})();
