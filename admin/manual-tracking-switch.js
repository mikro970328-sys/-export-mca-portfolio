(() => {
  if (window.__manualTrackingSwitchInstalled) return;
  window.__manualTrackingSwitchInstalled = true;

  const token = () => localStorage.getItem('export_mca_token') || '';

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token()}`,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.details || 'Error');
    return data;
  }

  async function decorate() {
    const container = document.getElementById('shipments');
    if (!container || container.dataset.manualSwitchDecorating === '1') return;
    container.dataset.manualSwitchDecorating = '1';

    try {
      const data = await request('/api/shipments');
      const byNumber = new Map((data.shipments || []).map(s => [String(s.container_number || '').trim(), s]));

      container.querySelectorAll('tbody tr').forEach(row => {
        const number = row.querySelector('td:first-child b')?.textContent?.trim();
        const shipment = byNumber.get(number);
        const actions = row.querySelector('td:last-child .actions');
        if (!shipment || !actions || shipment.shipsgo_status === 'manual') return;
        if (actions.querySelector('[data-force-manual]')) return;

        const button = document.createElement('button');
        button.className = 'alt';
        button.dataset.forceManual = '1';
        button.textContent = 'Cambiar a manual';
        button.onclick = async () => {
          const accepted = confirm(
            `¿Cambiar ${shipment.container_number} a seguimiento manual?\n\nShipsGo dejará de controlar las actualizaciones hasta que vuelvas a conectarlo.`
          );
          if (!accepted) return;

          try {
            button.disabled = true;
            await request('/api/tracking-mode', {
              method: 'PATCH',
              body: JSON.stringify({ id: shipment.id, action: 'enable_manual' })
            });
            alert('Seguimiento manual activado.');
            if (typeof window.loadAll === 'function') await window.loadAll();
          } catch (error) {
            alert(error.message);
          } finally {
            button.disabled = false;
          }
        };
        actions.appendChild(button);
      });
    } catch (error) {
      console.warn('MANUAL_TRACKING_SWITCH_FAILED', error.message);
    } finally {
      container.dataset.manualSwitchDecorating = '0';
    }
  }

  decorate();
  const observer = new MutationObserver(decorate);
  observer.observe(document.body, { childList: true, subtree: true });
})();