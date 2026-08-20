(() => {
  if (window.__operationalNavigationInstalled) return;
  window.__operationalNavigationInstalled = true;

  const normalize = value => String(value || '').trim().toUpperCase();
  let linksCache = null;
  let linksPromise = null;

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

  async function requestLinks({ refresh = false } = {}) {
    if (!refresh && Array.isArray(linksCache)) return linksCache;
    if (!refresh && linksPromise) return linksPromise;

    const token = localStorage.getItem('export_mca_token') || '';
    linksPromise = fetch('/api/operational-links', {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los enlaces operativos');
        linksCache = Array.isArray(data.links) ? data.links : [];
        return linksCache;
      })
      .finally(() => { linksPromise = null; });

    return linksPromise;
  }

  function invalidateLinks() {
    linksCache = null;
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

  async function loadForShipment(shipmentId) {
    if (!shipmentId) return null;
    const links = await requestLinks();
    return links.find(item => String(item.shipment_id) === String(shipmentId)) || null;
  }

  async function loadsForOperation(operationId) {
    if (!operationId) return [];
    const links = await requestLinks();
    return links.filter(item => String(item.operation_id || '') === String(operationId));
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

  async function openLoadForShipment(shipmentId) {
    const link = await loadForShipment(shipmentId);
    if (!link) return false;
    return openLoad({ loadId: link.load_id });
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

  window.addEventListener('export-mca:data-loaded', invalidateLinks);

  window.OperationalNavigation = Object.freeze({
    openTracking,
    openLoad,
    openLoadForShipment,
    openInventoryReceipt,
    openExpediente,
    loadForShipment,
    loadsForOperation,
    refreshLinks: () => requestLinks({ refresh:true }),
    owner: 'operational-navigation.js'
  });
})();
