(() => {
  'use strict';
  if (window.__adminDataLoaderInstalled) return;
  window.__adminDataLoaderInstalled = true;

  const accessCan = permission => window.ExportMcaAccessControl?.can?.(permission) === true;
  const currentAdmin = () => {
    try { if (typeof currentUser !== 'undefined' && currentUser) return currentUser; } catch {}
    return window.currentUser || null;
  };

  function setLegacyCollection(name, value) {
    try {
      if (name === 'clients' && typeof clients !== 'undefined') clients = value;
      if (name === 'shipments' && typeof shipments !== 'undefined') shipments = value;
      if (name === 'admins' && typeof admins !== 'undefined') admins = value;
    } catch (error) {
      console.warn('[admin data loader] legacy collection bridge', name, error);
    }
    window[name] = value;
  }

  async function loadCore() {
    if (typeof window.api !== 'function') throw new Error('API no disponible');

    const jobs = [];
    const indexes = {};
    const push = (key, promise) => {
      indexes[key] = jobs.length;
      jobs.push(promise);
    };

    if (accessCan('clients.read')) push('clients', window.api('/api/clients'));
    if (accessCan('logistics.read')) push('shipments', window.api('/api/shipments'));
    if (accessCan('administration.users.manage')) push('admins', window.api('/api/admins'));

    const results = await Promise.all(jobs);
    const clientRows = indexes.clients === undefined ? [] : (results[indexes.clients]?.clients || []);
    const shipmentRows = indexes.shipments === undefined ? [] : (results[indexes.shipments]?.shipments || []);
    const adminRows = indexes.admins === undefined ? [] : (results[indexes.admins]?.admins || []);

    setLegacyCollection('clients', clientRows);
    setLegacyCollection('shipments', shipmentRows);
    setLegacyCollection('admins', adminRows);

    if (accessCan('clients.read') && typeof window.renderClients === 'function') window.renderClients();
    if (accessCan('administration.users.manage') && typeof window.renderAdmins === 'function') window.renderAdmins();
    if (accessCan('clients.read') && typeof window.fillClientSelects === 'function') window.fillClientSelects();

    window.dispatchEvent(new CustomEvent('export-mca:data-loaded', {
      detail: { clients:clientRows, shipments:shipmentRows }
    }));

    return { clients:clientRows, shipments:shipmentRows, admins:adminRows };
  }

  async function loadDashboard() {
    if (!accessCan('dashboard.read')) return false;
    if (window.ExecutiveDashboard?.refresh) return window.ExecutiveDashboard.refresh();
    if (typeof window.api !== 'function') throw new Error('API no disponible');
    const data = await window.api('/api/dashboard');
    if (typeof window.renderStats === 'function') window.renderStats(data);
    return true;
  }

  async function loadAll() {
    const core = await loadCore();
    loadDashboard().catch(error => console.error('[admin dashboard refresh]', error));
    return core;
  }

  window.loadAll = loadAll;
  window.ExportMcaAdminData = Object.freeze({ loadCore, loadDashboard, loadAll, owner:'admin-data-loader.js' });
})();
