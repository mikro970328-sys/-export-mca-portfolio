(() => {
  if (window.__operationalNavigationInstalled) return;
  window.__operationalNavigationInstalled = true;

  const normalize = value => String(value || '').trim().toUpperCase();

  function section(id) {
    return typeof window.showSection === 'function' ? window.showSection(id) : false;
  }

  function embeddedFrame(sectionId) {
    return document.querySelector(`#${sectionId} iframe`);
  }

  function callEmbedded(sectionId, method, args = []) {
    const frame = embeddedFrame(sectionId);
    if (!frame) return false;

    const invoke = () => {
      try {
        const fn = frame.contentWindow?.[method];
        if (typeof fn !== 'function') return false;
        fn(...args);
        return true;
      } catch (error) {
        console.error('[operational navigation embedded]', sectionId, method, error);
        return false;
      }
    };

    if (frame.contentDocument?.readyState === 'complete') {
      requestAnimationFrame(invoke);
      return true;
    }
    frame.addEventListener('load', () => requestAnimationFrame(invoke), { once:true });
    return true;
  }

  function findShipment({ shipmentId = null, containerNumber = null } = {}) {
    const rows = Array.isArray(window.shipments) ? window.shipments : [];
    if (shipmentId) {
      const byId = rows.find(item => String(item.id) === String(shipmentId));
      if (byId) return byId;
    }
    const key = normalize(containerNumber);
    return key ? rows.find(item => normalize(item.container_number) === key) || null : null;
  }

  function openTracking(context = {}) {
    section('containersSection');
    const shipment = findShipment(context);
    if (!shipment) return false;
    requestAnimationFrame(() => window.ContainersModule?.openDetails?.(shipment));
    return true;
  }

  function openLoad({ loadId = null } = {}) {
    if (!loadId) return false;
    window.NavigationShell?.openLoads?.();
    return callEmbedded('loadsSection', 'openLoad', [loadId]);
  }

  function openInventoryReceipt(receiptNumber) {
    const receipt = String(receiptNumber || '').trim();
    if (!receipt) return false;
    window.NavigationShell?.openInventory?.();
    return callEmbedded('inventorySection', 'traceWR', [receipt]);
  }

  function openExpediente(operationId) {
    if (!operationId) return false;
    section('newOperationsSection');
    requestAnimationFrame(() => window.ExpedientesModule?.open?.(operationId));
    return true;
  }

  window.OperationalNavigation = Object.freeze({
    openTracking,
    openLoad,
    openInventoryReceipt,
    openExpediente,
    owner: 'operational-navigation.js'
  });
})();
