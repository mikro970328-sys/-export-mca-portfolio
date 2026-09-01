(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('embedded') !== '1') return;
  if (window.__warehouseEmbeddedPresentationInstalled) return;
  window.__warehouseEmbeddedPresentationInstalled = true;

  document.body.classList.add('warehouse-embedded');

  const style = document.createElement('style');
  style.id = 'warehouseEmbeddedPresentationStyles';
  style.textContent = `
    body.warehouse-embedded .tab[data-tab="products"],
    body.warehouse-embedded #productsPane,
    body.warehouse-embedded #quickProductModal,
    body.warehouse-embedded .product-picker button {
      display:none !important;
    }
  `;
  document.head.appendChild(style);

  const replaceExactCopy = (from, to) => {
    document.querySelectorAll('.muted').forEach(node => {
      if (node.textContent?.trim() === from) node.textContent = to;
    });
  };

  replaceExactCopy(
    'Recepciones físicas, productos y ubicaciones.',
    'Recepciones físicas y ubicaciones de almacén.'
  );
  replaceExactCopy(
    'Selecciona un producto existente o créalo aquí sin salir del WR.',
    'Selecciona un producto existente del catálogo maestro. Los productos se administran en Administración → Productos.'
  );

  const productTab = document.querySelector('.tab[data-tab="products"]');
  if (productTab) {
    productTab.setAttribute('aria-hidden', 'true');
    productTab.tabIndex = -1;
  }

  const productsPane = document.getElementById('productsPane');
  productsPane?.setAttribute('aria-hidden', 'true');
  document.getElementById('quickProductModal')?.setAttribute('aria-hidden', 'true');

  window.WarehouseEmbeddedPresentation = Object.freeze({
    embedded: true,
    owner: 'warehouse-embedded.js'
  });
})();
