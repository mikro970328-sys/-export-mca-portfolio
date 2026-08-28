(() => {
  const inject = (doc, id, src) => {
    if (!doc?.head || doc.getElementById(id)) return;
    const script = doc.createElement('script');
    script.id = id;
    script.src = src;
    doc.head.appendChild(script);
  };

  function installDirect(win = window) {
    const path = win.location?.pathname || '';
    if (path.endsWith('/invoices.html')) inject(win.document, 'b7-invoice-documents', '/admin/commercial-documents-invoices.js');
    if (path.endsWith('/loads.html')) inject(win.document, 'b7-load-documents', '/admin/commercial-documents-loads.js');
  }

  if (window.parent !== window) {
    installDirect(window);
    try {
      const parentWindow = window.parent;
      if (parentWindow.location.origin === window.location.origin && !parentWindow.document.getElementById('b7-commercial-documents-shell')) {
        const script = parentWindow.document.createElement('script');
        script.id = 'b7-commercial-documents-shell';
        script.src = '/admin/commercial-documents-shell.js';
        parentWindow.document.head.appendChild(script);
      }
    } catch {}
    return;
  }

  if (window.__b7CommercialDocumentsShellInstalled) return;
  window.__b7CommercialDocumentsShellInstalled = true;

  const configs = [
    ['invoicesSection', 'b7-invoice-documents', '/admin/commercial-documents-invoices.js'],
    ['loadsSection', 'b7-load-documents', '/admin/commercial-documents-loads.js']
  ];

  function installFrame(sectionId, scriptId, src) {
    const frame = window.document.querySelector(`#${CSS.escape(sectionId)} iframe`);
    if (!frame) return;
    const install = () => {
      try { inject(frame.contentDocument, scriptId, src); } catch {}
    };
    if (frame.contentDocument?.readyState === 'complete') install();
    if (!frame.dataset.b7DocumentsLoadBound) {
      frame.dataset.b7DocumentsLoadBound = '1';
      frame.addEventListener('load', install);
    }
  }

  function installAll() {
    configs.forEach(config => installFrame(...config));
  }

  installAll();
  window.addEventListener('pageshow', installAll);
  window.addEventListener('export-mca:section-changed', installAll);
})();
