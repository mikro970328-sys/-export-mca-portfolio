(() => {
  if (window.__financialTraceabilityDedupeInstalled) return;
  window.__financialTraceabilityDedupeInstalled = true;

  function dedupeSalesContext(doc) {
    if (!doc) return;
    const nodes = [...doc.querySelectorAll('#salesFinancialContext')];
    if (nodes.length <= 1) return;
    nodes.slice(0, -1).forEach(node => node.remove());
  }

  function attachSalesFrame() {
    const frame = document.querySelector('#salesSection iframe');
    if (!frame) return;

    const install = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc || doc.__financialTraceabilityDedupeObserver) return;
        const target = doc.getElementById('detailBody') || doc.body;
        if (!target) return;
        dedupeSalesContext(doc);
        const observer = new MutationObserver(() => dedupeSalesContext(doc));
        observer.observe(target, { childList:true, subtree:false });
        doc.__financialTraceabilityDedupeObserver = observer;
      } catch (error) {
        console.error('[financial traceability dedupe]', error);
      }
    };

    if (frame.contentDocument?.readyState === 'complete') install();
    else frame.addEventListener('load', install, { once:true });
  }

  attachSalesFrame();
  window.addEventListener('export-mca:section-changed', attachSalesFrame);
})();
