(() => {
  try {
    if (!document.querySelector('script[data-payables-payment-ux]')) {
      const ux = document.createElement('script');
      ux.src = '/admin/payables-payment-ux.js?v=20260828-1';
      ux.dataset.payablesPaymentUx = 'true';
      ux.async = false;
      ux.onerror = () => console.error('[ap payment UX bootstrap] No se pudo cargar la mejora de pagos.');
      (document.head || document.documentElement).appendChild(ux);
    }

    if (parent === window || parent.APTraceability) return;
    const doc = parent.document;
    if (doc.querySelector('script[data-ap-traceability]')) return;
    const script = doc.createElement('script');
    script.src = '/admin/ap-traceability.js';
    script.dataset.apTraceability = 'true';
    script.async = false;
    script.onerror = () => console.error('[ap traceability bootstrap] No se pudo cargar el propietario AP.');
    (doc.head || doc.documentElement).appendChild(script);
  } catch (error) {
    console.error('[ap traceability bootstrap]', error);
  }
})();
