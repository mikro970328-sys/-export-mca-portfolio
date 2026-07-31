(() => {
  if (window.__clientInformationInstalled) return;
  window.__clientInformationInstalled = true;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);

  const formatDate = value => {
    if (!value) return 'No disponible';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('es-US');
  };

  const findClient = id => Array.isArray(clients)
    ? clients.find(client => String(client.id) === String(id))
    : null;

  const row = (label, value) => `
    <div style="padding:12px 0;border-bottom:1px solid #e6ebf2">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#667085;margin-bottom:5px">${escapeHtml(label)}</div>
      <div style="font-size:15px;color:#152238;word-break:break-word">${escapeHtml(value || 'No disponible')}</div>
    </div>`;

  function openClientInformation(id) {
    const client = findClient(id);
    if (!client) {
      alert('Cliente no encontrado. Actualiza la lista e inténtalo nuevamente.');
      return;
    }

    const content = `
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 22px" class="client-information-grid">
        <section>
          ${row('Nombre completo', client.name)}
          ${row('Empresa', client.company)}
          ${row('Nombre de la MIPYME', client.mipyme_name)}
          ${row('Importadora por la que importa', client.importer_name)}
        </section>
        <section>
          ${row('WhatsApp', client.phone)}
          ${row('Correo', client.email)}
          ${row('Estado de bienvenida', client.welcome_status || 'pending')}
          ${row('Error de bienvenida', client.welcome_error)}
          ${row('Fecha de bienvenida', formatDate(client.welcome_sent_at))}
          ${row('Cliente creado', formatDate(client.created_at))}
          ${row('Última actualización', formatDate(client.updated_at))}
        </section>
      </div>
      <style>@media(max-width:700px){.client-information-grid{grid-template-columns:1fr!important}}</style>`;

    openModal(`Información · ${client.name || 'Cliente'}`, content);
  }

  function insertInformationAction(trigger) {
    const rowElement = trigger.closest('[data-client-id]');
    const clientId = rowElement?.dataset.clientId;
    const popover = document.querySelector('.client-actions-popover:not(.hidden)');
    if (!clientId || !popover || popover.querySelector('[data-client-information]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Información';
    button.dataset.clientInformation = clientId;
    popover.prepend(button);
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-client-menu-trigger]');
    if (trigger) queueMicrotask(() => insertInformationAction(trigger));
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-client-information]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    document.querySelector('.client-actions-popover')?.classList.add('hidden');
    document.querySelector('.client-actions-backdrop')?.classList.remove('show');
    document.body.classList.remove('client-actions-open');
    openClientInformation(button.dataset.clientInformation);
  }, true);
})();
