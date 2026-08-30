(() => {
  if (window.parent === window) return;
  try {
    const doc = window.parent.document;
    if (!doc) return;

    if (!doc.querySelector('script[data-financial-traceability]')) {
      const script = doc.createElement('script');
      script.src = '/admin/financial-traceability.js?v=20260822-b45';
      script.dataset.financialTraceability = 'true';
      script.async = false;
      script.onerror = () => console.error('[financial traceability] No se pudo cargar el propietario de trazabilidad financiera.');
      (doc.head || doc.documentElement).appendChild(script);
    }

    if (!doc.querySelector('script[data-financial-traceability-dedupe]')) {
      const guard = doc.createElement('script');
      guard.src = '/admin/financial-traceability-dedupe.js?v=20260830-1';
      guard.dataset.financialTraceabilityDedupe = 'true';
      guard.async = false;
      guard.onerror = () => console.error('[financial traceability] No se pudo cargar la protección anti-duplicados.');
      (doc.head || doc.documentElement).appendChild(guard);
    }
  } catch (error) {
    console.error('[financial traceability loader]', error);
  }
})();
