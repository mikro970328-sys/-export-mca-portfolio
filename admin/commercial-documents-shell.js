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
    if (path.endsWith('/invoices.html')) {
      inject(win.document, 'b7-invoice-expediente', '/admin/invoice-expediente.js');
      inject(win.document, 'b7-invoice-documents', '/admin/commercial-documents-invoices.js');
    }
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
    ['invoicesSection', 'b7-invoice-expediente', '/admin/invoice-expediente.js'],
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

  function installGeneratedStyles() {
    if (document.getElementById('b7-generated-document-styles')) return;
    const style = document.createElement('style');
    style.id = 'b7-generated-document-styles';
    style.textContent = '.exp-doc-generated{display:inline-flex;margin-left:6px;padding:3px 6px;border-radius:999px;background:#eef8f0;color:#176b34;font-size:10px;font-weight:900;vertical-align:middle}.exp-doc-row[data-generated="true"]{border-left:3px solid #9ac9a7;padding-left:10px}';
    document.head.appendChild(style);
  }

  function enhanceGeneratedDocuments() {
    const documents = window.ExpedientesModule?.getState?.().documents || [];
    if (!Array.isArray(documents) || !documents.length) return;
    const generated = new Map(documents.filter(item => item?.generated).map(item => [String(item.id), item]));
    if (!generated.size) return;
    installGeneratedStyles();

    document.querySelectorAll('.exp-doc-row').forEach(row => {
      const deleteButton = row.querySelector('[data-delete-document]');
      const existingId = row.dataset.generatedDocumentId || '';
      const documentId = deleteButton?.dataset.deleteDocument || existingId;
      const item = generated.get(String(documentId || ''));
      if (!item) return;

      row.dataset.generated = 'true';
      row.dataset.generatedDocumentId = String(item.id);
      const title = row.firstElementChild;
      if (title && !title.querySelector('.exp-doc-generated')) {
        const badge = document.createElement('span');
        badge.className = 'exp-doc-generated';
        badge.textContent = 'GENERADO';
        badge.title = item.content_sha256 ? `Documento automático · SHA-256 ${item.content_sha256}` : 'Documento automático e inmutable';
        title.appendChild(badge);
      }
      deleteButton?.remove();
    });
  }

  function installAll() {
    configs.forEach(config => installFrame(...config));
    enhanceGeneratedDocuments();
  }

  installAll();
  const observer = new MutationObserver(() => enhanceGeneratedDocuments());
  observer.observe(document.body, { childList:true, subtree:true });
  window.addEventListener('pageshow', installAll);
  window.addEventListener('export-mca:section-changed', installAll);
  window.addEventListener('export-mca:data-loaded', enhanceGeneratedDocuments);
})();
