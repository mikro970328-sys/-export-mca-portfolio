(() => {
  if (!window.__exportMcaAutoRefreshChildBootstrapped) {
    window.__exportMcaAutoRefreshChildBootstrapped = true;
    const coordinator = document.createElement('script');
    coordinator.src = '/admin/embedded-auto-refresh.js';
    coordinator.async = true;
    document.head.appendChild(coordinator);
  }

  if (typeof addLine !== 'function' || typeof api !== 'function' || typeof productOptions !== 'function') return;

  let targetLine = null;
  const originalAddLine = addLine;

  function enhanceLine(line) {
    if (!line || line.dataset.productCatalogEnhanced === '1') return;
    line.dataset.productCatalogEnhanced = '1';
    const select = line.querySelector('.lProduct');
    if (!select) return;
    const field = select.parentElement;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn product-create-inline';
    button.textContent = '+ Nuevo producto';
    button.style.marginTop = '7px';
    button.onclick = () => openQuickProduct(line);
    field.appendChild(button);
  }

  addLine = function(seed = {}) {
    originalAddLine(seed);
    enhanceLine(document.querySelector('#orderLines .line:last-child'));
  };

  function clearQuickForm() {
    ['qpSku','qpName','qpBrand','qpCategory','qpFormat','qpUnitsPallet','qpOrigin','qpHs'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const unit = document.getElementById('qpUnit');
    if (unit) unit.value = 'unidades';
    const msg = document.getElementById('quickProductMsg');
    if (msg) msg.textContent = '';
  }

  function openQuickProduct(line) {
    targetLine = line || null;
    clearQuickForm();
    document.getElementById('quickProductModal')?.classList.remove('hidden');
    document.getElementById('qpName')?.focus();
  }

  function closeQuickProduct() {
    document.getElementById('quickProductModal')?.classList.add('hidden');
    targetLine = null;
  }

  async function refreshProductSelectors(newProductId) {
    const data = await api('/api/products');
    products = (data.products || []).filter(product => product.active !== false);
    document.querySelectorAll('#orderLines .line').forEach(line => {
      const select = line.querySelector('.lProduct');
      if (!select) return;
      const selected = line === targetLine && newProductId ? newProductId : select.value;
      select.innerHTML = productOptions(selected);
      select.value = selected || '';
      if (typeof syncProduct === 'function') syncProduct(line);
    });
  }

  async function saveQuickProduct() {
    const button = document.getElementById('saveQuickProduct');
    const msg = document.getElementById('quickProductMsg');
    try {
      if (button) button.disabled = true;
      if (msg) msg.textContent = '';
      const body = {
        sku:document.getElementById('qpSku')?.value || '',
        name:document.getElementById('qpName')?.value || '',
        brand:document.getElementById('qpBrand')?.value || '',
        category:document.getElementById('qpCategory')?.value || '',
        unit:document.getElementById('qpUnit')?.value || 'unidades',
        package_format:document.getElementById('qpFormat')?.value || '',
        default_units_per_pallet:document.getElementById('qpUnitsPallet')?.value || '',
        country_of_origin:document.getElementById('qpOrigin')?.value || '',
        hs_code:document.getElementById('qpHs')?.value || ''
      };
      const created = await api('/api/products', { method:'POST', body:JSON.stringify(body) });
      if (!created.product?.id) throw new Error('No se pudo crear el producto');
      await refreshProductSelectors(created.product.id);
      closeQuickProduct();
    } catch (error) {
      if (msg) msg.textContent = error?.message || 'No se pudo crear el producto';
    } finally {
      if (button) button.disabled = false;
    }
  }

  document.getElementById('saveQuickProduct')?.addEventListener('click', saveQuickProduct);
  document.querySelectorAll('[data-close-quick-product]').forEach(button => button.addEventListener('click', closeQuickProduct));
  document.getElementById('quickProductModal')?.addEventListener('click', event => {
    if (event.target === document.getElementById('quickProductModal')) closeQuickProduct();
  });

  document.querySelectorAll('#orderLines .line').forEach(enhanceLine);
})();
