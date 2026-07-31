(() => {
  if (window.__clientsModuleInstalled) return;
  window.__clientsModuleInstalled = true;

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);

  const CLIENT_FIELD_IDS = [
    'clientName',
    'clientCompany',
    'clientMipyme',
    'clientImporter',
    'clientPhone',
    'clientEmail'
  ];

  function clientsSectionHtml() {
    return `
      <div class="grid">
        <section class="card">
          <h2>Agregar cliente</h2>
          <label for="clientName">Nombre completo *</label>
          <input id="clientName" placeholder="Nombre del cliente" autocomplete="name">

          <label for="clientCompany">Empresa</label>
          <input id="clientCompany" placeholder="Empresa o negocio" autocomplete="organization">

          <label for="clientMipyme">Nombre de la MIPYME</label>
          <input id="clientMipyme" placeholder="Opcional, si el cliente tiene MIPYME">

          <label for="clientImporter">Importadora por la que importa</label>
          <input id="clientImporter" placeholder="Ejemplo: Quimimport, Consumimport...">

          <label for="clientPhone">WhatsApp *</label>
          <input id="clientPhone" placeholder="+5351234567" autocomplete="tel" inputmode="tel">

          <label for="clientEmail">Correo</label>
          <input id="clientEmail" type="email" autocomplete="email">

          <div style="margin-top:14px">
            <button id="saveClient" class="orange" type="button">Guardar cliente</button>
          </div>
          <div id="clientMsg" class="msg" role="status" aria-live="polite"></div>
        </section>

        <section class="card">
          <h2>Clientes registrados</h2>
          <div id="clients"></div>
        </section>
      </div>`;
  }

  function clientPayload(mode = 'create') {
    const id = name => mode === 'create'
      ? `client${name}`
      : `clientEdit${name}`;

    return {
      name: byId(id('Name'))?.value || '',
      company: byId(id('Company'))?.value || '',
      mipyme_name: byId(id('Mipyme'))?.value || '',
      importer_name: byId(id('Importer'))?.value || '',
      phone: byId(id('Phone'))?.value || '',
      email: byId(id('Email'))?.value || ''
    };
  }

  function welcomeLabel(status) {
    const normalized = String(status || 'pending').toLowerCase();
    if (normalized === 'sent') return 'Reenviar bienvenida';
    if (normalized === 'failed') return 'Reintentar bienvenida';
    return 'Enviar bienvenida';
  }

  function createMessage(welcomeResult = {}) {
    const status = String(welcomeResult.status || 'pending').toLowerCase();
    if (status === 'sent') return 'Cliente guardado y bienvenida enviada.';
    if (status === 'failed') return 'Cliente guardado. La bienvenida falló y puede reintentarse desde Acciones.';
    return 'Cliente guardado. La bienvenida está pendiente de envío.';
  }

  function renderClientTable() {
    const target = byId('clients');
    if (!target) return;

    if (!Array.isArray(clients) || clients.length === 0) {
      target.innerHTML = '<div class="empty-state">No hay clientes registrados.</div>';
      return;
    }

    target.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Empresa</th>
            <th>WhatsApp</th>
            <th>Bienvenida</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${clients.map(client => `
            <tr data-client-id="${escapeHtml(client.id)}">
              <td><b>${escapeHtml(client.name)}</b></td>
              <td>${escapeHtml(client.company || '-')}</td>
              <td>${escapeHtml(client.phone || '-')}</td>
              <td><span class="pill ${client.welcome_status === 'sent' ? 'done' : ''}">${escapeHtml(client.welcome_status || 'pending')}</span></td>
              <td>
                <div class="actions">
                  <button class="alt" type="button" data-client-action="edit">Editar</button>
                  <button class="success" type="button" data-client-action="welcome">${welcomeLabel(client.welcome_status)}</button>
                  <button class="alt" type="button" data-client-action="history">Historial</button>
                  <button class="danger" type="button" data-client-action="delete">Eliminar</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  async function saveClientRecord() {
    const button = byId('saveClient');
    if (!button || button.disabled) return;

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Guardando...';

    try {
      const result = await api('/api/clients', {
        method: 'POST',
        body: JSON.stringify(clientPayload('create'))
      });

      note('clientMsg', createMessage(result.welcome), true);
      CLIENT_FIELD_IDS.forEach(id => {
        const field = byId(id);
        if (field) field.value = '';
      });
      await loadAll();
    } catch (error) {
      note('clientMsg', error.message);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function editorHtml(client) {
    return `
      <div class="grid">
        <div>
          <label for="clientEditName">Nombre completo *</label>
          <input id="clientEditName" value="${escapeHtml(client.name || '')}" autocomplete="name">
        </div>
        <div>
          <label for="clientEditCompany">Empresa</label>
          <input id="clientEditCompany" value="${escapeHtml(client.company || '')}" autocomplete="organization">
        </div>
        <div>
          <label for="clientEditMipyme">Nombre de la MIPYME</label>
          <input id="clientEditMipyme" value="${escapeHtml(client.mipyme_name || '')}">
        </div>
        <div>
          <label for="clientEditImporter">Importadora por la que importa</label>
          <input id="clientEditImporter" value="${escapeHtml(client.importer_name || '')}">
        </div>
        <div>
          <label for="clientEditPhone">WhatsApp *</label>
          <input id="clientEditPhone" value="${escapeHtml(client.phone || '')}" autocomplete="tel" inputmode="tel">
        </div>
        <div>
          <label for="clientEditEmail">Correo</label>
          <input id="clientEditEmail" type="email" value="${escapeHtml(client.email || '')}" autocomplete="email">
        </div>
      </div>
      <div class="toolbar" style="justify-content:flex-end;margin-top:18px">
        <button id="cancelClientEdit" class="alt" type="button">Cancelar</button>
        <button id="saveClientEdit" class="orange" type="button">Guardar cambios</button>
      </div>
      <div id="clientEditMsg" class="msg" role="status" aria-live="polite"></div>`;
  }

  function showEditorMessage(message) {
    const target = byId('clientEditMsg');
    if (!target) return;
    target.textContent = message;
    target.className = 'msg bad';
  }

  function openClientEditor(id) {
    const client = Array.isArray(clients)
      ? clients.find(item => String(item.id) === String(id))
      : null;

    if (!client) {
      alert('Cliente no encontrado. Actualiza la lista e inténtalo nuevamente.');
      return;
    }

    openModal(`Editar cliente · ${client.name}`, editorHtml(client));

    byId('cancelClientEdit')?.addEventListener('click', closeModal, { once: true });
    byId('saveClientEdit')?.addEventListener('click', async () => {
      const button = byId('saveClientEdit');
      if (!button || button.disabled) return;

      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Guardando...';

      try {
        await api('/api/clients', {
          method: 'PATCH',
          body: JSON.stringify({ id: client.id, ...clientPayload('edit') })
        });
        closeModal();
        await loadAll();
      } catch (error) {
        showEditorMessage(error.message);
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  }

  async function handleClientAction(event) {
    const button = event.target.closest('[data-client-action]');
    if (!button) return;

    const row = button.closest('[data-client-id]');
    const id = row?.dataset.clientId;
    const client = Array.isArray(clients)
      ? clients.find(item => String(item.id) === String(id))
      : null;
    if (!id || !client) return;

    const action = button.dataset.clientAction;
    if (action === 'edit') {
      openClientEditor(id);
      return;
    }
    if (action === 'welcome') {
      await welcome(id);
      return;
    }
    if (action === 'history') {
      await clientHistory(id, client.name);
      return;
    }
    if (action === 'delete') {
      await delClient(id, client.name);
    }
  }

  function mount() {
    const section = byId('clientsSection');
    if (!section) return;

    section.innerHTML = clientsSectionHtml();
    byId('saveClient')?.addEventListener('click', saveClientRecord);
    byId('clients')?.addEventListener('click', event => {
      Promise.resolve(handleClientAction(event)).catch(error => alert(error.message));
    });

    window.renderClients = renderClientTable;
    window.editClient = openClientEditor;
    try { renderClients = renderClientTable; } catch {}
    try { editClient = openClientEditor; } catch {}

    renderClientTable();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
