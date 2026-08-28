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
      const target = document.getElementById('orderList');
      if (target) target.innerHTML = `<div class="empty">${typeof esc === 'function' ? esc(error?.message || 'No se pudieron actualizar los proveedores.') : 'No se pudieron actualizar los proveedores.'}</div>`;
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  };
})();
