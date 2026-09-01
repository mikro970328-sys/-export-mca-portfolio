(() => {
  const button = document.getElementById('newOrder');
  if (!button || typeof load !== 'function' || typeof openOrder !== 'function') return;

  button.onclick = async () => {
    const label = button.textContent;
    try {
      button.disabled = true;
      button.textContent = 'Actualizando…';
      await load();
      openOrder();
    } catch (error) {
      console.error('PURCHASES_MASTER_REFRESH_FAILED', { error });
      const target = document.getElementById('orderList');
      const message = typeof safePurchaseMessage === 'function' ? safePurchaseMessage(error, 'No se pudieron actualizar los proveedores. Intenta nuevamente.') : 'No se pudieron actualizar los proveedores. Intenta nuevamente.';
      if (target) target.innerHTML = `<div class="empty">${typeof esc === 'function' ? esc(message) : 'No se pudieron actualizar los proveedores. Intenta nuevamente.'}</div>`;
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  };
})();
