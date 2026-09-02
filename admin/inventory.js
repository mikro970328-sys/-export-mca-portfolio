const $ = id => document.getElementById(id);
let token = localStorage.getItem('export_mca_token') || '';
const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';
let moduleStarted = false;

let inventory = [];
let warehouses = [];
let traceability = [];
let activeView = 'stock';
let activeReceipt = '';
let contextRequest = 0;

const MOVEMENT_LABELS = Object.freeze({
  receipt: 'Recepción WR',
  reserve: 'Reserva para cargue',
  release: 'Liberación de reserva',
  dispatch: 'Salida de almacén',
  adjustment_in: 'Ajuste de entrada',
  adjustment_out: 'Ajuste de salida',
  transfer_out: 'Transferencia de salida',
  transfer_in: 'Transferencia de entrada'
});

const LOAD_STATUS_LABELS = Object.freeze({
  draft: 'Borrador',
  reserved: 'Reservado',
  loading: 'En carga',
  loaded: 'Cargado',
  dispatched: 'Despachado',
  cancelled: 'Cancelado'
});

const PURCHASE_STATUS_LABELS = Object.freeze({
  draft: 'Borrador',
  issued: 'Emitida',
  confirmed: 'Confirmada',
  partially_received: 'Recepción parcial',
  received: 'Recibida',
  closed: 'Cerrada',
  cancelled: 'Cancelada'
});

const SALES_STATUS_LABELS = Object.freeze({
  draft: 'Borrador',
  confirmed: 'Confirmada',
  allocated: 'Asignada',
  in_fulfillment: 'En preparación',
  dispatched: 'Despachada',
  closed: 'Cerrada',
  cancelled: 'Cancelada'
});

const REFERENCE_LABELS = Object.freeze({
  warehouse_receipt: 'Recepción',
  receipt: 'Recepción',
  load: 'Cargue',
  sales_order: 'Venta',
  purchase_order: 'Compra',
  adjustment: 'Ajuste',
  transfer: 'Transferencia'
});

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));

function redirectToAdminLogin() {
  localStorage.removeItem('export_mca_token');
  localStorage.removeItem('export_mca_user');
  if (embeddedMode && window.top !== window) {
    window.top.location.replace('/admin/index.html');
    return;
  }
  location.replace('/admin/index.html');
}

async function api() {
  const response = await fetch('/api/inventory', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    redirectToAdminLogin();
    const error = new Error('Sesión vencida');
    error.status = 401;
    error.endpoint = '/api/inventory';
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data.error || 'No se pudo cargar el inventario.');
    error.status = response.status;
    error.code = data.details?.code || data.code || null;
    error.endpoint = '/api/inventory';
    throw error;
  }
  return data;
}

function safeInventoryMessage(error, fallback = 'No se pudo completar la consulta. Intenta nuevamente.', context = 'operation') {
  const message = String(error?.message || '').trim();
  const status = Number(error?.status || 0);
  if (status === 401 || message === 'Sesión vencida') return 'Tu sesión terminó. Inicia sesión nuevamente para continuar.';
  if (status === 403) return 'No tienes permiso para consultar esta información.';
  if (status === 405) return 'Esta consulta no está disponible.';
  console.error('INVENTORY_UI_FAILED', {
    context,
    status: status || null,
    code: error?.code || null,
    endpoint: error?.endpoint || null,
    error
  });
  return fallback;
}

function num(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '0';
}

function signed(value) {
  const number = Number(value || 0);
  return `${number > 0 ? '+' : ''}${num(number)}`;
}

function fmtDate(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return date.toLocaleString('es-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function movementLabel(type) {
  return MOVEMENT_LABELS[type] || 'Movimiento de inventario';
}

function loadStatusLabel(status) {
  return LOAD_STATUS_LABELS[status] || 'Estado no disponible';
}

function purchaseStatusLabel(status) {
  return PURCHASE_STATUS_LABELS[status] || 'Estado no disponible';
}

function salesStatusLabel(status) {
  return SALES_STATUS_LABELS[status] || 'Estado no disponible';
}

function unit(row) {
  return row.unit || row.product?.unit || 'unidades';
}

function qtyText(quantity, pallets, itemUnit) {
  const parts = [];
  if (Number(pallets || 0) !== 0) parts.push(`${num(pallets)} pallets`);
  if (Number(quantity || 0) !== 0) parts.push(`${num(quantity)} ${esc(itemUnit)}`);
  return parts.join(' · ') || '0';
}

function matchesWarehouse(id) {
  const warehouseId = $('warehouseFilter').value;
  return !warehouseId || String(id) === String(warehouseId);
}

function searchText() {
  return $('search').value.trim().toLowerCase();
}

function filteredInventory() {
  const query = searchText();
  return inventory.filter(row => {
    if (!matchesWarehouse(row.warehouse_id)) return false;
    if (!query) return true;
    const text = [
      row.product?.sku,
      row.product?.name,
      row.product?.brand,
      row.warehouse?.code,
      row.warehouse?.name,
      ...(row.sources || []).map(source => source.receipt_number)
    ].join(' ').toLowerCase();
    return text.includes(query);
  });
}

function filteredTrace() {
  const query = searchText();
  return traceability.filter(row => {
    if (!matchesWarehouse(row.warehouse_id)) return false;
    if (!query) return true;
    const text = [
      row.receipt_number,
      row.product_sku,
      row.product_name,
      row.warehouse_code,
      row.warehouse_name,
      movementLabel(row.movement_type),
      REFERENCE_LABELS[row.reference_type],
      row.reference_id,
      row.notes,
      row.created_by_username,
      row.lot_number
    ].join(' ').toLowerCase();
    return text.includes(query);
  });
}

function metricCard(label, value, detail) {
  return `<article class="stat"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(detail)}</small></article>`;
}

function renderStats() {
  const rows = filteredInventory();
  const uniqueProducts = new Set(rows.map(row => row.product_id || row.product?.name).filter(Boolean)).size;
  const physical = rows.reduce((sum, row) => sum + Number(row.physical_pallets || 0), 0);
  const reserved = rows.reduce((sum, row) => sum + Number(row.reserved_pallets || 0), 0);
  const available = rows.reduce((sum, row) => sum + Number(row.available_pallets || 0), 0);
  $('stats').innerHTML = [
    metricCard('Productos', num(uniqueProducts), 'Con existencia registrada'),
    metricCard('Pallets físicos', num(physical), 'Mercancía recibida'),
    metricCard('Pallets reservados', num(reserved), 'Asignados a cargues'),
    metricCard('Pallets disponibles', num(available), 'Listos para asignar')
  ].join('');
}

function emptyState(title, copy) {
  return `<div class="inventory-empty"><strong>${esc(title)}</strong><span>${esc(copy)}</span></div>`;
}

function sourceDesktop(source, itemUnit) {
  return `<tr><td><b>${esc(source.receipt_number || 'WR sin número')}</b><br><button class="inventory-action-link" type="button" data-trace-wr="${esc(source.receipt_number)}">Ver trazabilidad</button></td><td>${esc(source.lot_number || 'Sin lote')}</td><td>${qtyText(source.physical_quantity, source.physical_pallets, itemUnit)}</td><td>${qtyText(source.reserved_quantity, source.reserved_pallets, itemUnit)}</td><td><b>${qtyText(source.available_quantity, source.available_pallets, itemUnit)}</b></td><td>${source.units_per_pallet ? num(source.units_per_pallet) : '—'}</td><td>${num(source.movement_count)}</td></tr>`;
}

function sourceMobile(source, itemUnit) {
  return `<article class="inventory-source-card"><div class="inventory-source-card-top"><div><b>${esc(source.receipt_number || 'WR sin número')}</b><div class="inventory-product-meta">${source.lot_number ? `Lote ${esc(source.lot_number)}` : 'Sin lote'} · ${num(source.movement_count)} movimientos</div></div><span class="pill">Origen WR</span></div><div class="inventory-source-grid"><div><span>Físico</span><strong>${qtyText(source.physical_quantity, source.physical_pallets, itemUnit)}</strong></div><div><span>Disponible</span><strong>${qtyText(source.available_quantity, source.available_pallets, itemUnit)}</strong></div><div><span>Reservado</span><strong>${qtyText(source.reserved_quantity, source.reserved_pallets, itemUnit)}</strong></div><div><span>Unid./pallet</span><strong>${source.units_per_pallet ? num(source.units_per_pallet) : '—'}</strong></div></div><button class="inventory-action-link" type="button" data-trace-wr="${esc(source.receipt_number)}">Ver trazabilidad completa</button></article>`;
}

function inventoryRow(row, index) {
  const itemUnit = unit(row);
  const sources = Array.isArray(row.sources) ? row.sources : [];
  const productName = row.product?.name || 'Producto sin nombre';
  const sku = row.product?.sku || 'Sin SKU';
  const warehouse = [row.warehouse?.code, row.warehouse?.name].filter(Boolean).join(' · ') || 'Almacén no disponible';
  const sourceId = `inventorySources${index}`;
  const sourceLabel = `${sources.length} WR de origen`;
  return `<article class="inventory-row"><button class="inventory-row-toggle" type="button" data-toggle-inventory aria-expanded="false" aria-controls="${sourceId}"><div><div class="inventory-product-name">${esc(productName)}</div><div class="inventory-product-meta">${esc(sku)} · ${esc(warehouse)} · ${esc(sourceLabel)}</div>${row.product?.brand ? `<span class="inventory-product-brand">${esc(row.product.brand)}</span>` : ''}<div class="inventory-mobile-summary"><div><span>Físico</span><b>${qtyText(row.physical_quantity, row.physical_pallets, itemUnit)}</b></div><div><span>Reservado</span><b>${qtyText(row.reserved_quantity, row.reserved_pallets, itemUnit)}</b></div><div><span>Disponible</span><b>${qtyText(row.available_quantity, row.available_pallets, itemUnit)}</b></div></div></div><div class="inventory-metric"><span>Físico</span><b>${qtyText(row.physical_quantity, row.physical_pallets, itemUnit)}</b></div><div class="inventory-metric reserved"><span>Reservado</span><b>${qtyText(row.reserved_quantity, row.reserved_pallets, itemUnit)}</b></div><div class="inventory-metric available"><span>Disponible</span><b>${qtyText(row.available_quantity, row.available_pallets, itemUnit)}</b></div><span class="inventory-chevron" aria-hidden="true">⌄</span></button><div id="${sourceId}" class="inventory-source-wrap hidden"><div class="inventory-source-title"><strong>Recepciones que componen esta existencia</strong><span>${esc(sourceLabel)}</span></div><div class="inventory-source-desktop inventory-table-wrap"><table><thead><tr><th>WR origen</th><th>Lote</th><th>Físico</th><th>Reservado</th><th>Disponible</th><th>Unid./pallet</th><th>Mov.</th></tr></thead><tbody>${sources.map(source => sourceDesktop(source, itemUnit)).join('')}</tbody></table></div><div class="inventory-source-mobile">${sources.map(source => sourceMobile(source, itemUnit)).join('')}</div></div></article>`;
}

function renderInventory() {
  const rows = filteredInventory();
  $('stockCount').textContent = `${rows.length} resultado${rows.length === 1 ? '' : 's'}`;
  if (!rows.length) {
    const filtered = Boolean(searchText() || $('warehouseFilter').value);
    $('inventoryList').innerHTML = filtered
      ? emptyState('Sin coincidencias', 'Prueba otra búsqueda o limpia el filtro de almacén.')
      : emptyState('Aún no hay existencias', 'Las recepciones WR activas aparecerán aquí cuando aporten inventario.');
    return;
  }
  $('inventoryList').innerHTML = `<div class="inventory-list-summary"><strong>${rows.length} combinación${rows.length === 1 ? '' : 'es'} de producto y almacén</strong><span>Selecciona una fila para consultar sus WR</span></div>${rows.map(inventoryRow).join('')}`;
}

function deltaClass(value) {
  const number = Number(value || 0);
  return number > 0 ? 'positive' : number < 0 ? 'negative' : '';
}

function physicalDelta(row) {
  const parts = [];
  if (Number(row.pallets_delta || 0) !== 0) parts.push(`${signed(row.pallets_delta)} pallets`);
  if (Number(row.quantity_delta || 0) !== 0) parts.push(`${signed(row.quantity_delta)} ${esc(row.unit || 'unidades')}`);
  return parts.join(' · ') || '—';
}

function reservedDelta(row) {
  const parts = [];
  if (Number(row.reserved_pallets_delta || 0) !== 0) parts.push(`${signed(row.reserved_pallets_delta)} pallets`);
  if (Number(row.reserved_quantity_delta || 0) !== 0) parts.push(`${signed(row.reserved_quantity_delta)} ${esc(row.unit || 'unidades')}`);
  return parts.join(' · ') || '—';
}

function referenceText(row) {
  if (row.movement_type === 'receipt') return `Recepción ${esc(row.receipt_number || '')}`;
  if (!row.reference_type && !row.reference_id) return 'Sin referencia adicional';
  const label = REFERENCE_LABELS[row.reference_type] || 'Referencia operativa';
  return `${esc(label)}${row.reference_id ? ` · ${esc(row.reference_id)}` : ''}`;
}

function traceDesktop(row) {
  const physicalClass = deltaClass(row.quantity_delta || row.pallets_delta);
  const reservedClass = deltaClass(row.reserved_quantity_delta || row.reserved_pallets_delta);
  return `<tr><td>${fmtDate(row.occurred_at)}</td><td><span class="inventory-trace-type">${esc(movementLabel(row.movement_type))}</span>${row.created_by_username ? `<div class="muted">${esc(row.created_by_username)}</div>` : ''}</td><td><b>${esc(row.receipt_number || 'Sin WR')}</b>${row.lot_number ? `<div class="muted">Lote ${esc(row.lot_number)}</div>` : ''}</td><td><b>${esc(row.product_name || 'Producto')}</b><div class="muted">${esc(row.product_sku || 'Sin SKU')}</div></td><td>${esc([row.warehouse_code, row.warehouse_name].filter(Boolean).join(' · ') || 'Sin almacén')}</td><td class="inventory-delta ${physicalClass}">${physicalDelta(row)}</td><td class="inventory-delta ${reservedClass}">${reservedDelta(row)}</td><td class="inventory-trace-reference">${referenceText(row)}${row.notes ? `<div class="muted">${esc(row.notes)}</div>` : ''}</td></tr>`;
}

function traceMobile(row) {
  const physicalClass = deltaClass(row.quantity_delta || row.pallets_delta);
  const reservedClass = deltaClass(row.reserved_quantity_delta || row.reserved_pallets_delta);
  return `<article class="inventory-trace-card"><div class="inventory-trace-card-top"><div><b>${esc(movementLabel(row.movement_type))}</b><div class="inventory-product-meta">${fmtDate(row.occurred_at)}</div></div><span class="pill">${esc(row.receipt_number || 'Sin WR')}</span></div><div class="inventory-product-meta">${esc(row.product_name || 'Producto')} · ${esc([row.warehouse_code, row.warehouse_name].filter(Boolean).join(' · ') || 'Sin almacén')}</div><div class="inventory-trace-grid"><div><span>Cambio físico</span><strong class="${physicalClass}">${physicalDelta(row)}</strong></div><div><span>Cambio reservado</span><strong class="${reservedClass}">${reservedDelta(row)}</strong></div></div><div class="inventory-trace-card-copy">${referenceText(row)}${row.notes ? ` · ${esc(row.notes)}` : ''}</div></article>`;
}

function renderTrace() {
  const rows = filteredTrace();
  $('traceCount').textContent = `${rows.length} evento${rows.length === 1 ? '' : 's'}`;
  if (!rows.length) {
    const filtered = Boolean(searchText() || $('warehouseFilter').value);
    $('traceList').innerHTML = filtered
      ? emptyState('Sin movimientos coincidentes', 'Prueba otra referencia, producto, WR o almacén.')
      : emptyState('Aún no hay movimientos', 'La trazabilidad se construye desde cada recepción WR y sus movimientos posteriores.');
    return;
  }
  $('traceList').innerHTML = `<div class="inventory-trace-desktop inventory-table-wrap"><table class="inventory-trace-table"><thead><tr><th>Fecha</th><th>Evento</th><th>WR origen</th><th>Producto</th><th>Almacén</th><th>Cambio físico</th><th>Cambio reservado</th><th>Referencia</th></tr></thead><tbody>${rows.map(traceDesktop).join('')}</tbody></table></div><div class="inventory-trace-mobile">${rows.map(traceMobile).join('')}</div>`;
}

function parentNavigation() {
  try {
    return window.parent !== window ? window.parent.OperationalNavigation || null : null;
  } catch {
    return null;
  }
}

function parentCan(permission) {
  try {
    return window.parent !== window && window.parent.ExportMcaAccessControl?.can?.(permission) === true;
  } catch {
    return false;
  }
}

function contextCard(cardId, kicker, title, items, emptyCopy) {
  const card = $(cardId);
  card.classList.remove('hidden');
  card.innerHTML = `<div class="inventory-context-head"><div><span class="inventory-eyebrow">${esc(kicker)}</span><h2>${esc(title)}</h2></div><span class="inventory-result-count">${items.length} relacionado${items.length === 1 ? '' : 's'}</span></div>${items.length ? `<div class="inventory-context-actions">${items.map(item => `<button class="inventory-context-action" type="button" data-context-kind="${esc(item.kind)}" data-context-id="${esc(item.id)}">${esc(item.label)}</button>`).join('')}</div>` : `<div class="inventory-context-empty">${esc(emptyCopy)}</div>`}`;
}

function contextLoading(cardId, kicker, title) {
  const card = $(cardId);
  card.classList.remove('hidden');
  card.innerHTML = `<div class="inventory-context-head"><div><span class="inventory-eyebrow">${esc(kicker)}</span><h2>${esc(title)}</h2></div></div><div class="inventory-context-loading"><span class="inventory-spinner" aria-hidden="true"></span>Consultando relaciones operativas…</div>`;
}

function clearOperationalContext() {
  contextRequest += 1;
  ['purchaseOriginCard', 'salesUsageCard'].forEach(id => {
    $(id).classList.add('hidden');
    $(id).innerHTML = '';
  });
  $('traceContextLabel').textContent = 'Cronología completa del inventario recibido.';
}

async function renderOperationalContext(receiptNumber) {
  const receipt = String(receiptNumber || '').trim();
  const navigation = parentNavigation();
  const requestId = ++contextRequest;
  if (!receipt || !navigation) {
    clearOperationalContext();
    return;
  }
  $('traceContextLabel').textContent = `Trazabilidad completa de ${receipt}.`;
  contextLoading('purchaseOriginCard', 'Origen físico', `Compra de origen · ${receipt}`);
  contextLoading('salesUsageCard', 'Salida comercial', `Uso posterior · ${receipt}`);
  try {
    const [purchases, loads, sales] = await Promise.all([
      parentCan('procurement.read') ? navigation.purchaseOrdersForReceipt(receipt) : Promise.resolve([]),
      parentCan('logistics.read') ? navigation.loadsForReceipt(receipt) : Promise.resolve([]),
      parentCan('sales.read') ? navigation.salesOrdersForReceipt(receipt) : Promise.resolve([])
    ]);
    if (requestId !== contextRequest) return;
    const purchaseItems = purchases.map(order => ({
      kind: 'purchase',
      id: order.purchase_order_id,
      label: `${order.po_number || 'Orden de compra'} · ${purchaseStatusLabel(order.po_status || order.status)}`
    }));
    const usageItems = [
      ...loads.map(load => ({
        kind: 'load',
        id: load.load_id,
        label: `Cargue ${load.load_number || 'sin número'} · ${loadStatusLabel(load.load_status || load.status)}`
      })),
      ...sales.map(order => ({
        kind: 'sale',
        id: order.sales_order_id,
        label: `Venta ${order.so_number || 'sin número'} · ${salesStatusLabel(order.so_status || order.status)}`
      }))
    ];
    contextCard('purchaseOriginCard', 'Origen físico', `Compra de origen · ${receipt}`, purchaseItems, parentCan('procurement.read') ? 'Este WR no tiene una orden de compra visible vinculada.' : 'Tu rol no incluye la consulta de Compras.');
    contextCard('salesUsageCard', 'Salida comercial', `Uso posterior · ${receipt}`, usageItems, 'Este WR todavía no participa en un cargue o venta visible para tu rol.');
  } catch (error) {
    if (requestId !== contextRequest) return;
    const message = safeInventoryMessage(error, 'No se pudieron consultar las relaciones operativas de este WR.', 'operational_context');
    contextCard('purchaseOriginCard', 'Origen físico', `Compra de origen · ${receipt}`, [], message);
    contextCard('salesUsageCard', 'Salida comercial', `Uso posterior · ${receipt}`, [], message);
  }
}

function traceWR(receiptNumber) {
  activeReceipt = String(receiptNumber || '').trim();
  activeView = 'trace';
  $('search').value = activeReceipt;
  $('warehouseFilter').value = '';
  syncView();
  render();
  renderOperationalContext(activeReceipt);
}

function syncView() {
  const trace = activeView === 'trace';
  document.querySelectorAll('[data-inventory-view]').forEach(tab => {
    const active = tab.dataset.inventoryView === activeView;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  $('stockView').classList.toggle('hidden', trace);
  $('stockView').setAttribute('aria-hidden', String(trace));
  $('traceView').classList.toggle('hidden', !trace);
  $('traceView').setAttribute('aria-hidden', String(!trace));
  $('stockLegend').classList.toggle('hidden', trace);
  $('traceLegend').classList.toggle('hidden', !trace);
  $('search').placeholder = trace
    ? 'Evento, WR, producto, referencia o almacén'
    : 'Producto, SKU, marca, WR o almacén';
}

function render() {
  renderStats();
  renderInventory();
  renderTrace();
}

function toggleInventoryRow(button) {
  const row = button.closest('.inventory-row');
  const source = row?.querySelector('.inventory-source-wrap');
  if (!row || !source) return;
  const open = !row.classList.contains('open');
  row.classList.toggle('open', open);
  source.classList.toggle('hidden', !open);
  button.setAttribute('aria-expanded', String(open));
}

function handleListClick(event) {
  const traceButton = event.target.closest('[data-trace-wr]');
  if (traceButton) {
    event.stopPropagation();
    traceWR(traceButton.dataset.traceWr);
    return;
  }
  const toggle = event.target.closest('[data-toggle-inventory]');
  if (toggle) toggleInventoryRow(toggle);
}

function handleContextClick(event) {
  const button = event.target.closest('[data-context-kind]');
  if (!button) return;
  const navigation = parentNavigation();
  if (!navigation) return;
  const id = button.dataset.contextId;
  Promise.resolve().then(() => {
    if (button.dataset.contextKind === 'purchase') return navigation.openPurchase({ purchaseOrderId: id });
    if (button.dataset.contextKind === 'load') return navigation.openLoad({ loadId: id });
    if (button.dataset.contextKind === 'sale') return navigation.openSales({ salesOrderId: id });
    return false;
  }).catch(error => {
    $('inventoryFeedback').textContent = safeInventoryMessage(error, 'No se pudo abrir el registro relacionado.', 'context_navigation');
    $('inventoryFeedback').className = 'inventory-feedback bad';
  });
}

function bindEvents() {
  document.querySelectorAll('[data-inventory-view]').forEach(tab => {
    tab.addEventListener('click', () => {
      activeReceipt = '';
      activeView = tab.dataset.inventoryView;
      clearOperationalContext();
      syncView();
      render();
    });
  });
  $('search').addEventListener('input', () => {
    activeReceipt = '';
    clearOperationalContext();
    render();
  });
  $('warehouseFilter').addEventListener('change', () => {
    activeReceipt = '';
    clearOperationalContext();
    render();
  });
  $('clearFilters').addEventListener('click', () => {
    activeReceipt = '';
    $('search').value = '';
    $('warehouseFilter').value = '';
    clearOperationalContext();
    render();
    $('search').focus();
  });
  $('inventoryList').addEventListener('click', handleListClick);
  $('purchaseOriginCard').addEventListener('click', handleContextClick);
  $('salesUsageCard').addEventListener('click', handleContextClick);
}

async function load() {
  const data = await api();
  inventory = Array.isArray(data.inventory) ? data.inventory : [];
  warehouses = Array.isArray(data.warehouses) ? data.warehouses : [];
  traceability = Array.isArray(data.traceability) ? data.traceability : [];
  const currentWarehouse = $('warehouseFilter').value;
  $('warehouseFilter').innerHTML = '<option value="">Todos los almacenes</option>' + warehouses
    .filter(warehouse => warehouse.active)
    .map(warehouse => `<option value="${esc(warehouse.id)}">${esc(warehouse.code || 'Sin código')} · ${esc(warehouse.name || 'Almacén')}</option>`)
    .join('');
  $('warehouseFilter').value = warehouses.some(warehouse => String(warehouse.id) === String(currentWarehouse) && warehouse.active) ? currentWarehouse : '';
  $('inventoryFeedback').classList.add('hidden');
  syncView();
  render();
  if (activeReceipt) await renderOperationalContext(activeReceipt);
}

function showLoadFailure(error) {
  const message = safeInventoryMessage(error, 'No se pudo cargar Inventario. Intenta nuevamente.', 'load');
  $('inventoryFeedback').textContent = message;
  $('inventoryFeedback').className = 'inventory-feedback bad';
  $('stockCount').textContent = 'No disponible';
  $('traceCount').textContent = 'No disponible';
  $('inventoryList').innerHTML = `${emptyState('Inventario no disponible', message)}<div class="inventory-context-actions"><button id="inventoryRetry" class="inventory-context-action" type="button">Reintentar</button></div>`;
  $('traceList').innerHTML = emptyState('Trazabilidad no disponible', message);
  $('inventoryRetry').addEventListener('click', () => {
    $('inventoryList').innerHTML = '<div class="inventory-loading"><span class="inventory-spinner" aria-hidden="true"></span>Consultando existencias…</div>';
    load().catch(showLoadFailure);
  });
}

function startInventory(sessionToken = token) {
  if (moduleStarted) return true;
  token = String(sessionToken || '');
  if (!token) return false;
  moduleStarted = true;
  bindEvents();
  syncView();
  load().catch(showLoadFailure);
  return true;
}

function handleStoredSession(event) {
  if (event.key !== 'export_mca_token' || !event.newValue) return;
  window.removeEventListener('storage', handleStoredSession);
  startInventory(event.newValue);
}

window.InventoryModule = Object.freeze({
  owner: 'inventory.js',
  embedded: embeddedMode,
  safeInventoryMessage,
  traceWR,
  load
});

if (!startInventory()) {
  if (embeddedMode) window.addEventListener('storage', handleStoredSession);
  else redirectToAdminLogin();
}
