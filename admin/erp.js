(() => {
  const loadScript = (src, marker, onload) => {
    if (document.querySelector(`script[${marker}]`)) return onload?.();
    const script = document.createElement('script');
    script.src = src;
    script.setAttribute(marker, 'true');
    script.onload = () => onload?.();
    document.head.appendChild(script);
  };

  loadScript('/admin/erp-core.js', 'data-erp-core', () => {
    loadScript('/admin/workers-module.js', 'data-workers-module');
  });
})();