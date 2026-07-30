(() => {
  if (window.__manualTrackingSwitchInstalled) return;
  window.__manualTrackingSwitchInstalled = true;

  const EVENTS = [
    { key: 'load', label: 'Cargado en el buque' },
    { key: 'departed', label: 'Salió del puerto' },
    { key: 'arrived', label: 'Llegó al puerto' },
    { key: 'discharged', label: 'Descargado del buque' },
    { key: 'released', label: 'Liberado' },
    { key: 'delivered', label: 'Entregado' }
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

  function ensureStyles() {
    if (document.getElementById('manualTrackingModalStyles')) return;
    const style = document.createElement('style');
    style.id = 'manualTrackingModalStyles';
    style.textContent = `
      .manual-track-summary{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;margin-top:6px}
      .manual-track-current{font-size:12px;color:#667085;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .manual-track-open{padding:8px 11px!important;font-size:12px!important}
      .manual-track-overlay{position:fixed;inset:0;background:rgba(3,14,31,.58);display:flex;align-items:flex-end;justify-content:center;padding:0;z-index:5000}
      .manual-track-panel{width:100%;max-width:620px;max-height:92vh;overflow:auto;background:#fff;border-radius:22px 22px 0 0;padding:22px 18px calc(22px + env(safe-area-inset-bottom));box-shadow:0 -18px 48px rgba(6,32,74,.25)}
      .manual-track-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:18px}
      .manual-track-head h3{margin:0;color:#06204a;font-size:21px}
      .manual-track-close{background:#fff!important;color:#06204a!important;border:1px solid #dfe5ee!important;padding:8px 11px!important}
      .manual-track-next{padding:13px;border:1px solid #b8c9e4;background:#f3f7fd;border-radius:12px;margin-bottom:16px}
      .manual-track-next small{display:block;color:#667085;margin-bottom:4px}
      .manual-track-next b{color:#06204a}
      .manual-track-list{display:grid;gap:9px;margin:14px 0 18px}
      .manual-track-step{display:grid;grid-template-columns:30px 1fr;gap:10px;align-items:center;padding:11px;border:1px solid #dfe5ee;border-radius:12px;background:#fff;cursor:pointer}
      .manual-track-step.done{background:#f1f8f3;border-color:#b8dfc1;color:#477253;cursor:default}
      .manual-track-step.recommended{border:2px solid #f58220;background:#fff8f2}
      .manual-track-step input{width:18px;height:18px;margin:0}
      .manual-track-step-index{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:#edf3ff;color:#06204a;font-size:12px;font-weight:900}
      .manual-track-step.done .manual-track-step-index{background:#dff2e4;color:#117a37}
      .manual-track-step-title{font-weight:800}
      .manual-track-step-note{font-size:11px;color:#667085;margin-top:2px}
      .manual-track-field label{display:block;margin:12px 0 6px;font-size:13px;font-weight:800}
      .manual-track-field input{width:100%}
      .manual-track-preview{margin-top:14px;padding:12px;border-left:4px solid #06204a;background:#f7f9fc;border-radius:8px;font-size:13px;line-height:1.45}
      .manual-track-actions{display:grid;grid-template-columns:1fr;gap:9px;margin-top:18px}
      .manual-track-confirm{background:#f58220!important;padding:13px!important}
      .manual-track-cancel{background:#fff!important;color:#06204a!important;border:1px solid #cfd7e3!important}
      @media(min-width:700px){.manual-track-overlay{align-items:center;padding:20px}.manual-track-panel{border-radius:18px;padding:24px}.manual-track-actions{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.querySelector('.manual-track-overlay')?.remove();
  }

  function showResult(result) {
    if (result.notification_status === 'failed') {
      alert(`Evento actualizado, pero falló el WhatsApp:\n${result.notification_error || 'Error desconocido'}`);
    } else if (result.notification_status === 'pending_template') {
      alert(`Evento actualizado. Falta configurar ${result.missing_variable} en Vercel para enviar el WhatsApp.`);
    } else {
      alert(`Evento actualizado y WhatsApp enviado.\nEstado: ${result.notification_status || 'queued'}`);
    }
  }

  function openManualWorkflow(shipment) {
    closeModal();
    ensureStyles();

    const completedIndex = currentIndex(shipment);
    const nextIndex = Math.min(completedIndex + 1, EVENTS.length - 1);
    const selectable = EVENTS.map((event, index) => ({ ...event, index })).filter(item => item.index > completedIndex);
    const defaultEvent = selectable[0] || null;

    const overlay = document.createElement('div');
    overlay.className = 'manual-track-overlay';
    overlay.innerHTML = `
      <div class="manual-track-panel" role="dialog" aria-modal="true" aria-label="Actualizar tracking manual">
        <div class="manual-track-head">
          <div><h3>Tracking manual</h3><div class="muted">${shipment.container_number}</div></div>
          <button type="button" class="manual-track-close">Cerrar</button>
        </div>
        ${defaultEvent ? `<div class="manual-track-next"><small>Próximo evento recomendado</small><b>${defaultEvent.label}</b></div>` : '<div class="manual-track-next"><b>Proceso completado</b></div>'}
        <div class="manual-track-list">
          ${EVENTS.map((event, index) => {
            const done = index <= completedIndex;
            const recommended = index === nextIndex && !done;
            return `<label class="manual-track-step ${done ? 'done' : ''} ${recommended ? 'recommended' : ''}">
              <div class="manual-track-step-index">${done ? '✓' : index + 1}</div>
              <div>
                <div class="manual-track-step-title">${event.label}</div>
                <div class="manual-track-step-note">${done ? 'Completado' : recommended ? 'Siguiente paso' : 'Disponible para selección manual'}</div>
              </div>
              ${done ? '' : `<input style="position:absolute;opacity:0;pointer-events:none" type="radio" name="manualTrackingEvent" value="${event.key}" ${defaultEvent?.key === event.key ? 'checked' : ''}>`}
            </label>`;
          }).join('')}
        </div>
        ${defaultEvent ? `
          <div class="manual-track-field">
            <label for="manualTrackingLocation">Puerto o ubicación</label>
            <input id="manualTrackingLocation" placeholder="Opcional" value="${String(shipment.last_location || '').replace(/"/g, '&quot;')}">
          </div>
          <div class="manual-track-preview">
            <b>Vista previa del WhatsApp</b><br>
            Contenedor: ${shipment.container_number}<br>
            Estado: <span id="manualTrackingPreviewStatus">${defaultEvent.label}</span>
          </div>
          <div class="manual-track-actions">
            <button type="button" class="manual-track-confirm">Confirmar y enviar WhatsApp</button>
            <button type="button" class="manual-track-cancel">Cancelar</button>
          </div>` : ''}
      </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('.manual-track-close').onclick = closeModal;
    overlay.querySelector('.manual-track-cancel')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeModal(); });

    overlay.querySelectorAll('.manual-track-step:not(.done)').forEach(step => {
      step.addEventListener('click', () => {
        const radio = step.querySelector('input[type="radio"]');
        if (!radio) return;
        radio.checked = true;
        overlay.querySelectorAll('.manual-track-step').forEach(item => item.classList.remove('recommended'));
        step.classList.add('recommended');
        const selected = EVENTS.find(event => event.key === radio.value);
        const preview = overlay.querySelector('#manualTrackingPreviewStatus');
        if (preview && selected) preview.textContent = selected.label;
      });
    });

    const confirmButton = overlay.querySelector('.manual-track-confirm');
    if (confirmButton) {
      confirmButton.onclick = async () => {
        const selectedKey = overlay.querySelector('input[name="manualTrackingEvent"]:checked')?.value;
        const selected = EVENTS.find(event => event.key === selectedKey);
        if (!selected) return alert('Selecciona un evento.');

        const accepted = confirm(
          `¿Confirmar “${selected.label}” para ${shipment.container_number}?\n\n` +
          'El estado se actualizará y se enviará el WhatsApp al cliente.'
        );
        if (!accepted) return;

        try {
          confirmButton.disabled = true;
          confirmButton.textContent = 'Procesando...';
          const location = String(overlay.querySelector('#manualTrackingLocation')?.value || '').trim();
          const result = await request('/api/manual-tracking-event', {
            method: 'PATCH',
            body: JSON.stringify({ id: shipment.id, event: selected.key, location })
          });
          closeModal();
          showResult(result);
          if (typeof window.loadAll === 'function') await window.loadAll();
          if (typeof window.loadNotifications === 'function') await window.loadNotifications();
        } catch (error) {
          alert(error.message);
          confirmButton.disabled = false;
          confirmButton.textContent = 'Confirmar y enviar WhatsApp';
        }
      };
    }
  }

  function removeLegacyManualActions(actions) {
    actions.querySelectorAll('button').forEach(button => {
      const handler = String(button.getAttribute('onclick') || '');
      if (handler.includes("'release'") || handler.includes("'deliver'")) button.remove();
    });
  }

  function addManualWorkflow(actions, shipment) {
    removeLegacyManualActions(actions);
    actions.querySelector('[data-manual-tracking-flow]')?.remove();

    const wrapper = document.createElement('div');
    wrapper.dataset.manualTrackingFlow = '1';
    wrapper.className = 'manual-track-summary';

    const label = document.createElement('span');
    label.className = 'pill';
    label.textContent = 'Manual';

    const status = document.createElement('span');
    status.className = 'manual-track-current';
    status.textContent = `Estado: ${shipment.last_status || shipment.operational_status || 'Registrado'}`;

    const button = document.createElement('button');
    button.className = 'alt manual-track-open';
    button.textContent = 'Actualizar estado';
    button.onclick = () => openManualWorkflow(shipment);

    wrapper.append(label, status, button);
    actions.appendChild(wrapper);
  }

  async function decorate() {
    const container = document.getElementById('shipments');
    if (!container || container.dataset.manualSwitchDecorating === '1') return;
    container.dataset.manualSwitchDecorating = '1';

    try {
      ensureStyles();
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
            alert('Seguimiento manual activado. Usa “Actualizar estado” para continuar el proceso.');
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