(() => {
  const SECTION_KEY = 'export_mca_current_section';
  const DYNAMIC_SECTION_KEY = 'export_mca_dynamic_section';
  const savedSection = localStorage.getItem(DYNAMIC_SECTION_KEY) || localStorage.getItem(SECTION_KEY);
  const appShell = document.getElementById('appShell');

  if (appShell && savedSection && savedSection !== 'dashboardSection') {
    appShell.style.setProperty('display', 'none', 'important');
    appShell.style.visibility = 'hidden';
    window.__sectionRestorePending = true;
  }

  const removeLegacyAdminControls = () => {
    const waTestButton = document.getElementById('sendWaTest');
    const waTestCard = waTestButton?.closest('section.card');
    if (waTestCard) waTestCard.remove();

    const refreshButton = document.getElementById('refresh');
    if (refreshButton) refreshButton.remove();
  };

  const loadScript = (src, marker, onload) => {
    if (document.querySelector(`script[${marker}]`)) return onload?.();
    const script = document.createElement('script');
    script.src = src;
    script.setAttribute(marker, 'true');
    script.onload = () => onload?.();
    document.head.appendChild(script);
  };

  removeLegacyAdminControls();

  loadScript('/admin/erp-core.js', 'data-erp-core', () => {
    loadScript('/admin/workers-module.js', 'data-workers-module', () => {
      loadScript('/admin/workers-responsive.js', 'data-workers-responsive');
      loadScript('/admin/workers-actions-menu.js', 'data-workers-actions-menu');
    });
    loadScript('/admin/client-extra-fields.js', 'data-client-extra-fields');

    // Registrar contenedor is created dynamically. Build it first, then restore
    // the saved section, so the app never renders Inicio as an intermediate state.
    loadScript('/admin/separate-container-tracking.js', 'data-separate-container-tracking', () => {
      loadScript('/admin/section-state.js', 'data-section-state');
    });

    loadScript('/admin/responsive-columns-control.js', 'data-responsive-columns-control');
    loadScript('/admin/module-export-controls.js', 'data-module-export-controls');
    loadScript('/admin/tracking-fallback.js', 'data-tracking-fallback', () => {
      loadScript('/admin/manual-tracking-switch.js', 'data-manual-tracking-switch', () => {
        loadScript('/admin/shipment-actions-menu.js', 'data-shipment-actions-menu', () => {
          loadScript('/admin/shipment-row-details.js', 'data-shipment-row-details');
        });
      });
    });
  });
})();