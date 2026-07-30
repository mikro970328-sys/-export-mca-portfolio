(() => {
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
    loadScript('/admin/workers-module.js', 'data-workers-module');
    loadScript('/admin/tracking-fallback.js', 'data-tracking-fallback', () => {
      loadScript('/admin/manual-tracking-switch.js', 'data-manual-tracking-switch');
    });
  });
})();