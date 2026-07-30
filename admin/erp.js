// Restored stable interface before company removal.
(() => {
  const removeLegacyAdminControls = () => {
    const waTestButton = document.getElementById('sendWaTest');
    const waTestCard = waTestButton?.closest('section.card');
    if (waTestCard) waTestCard.remove();

    document.getElementById('refresh')?.remove();
    document.getElementById('exportCsv')?.remove();
    document.getElementById('trackingAlertBell')?.remove();
    document.getElementById('trackingAlertPopover')?.remove();
    document.getElementById('dashboardTrackingAlerts')?.remove();
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

  // Single audited mobile controller. No global MutationObserver and no
  // duplicated onclick rebinding.
  loadScript('/admin/mobile-interaction-core.js?v=20260730-5', 'data-mobile-interaction-core');

  // One source of truth for dashboard operational cards.
  loadScript('/admin/dashboard-operational-state.js?v=20260730-2', 'data-dashboard-operational-state');

  loadScript('/admin/erp-core.js?v=20260730-loginfix1', 'data-erp-core', () => {
    loadScript('/admin/workers-module.js', 'data-workers-module', () => {
      loadScript('/admin/workers-responsive.js', 'data-workers-responsive');
      loadScript('/admin/workers-actions-menu.js', 'data-workers-actions-menu');
    });
    loadScript('/admin/client-extra-fields.js', 'data-client-extra-fields');
    loadScript('/admin/client-actions-menu.js', 'data-client-actions-menu');

    loadScript('/admin/separate-container-tracking.js', 'data-separate-container-tracking', () => {
      loadScript('/admin/section-state.js?v=20260730-loginfix1', 'data-section-state');
    });

    loadScript('/admin/responsive-columns-control.js', 'data-responsive-columns-control');
    loadScript('/admin/module-export-controls.js', 'data-module-export-controls');

    // Keep one operational alert center. The stability guard runs only after
    // the center has exposed its refresh function.
    loadScript('/admin/operational-alert-center.js?v=20260730-2', 'data-operational-alert-center', () => {
      loadScript('/admin/alert-phase2-stability.js?v=20260730-1', 'data-alert-phase2-stability');
    });

    loadScript('/admin/tracking-fallback.js', 'data-tracking-fallback', () => {
      loadScript('/admin/manual-tracking-switch.js', 'data-manual-tracking-switch', () => {
        loadScript('/admin/shipment-actions-menu.js', 'data-shipment-actions-menu', () => {
          loadScript('/admin/shipment-row-details.js', 'data-shipment-row-details');
        });
      });
    });
  });
})();