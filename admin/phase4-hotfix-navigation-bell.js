(() => {
  if (window.__phase4NavigationBellHotfixInstalled) return;
  window.__phase4NavigationBellHotfixInstalled = true;

  const $ = id => document.getElementById(id);

  const style = document.createElement('style');
  style.id = 'phase4BellVisibilityFix';
  style.textContent = `
    #operationalAlertPopover{
      position:fixed!important;
      z-index:20000!important;
      display:none;
      visibility:visible!important;
      opacity:1!important;
      transform:none!important;
      max-width:calc(100vw - 24px)!important;
      max-height:calc(100vh - 96px)!important;
      overflow:hidden!important;
      background:#fff!important;
      border:1px solid #dfe5ee!important;
      box-shadow:0 24px 64px rgba(6,32,74,.28)!important;
    }
    #operationalAlertPopover:not(.hidden){display:block!important}
    #operationalAlertBellWrap{overflow:visible!important}
    #operationalAlertBell{position:relative!important;overflow:visible!important}
    #operationalAlertBadge{z-index:2!important}
    @media(max-width:700px){
      #operationalAlertPopover{
        left:12px!important;
        right:12px!important;
        width:auto!important;
        max-height:calc(100vh - 92px)!important;
      }
    }
  `;
  document.head.appendChild(style);

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
    if (document.documentElement.dataset.phase4TrackingNavigation === '1') return;
    document.documentElement.dataset.phase4TrackingNavigation = '1';
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

  function positionPopover() {
    const bell = $('operationalAlertBell');
    const popover = $('operationalAlertPopover');
    if (!bell || !popover || popover.classList.contains('hidden')) return;

    if (popover.parentElement !== document.body) document.body.appendChild(popover);

    const mobile = window.matchMedia('(max-width:700px)').matches;
    if (mobile) {
      popover.style.top = `${Math.max(76, bell.getBoundingClientRect().bottom + 8)}px`;
      popover.style.left = '12px';
      popover.style.right = '12px';
      popover.style.width = 'auto';
      return;
    }

    const rect = bell.getBoundingClientRect();
    const width = Math.min(410, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
    popover.style.top = `${rect.bottom + 8}px`;
    popover.style.left = `${left}px`;
    popover.style.right = 'auto';
    popover.style.width = `${width}px`;
  }

  function repairBell() {
    const bell = $('operationalAlertBell');
    const popover = $('operationalAlertPopover');
    if (!bell || !popover) return;

    bell.style.pointerEvents = 'auto';
    bell.setAttribute('aria-haspopup', 'dialog');

    if (bell.dataset.visibilityFixReady !== '1') {
      bell.dataset.visibilityFixReady = '1';
      bell.addEventListener('click', () => {
        setTimeout(() => {
          const isOpen = !popover.classList.contains('hidden');
          bell.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
          if (isOpen) positionPopover();
        }, 0);
      });
    }

    if (!popover.classList.contains('hidden')) positionPopover();
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
      queueMicrotask(() => {
        repairBell();
        installReusableContainerRegistration();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
    window.addEventListener('pageshow', () => {
      repairBell();
      installReusableContainerRegistration();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();