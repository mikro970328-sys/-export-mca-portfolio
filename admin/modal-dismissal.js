(() => {
  if (window.__modalDismissalInstalled) return;
  window.__modalDismissalInstalled = true;

  const modal = document.getElementById('modal');
  const closeButton = document.getElementById('closeModal');
  if (!modal || !closeButton) return;

  let dirty = false;
  let scrollLocked = false;
  let previousHtmlOverflow = '';
  let previousBodyOverflow = '';

  const isOpen = () => !modal.classList.contains('hidden');

  const lockBackgroundScroll = () => {
    if (scrollLocked) return;
    previousHtmlOverflow = document.documentElement.style.overflow;
    previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    modal.style.overscrollBehavior = 'contain';
    const modalBox = modal.querySelector('.modalbox');
    if (modalBox) modalBox.style.overscrollBehavior = 'contain';
    scrollLocked = true;
  };

  const unlockBackgroundScroll = () => {
    if (!scrollLocked) return;
    document.documentElement.style.overflow = previousHtmlOverflow;
    document.body.style.overflow = previousBodyOverflow;
    scrollLocked = false;
  };

  const syncModalState = () => {
    if (isOpen()) {
      lockBackgroundScroll();
      return;
    }
    dirty = false;
    unlockBackgroundScroll();
  };

  const resetIfClosed = () => {
    if (!isOpen()) {
      dirty = false;
      unlockBackgroundScroll();
    }
  };

  const requestClose = () => {
    if (!isOpen()) return;
    if (dirty) {
      const confirmed = window.confirm('Hay cambios sin guardar. ¿Quieres cerrar esta ventana y descartarlos?');
      if (!confirmed) return;
    }
    dirty = false;
    const closeExistingModal = window.closeModal;
    if (typeof closeExistingModal === 'function') closeExistingModal();
    syncModalState();
  };

  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', 'Cerrar ventana');
  closeButton.setAttribute('title', 'Cerrar');
  closeButton.style.fontSize = '24px';
  closeButton.style.lineHeight = '1';
  closeButton.style.minWidth = '42px';

  const modalStateObserver = new MutationObserver(syncModalState);
  modalStateObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
  syncModalState();

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
    if (!isOpen()) return;

    if (event.target === closeButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      requestClose();
      return;
    }

    if (event.target === modal) {
      event.preventDefault();
      requestClose();
    }
  }, true);

  document.addEventListener('keydown', event => {
    resetIfClosed();
    if (!isOpen() || event.key !== 'Escape') return;
    event.preventDefault();
    requestClose();
  }, true);

  window.ModalDismissal = Object.freeze({
    owner: 'modal-dismissal.js',
    markClean() { dirty = false; },
    isDirty() { return dirty; },
    requestClose
  });
})();
