(() => {
  if (window.__clientActionsMenuInstalled) return;
  window.__clientActionsMenuInstalled = true;

  const style = document.createElement('style');
  style.textContent = `
    .client-actions-cell{position:relative!important;width:1%;white-space:nowrap;text-align:right}
    .client-actions-trigger{width:38px!important;height:38px!important;min-width:38px!important;padding:0!important;border:1px solid #cfd7e3!important;border-radius:10px!important;background:#fff!important;color:#06204a!important;font-size:24px!important;line-height:1!important;display:inline-grid!important;place-items:center!important;box-shadow:none!important}
    .client-actions-trigger:hover{background:#f7f9fc!important}
    .client-actions-popover{position:fixed;z-index:1800;min-width:220px;max-width:calc(100vw - 24px);background:#fff;border:1px solid #dfe5ee;border-radius:12px;padding:7px;box-shadow:0 18px 45px rgba(6,32,74,.22)}
    .client-actions-popover.hidden{display:none!important}
    .client-actions-popover button{width:100%!important;display:flex!important;align-items:center!important;justify-content:flex-start!important;text-align:left!important;background:#fff!important;color:#152238!important;border:0!important;border-radius:8px!important;padding:11px 12px!important;font-size:14px!important;font-weight:700!important;white-space:nowrap!important}
    .client-actions-popover button:hover{background:#f4f7fb!important}
    .client-actions-popover button.danger{color:#b42318!important}
    .client-actions-backdrop{display:none;position:fixed;inset:0;z-index:1799;background:rgba(6,20,42,.35)}
    .client-actions-backdrop.show{display:block}
    @media(max-width:700px){
      .client-actions-cell{position:sticky!important;right:0!important;background:#fff!important;z-index:3!important;box-shadow:none!important}
      .client-actions-popover{left:12px!important;right:12px!important;bottom:12px!important;top:auto!important;min-width:0!important;width:auto!important;border-radius:16px!important;padding:10px!important}
      .client-actions-popover::before{content:'Acciones del cliente';display:block;padding:5px 8px 10px;font-size:16px;font-weight:800;color:#06204a;border-bottom:1px solid #e6ebf2;margin-bottom:5px}
      .client-actions-popover button{padding:14px 12px!important;font-size:15px!important}
      body.client-actions-open{overflow:hidden!important}
    }
  `;
  document.head.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'client-actions-backdrop';
  document.body.appendChild(backdrop);

  const popover = document.createElement('div');
  popover.className = 'client-actions-popover hidden';
  popover.setAttribute('role', 'menu');
  document.body.appendChild(popover);

  let activeTrigger = null;

  function closeMenu(){
    popover.classList.add('hidden');
    popover.innerHTML = '';
    backdrop.classList.remove('show');
    document.body.classList.remove('client-actions-open');
    activeTrigger?.setAttribute('aria-expanded', 'false');
    activeTrigger = null;
  }

  function positionMenu(trigger){
    if (window.matchMedia('(max-width:700px)').matches) {
      backdrop.classList.add('show');
      document.body.classList.add('client-actions-open');
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 220;
    const estimatedHeight = Math.max(180, popover.scrollHeight || 180);
    let left = rect.right - menuWidth;
    let top = rect.bottom + 7;
    if (left < 8) left = 8;
    if (top + estimatedHeight > window.innerHeight - 8) top = Math.max(8, rect.top - estimatedHeight - 7);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.right = 'auto';
    popover.style.bottom = 'auto';
  }

  function openMenu(trigger, actions){
    if (activeTrigger === trigger && !popover.classList.contains('hidden')) {
      closeMenu();
      return;
    }
    closeMenu();
    activeTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    popover.innerHTML = '';

    actions.forEach(original => {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = original.textContent.trim();
      if (original.classList.contains('danger')) item.classList.add('danger');
      item.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        original.click();
      });
      popover.appendChild(item);
    });

    popover.classList.remove('hidden');
    requestAnimationFrame(() => positionMenu(trigger));
  }

  function welcomeActionLabel(row){
    const status = String(row.querySelector('td:nth-child(4) .pill')?.textContent || 'pending').trim().toLowerCase();
    if (status === 'sent') return 'Reenviar bienvenida';
    if (status === 'failed') return 'Reintentar bienvenida';
    return 'Enviar bienvenida';
  }

  function decorate(){
    const clients = document.getElementById('clients');
    if (!clients) return;

    clients.querySelectorAll('tbody tr').forEach(row => {
      const actions = row.querySelector('td:last-child .actions');
      if (!actions || actions.dataset.clientMenuReady === '1') return;
      const buttons = Array.from(actions.querySelectorAll(':scope > button'));
      if (!buttons.length) return;

      if (buttons[1]) buttons[1].textContent = welcomeActionLabel(row);

      actions.dataset.clientMenuReady = '1';
      const cell = actions.closest('td');
      if (cell) cell.classList.add('client-actions-cell');

      buttons.forEach(button => {
        button.style.display = 'none';
        button.setAttribute('aria-hidden', 'true');
        button.tabIndex = -1;
      });

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'client-actions-trigger';
      trigger.textContent = '⋮';
      trigger.title = 'Acciones';
      trigger.setAttribute('aria-label', 'Abrir acciones del cliente');
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openMenu(trigger, buttons);
      });
      actions.appendChild(trigger);
    });
  }

  backdrop.addEventListener('click', closeMenu);
  document.addEventListener('pointerdown', event => {
    if (popover.classList.contains('hidden')) return;
    if (popover.contains(event.target) || activeTrigger?.contains(event.target)) return;
    closeMenu();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });
  window.addEventListener('resize', () => {
    if (activeTrigger && !popover.classList.contains('hidden')) positionMenu(activeTrigger);
  });
  window.addEventListener('scroll', () => {
    if (activeTrigger && !popover.classList.contains('hidden') && !window.matchMedia('(max-width:700px)').matches) positionMenu(activeTrigger);
  }, true);

  decorate();
  const observer = new MutationObserver(decorate);
  observer.observe(document.body, { childList: true, subtree: true });
})();