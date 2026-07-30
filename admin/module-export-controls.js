(() => {
  if (window.__moduleExportControlsInstalled) return;
  window.__moduleExportControlsInstalled = true;

  const exportUrl = mode => `/api/export?mode=${encodeURIComponent(mode)}&token=${encodeURIComponent(window.token || localStorage.getItem('export_mca_token') || '')}`;

  function makeButton(mode, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'alt module-export-btn';
    button.dataset.exportMode = mode;
    button.textContent = label;
    button.onclick = () => window.open(exportUrl(mode), '_blank');
    return button;
  }

  function addToHeading(sectionId, headingText, mode, label) {
    const section = document.getElementById(sectionId);
    if (!section || section.querySelector(`[data-export-mode="${mode}"]`)) return;
    const heading = [...section.querySelectorAll('h2,h3')].find(el => String(el.textContent || '').trim().toLowerCase() === headingText.toLowerCase());
    if (!heading) return;
    let toolbar = heading.closest('.toolbar,.section-head');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'toolbar';
      heading.parentNode.insertBefore(toolbar, heading);
      toolbar.appendChild(heading);
    }
    toolbar.appendChild(makeButton(mode, label));
  }

  function install() {
    const globalButton = document.getElementById('exportCsv');
    if (globalButton) globalButton.remove();

    addToHeading('clientsSection', 'Clientes registrados', 'clients', 'Exportar clientes');
    addToHeading('containersSection', 'Tracking', 'shipments', 'Exportar tracking');
    addToHeading('newOperationsSection', 'Expedientes', 'operations', 'Exportar expedientes');
    addToHeading('notificationsSection', 'Centro de notificaciones', 'notifications', 'Exportar historial');
  }

  install();
  const observer = new MutationObserver(install);
  observer.observe(document.body, { childList: true, subtree: true });
})();
