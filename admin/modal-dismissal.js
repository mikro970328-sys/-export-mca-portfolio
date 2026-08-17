(() => {
  if (window.__modalDismissalInstalled) return;
  window.__modalDismissalInstalled = true;

  const modal = document.getElementById('modal');
  const closeButton = document.getElementById('closeModal');
  if (!modal || !closeButton) return;

  let dirty = false;

  const isOpen = () => !modal.classList.contains('hidden');
  const resetIfClosed = () => {
    if (!isOpen()) dirty = false;
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
  };

  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', 'Cerrar ventana');
  closeButton.setAttribute('title', 'Cerrar');
  closeButton.style.fontSize = '24px';
  closeButton.style.lineHeight = '1';
  closeButton.style.minWidth = '42px';

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
