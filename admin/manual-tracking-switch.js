(() => {
  if (window.__manualTrackingSwitchInstalled) return;
  window.__manualTrackingSwitchInstalled = true;

  const EVENTS = [
    { key: 'load', label: 'Cargado en el buque', short: 'Cargado' },
    { key: 'departed', label: 'Salió del puerto', short: 'Salida' },
    { key: 'arrived', label: 'Llegó al puerto', short: 'Llegada' },
    { key: 'discharged', label: 'Descargado del buque', short: 'Descargado' },
    { key: 'released', label: 'Liberado', short: 'Liberar' },
    { key: 'delivered', label: 'Entregado', short: 'Entregado' }
  ];

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

  function currentIndex(shipment) {
    const status = String(shipment.last_status || shipment.operational_status || '').trim().toLowerCase();
    return EVENTS.findIndex(event => event.label.toLowerCase() === status);
  }

  async function confirmManualEvent(shipment, event, button) {
    const needsLocation = ['load', 'departed', 'arrived', 'discharged'].includes(event.key);
    let location = '';
    if (needsLocation) {
      const entered = prompt(
        `${event.label}\n\nUbicación o puerto (opcional):`,
        shipment.last_location || ''
      );
      if (entered === null) return;
      location = entered.trim();
    }

    const accepted = confirm(
      `¿Confirmar “${event.label}” para ${shipment.container_number}?\n\n` +
      'El sistema actualizará el tracking y enviará al cliente el WhatsApp aprobado correspondiente.'
    );
    if (!accepted) return;

    try {
      button.disabled = true;
      const result = await request('/api/manual-tracking-event', {
        method: 'PATCH',
        body: JSON.stringify({ id: shipment.id, event: event.key, location })
      });

      if (result.notification_status === 'failed') {
        alert(`Evento actualizado, pero falló el WhatsApp:\n${result.notification_error || 'Error desconocido'}`);
      } else if (result.notification_status === 'pending_template') {
        alert(`Evento actualizado. Falta configurar ${result.missing_variable} en Vercel para enviar el WhatsApp.`);
      } else {
        alert(`Evento actualizado y WhatsApp enviado.\nEstado: ${result.notification_status || 'queued'}`);
      }

      if (typeof window.loadAll === 'function') await window.loadAll();
      if (typeof window.loadNotifications === 'function') await window.loadNotifications();
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function addManualWorkflow(actions, shipment) {
    if (actions.querySelector('[data-manual-tracking-flow]')) return;

    const wrapper = document.createElement('div');
    wrapper.dataset.manualTrackingFlow = '1';
    wrapper.style.display = 'flex';
    wrapper.style.gap = '6px';
    wrapper.style.flexWrap = 'wrap';
    wrapper.style.alignItems = 'center';
    wrapper.style.width = '100%';
    wrapper.style.marginTop = '6px';

    const label = document.createElement('span');
    label.className = 'pill';
    label.textContent = 'Manual';
    wrapper.appendChild(label);

    const completedIndex = currentIndex(shipment);
    EVENTS.forEach((event, index) => {
      if (index <= completedIndex) return;
      if (shipment.active === false && event.key !== 'delivered') return;

      const button = document.createElement('button');
      button.className = event.key === 'released' ? 'orange' : event.key === 'delivered' ? 'success' : 'alt';
      button.textContent = event.short;
      button.title = event.label;
      button.dataset.manualEvent = event.key;
      button.onclick = () => confirmManualEvent(shipment, event, button);
      wrapper.appendChild(button);
    });

    if (wrapper.children.length === 1) {
      const done = document.createElement('span');
      done.className = 'pill done';
      done.textContent = 'Proceso completado';
      wrapper.appendChild(done);
    }

    actions.appendChild(wrapper);
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
        if (!shipment || !actions) return;

        if (shipment.shipsgo_status === 'manual') {
          addManualWorkflow(actions, shipment);
          return;
        }

        if (actions.querySelector('[data-force-manual]')) return;
        const button = document.createElement('button');
        button.className = 'alt';
        button.dataset.forceManual = '1';
        button.textContent = 'Cambiar a manual';
        button.onclick = async () => {
          const accepted = confirm(
            `¿Cambiar ${shipment.container_number} a seguimiento manual?\n\n` +
            'ShipsGo dejará de controlar los eventos. Tú confirmarás cada paso y el cliente seguirá recibiendo sus WhatsApp.'
          );
          if (!accepted) return;

          try {
            button.disabled = true;
            await request('/api/tracking-mode', {
              method: 'PATCH',
              body: JSON.stringify({ id: shipment.id, action: 'enable_manual' })
            });
            alert('Seguimiento manual activado. Ya puedes confirmar los eventos desde la fila del contenedor.');
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
