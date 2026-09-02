(() => {
  if (window.__modalDismissalInstalled) return;
  window.__modalDismissalInstalled = true;

  const modal = document.getElementById('modal');
  const closeButton = document.getElementById('closeModal');
  if (!modal || !closeButton) return;

  let dirty = false;
  let closeRequest = null;
  let decisionPromise = null;
  let decisionResolve = null;
  let decisionRestoreFocus = null;

  const append = (parent, tag, { className = '', text = '', attrs = {} } = {}) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
    parent.appendChild(element);
    return element;
  };

  const decision = document.createElement('div');
  decision.id = 'modalDismissalDecision';
  decision.className = 'modal-dismissal-decision hidden';
  decision.setAttribute('aria-hidden', 'true');

  const decisionPanel = append(decision, 'div', {
    className: 'modal-dismissal-decision-panel',
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'modalDismissalTitle',
      'aria-describedby': 'modalDismissalDescription'
    }
  });
  append(decisionPanel, 'div', { className: 'modal-dismissal-kicker', text: 'Cambios pendientes' });
  append(decisionPanel, 'h2', { text: '¿Descartar los cambios?', attrs: { id: 'modalDismissalTitle' } });
  append(decisionPanel, 'p', {
    text: 'Hay cambios sin guardar. Si sales ahora, la información escrita en este formulario se perderá.',
    attrs: { id: 'modalDismissalDescription' }
  });
  const decisionActions = append(decisionPanel, 'div', { className: 'modal-dismissal-actions' });
  const keepEditingButton = append(decisionActions, 'button', {
    className: 'alt',
    text: 'Seguir editando',
    attrs: { type: 'button', 'data-modal-dismissal-cancel': '' }
  });
  const discardButton = append(decisionActions, 'button', {
    className: 'danger',
    text: 'Descartar cambios',
    attrs: { type: 'button', 'data-modal-dismissal-confirm': '' }
  });
  document.body.appendChild(decision);

  const isOpen = () => !modal.classList.contains('hidden');
  const isDecisionOpen = () => !decision.classList.contains('hidden');
  const resetIfClosed = () => {
    if (!isOpen()) dirty = false;
  };

  const settleDecision = confirmed => {
    if (!decisionResolve) return;
    const resolve = decisionResolve;
    const restoreFocus = decisionRestoreFocus;
    decisionResolve = null;
    decisionPromise = null;
    decisionRestoreFocus = null;
    decision.classList.add('hidden');
    decision.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-dismissal-pending');
    resolve(confirmed);
    if (!confirmed && restoreFocus?.isConnected) restoreFocus.focus();
  };

  const confirmDiscard = () => {
    if (decisionPromise) return decisionPromise;
    decisionRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : closeButton;
    decision.classList.remove('hidden');
    decision.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-dismissal-pending');
    decisionPromise = new Promise(resolve => { decisionResolve = resolve; });
    requestAnimationFrame(() => keepEditingButton.focus());
    return decisionPromise;
  };

  const requestClose = () => {
    if (closeRequest) return closeRequest;
    closeRequest = (async () => {
      if (!isOpen()) return false;
      if (dirty && !await confirmDiscard()) return false;
      dirty = false;
      const closeExistingModal = window.closeModal;
      if (typeof closeExistingModal === 'function') closeExistingModal();
      return true;
    })().finally(() => { closeRequest = null; });
    return closeRequest;
  };

  closeButton.textContent = '×';
  closeButton.classList.add('modal-dismissal-close');
  closeButton.setAttribute('aria-label', 'Cerrar ventana');
  closeButton.setAttribute('title', 'Cerrar');

  keepEditingButton.addEventListener('click', () => settleDecision(false));
  discardButton.addEventListener('click', () => settleDecision(true));
  decision.addEventListener('click', event => {
    if (event.target === decision) settleDecision(false);
  });

  document.addEventListener('input', event => {
    resetIfClosed();
    if (isOpen() && modal.contains(event.target) && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) dirty = true;
  }, true);

  document.addEventListener('change', event => {
    resetIfClosed();
    if (isOpen() && modal.contains(event.target) && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) dirty = true;
  }, true);

  document.addEventListener('click', event => {
    resetIfClosed();
    if (!isOpen() || isDecisionOpen()) return;

    if (event.target === closeButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void requestClose();
      return;
    }

    if (event.target === modal) {
      event.preventDefault();
      void requestClose();
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (isDecisionOpen()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        settleDecision(false);
        return;
      }
      if (event.key === 'Tab') {
        const controls = [keepEditingButton, discardButton];
        const current = controls.indexOf(document.activeElement);
        const next = event.shiftKey
          ? (current <= 0 ? controls.length - 1 : current - 1)
          : (current < 0 || current === controls.length - 1 ? 0 : current + 1);
        event.preventDefault();
        controls[next].focus();
      }
      return;
    }

    resetIfClosed();
    if (!isOpen() || event.key !== 'Escape') return;
    event.preventDefault();
    void requestClose();
  }, true);

  window.ModalDismissal = Object.freeze({
    owner: 'modal-dismissal.js',
    markClean() { dirty = false; },
    isDirty() { return dirty; },
    requestClose
  });
})();
