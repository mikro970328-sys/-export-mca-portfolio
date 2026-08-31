(() => {
  'use strict';
  if (window.__adminDataLoaderInstalled) return;
  window.__adminDataLoaderInstalled = true;

  const accessCan = permission => window.ExportMcaAccessControl?.can?.(permission) === true;
  const tokenValue = () => localStorage.getItem('export_mca_token') || '';

  function request(path, options={}) {
    if (typeof window.api === 'function') return window.api(path, options);
    return fetch(path, {
      ...options,
      headers:{
        'Content-Type':'application/json',
        ...(tokenValue() ? { Authorization:`Bearer ${tokenValue()}` } : {}),
        ...(options.headers || {})
      }
    }).then(async response => {
      const data=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(data.error || data.details || `HTTP ${response.status}`);
      return data;
    });
  }

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

  async function settled(key, promise) {
    try { return { key, ok:true, value:await promise }; }
    catch (error) { console.error(`[admin data loader] ${key}`, error); return { key, ok:false, error }; }
  }

  async function loadCore() {
    const jobs = [];
    if (accessCan('clients.read')) jobs.push(settled('clients', request('/api/clients')));
    if (accessCan('logistics.read')) jobs.push(settled('shipments', request('/api/shipments')));
    if (accessCan('administration.users.manage')) jobs.push(settled('admins', request('/api/admins')));

    const results = await Promise.all(jobs);
    const byKey = new Map(results.map(result => [result.key,result]));
    const clientPayload = byKey.get('clients')?.ok ? byKey.get('clients').value : null;
    const shipmentPayload = byKey.get('shipments')?.ok ? byKey.get('shipments').value : null;
    const adminPayload = byKey.get('admins')?.ok ? byKey.get('admins').value : null;
    const clientRows = clientPayload?.clients || window.clients || [];
    const shipmentRows = shipmentPayload?.shipments || window.shipments || [];
    const adminRows = adminPayload?.admins || window.admins || [];

    window.shipmentWriteAccess = shipmentPayload ? shipmentPayload.write_access === true : window.shipmentWriteAccess === true;
    setLegacyCollection('clients', Array.isArray(clientRows) ? clientRows : []);
    setLegacyCollection('shipments', Array.isArray(shipmentRows) ? shipmentRows : []);
    setLegacyCollection('admins', Array.isArray(adminRows) ? adminRows : []);

    try { if (accessCan('clients.read') && typeof window.renderClients === 'function') window.renderClients(); }
    catch (error) { console.error('[admin data loader] render clients',error); }
    try { if (accessCan('administration.users.manage') && typeof window.renderAdmins === 'function') window.renderAdmins(); }
    catch (error) { console.error('[admin data loader] render admins',error); }
    try { if (accessCan('clients.read') && typeof window.fillClientSelects === 'function') window.fillClientSelects(); }
    catch (error) { console.error('[admin data loader] fill client selects',error); }

    const errors = results.filter(result => !result.ok).map(result => ({ key:result.key, message:String(result.error?.message || 'No disponible') }));
    window.dispatchEvent(new CustomEvent('export-mca:data-loaded', {
      detail: { clients:window.clients || [], shipments:window.shipments || [], shipment_write_access:window.shipmentWriteAccess === true, errors }
    }));

    return { clients:window.clients || [], shipments:window.shipments || [], admins:window.admins || [], shipment_write_access:window.shipmentWriteAccess === true, errors };
  }

  async function loadDashboard() {
    if (!accessCan('dashboard.read')) return false;
    if (window.ExecutiveDashboard?.refresh) return window.ExecutiveDashboard.refresh();
    const data = await request('/api/dashboard');
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
