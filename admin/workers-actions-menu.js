(() => {
  if (window.__workersActionsMenuInstalled) return;
  window.__workersActionsMenuInstalled = true;

  const style = document.createElement('style');
  style.textContent = `
    .worker-actions-compact{display:flex!important;align-items:center;justify-content:flex-start;gap:8px;position:relative;flex-wrap:nowrap!important}
    .worker-actions-compact>.worker-original-action{display:none!important}
    .worker-menu-trigger{width:44px;height:40px;padding:0!important;border:1px solid #cfd8e6!important;background:#fff!important;color:#06204a!important;font-size:24px!important;line-height:1!important;border-radius:10px!important;display:inline-grid!important;place-items:center;flex:0 0 auto}
    .worker-action-popover{position:fixed;z-index:5200;width:min(290px,calc(100vw - 24px));background:#fff;border:1px solid #dfe5ee;border-radius:14px;box-shadow:0 18px 48px rgba(6,32,74,.22);padding:8px;display:none}
    .worker-action-popover.open{display:block}
    .worker-action-item{width:100%;display:flex;align-items:center;gap:12px;padding:13px 14px;border:0;border-radius:9px;background:#fff;color:#152238;text-align:left;font-size:15px;font-weight:700;cursor:pointer}
    .worker-action-item:active,.worker-action-item:hover{background:#f4f7fb}
    .worker-action-item.danger{color:#b42318}.worker-action-item.success{color:#117a37}
    .worker-action-icon{width:22px;text-align:center;font-size:17px}
    .worker-menu-separator{height:1px;background:#e8edf4;margin:6px 4px}
    @media(max-width:700px){.worker-menu-trigger{width:42px;height:38px}.worker-action-popover{width:min(300px,calc(100vw - 20px))}}
  `;
  document.head.appendChild(style);

  const popover = document.createElement('div');
  popover.className = 'worker-action-popover';
  popover.setAttribute('role','menu');
  document.body.appendChild(popover);

  let activeTrigger = null;

  const iconFor = label => {
    const text = label.toLowerCase();
    if (text.includes('historial')) return '◷';
    if (text.includes('editar')) return '✎';
    if (text.includes('desactivar')) return '⊘';
    if (text.includes('reactivar')) return '↺';
    return '•';
  };

  const classFor = button => {
    if (button.classList.contains('danger') || /desactivar/i.test(button.textContent)) return 'danger';
    if (button.classList.contains('success') || /reactivar/i.test(button.textContent)) return 'success';
    return '';
  };

  function closeMenu(){
    popover.classList.remove('open');
    popover.innerHTML = '';
    activeTrigger = null;
  }

  function positionMenu(trigger){
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(290, window.innerWidth - 24);
    let left = rect.right - width;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    popover.style.left = `${left}px`;
    popover.style.top = '0px';
    popover.classList.add('open');
    const height = popover.offsetHeight;
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 8);
    popover.style.top = `${top}px`;
  }

  function openMenu(trigger, buttons){
    if (activeTrigger === trigger && popover.classList.contains('open')) return closeMenu();
    activeTrigger = trigger;
    popover.innerHTML = '';

    buttons.forEach((button, index) => {
      const label = button.textContent.trim();
      if (!label) return;
      if (/desactivar|reactivar/i.test(label) && index > 0) {
        const separator = document.createElement('div');
        separator.className = 'worker-menu-separator';
        popover.appendChild(separator);
      }
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `worker-action-item ${classFor(button)}`.trim();
      item.innerHTML = `<span class="worker-action-icon">${iconFor(label)}</span><span>${label}</span>`;
      item.onclick = event => {
        event.stopPropagation();
        closeMenu();
        button.click();
      };
      popover.appendChild(item);
    });

    positionMenu(trigger);
  }

  function compactActions(){
    document.querySelectorAll('#workers td:last-child .actions').forEach(actions => {
      const buttons = [...actions.children].filter(el => el.tagName === 'BUTTON' && !el.classList.contains('worker-menu-trigger'));
      if (!buttons.length) return;

      buttons.forEach(button => button.classList.add('worker-original-action'));
      actions.classList.add('worker-actions-compact');

      let trigger = actions.querySelector('.worker-menu-trigger');
      if (!trigger) {
        trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'worker-menu-trigger';
        trigger.textContent = '⋯';
        trigger.setAttribute('aria-label','Abrir acciones del trabajador');
        trigger.title = 'Acciones';
        actions.appendChild(trigger);
      }

      trigger.onclick = event => {
        event.stopPropagation();
        const current = [...actions.children].filter(el => el.tagName === 'BUTTON' && el.classList.contains('worker-original-action'));
        openMenu(trigger,current);
      };
    });
  }

  document.addEventListener('click', event => {
    if (!popover.contains(event.target) && event.target !== activeTrigger) closeMenu();
  });
  window.addEventListener('resize',closeMenu);
  window.addEventListener('scroll',closeMenu,true);

  compactActions();
  const observer = new MutationObserver(() => queueMicrotask(compactActions));
  observer.observe(document.body,{childList:true,subtree:true});
})();