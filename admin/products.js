(() => {
  'use strict';

  if (window.__productsModuleInstalled) return;
  window.__productsModuleInstalled = true;

  const $ = id => document.getElementById(id);
  const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';
  const state = {
    products:[],
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
  const SAFE_PRODUCT_ERRORS = new Set([
    'El nombre del producto es obligatorio',
    'Ya existe un producto con ese SKU',
    'La unidad base debe ser texto, por ejemplo: unidades, cajas o paneles',
    'Unidades por pallet inválidas',
    'Peso unitario inválido',
    'Volumen unitario inválido',
    'Producto no encontrado',
    'Falta el producto',
    'Acción de producto inválida',
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

  function safeProductMessage(error, fallback = 'No se pudo completar la acción. Intenta nuevamente.') {
    const detail = String(error?.message || '').trim();
    if (/sesión vencida|unauthorized|no autorizado|sesión no autorizada|sesión expiró/i.test(detail)) {
      return 'Tu sesión venció. Inicia sesión nuevamente.';
    }
    return SAFE_PRODUCT_ERRORS.has(detail) ? detail : fallback;
  }

  function productError(context, error) {
    console.error(`PRODUCTS_${String(context || 'UI').toUpperCase()}_FAILED`, error);
  }

  function feedback(message = '', tone = '') {
    const node = $('productMessage');
    if (!node) return;
    node.textContent = message;
    node.className = `products-feedback ${message ? tone : ''}`.trim();
  }

  function formMessage(message = '', tone = '') {
    const node = $('productFormMessage');
    if (!node) return;
    node.textContent = message;
    node.className = `products-form-message ${message ? tone : ''}`.trim();
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
    if (!response.ok) throw new Error(data.error || 'No se pudo procesar Productos');
    return data;
  }

  function findProduct(id) {
    return state.products.find(item => String(item.id) === String(id)) || null;
  }

  function productSearchText(item) {
    return [item.sku,item.name,item.brand,item.category,item.hs_code,item.country_of_origin,item.package_format,item.unit]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('es');
  }

  function visibleProducts() {
    const query = state.query.trim().toLocaleLowerCase('es');
    return state.products.filter(item => {
      const statusMatch = state.view === 'all'
        || (state.view === 'active' ? item.active !== false : item.active === false);
      return statusMatch && (!query || productSearchText(item).includes(query));
    });
  }

  function formatNumber(value, maximumFractionDigits = 3) {
    if (value === null || value === undefined || value === '') return 'No definido';
    const number = Number(value);
    return Number.isFinite(number)
      ? number.toLocaleString('es-US',{maximumFractionDigits})
      : 'No definido';
  }

  function applyAccess() {
    $('newProduct').hidden = state.writeAccess !== true;
    $('productsReadOnlyNote').hidden = state.writeAccess === true;
    $('editProductFromDetail').hidden = state.writeAccess !== true;
  }

  function renderMetrics() {
    const active = state.products.filter(item => item.active !== false).length;
    const inactive = state.products.length - active;
    const withSku = state.products.filter(item => Boolean(item.sku)).length;
    const withPallet = state.products.filter(item => Number(item.default_units_per_pallet) > 0).length;
    $('productTotalMetric').textContent = state.products.length.toLocaleString('es-US');
    $('productActiveMetric').textContent = active.toLocaleString('es-US');
    $('productInactiveMetric').textContent = inactive.toLocaleString('es-US');
    $('productSkuMetric').textContent = withSku.toLocaleString('es-US');
    $('productPalletMetric').textContent = withPallet.toLocaleString('es-US');
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
    return `<div class="product-card-actions">
      <button type="button" class="btn" data-product-action="detail" data-product-id="${id}">Ver</button>
      ${writable ? `<button type="button" class="btn" data-product-action="edit" data-product-id="${id}">Editar</button><button type="button" class="btn ${item.active === false ? '' : 'danger'}" data-product-action="toggle" data-product-id="${id}">${toggleLabel}</button>` : ''}
    </div>`;
  }

  function productCard(item) {
    const identity = String(item.sku || item.name || '?').trim();
    const brandCategory = [item.brand,item.category].filter(Boolean).join(' · ') || 'Sin marca ni categoría';
    const packageLabel = item.package_format || 'Sin presentación definida';
    const origin = item.country_of_origin || 'Origen no registrado';
    const hs = item.hs_code ? `HS ${item.hs_code}` : 'Sin HS Code';
    const pallet = Number(item.default_units_per_pallet) > 0
      ? `${formatNumber(item.default_units_per_pallet)} por pallet`
      : 'Sin pallet estándar';
    const measurements = [
      item.unit_weight_kg !== null && item.unit_weight_kg !== undefined ? `${formatNumber(item.unit_weight_kg)} kg/unidad` : '',
      item.unit_volume_m3 !== null && item.unit_volume_m3 !== undefined ? `${formatNumber(item.unit_volume_m3,6)} m³/unidad` : ''
    ].filter(Boolean).join(' · ') || 'Sin peso ni volumen maestro';
    return `<article class="product-card" data-product-row="${esc(item.id)}">
      <div class="product-identity">
        <span class="product-avatar" aria-hidden="true">${esc(identity.slice(0,3).toUpperCase() || '?')}</span>
        <div><span class="product-sku">${esc(item.sku || 'Sin SKU')}</span><strong class="product-name">${esc(item.name || 'Producto sin nombre')}</strong><span class="product-meta">${esc(brandCategory)}</span></div>
      </div>
      <div class="product-card-section"><span class="product-card-label">Unidad y empaque</span><strong>${esc(item.unit || 'unidades')}</strong><span class="product-meta">${esc(packageLabel)}</span></div>
      <div class="product-card-section product-card-origin"><span class="product-card-label">Procedencia</span><strong>${esc(origin)}</strong><span class="product-meta">${esc(hs)}</span></div>
      <div class="product-card-section product-card-handling"><span class="product-card-label">Manejo</span><strong>${esc(pallet)}</strong><span class="product-meta">${esc(measurements)}</span></div>
      <div class="product-card-control"><span class="product-status ${item.active === false ? 'inactive' : ''}">${item.active === false ? 'Inactivo' : 'Activo'}</span>${actionMarkup(item)}</div>
    </article>`;
  }

  function emptyMarkup() {
    const hasRows = state.products.length > 0;
    if (hasRows) {
      return '<div class="products-empty"><strong>No encontramos coincidencias</strong><span>Prueba otro término o cambia el estado seleccionado.</span></div>';
    }
    const action = state.writeAccess
      ? '<button type="button" class="btn primary" data-empty-action="new">Registrar primer producto</button>'
      : '';
    return `<div class="products-empty"><strong>No hay productos registrados</strong><span>Cuando exista información maestra, aparecerá en este catálogo.</span>${action}</div>`;
  }

  function renderList() {
    const list = visibleProducts();
    $('productResultCount').textContent = `${list.length.toLocaleString('es-US')} ${list.length === 1 ? 'producto' : 'productos'}`;
    $('productList').innerHTML = list.length ? list.map(productCard).join('') : emptyMarkup();
    $('productList').setAttribute('aria-busy', 'false');
  }

  function render() {
    applyAccess();
    renderMetrics();
    renderTabs();
    renderList();
  }

  function renderLoading() {
    $('productResultCount').textContent = 'Consultando…';
    $('productList').setAttribute('aria-busy', 'true');
    $('productList').innerHTML = '<div class="products-loading" role="status"><span class="products-spinner" aria-hidden="true"></span>Consultando productos…</div>';
  }

  function renderLoadError() {
    $('productResultCount').textContent = 'No disponible';
    $('productList').setAttribute('aria-busy', 'false');
    $('productList').innerHTML = '<div class="products-empty"><strong>No se pudo mostrar el catálogo</strong><span>La información no fue modificada. Intenta cargarla nuevamente.</span><button type="button" class="btn primary" data-empty-action="retry">Reintentar</button></div>';
  }

  function updateReadTime() {
    const now = new Date();
    $('productsLastUpdated').textContent = `Actualizado ${now.toLocaleTimeString('es-US',{hour:'numeric',minute:'2-digit'})}`;
  }

  async function load(announce = false) {
    if (state.loading) return;
    if (!token()) {
      if (embeddedMode && window.top !== window) return;
      redirectToAdminLogin();
      return;
    }
    state.loading = true;
    $('refreshProducts').disabled = true;
    renderLoading();
    if (!announce) feedback();
    try {
      const data = await request('/api/products');
      state.products = Array.isArray(data.products) ? data.products : [];
      state.writeAccess = data.write_access === true;
      render();
      updateReadTime();
      if (announce) feedback('Catálogo actualizado.', 'good');
    } catch (error) {
      productError('load', error);
      renderLoadError();
      feedback(safeProductMessage(error, 'No se pudo cargar Productos. Intenta actualizar nuevamente.'), 'bad');
    } finally {
      state.loading = false;
      $('refreshProducts').disabled = false;
    }
  }

  function syncBodyModalState() {
    document.body.classList.toggle('products-modal-open', Boolean(document.querySelector('.product-modal:not(.hidden)')));
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
    return `<div class="product-detail-field ${wide ? 'wide' : ''}"><b>${esc(label)}</b><span>${esc(value || 'No definido')}</span></div>`;
  }

  function openDetails(id) {
    const item = findProduct(id);
    if (!item) return feedback('El producto ya no está disponible.', 'bad');
    state.detailId = item.id;
    $('productDetailTitle').textContent = item.sku ? `${item.sku} · ${item.name}` : item.name || 'Detalle de producto';
    $('productDetailBody').innerHTML = [
      detailField('Nombre', item.name),
      detailField('SKU', item.sku),
      detailField('Estado', item.active === false ? 'Inactivo' : 'Activo'),
      detailField('Marca', item.brand),
      detailField('Categoría', item.category),
      detailField('Unidad base', item.unit || 'unidades'),
      detailField('Presentación / empaque', item.package_format),
      detailField('Unidades por pallet', formatNumber(item.default_units_per_pallet)),
      detailField('Peso por unidad', item.unit_weight_kg === null || item.unit_weight_kg === undefined ? '' : `${formatNumber(item.unit_weight_kg)} kg`),
      detailField('Volumen por unidad', item.unit_volume_m3 === null || item.unit_volume_m3 === undefined ? '' : `${formatNumber(item.unit_volume_m3,6)} m³`),
      detailField('País de origen', item.country_of_origin),
      detailField('HS Code', item.hs_code),
      detailField('Descripción', item.description, true),
      detailField('Notas internas', item.notes, true)
    ].join('');
    $('editProductFromDetail').hidden = state.writeAccess !== true;
    openModal('productDetailModal', '[data-close="detail"]');
  }

  function fillForm(item = null) {
    $('productSku').value = item?.sku || '';
    $('productName').value = item?.name || '';
    $('productBrand').value = item?.brand || '';
    $('productCategory').value = item?.category || '';
    $('productUnit').value = item?.unit || 'unidades';
    $('productFormat').value = item?.package_format || '';
    $('productUnitsPallet').value = item?.default_units_per_pallet ?? '';
    $('productWeight').value = item?.unit_weight_kg ?? '';
    $('productVolume').value = item?.unit_volume_m3 ?? '';
    $('productOrigin').value = item?.country_of_origin || '';
    $('productHs').value = item?.hs_code || '';
    $('productDescription').value = item?.description || '';
    $('productNotes').value = item?.notes || '';
  }

  function openProduct(id = null) {
    if (state.writeAccess !== true) {
      feedback('No tienes permiso para modificar productos.', 'bad');
      return false;
    }
    const item = id === null ? null : findProduct(id);
    if (id !== null && !item) {
      feedback('El producto ya no está disponible.', 'bad');
      return false;
    }
    state.editingId = item?.id || null;
    $('productModalTitle').textContent = item ? `Editar ${item.name}` : 'Nuevo producto';
    $('saveProduct').textContent = item ? 'Guardar cambios' : 'Guardar producto';
    fillForm(item);
    formMessage();
    openModal('productModal', '#productName');
    return true;
  }

  function productPayload() {
    return {
      sku:$('productSku').value,
      name:$('productName').value,
      brand:$('productBrand').value,
      category:$('productCategory').value,
      unit:$('productUnit').value,
      package_format:$('productFormat').value,
      default_units_per_pallet:$('productUnitsPallet').value,
      unit_weight_kg:$('productWeight').value,
      unit_volume_m3:$('productVolume').value,
      country_of_origin:$('productOrigin').value,
      hs_code:$('productHs').value,
      description:$('productDescription').value,
      notes:$('productNotes').value
    };
  }

  async function saveProduct(event) {
    event.preventDefault();
    if (state.writeAccess !== true) return formMessage('No tienes permiso para modificar productos.');
    const form = $('productForm');
    if (typeof form.checkValidity === 'function' && !form.checkValidity()) {
      form.reportValidity?.();
      return formMessage('Completa el nombre, la unidad base y revisa los valores numéricos.');
    }
    const button = $('saveProduct');
    if (button.disabled) return;
    button.disabled = true;
    const defaultLabel = state.editingId ? 'Guardar cambios' : 'Guardar producto';
    button.textContent = 'Guardando…';
    formMessage('Guardando producto…', 'good');
    try {
      const body = productPayload();
      if (state.editingId) {
        body.id = state.editingId;
        body.action = 'update';
      }
      await request('/api/products', {
        method:state.editingId ? 'PATCH' : 'POST',
        body:JSON.stringify(body)
      });
      closeModal('productModal');
      const changed = Boolean(state.editingId);
      state.editingId = null;
      await load(false);
      feedback(changed ? 'Producto actualizado.' : 'Producto registrado.', 'good');
      window.dispatchEvent(new CustomEvent('export-mca:products-changed'));
    } catch (error) {
      productError('save', error);
      formMessage(safeProductMessage(error, 'No se pudo guardar el producto. Revisa los datos e intenta nuevamente.'));
    } finally {
      button.disabled = false;
      button.textContent = defaultLabel;
    }
  }

  function finishDecision(value) {
    const resolve = decisionResolver;
    decisionResolver = null;
    closeModal('productDecision');
    if (decisionPreviousFocus instanceof HTMLElement && decisionPreviousFocus.isConnected) decisionPreviousFocus.focus();
    decisionPreviousFocus = null;
    resolve?.(Boolean(value));
  }

  function decision({ title, message, confirmLabel }) {
    if (decisionResolver) finishDecision(false);
    decisionPreviousFocus = document.activeElement;
    $('productDecisionTitle').textContent = title;
    $('productDecisionText').textContent = message;
    $('productDecisionConfirm').textContent = confirmLabel;
    openModal('productDecision', '#productDecisionCancel');
    return new Promise(resolve => { decisionResolver = resolve; });
  }

  async function toggleProduct(id) {
    if (state.writeAccess !== true) return feedback('No tienes permiso para modificar productos.', 'bad');
    const item = findProduct(id);
    if (!item) return feedback('El producto ya no está disponible.', 'bad');
    const nextActive = item.active === false;
    const approved = await decision({
      title:nextActive ? `Reactivar ${item.name}` : `Desactivar ${item.name}`,
      message:nextActive
        ? 'El producto volverá a estar disponible para nuevas operaciones.'
        : 'El producto dejará de estar disponible para nuevas operaciones, pero su historial físico y financiero se conservará.',
      confirmLabel:nextActive ? 'Reactivar producto' : 'Desactivar producto'
    });
    if (!approved) return;
    try {
      await request('/api/products', {
        method:'PATCH',
        body:JSON.stringify({ action:'set_active', id:item.id, active:nextActive })
      });
      await load(false);
      feedback(nextActive ? 'Producto reactivado.' : 'Producto desactivado.', 'good');
      window.dispatchEvent(new CustomEvent('export-mca:products-changed'));
    } catch (error) {
      productError('toggle', error);
      feedback(safeProductMessage(error, 'No se pudo cambiar el estado del producto. Intenta nuevamente.'), 'bad');
    }
  }

  function onProductListClick(event) {
    const retry = event.target.closest('[data-empty-action="retry"]');
    if (retry) return load(true);
    const create = event.target.closest('[data-empty-action="new"]');
    if (create) return openProduct();
    const button = event.target.closest('[data-product-action]');
    if (!button) return;
    const id = button.dataset.productId;
    if (button.dataset.productAction === 'detail') openDetails(id);
    if (button.dataset.productAction === 'edit') openProduct(id);
    if (button.dataset.productAction === 'toggle') toggleProduct(id);
  }

  function closeProductEditor() {
    state.editingId = null;
    closeModal('productModal');
  }

  function closeProductDetail() {
    state.detailId = null;
    closeModal('productDetailModal');
  }

  function bindEvents() {
    $('refreshProducts').addEventListener('click', () => load(true));
    $('newProduct').addEventListener('click', () => openProduct());
    $('productForm').addEventListener('submit', saveProduct);
    $('productSearch').addEventListener('input', event => {
      state.query = event.target.value;
      renderList();
    });
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
      state.view = button.dataset.view;
      renderTabs();
      renderList();
    }));
    $('productList').addEventListener('click', onProductListClick);
    document.querySelectorAll('[data-close="product"]').forEach(button => button.addEventListener('click', closeProductEditor));
    document.querySelectorAll('[data-close="detail"]').forEach(button => button.addEventListener('click', closeProductDetail));
    $('editProductFromDetail').addEventListener('click', () => {
      const id = state.detailId;
      closeProductDetail();
      if (id !== null) openProduct(id);
    });
    $('productDecisionCancel').addEventListener('click', () => finishDecision(false));
    $('productDecisionConfirm').addEventListener('click', () => finishDecision(true));
    ['productModal','productDetailModal','productDecision'].forEach(id => {
      $(id).addEventListener('click', event => {
        if (event.target !== $(id)) return;
        if (id === 'productDecision') finishDecision(false);
        if (id === 'productModal') closeProductEditor();
        if (id === 'productDetailModal') closeProductDetail();
      });
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!$('productDecision').classList.contains('hidden')) return finishDecision(false);
      if (!$('productDetailModal').classList.contains('hidden')) return closeProductDetail();
      if (!$('productModal').classList.contains('hidden')) closeProductEditor();
    });
  }

  function handleStoredSession(event) {
    if (event.key !== 'export_mca_token' || !event.newValue || state.started) return;
    window.removeEventListener('storage', handleStoredSession);
    startProducts();
  }

  function startProducts() {
    if (state.started) return;
    if (!token()) {
      if (embeddedMode && window.top !== window) {
        $('productsLastUpdated').textContent = 'Esperando sesión segura…';
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
  window.ProductsModule = Object.freeze({
    owner:'products.js',
    source:'api/products.js',
    refresh:() => load(false),
    openProduct,
    openDetails
  });
  startProducts();
})();
