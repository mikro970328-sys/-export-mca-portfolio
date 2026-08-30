(() => {
  if (window.__salesOrderControllerInstalled) return;
  window.__salesOrderControllerInstalled = true;

  function getOrder(id) {
    try {
      return Array.isArray(orders) ? orders.find(row => String(row.id) === String(id)) || null : null;
    } catch {
      return null;
    }
  }

  function closeWorkspace() {
    document.getElementById('detailModal')?.classList.add('hidden');
  }

  async function refresh() {
    if (typeof load !== 'function') throw new Error('No está disponible la actualización de Ventas.');
    await load();
    return true;
  }

  function edit(salesOrderId) {
    const order = getOrder(salesOrderId);
    if (!order || order.status !== 'draft') return false;
    closeWorkspace();
    openOrder(order);
    return true;
  }

  async function transition(salesOrderId, action) {
    const order = getOrder(salesOrderId);
    if (!order) throw new Error('Venta no encontrada.');
    await api('/api/sales', {
      method:'POST',
      body:JSON.stringify({ action, sales_order_id:order.id })
    });
    await refresh();
    return getOrder(order.id);
  }

  function createLoad(salesOrderId) {
    const order = getOrder(salesOrderId);
    if (!order || !hasUnallocated(order)) return false;
    closeWorkspace();
    openLoad(order);
    return true;
  }

  function open(salesOrderId) {
    const order = getOrder(salesOrderId);
    if (!order) return false;
    detailOrder = order;
    if (!window.SalesWorkspace?.open) throw new Error('El Workspace de Ventas no está disponible.');
    window.SalesWorkspace.open(order.id);
    return true;
  }

  // Public entry point used by the list, Cargues and OperationalNavigation.
  // The mutation logic remains in sales.js; only the detail owner changes.
  window.openDetail = open;

  window.SalesOrderController = Object.freeze({
    getOrder,
    hasUnallocated,
    refresh,
    edit,
    transition,
    createLoad,
    open,
    close:closeWorkspace,
    owner:'sales-controller.js'
  });
})();
