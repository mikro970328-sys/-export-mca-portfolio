(() => {
  if (window.__exportMcaEmbeddedAutoRefreshLoaded) return;
  window.__exportMcaEmbeddedAutoRefreshLoaded = true;

  const WRITE_METHODS = new Set(['POST','PUT','PATCH','DELETE']);
  const RELATED = {
    products: ['productsSection','purchasesSection','warehouseSection','inventorySection','loadsSection','salesSection','invoicesSection'],
    suppliers: ['suppliersSection','purchasesSection','warehouseSection','payablesSection','costsSection'],
    purchases: ['purchasesSection','warehouseSection','inventorySection','payablesSection','costsSection','loadsSection'],
    warehouse: ['warehouseSection','purchasesSection','inventorySection','loadsSection','costsSection'],
    inventory: ['inventorySection','loadsSection','salesSection','costsSection'],
    loads: ['loadsSection','inventorySection','salesSection','invoicesSection','costsSection'],
    sales: ['salesSection','invoicesSection','costsSection'],
    invoices: ['invoicesSection','costsSection','payablesSection'],
    payables: ['payablesSection','costsSection'],
    costs: ['costsSection']
  };
  const API_SCOPE = [
    ['/api/products','products'],
    ['/api/suppliers','suppliers'],
    ['/api/purchases','purchases'],
    ['/api/warehouse','warehouse'],
    ['/api/inventory','inventory'],
    ['/api/loads','loads'],
    ['/api/sales','sales'],
    ['/api/invoices','invoices'],
    ['/api/payables','payables'],
    ['/api/costs','costs']
  ];

  const state = new WeakMap();

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

  function visibleModal(doc) {
    return Boolean(doc?.querySelector('.modal:not(.hidden), [role="dialog"]:not(.hidden)'));
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
        if (typeof win.load === 'function') await win.load();
        win.dispatchEvent(new CustomEvent('export-mca:auto-refreshed', { detail:{ reason } }));
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
    refreshSections(RELATED[scope] || [], sourceFrame, `mutation:${scope}`);
    const sourceState = state.get(sourceFrame);
    if (sourceState) sourceState.pending = true;
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
      if (response.ok && WRITE_METHODS.has(method)) announceMutation(scopeFor(path), frame);
      return response;
    };
  }

  function installModalObserver(frame) {
    const current = state.get(frame);
    const doc = frame.contentDocument;
    if (!current || !doc?.body) return;
    current.wasBusy = visibleModal(doc);
    current.observer?.disconnect?.();
    current.observer = new MutationObserver(() => {
      const busy = visibleModal(doc);
      if (current.wasBusy && !busy) refreshFrame(frame, current.pending ? 'close-after-change' : 'modal-close');
      current.wasBusy = busy;
    });
    current.observer.observe(doc.body, { attributes:true, attributeFilter:['class'], childList:true, subtree:true });
  }

  function installFrame(frame) {
    if (!frame?.contentWindow || !frame.contentDocument?.body) return;
    const old = state.get(frame);
    old?.observer?.disconnect?.();
    clearTimeout(old?.timer);
    state.set(frame, { pending:false, timer:null, observer:null, wasBusy:false });
    installFetchObserver(frame);
    installModalObserver(frame);
  }

  function installAll() {
    document.querySelectorAll('.app-section iframe').forEach(frame => {
      if (frame.contentDocument?.readyState === 'complete') installFrame(frame);
      if (!frame.__exportMcaAutoRefreshLoadBound) {
        frame.__exportMcaAutoRefreshLoadBound = true;
        frame.addEventListener('load', () => installFrame(frame));
      }
    });
  }

  function onSectionOpened(sectionId) {
    const frame = document.querySelector(`#${CSS.escape(sectionId)} iframe`);
    if (frame) refreshFrame(frame, 'section-open');
  }

  window.ExportMcaEmbeddedAutoRefresh = Object.freeze({ installAll, onSectionOpened, refreshFrame });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installAll, { once:true });
  else installAll();
})();
