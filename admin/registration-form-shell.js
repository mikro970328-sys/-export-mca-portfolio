(() => {
  if (window.__registrationFormShellInstalled) return;
  window.__registrationFormShellInstalled = true;

  const byId = id => document.getElementById(id);

  function fieldWrapper(id) {
    return byId(id)?.closest('div') || null;
  }

  function createBlock(step, title, description, ids) {
    const block = document.createElement('section');
    block.className = 'registration-block';
    block.innerHTML = `<div class="registration-block-head"><span class="registration-step">${step}</span><div><h3>${title}</h3><p>${description}</p></div></div><div class="registration-fields"></div>`;
    const fields = block.querySelector('.registration-fields');
    ids.forEach(id => {
      const wrapper = fieldWrapper(id);
      if (wrapper) fields.appendChild(wrapper);
    });
    return block;
  }

  function syncContainerGuidance() {
    const input = byId('shipmentContainer');
    const help = byId('registrationContainerHelp');
    const readiness = byId('registrationReadiness');
    if (!input || !help || !readiness) return;

    const value = String(input.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (input.value !== value) input.value = value.slice(0, 11);

    const valid = /^[A-Z]{4}\d{7}$/.test(value);
    const empty = !value;
    help.className = `registration-container-help${empty ? '' : valid ? ' valid' : ' invalid'}`;
    help.textContent = empty
      ? 'Formato requerido: 4 letras + 7 números. Ejemplo: ABCD1234567.'
      : valid
        ? 'Número de contenedor con formato correcto.'
        : 'Completa 4 letras seguidas de 7 números.';

    readiness.classList.toggle('ready', valid);
    readiness.querySelector('span:last-child').textContent = valid
      ? 'Datos mínimos listos para guardar'
      : 'Completa el número de contenedor para continuar';
  }

  function mount() {
    const section = byId('registerContainerSection');
    const card = section?.querySelector('.registration-card');
    const originalGrid = card?.querySelector(':scope > .grid');
    const save = byId('saveShipment');
    const message = byId('shipmentMsg');
    if (!section || !card || !originalGrid || !save || !message) return;
    if (card.dataset.registrationShell === 'guided-v1') return;

    card.dataset.registrationShell = 'guided-v1';

    const title = card.querySelector(':scope > h2');
    if (title) title.textContent = 'Datos del contenedor';

    const shell = document.createElement('div');
    shell.className = 'registration-shell';
    shell.innerHTML = `<div class="registration-intro"><div><h3>Registro operativo</h3><p>Completa lo que ya conoces. Cliente, importadora, booking, B/L y fecha pueden quedar pendientes y actualizarse después.</p></div><span class="registration-required">* Único dato obligatorio: contenedor</span></div>`;

    card.insertBefore(shell, originalGrid);
    shell.appendChild(createBlock('1', 'Asignación', 'Define comprador e importadora cuando ya estén confirmados.', ['shipmentClient', 'shipmentImporter']));
    shell.appendChild(createBlock('2', 'Identificación y transporte', 'Datos que permiten localizar y relacionar la operación marítima.', ['shipmentContainer', 'shipmentBooking', 'shipmentBol', 'shipmentCarrier', 'shipmentDepartureDate']));
    shell.appendChild(createBlock('3', 'Mercancía', 'Describe qué viaja dentro del contenedor y en qué cantidad.', ['shipmentProduct', 'shipmentQuantity', 'shipmentQuantityUnit']));

    const containerWrapper = fieldWrapper('shipmentContainer');
    if (containerWrapper && !byId('registrationContainerHelp')) {
      const help = document.createElement('div');
      help.id = 'registrationContainerHelp';
      help.className = 'registration-container-help';
      containerWrapper.appendChild(help);
    }

    const actions = document.createElement('div');
    actions.className = 'registration-actions';
    actions.innerHTML = `<div id="registrationReadiness" class="registration-readiness"><span class="registration-readiness-dot"></span><span>Completa el número de contenedor para continuar</span></div>`;
    actions.appendChild(save.parentElement || save);
    shell.appendChild(actions);
    shell.appendChild(message);
    originalGrid.remove();

    const input = byId('shipmentContainer');
    input?.setAttribute('autocomplete', 'off');
    input?.setAttribute('inputmode', 'text');
    input?.addEventListener('input', syncContainerGuidance);
    syncContainerGuidance();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();

  window.RegistrationFormShell = Object.freeze({ owner: 'registration-form-shell.js', responsibility: 'visual-guidance-only' });
})();
