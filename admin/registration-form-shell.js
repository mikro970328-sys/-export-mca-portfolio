(() => {
  if (window.__registrationFormShellInstalled) return;
  window.__registrationFormShellInstalled = true;

  const byId = id => document.getElementById(id);

  function installStyles() {
    if (byId('registrationFormShellStyles')) return;
    const style = document.createElement('style');
    style.id = 'registrationFormShellStyles';
    style.textContent = `
      #registerContainerSection .registration-shell{display:grid;gap:18px}
      #registerContainerSection .registration-intro{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding:16px 18px;border:1px solid #dce6f2;border-radius:14px;background:#f8fbff}
      #registerContainerSection .registration-intro h3{margin:0 0 5px;color:var(--navy);font-size:16px}
      #registerContainerSection .registration-intro p{margin:0;color:var(--muted);font-size:12px;line-height:1.5}
      #registerContainerSection .registration-required{white-space:nowrap;padding:7px 10px;border-radius:999px;background:#fff3e8;color:#9b4a00;font-size:11px;font-weight:800}
      #registerContainerSection .registration-block{border:1px solid var(--line);border-radius:14px;padding:16px 18px;background:#fff}
      #registerContainerSection .registration-block-head{display:flex;align-items:center;gap:11px;margin-bottom:12px}
      #registerContainerSection .registration-step{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#edf3ff;color:var(--navy);font-size:12px;font-weight:900;flex:none}
      #registerContainerSection .registration-block h3{margin:0;color:var(--navy);font-size:15px}
      #registerContainerSection .registration-block p{margin:3px 0 0;color:var(--muted);font-size:11px}
      #registerContainerSection .registration-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 18px}
      #registerContainerSection .registration-field-full{grid-column:1/-1}
      #registerContainerSection .registration-actions{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding-top:2px}
      #registerContainerSection .registration-readiness{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}
      #registerContainerSection .registration-readiness-dot{width:9px;height:9px;border-radius:50%;background:#b8c2cf}
      #registerContainerSection .registration-readiness.ready{color:var(--ok);font-weight:700}
      #registerContainerSection .registration-readiness.ready .registration-readiness-dot{background:var(--ok)}
      #registerContainerSection .registration-container-help{font-size:11px;color:var(--muted);margin-top:5px;line-height:1.4}
      #registerContainerSection .registration-container-help.valid{color:var(--ok);font-weight:700}
      #registerContainerSection .registration-container-help.invalid{color:var(--bad);font-weight:700}
      #registerContainerSection #saveShipment{min-width:180px;padding:12px 18px}
      @media(max-width:760px){
        #registerContainerSection .registration-intro{display:grid}
        #registerContainerSection .registration-required{justify-self:start}
        #registerContainerSection .registration-fields{grid-template-columns:1fr}
        #registerContainerSection .registration-field-full{grid-column:auto}
        #registerContainerSection .registration-actions{display:grid;grid-template-columns:1fr}
        #registerContainerSection #saveShipment{width:100%}
      }
    `;
    document.head.appendChild(style);
  }

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
    const card = section?.querySelector(':scope > .card');
    const originalGrid = card?.querySelector(':scope > .grid');
    const save = byId('saveShipment');
    const message = byId('shipmentMsg');
    if (!section || !card || !originalGrid || !save || !message) return;
    if (card.dataset.registrationShell === 'guided-v1') return;

    installStyles();
    card.dataset.registrationShell = 'guided-v1';

    const title = card.querySelector(':scope > h2');
    if (title) title.textContent = 'Registrar contenedor';

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
