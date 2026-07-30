(() => {
  if (window.__phase4NavigationBellHotfixInstalled) return;
  window.__phase4NavigationBellHotfixInstalled = true;

  const $ = id => document.getElementById(id);

  function openTracking(containerNumber = '') {
    if (typeof window.showSection === 'function') window.showSection('containersSection');
    const search = $('shipmentSearch');
    if (search) {
      search.value = containerNumber || '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(() => search.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    }
  }

  function installTrackingNavigation() {
    document.addEventListener('click', event => {
      const button = event.target.closest('button,a');
      if (!button) return;
      const label = String(button.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!/ver tracking|abrir tracking|ir a tracking/.test(label)) return;
      event.preventDefault();
      event.stopPropagation();
      const row = button.closest('[data-container],tr,.activity-item');
      const explicit = button.dataset.container || row?.dataset?.container || '';
      const text = explicit || row?.querySelector('b,.activity-title')?.textContent?.trim() || '';
      const match = text.toUpperCase().match(/[A-Z]{4}\d{7}/);
      openTracking(match?.[0] || '');
    }, true);
  }

  function repairBell() {
    const wrap = $('operationalAlertBellWrap');
    const bell = $('operationalAlertBell');
    const popover = $('operationalAlertPopover');
    if (!wrap || !bell || !popover) return;

    bell.style.pointerEvents = 'auto';
    bell.style.position = 'relative';
    bell.setAttribute('aria-haspopup', 'dialog');

    if (bell.dataset.hotfixReady === '1') return;
    bell.dataset.hotfixReady = '1';
    bell.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const opening = popover.classList.contains('hidden');
      popover.classList.toggle('hidden', !opening);
      popover.style.display = opening ? 'block' : '';
      bell.setAttribute('aria-expanded', opening ? 'true' : 'false');
    }, true);

    document.addEventListener('click', event => {
      if (!wrap.contains(event.target)) {
        popover.classList.add('hidden');
        popover.style.display = '';
        bell.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function installReusableContainerRegistration() {
    const button = $('saveShipment');
    if (!button || button.dataset.reuseReady === '1') return;
    button.dataset.reuseReady = '1';
    button.onclick = async () => {
      try {
        const result = await api('/api/shipments-register', {
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
        note('shipmentMsg', result.reused_number ? 'Contenedor registrado. El número fue reutilizado después de una operación cerrada.' : 'Contenedor registrado correctamente.', true);
        ['shipmentContainer','shipmentBooking','shipmentBol','shipmentCarrier','shipmentProduct'].forEach(id => { if ($(id)) $(id).value = ''; });
        await loadAll();
        if (window.loadNotifications) await window.loadNotifications();
      } catch (error) {
        note('shipmentMsg', error.message);
      }
    };
  }

  function mount() {
    installTrackingNavigation();
    repairBell();
    installReusableContainerRegistration();
    const observer = new MutationObserver(() => {
      repairBell();
      installReusableContainerRegistration();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('pageshow', () => {
      repairBell();
      installReusableContainerRegistration();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();