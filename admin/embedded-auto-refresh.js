(() => {
  if (window.parent !== window) {
    try {
      const parentWindow = window.parent;
      if (
        parentWindow.location.origin === window.location.origin &&
        !parentWindow.__exportMcaEmbeddedAutoRefreshLoaded &&
        !parentWindow.__exportMcaAutoRefreshBootstrapping
      ) {
        parentWindow.__exportMcaAutoRefreshBootstrapping = true;
        const script = parentWindow.document.createElement('script');
        script.src = '/admin/embedded-auto-refresh.js?v=20260904-live1';
        script.onload = () => { parentWindow.__exportMcaAutoRefreshBootstrapping = false; };
        script.onerror = () => { parentWindow.__exportMcaAutoRefreshBootstrapping = false; };
        parentWindow.document.head.appendChild(script);
      }
    } catch {}
    return;
  }

  if (window.__exportMcaEmbeddedAutoRefreshLoaded) return;
  window.__exportMcaEmbeddedAutoRefreshLoaded = true;

  const WRITE_METHODS = new Set(['POST','PUT','PATCH','DELETE']);
  const LAST_MUTATION_KEY = 'export_mca_last_mutation';
  const RELATED = {
    products: ['productsSection','purchasesSection','warehouseSection','inventorySection','loadsSection','salesSection','invoicesSection'],
    suppliers: ['suppliersSection','purchasesSection','warehouseSection','payablesSection','costsSection'],
    purchases: ['purchasesSection','warehouseSection','inventorySection','payablesSection','costsSection','loadsSection'],
    warehouse: ['warehouseSection','purchasesSection','inventorySection','loadsSection','costsSection'],
    inventory: ['inventorySection','loadsSection','salesSection','costsSection'],
    loads: ['loadsSection','inventorySection','salesSection','invoicesSection','costsSection'],
    sales: ['salesSection','invoicesSection','costsSection'],
    clients: ['salesSection','invoicesSection','publicationsSection'],
    shipments: ['loadsSection','salesSection','invoicesSection','costsSection'],
    publications: ['publicationsSection'],
    invoices: ['invoicesSection','costsSection','payablesSection'],
    payables: ['payablesSection','costsSection'],
    costs: ['costsSection']
  };
  const API_SCOPE = [
    ['/api/sales-loads','loads'],
    ['/api/shipments-register','shipments'],
    ['/api/manual-tracking-event','shipments'],
    ['/api/shipment-documents','shipments'],
    ['/api/direct-shipment-dispatch','shipments'],
    ['/api/customer-advances','sales'],
    ['/api/proformas','sales'],
    ['/api/invoice-payments','invoices'],
    ['/api/commercial-documents','invoices'],
    ['/api/supplier-payments','payables'],
    ['/api/publication-images','publications'],
    ['/api/tasks','tasks'],
    ['/api/workflow-routes','tasks'],
    ['/api/access-control','account'],
    ['/api/admins','account'],
    ['/api/account','account'],
    ['/api/products','products'],
    ['/api/suppliers','suppliers'],
    ['/api/clients','clients'],
    ['/api/purchases','purchases'],
    ['/api/warehouse','warehouse'],
    ['/api/inventory','inventory'],
    ['/api/loads','loads'],
    ['/api/sales','sales'],
    ['/api/shipments','shipments'],
    ['/api/publications','publications'],
    ['/api/invoices','invoices'],
    ['/api/payables','payables'],
    ['/api/costs','costs']
  ];
  const OP_CONTEXT_SECTION = {
    tracking:'containersSection',
    load:'loadsSection',
    wr:'inventorySection',
    receipt:'warehouseSection',
    po:'purchasesSection',
    so:'salesSection',
    supplier:'suppliersSection',
    client:'clientsSection',
    expediente:'newOperationsSection'
  };

  const state = new WeakMap();
  let shellRefreshTimer = null;
  let shellRefreshRunning = false;
  let shellRefreshQueued = false;
  let frameObserver = null;
  let lastResumeRefresh = 0;

  function normalizeMethod(input, init) {
    return String(init?.method || (input && typeof input === 'object' ? input.method : '') || 'GET').toUpperCase();
  }

  function requestPath(input) {
    try {
      if (typeof input === 'string') return new URL(input, location.href).pathname;
      if (input?.url) return new URL(input.url, location.href).pathname;
    } catch {}
    return '';
  }

  function scopeFor(path) {
    return API_SCOPE.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'))?.[1] || null;
  }

  function mutationScope(path){
    return scopeFor(path)||(path.startsWith('/api/')?'erp':null);
  }

  function visibleModal(doc) {
    return Boolean(doc?.querySelector('.modal:not(.hidden), [role="dialog"]:not(.hidden)'));
  }

  function visibleSectionId() {
    return document.querySelector('.app-section:not(.hidden)')?.id || null;
  }

  function frameSectionId(frame) {
    return frame?.closest?.('.app-section')?.id || null;
  }

  function clearStaleOperationalContext(sectionId = visibleSectionId()) {
    if (!sectionId || !location.hash) return false;
    const params = new URLSearchParams(location.hash.slice(1));
    const type = params.get('opnav');
    const id = params.get('id');
    if (!type || !id) return false;
    const expectedSection = OP_CONTEXT_SECTION[type];
    if (!expectedSection || expectedSection === sectionId) return false;

    const nextState = { ...(history.state || {}) };
    delete nextState.operationalContext;
    history.replaceState(nextState, '', `${location.pathname}${location.search}`);
    return true;
  }

  function frameRefresher(win) {
    const candidates = [
      win?.LoadsModule?.refresh,
      win?.InventoryModule?.load,
      win?.ProductsModule?.refresh,
      win?.SuppliersModule?.refresh,
      win?.InvoicesModule?.refresh,
      win?.PayablesModule?.refresh,
      win?.CostsModule?.refresh,
      win?.ExecutiveReports?.refresh,
      win?.PublicationsModule?.load,
      win?.WarehouseModule?.refresh,
      win?.PurchasesModule?.refresh,
      win?.SalesModule?.refresh,
      win?.load
    ];
    return candidates.find(candidate=>typeof candidate==='function')||null;
  }

  async function runShellRefresh(reason,scope) {
    if(shellRefreshRunning){shellRefreshQueued=true;return;}
    shellRefreshRunning=true;
    try{
      const loader=window.ExportMcaAdminData;
      if(typeof loader?.loadCore==='function')await loader.loadCore();
      if(typeof loader?.loadDashboard==='function')await loader.loadDashboard();
      window.dispatchEvent(new CustomEvent('export-mca:mutation-settled',{detail:{reason,scope}}));
    }catch(error){
      console.warn('[auto-refresh] shell refresh failed',scope,error);
    }finally{
      shellRefreshRunning=false;
      if(shellRefreshQueued){shellRefreshQueued=false;scheduleShellRefresh('queued',scope);}
    }
  }

  function scheduleShellRefresh(reason,scope) {
    clearTimeout(shellRefreshTimer);
    shellRefreshTimer=setTimeout(()=>runShellRefresh(reason,scope),140);
  }

  function refreshFrame(frame, reason = 'auto') {
    const current = state.get(frame);
    if (!current) return;
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc?.body) return;
    if (visibleModal(doc)) {
      current.pending = true;
      return;
    }
    current.pending = false;
    clearTimeout(current.timer);
    current.timer = setTimeout(async () => {
      try {
        const refresh=frameRefresher(win);
        if(refresh)await refresh();
        win.dispatchEvent(new win.CustomEvent('export-mca:auto-refreshed', { detail:{ reason } }));
      } catch (error) {
        console.warn('[auto-refresh] refresh failed', frame.title || frame.src, error);
      }
    }, 100);
  }

  function refreshSections(sectionIds, sourceFrame, reason) {
    for (const id of [...new Set(sectionIds || [])]) {
      const frame = document.querySelector(`#${CSS.escape(id)} iframe`);
      if (!frame || frame === sourceFrame) continue;
      refreshFrame(frame, reason);
    }
  }

  function announceMutation(scope, sourceFrame) {
    if (!scope) return;
    clearStaleOperationalContext(frameSectionId(sourceFrame));
    refreshSections(RELATED[scope] || [], sourceFrame, `mutation:${scope}`);
    if(sourceFrame)refreshFrame(sourceFrame, `mutation:${scope}:self`);
    window.dispatchEvent(new CustomEvent('export-mca:mutation-committed',{detail:{scope}}));
    scheduleShellRefresh(`mutation:${scope}`,scope);
    try{localStorage.setItem(LAST_MUTATION_KEY,JSON.stringify({scope,at:Date.now()}));}catch{}
  }

  function installTopFetchObserver() {
    if(window.__exportMcaAutoRefreshTopFetchWrapped)return;
    const original=window.fetch?.bind(window);
    if(!original)return;
    window.__exportMcaAutoRefreshTopFetchWrapped=true;
    window.fetch=async(input,init={})=>{
      const method=normalizeMethod(input,init);
      const path=requestPath(input);
      const response=await original(input,init);
      if(response.ok&&WRITE_METHODS.has(method))announceMutation(mutationScope(path),null);
      return response;
    };
  }

  function installFetchObserver(frame) {
    const win = frame.contentWindow;
    if (!win || win.__exportMcaAutoRefreshFetchWrapped) return;
    const original = win.fetch?.bind(win);
    if (!original) return;
    win.__exportMcaAutoRefreshFetchWrapped = true;
    win.fetch = async (input, init = {}) => {
      const method = normalizeMethod(input, init);
      const path = requestPath(input);
      const response = await original(input, init);
      if (response.ok && WRITE_METHODS.has(method)) announceMutation(mutationScope(path), frame);
      return response;
    };
  }

  function installModalObserver(frame) {
    const current = state.get(frame);
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!current || !win || !doc?.body) return;
    current.wasBusy = visibleModal(doc);
    current.observer?.disconnect?.();
    const Observer = win.MutationObserver || MutationObserver;
    current.observer = new Observer(() => {
      const busy = visibleModal(doc);
      if (current.wasBusy && !busy) refreshFrame(frame, current.pending ? 'close-after-change' : 'modal-close');
      current.wasBusy = busy;
    });
    current.observer.observe(doc.body, { attributes:true, attributeFilter:['class'], childList:true, subtree:true });
  }

  function installFrame(frame) {
    if (!frame?.contentWindow || !frame.contentDocument?.body) return;
    const old = state.get(frame);
    if(old?.document===frame.contentDocument&&frame.contentWindow.__exportMcaAutoRefreshFetchWrapped)return;
    old?.observer?.disconnect?.();
    clearTimeout(old?.timer);
    state.set(frame, { pending:false, timer:null, observer:null, wasBusy:false, document:frame.contentDocument });
    installFetchObserver(frame);
    installModalObserver(frame);
  }

  function installAll() {
    clearStaleOperationalContext();
    installTopFetchObserver();
    document.querySelectorAll('.app-section iframe').forEach(frame => {
      if (frame.contentDocument?.readyState === 'complete') installFrame(frame);
      if (!frame.__exportMcaAutoRefreshLoadBound) {
        frame.__exportMcaAutoRefreshLoadBound = true;
        frame.addEventListener('load', () => installFrame(frame));
      }
    });
    if(!frameObserver&&document.body){
      frameObserver=new MutationObserver(records=>{
        const addedFrame=records.some(record=>[...(record.addedNodes||[])].some(node=>
          node?.matches?.('.app-section iframe')||node?.querySelector?.('.app-section iframe')
        ));
        if(addedFrame)installAll();
      });
      frameObserver.observe(document.body,{childList:true,subtree:true});
    }
  }

  function onSectionOpened(sectionId) {
    if (!sectionId) return;
    clearStaleOperationalContext(sectionId);
    const frame = document.querySelector(`#${CSS.escape(sectionId)} iframe`);
    if(frame&&!state.has(frame))installFrame(frame);
    if (frame) refreshFrame(frame, 'section-open');
    scheduleShellRefresh('section-open',null);
  }

  function refreshAfterResume(reason){
    const now=Date.now();
    if(now-lastResumeRefresh<1000)return;
    lastResumeRefresh=now;
    const sectionId=visibleSectionId();
    const frame=sectionId?document.querySelector(`#${CSS.escape(sectionId)} iframe`):null;
    if(frame&&!state.has(frame))installFrame(frame);
    if(frame)refreshFrame(frame,reason);
    scheduleShellRefresh(reason,null);
  }

  window.addEventListener('export-mca:data-loaded', () => clearStaleOperationalContext(), true);
  window.addEventListener('export-mca:section-changed', event => onSectionOpened(event.detail?.id));
  window.addEventListener('export-mca:navigation-shell-changed',installAll);
  window.addEventListener('focus',()=>refreshAfterResume('window-focus'));
  window.addEventListener('storage',event=>{
    if(event.key!==LAST_MUTATION_KEY||!event.newValue)return;
    let scope=null;
    try{scope=JSON.parse(event.newValue)?.scope||null;}catch{}
    refreshSections(RELATED[scope]||[],null,`cross-tab:${scope||'change'}`);
    refreshAfterResume('cross-tab-change');
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAfterResume('tab-visible');});
  window.addEventListener('pageshow', installAll);
  window.ExportMcaEmbeddedAutoRefresh = Object.freeze({ installAll, onSectionOpened, refreshFrame, announceMutation, clearStaleOperationalContext });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installAll, { once:true });
  else installAll();
})();
