(() => {
  if (window.__shipmentActionsMenuInstalled) return;
  window.__shipmentActionsMenuInstalled = true;

  const style = document.createElement('style');
  style.textContent = `
    .shipment-actions-compact{display:flex!important;align-items:center;gap:8px;flex-wrap:nowrap!important;position:relative}
    .shipment-actions-compact>.pill{display:inline-block!important;white-space:nowrap}
    .shipment-actions-compact>button:not(.shipment-menu-trigger){display:none!important}
    .shipment-menu-trigger{width:44px;height:40px;padding:0!important;border:1px solid #cfd8e6!important;background:#fff!important;color:#06204a!important;font-size:24px!important;line-height:1!important;border-radius:10px!important;display:inline-grid!important;place-items:center;flex:0 0 auto}
    .shipment-action-popover{position:fixed;z-index:5000;width:min(290px,calc(100vw - 24px));background:#fff;border:1px solid #dfe5ee;border-radius:14px;box-shadow:0 18px 48px rgba(6,32,74,.22);padding:8px;display:none}
    .shipment-action-popover.open{display:block}
    .shipment-action-item{width:100%;display:flex;align-items:center;gap:12px;padding:13px 14px;border:0;border-radius:9px;background:#fff;color:#152238;text-align:left;font-size:15px;font-weight:700;cursor:pointer}
    .shipment-action-item:hover,.shipment-action-item:active{background:#f4f7fb}
    .shipment-action-item.danger{color:#b42318}
    .shipment-action-item.orange{color:#d66a00}
    .shipment-action-item.success{color:#117a37}
    .shipment-action-icon{width:22px;text-align:center;font-size:17px}
    .shipment-menu-separator{height:1px;background:#e8edf4;margin:6px 4px}
    @media(max-width:700px){.shipment-actions-compact{justify-content:flex-start}.shipment-menu-trigger{width:42px;height:38px}.shipment-action-popover{width:min(300px,calc(100vw - 20px))}}
  `;
  document.head.appendChild(style);

  const popover = document.createElement('div');
  popover.className = 'shipment-action-popover';
  popover.setAttribute('role', 'menu');
  document.body.appendChild(popover);

  let activeTrigger = null;

  const iconFor = label => {
    const t = label.toLowerCase();
    if (t.includes('editar')) return '✎';
    if (t.includes('historial')) return '◷';
    if (t.includes('liberar')) return '🔓';
    if (t.includes('entregado')) return '✓';
    if (t.includes('manual')) return '↻';
    if (t.includes('shipsgo') || t.includes('automático')) return '↻';
    if (t.includes('reactivar')) return '↺';
    if (t.includes('eliminar')) return '🗑';
    return '•';
  };

  const classFor = button => {
    if (button.classList.contains('danger') || /eliminar/i.test(button.textContent)) return 'danger';
    if (button.classList.contains('orange') || /liberar/i.test(button.textContent)) return 'orange';
    if (button.classList.contains('success') || /entregado|reactivar/i.test(button.textContent)) return 'success';
    return '';
  };

  function closeMenu() {
    popover.classList.remove('open');
    popover.innerHTML = '';
    activeTrigger = null;
  }

  function positionMenu(trigger) {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(290, window.innerWidth - 24);
    let left = rect.right - width;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    popover.style.left = `${left}px`;
    popover.style.top = '0px';
    popover.classList.add('open');
    const menuHeight = popover.offsetHeight;
    let top = rect.bottom + 8;
    if (top + menuHeight > window.innerHeight - 12) top = Math.max(12, rect.top - menuHeight - 8);
    popover.style.top = `${top}px`;
  }

  function openMenu(trigger, actions) {
    if (activeTrigger === trigger && popover.classList.contains('open')) return closeMenu();
    activeTrigger = trigger;
    popover.innerHTML = '';

    actions.forEach((button, index) => {
      const label = button.textContent.trim();
      if (!label) return;
      if (/eliminar/i.test(label) && index > 0) {
        const sep = document.createElement('div');
        sep.className = 'shipment-menu-separator';
        popover.appendChild(sep);
      }
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `shipment-action-item ${classFor(button)}`.trim();
      item.innerHTML = `<span class="shipment-action-icon">${iconFor(label)}</span><span>${label}</span>`;
      item.onclick = event => {
        event.stopPropagation();
        closeMenu();
        button.click();
      };
      popover.appendChild(item);
    });

    positionMenu(trigger);
  }

  function compactActions() {
    document.querySelectorAll('#shipments td:last-child .actions').forEach(actions => {
      const buttons = [...actions.children].filter(el => el.tagName === 'BUTTON' && !el.classList.contains('shipment-menu-trigger'));
      if (!buttons.length) return;
      actions.classList.add('shipment-actions-compact');
      let trigger = actions.querySelector('.shipment-menu-trigger');
      if (!trigger) {
        trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'shipment-menu-trigger';
        trigger.setAttribute('aria-label', 'Abrir menú de acciones');
        trigger.setAttribute('title', 'Acciones');
        trigger.textContent = '⋯';
        actions.appendChild(trigger);
      }
      trigger.onclick = event => {
        event.stopPropagation();
        const currentButtons = [...actions.children].filter(el => el.tagName === 'BUTTON' && !el.classList.contains('shipment-menu-trigger'));
        openMenu(trigger, currentButtons);
      };
    });
  }

  document.addEventListener('click', event => {
    if (!popover.contains(event.target) && event.target !== activeTrigger) closeMenu();
  });
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, true);

  compactActions();
  const observer = new MutationObserver(() => queueMicrotask(compactActions));
  observer.observe(document.body, { childList: true, subtree: true });
})();