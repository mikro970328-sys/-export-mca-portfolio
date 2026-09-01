(() => {
  if (window.parent === window) return;
  try {
    const doc = window.parent.document;
    if (!doc || doc.querySelector('script[data-financial-traceability]')) return;

    const script = doc.createElement('script');
    script.src = '/admin/financial-traceability.js?v=20260901-ux6';
    script.dataset.financialTraceability = 'true';
    script.async = false;
    script.onerror = () => console.error('[financial traceability] No se pudo cargar la navegación financiera relacionada.');
    (doc.head || doc.documentElement).appendChild(script);
  } catch (error) {
    console.error('[financial traceability loader]', error);
  }
})();
