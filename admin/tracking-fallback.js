(() => {
  if (window.__trackingFallbackInstalled) return;
  window.__trackingFallbackInstalled = true;

  const $ = id => document.getElementById(id);
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

  async function activateManual(shipment) {
    const accepted = confirm(
      `ShipsGo no pudo activar el tracking de ${shipment.container_number}.\n\n¿Deseas continuar este contenedor en modo manual?`
    );
    if (!accepted) return;
    await request('/api/tracking-mode', {
      method: 'PATCH',
      body: JSON.stringify({ id: shipment.id, action: 'enable_manual' })
    });
    alert('Seguimiento manual activado. Tú controlarás las actualizaciones de este contenedor.');
  }

  function installSaveOverride() {
    const oldButton = $('saveShipment');
    if (!oldButton || oldButton.dataset.trackingFallback === '1') return;

    const button = oldButton.cloneNode(true);
    button.dataset.trackingFallback = '1';
    oldButton.replaceWith(button);

    button.onclick = async () => {
      const msg = $('shipmentMsg');
      try {
        button.disabled = true;
        const result = await request('/api/shipments', {
          method: 'POST',
          body: JSON.stringify({
            client_id: $('shipmentClient')?.value,
            container_number: $('shipmentContainer')?.value,
            booking_number: $('shipmentBooking')?.value,
            bol_number: $('shipmentBol')?.value,
            carrier: $('shipmentCarrier')?.value,
            product: $('shipmentProduct')?.value
          })
        });

        if (msg) {
          msg.textContent = 'Contenedor registrado correctamente.';
          msg.className = 'msg ok';
        }
        ['shipmentContainer','shipmentBooking','shipmentBol','shipmentCarrier','shipmentProduct']
          .forEach(id => { if ($(id)) $(id).value = ''; });

        if (typeof window.loadAll === 'function') await window.loadAll();

        if (result.shipment?.shipsgo_status === 'failed') {
          await activateManual(result.shipment);
          if (typeof window.loadAll === 'function') await window.loadAll();
        }
      } catch (error) {
        if (msg) {
          msg.textContent = error.message;
          msg.className = 'msg bad';
        } else {
          alert(error.message);
        }
      } finally {
        button.disabled = false;
      }
    };
  }

  async function decorateTrackingControls() {
    const container = $('shipments');
    if (!container || container.dataset.trackingDecorating === '1') return;
    container.dataset.trackingDecorating = '1';
    try {
      const data = await request('/api/shipments');
      const byNumber = new Map((data.shipments || []).map(s => [String(s.container_number || '').trim(), s]));

      container.querySelectorAll('tbody tr').forEach(row => {
        if (row.dataset.trackingDecorated === '1') return;
        const number = row.querySelector('td:first-child b')?.textContent?.trim();
        const shipment = byNumber.get(number);
        if (!shipment) return;
        const actions = row.querySelector('td:last-child .actions');
        if (!actions) return;

        const badge = document.createElement('span');
        badge.className = 'pill';
        badge.textContent = shipment.shipsgo_status === 'active'
          ? 'ShipsGo automático'
          : shipment.shipsgo_status === 'manual'
            ? 'Seguimiento manual'
            : 'ShipsGo pendiente';
        actions.prepend(badge);

        if (shipment.shipsgo_status === 'failed') {
          const manual = document.createElement('button');
          manual.className = 'alt';
          manual.textContent = 'Pasar a manual';
          manual.onclick = async () => {
            if (!confirm(`¿Activar seguimiento manual para ${shipment.container_number}?`)) return;
            await request('/api/tracking-mode', {
              method: 'PATCH',
              body: JSON.stringify({ id: shipment.id, action: 'enable_manual' })
            });
            if (typeof window.loadAll === 'function') await window.loadAll();
          };
          actions.appendChild(manual);
        }

        if (shipment.shipsgo_status === 'failed' || shipment.shipsgo_status === 'manual') {
          const retry = document.createElement('button');
          retry.className = 'alt';
          retry.textContent = 'Intentar ShipsGo';
          retry.onclick = async () => {
            const question = shipment.shipsgo_status === 'manual'
              ? `¿Intentar conectar ${shipment.container_number} con ShipsGo? Si funciona, volverá al modo automático.`
              : `¿Reintentar ShipsGo para ${shipment.container_number}?`;
            if (!confirm(question)) return;
            try {
              await request('/api/shipments', {
                method: 'PATCH',
                body: JSON.stringify({ id: shipment.id, action: 'retry_shipsgo' })
              });
              alert('ShipsGo quedó conectado y el seguimiento automático está activo.');
              if (typeof window.loadAll === 'function') await window.loadAll();
            } catch (error) {
              alert(error.message);
            }
          };
          actions.appendChild(retry);
        }

        row.dataset.trackingDecorated = '1';
      });
    } catch (error) {
      console.warn('TRACKING_CONTROLS_FAILED', error.message);
    } finally {
      container.dataset.trackingDecorating = '0';
    }
  }

  installSaveOverride();
  decorateTrackingControls();

  const observer = new MutationObserver(() => {
    installSaveOverride();
    decorateTrackingControls();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
