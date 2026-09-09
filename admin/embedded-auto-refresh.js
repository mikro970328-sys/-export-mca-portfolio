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
        script.src = '/admin/embedded-auto-refresh.js?v=20260909-live4';
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
  const LIVE_SYNC_PATH = '/api/live-updates';
  const LIVE_SYNC_VISIBLE_MS = 4000;
  const LIVE_SYNC_HIDDEN_MS = 15000;
  const LIVE_SYNC_MAX_BACKOFF_MS = 60000;
  const LIVE_SYNC_TIMEOUT_MS = 12000;
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
    costs: ['costsSection'],
    tasks: [],
    notifications: [],
    account: [],
    workers: []
  };
  const ALL_RELATED_SECTIONS = [...new Set(Object.values(RELATED).flat())];
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
  let livePollTimer = null;
  let liveRequest = null;
  let liveSyncEnabled = false;
  let liveSessionToken = '';
  let livePollFailures = 0;
  let liveVersions = null;
  let pendingExternalReason = 'live-change';
  const pendingExternalScopes = new Set();

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

  function callNativeRefresh(label, refresh) {
    if(typeof refresh!=='function')return null;
    try{
      return Promise.resolve(refresh()).catch(error=>console.warn(`[live-sync] ${label} refresh failed`,error));
    }catch(error){
      console.warn(`[live-sync] ${label} refresh failed`,error);
      return null;
    }
  }

  function refreshNativeScopes(scopes) {
    const wanted=new Set(scopes||[]);
    const all=wanted.has('erp');
    const jobs=[];
    const add=(label,refresh)=>{const job=callNativeRefresh(label,refresh);if(job)jobs.push(job);};
    if(all||wanted.has('tasks'))add('tasks',()=>window.TasksWorkspace?.load?.());
    if(all||wanted.has('notifications'))add('alerts',()=>window.OperationalAlertCenter?.load?.());
    if(all||wanted.has('workers'))add('workers',()=>window.WorkersModule?.load?.());
    if(all||wanted.has('account')){
      add('access',()=>window.ExportMcaAccessControl?.initialize?.());
      add('account',()=>window.ExportMcaAccountAdministration?.refresh?.());
    }
    return Promise.allSettled(jobs);
  }

  function flushExternalScopes() {
    if(!pendingExternalScopes.size||visibleModal(document))return false;
    const scopes=[...pendingExternalScopes];
    pendingExternalScopes.clear();
    const sectionIds=scopes.includes('erp')
      ? ALL_RELATED_SECTIONS
      : scopes.flatMap(scope=>RELATED[scope]||[]);
    refreshSections(sectionIds,null,`${pendingExternalReason}:${scopes.join(',')}`);
    refreshNativeScopes(scopes);
    scheduleShellRefresh(pendingExternalReason,scopes.join(','));
    window.dispatchEvent(new CustomEvent('export-mca:external-change',{detail:{reason:pendingExternalReason,scopes}}));
    return true;
  }

  function queueExternalScopes(scopes, reason = 'live-change') {
    for(const scope of scopes||[])if(scope==='erp'||Object.hasOwn(RELATED,scope))pendingExternalScopes.add(scope);
    if(!pendingExternalScopes.size)return false;
    pendingExternalReason=reason;
    return flushExternalScopes();
  }

  function normalizeLiveVersions(payload) {
    if(!payload?.versions||typeof payload.versions!=='object'||Array.isArray(payload.versions)){
      throw new Error('LIVE_SYNC_INVALID_RESPONSE');
    }
    const normalized={};
    for(const [scope,value] of Object.entries(payload?.versions||{})){
      if(!Object.hasOwn(RELATED,scope))continue;
      const version=Number(value);
      if(!['number','string'].includes(typeof value)||value===''||!Number.isSafeInteger(version)||version<0)throw new Error('LIVE_SYNC_INVALID_VERSION');
      normalized[scope]=version;
    }
    if(!Object.keys(normalized).length)throw new Error('LIVE_SYNC_EMPTY_RESPONSE');
    return normalized;
  }

  function applyLiveSnapshot(payload) {
    const next=normalizeLiveVersions(payload);
    if(liveVersions===null){
      liveVersions=next;
      return [];
    }
    const changed=Object.keys(next).filter(scope=>
      !Object.hasOwn(liveVersions,scope)||liveVersions[scope]!==next[scope]
    );
    liveVersions=next;
    if(changed.length)queueExternalScopes(changed,'multiuser-change');
    return changed;
  }

  async function requestLiveSnapshot(request) {
    let timeout;
    const cancelled=new Promise((resolve,reject)=>{
      request.cancel=()=>{
        request.controller.abort();
        reject(new Error('LIVE_SYNC_CANCELLED'));
      };
      timeout=setTimeout(()=>{
        request.controller.abort();
        reject(new Error('LIVE_SYNC_TIMEOUT'));
      },LIVE_SYNC_TIMEOUT_MS);
    });
    try{
      // The deadline also covers a response body that never finishes loading.
      return await Promise.race([cancelled,(async()=>{
        const response=await fetch(LIVE_SYNC_PATH,{
          method:'GET',cache:'no-store',signal:request.controller.signal,
          headers:{Authorization:`Bearer ${request.token}`}
        });
        return {status:response.status,ok:response.ok,payload:response.ok?await response.json():null};
      })()]);
    }finally{
      clearTimeout(timeout);
    }
  }

  function currentLiveRequest(request) {
    return liveSyncEnabled&&liveRequest===request&&liveSessionToken===request.token
      &&localStorage.getItem('export_mca_token')===request.token;
  }

  function pauseLiveSync() {
    clearTimeout(livePollTimer);
    livePollTimer=null;
    const request=liveRequest;
    liveRequest=null;
    request?.cancel?.();
  }

  function livePollDelay() {
    const base=document.hidden?LIVE_SYNC_HIDDEN_MS:LIVE_SYNC_VISIBLE_MS;
    return Math.min(base*(2**Math.min(livePollFailures,4)),LIVE_SYNC_MAX_BACKOFF_MS);
  }

  function scheduleLivePoll(delay=livePollDelay()) {
    clearTimeout(livePollTimer);
    livePollTimer=null;
    if(!liveSyncEnabled||!liveSessionToken||window.navigator?.onLine===false
      ||localStorage.getItem('export_mca_token')!==liveSessionToken)return false;
    livePollTimer=setTimeout(pollLiveState,Math.max(0,delay));
    return true;
  }

  async function pollLiveState() {
    if(liveRequest||!liveSyncEnabled)return false;
    if(!localStorage.getItem('export_mca_token')){
      stopLiveSync();
      return false;
    }
    if(localStorage.getItem('export_mca_token')!==liveSessionToken)return startLiveSync(true);
    if(window.navigator?.onLine===false)return false;
    clearTimeout(livePollTimer);
    livePollTimer=null;
    const request={token:liveSessionToken,controller:new AbortController(),cancel:null};
    liveRequest=request;
    try{
      const response=await requestLiveSnapshot(request);
      if(!currentLiveRequest(request))return false;
      if(response.status===401){
        stopLiveSync();
        window.dispatchEvent(new CustomEvent('export-mca:live-sync-status',{detail:{status:'unauthorized'}}));
        window.ExportMcaAdminShellRuntime?.transitionExpiredSession?.('live_sync_unauthorized');
        return false;
      }
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const changed=applyLiveSnapshot(response.payload);
      livePollFailures=0;
      window.dispatchEvent(new CustomEvent('export-mca:live-sync-status',{detail:{status:'connected',changed}}));
      return true;
    }catch(error){
      if(!currentLiveRequest(request))return false;
      livePollFailures+=1;
      if(livePollFailures===1)console.warn('[live-sync] update check failed',error);
      window.dispatchEvent(new CustomEvent('export-mca:live-sync-status',{detail:{status:'retrying'}}));
      return false;
    }finally{
      // A cancelled request must never overwrite a newer session/request.
      if(liveRequest===request){
        liveRequest=null;
        if(liveSessionToken!==localStorage.getItem('export_mca_token'))startLiveSync(true);
        else scheduleLivePoll();
      }
    }
  }

  function startLiveSync(immediate=false) {
    const token=localStorage.getItem('export_mca_token')||'';
    if(!token){stopLiveSync();return false;}
    if(token!==liveSessionToken){
      stopLiveSync();
      liveSessionToken=token;
    }
    liveSyncEnabled=true;
    if(liveRequest||(!immediate&&livePollTimer!==null))return true;
    return scheduleLivePoll(immediate?0:livePollDelay());
  }

  function stopLiveSync() {
    liveSyncEnabled=false;
    liveSessionToken='';
    pauseLiveSync();
    livePollFailures=0;
    liveVersions=null;
    pendingExternalScopes.clear();
    clearTimeout(shellRefreshTimer);
    shellRefreshQueued=false;
    document.querySelectorAll('.app-section iframe').forEach(frame=>{
      const current=state.get(frame);
      if(!current)return;
      current.pending=false;
      clearTimeout(current.timer);
      clearTimeout(current.fallbackTimer);
    });
  }

  function scheduleSourceRefresh(frame,scope){
    const current=state.get(frame);
    if(!current)return;
    clearTimeout(current.fallbackTimer);
    current.fallbackTimer=setTimeout(()=>{
      current.fallbackTimer=null;
      refreshFrame(frame,`mutation:${scope}:source-fallback`);
    },400);
  }

  function announceMutation(scope, sourceFrame) {
    if (!scope) return;
    clearStaleOperationalContext(frameSectionId(sourceFrame));
    refreshSections(RELATED[scope] || [], sourceFrame, `mutation:${scope}`);
    if(sourceFrame)scheduleSourceRefresh(sourceFrame,scope);
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
      const current=state.get(frame);
      if(method==='GET'&&current?.fallbackTimer){clearTimeout(current.fallbackTimer);current.fallbackTimer=null;}
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
      if(current.wasBusy&&!busy&&current.pending)refreshFrame(frame,'close-after-change');
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
    clearTimeout(old?.fallbackTimer);
    state.set(frame, { pending:false, timer:null, fallbackTimer:null, observer:null, wasBusy:false, document:frame.contentDocument });
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
        if(pendingExternalScopes.size&&!visibleModal(document))flushExternalScopes();
      });
      frameObserver.observe(document.body,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});
    }
    startLiveSync();
  }

  function onSectionOpened(sectionId) {
    if (!sectionId) return;
    clearStaleOperationalContext(sectionId);
    const frame = document.querySelector(`#${CSS.escape(sectionId)} iframe`);
    if(frame&&!state.has(frame))installFrame(frame);
  }

  window.addEventListener('export-mca:data-loaded', () => clearStaleOperationalContext(), true);
  window.addEventListener('export-mca:section-changed', event => onSectionOpened(event.detail?.id));
  window.addEventListener('export-mca:navigation-shell-changed',installAll);
  window.addEventListener('storage',event=>{
    if(event.key==='export_mca_token'){
      if(event.newValue)startLiveSync(true);else stopLiveSync();
      return;
    }
    if(event.key!==LAST_MUTATION_KEY||!event.newValue)return;
    let scope=null;
    try{scope=JSON.parse(event.newValue)?.scope||null;}catch{}
    queueExternalScopes([scope||'erp'],'cross-tab-change');
  });
  window.addEventListener('export-mca:admin-ready',()=>startLiveSync(true));
  window.addEventListener('export-mca:session-ending',stopLiveSync);
  window.addEventListener('export-mca:auth-invalid',stopLiveSync);
  window.addEventListener('pagehide',pauseLiveSync);
  window.addEventListener('offline',()=>{
    pauseLiveSync();
    window.dispatchEvent(new CustomEvent('export-mca:live-sync-status',{detail:{status:'offline'}}));
  });
  window.addEventListener('online',()=>startLiveSync(true));
  window.addEventListener('pageshow',()=>{installAll();startLiveSync(true);});
  window.ExportMcaEmbeddedAutoRefresh = Object.freeze({
    installAll,onSectionOpened,refreshFrame,announceMutation,clearStaleOperationalContext,
    applyLiveSnapshot,pollLiveState,startLiveSync,stopLiveSync,queueExternalScopes
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installAll, { once:true });
  else installAll();
})();
