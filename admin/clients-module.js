(() => {
  if (window.__clientsModuleInstalled) return;
  window.__clientsModuleInstalled = true;

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const formatDate = value => {
    if (!value) return 'No disponible';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('es-US');
  };

  const CLIENT_FIELD_IDS = [
    'clientName', 'clientCompany', 'clientMipyme',
    'clientImporters', 'clientPhone', 'clientEmail'
  ];

  let importerState = { importers: [], client_importers: [], shipment_importers: [] };
  let activeMenuTrigger = null;
  let activeMenuClientId = null;
  let menuBackdrop = null;
  let menuPopover = null;

  function installStyles() {
    if (byId('clientsModuleStyles')) return;
    const style = document.createElement('style');
    style.id = 'clientsModuleStyles';
    style.textContent = `
      .client-actions-cell{width:1%;white-space:nowrap;text-align:right}
      .client-actions-trigger{width:38px!important;height:38px!important;min-width:38px!important;padding:0!important;border:1px solid #cfd7e3!important;border-radius:10px!important;background:#fff!important;color:#06204a!important;font-size:24px!important;line-height:1!important;display:inline-grid!important;place-items:center!important;box-shadow:none!important}
      .client-actions-trigger:hover{background:#f7f9fc!important}
      .client-actions-popover{position:fixed;z-index:1800;min-width:230px;max-width:calc(100vw - 24px);background:#fff;border:1px solid #dfe5ee;border-radius:12px;padding:7px;box-shadow:0 18px 45px rgba(6,32,74,.22)}
      .client-actions-popover.hidden{display:none!important}
      .client-actions-popover button{width:100%!important;display:flex!important;align-items:center!important;justify-content:flex-start!important;text-align:left!important;background:#fff!important;color:#152238!important;border:0!important;border-radius:8px!important;padding:11px 12px!important;font-size:14px!important;font-weight:700!important;white-space:nowrap!important}
      .client-actions-popover button:hover{background:#f4f7fb!important}
      .client-actions-popover button.danger{color:#b42318!important;border-top:1px solid #e6ebf2!important;border-radius:0 0 8px 8px!important;margin-top:5px!important;padding-top:14px!important}
      .client-actions-backdrop{display:none;position:fixed;inset:0;z-index:1799;background:rgba(6,20,42,.35)}
      .client-actions-backdrop.show{display:block}
      .client-information-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 22px}
      .client-information-row{padding:12px 0;border-bottom:1px solid #e6ebf2}
      .client-information-label{font-size:11px;font-weight:800;text-transform:uppercase;color:#667085;margin-bottom:5px}
      .client-information-value{font-size:15px;color:#152238;word-break:break-word}
      .client-importer-help{font-size:11px;color:var(--muted);margin-top:5px;line-height:1.45}
      .client-importer-detail-list{display:grid;gap:8px;margin-top:7px}
      .client-importer-detail-item{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid #e1e7ef;border-radius:10px;background:#f8fafc;font-weight:700;color:#152238}
      .client-importer-detail-item::before{content:'↳';color:#667085;font-weight:900}
      .client-importer-summary{margin-top:7px;font-size:12px;color:#667085}
      @media(max-width:700px){
        .client-actions-cell{position:sticky!important;right:0!important;background:#fff!important;z-index:3!important}
        .client-actions-popover{left:12px!important;right:12px!important;bottom:12px!important;top:auto!important;min-width:0!important;width:auto!important;border-radius:16px!important;padding:10px!important}
        .client-actions-popover::before{content:'Acciones del cliente';display:block;padding:5px 8px 10px;font-size:16px;font-weight:800;color:#06204a;border-bottom:1px solid #e6ebf2;margin-bottom:5px}
        .client-actions-popover button{padding:14px 12px!important;font-size:15px!important}
        .client-information-grid{grid-template-columns:1fr}
        body.client-actions-open{overflow:hidden!important}
      }
    `;
    document.head.appendChild(style);
  }

  async function loadImporterState() {
    try {
      const result = await api('/api/importers');
      importerState = {
        importers: result.importers || [],
        client_importers: result.client_importers || [],
        shipment_importers: result.shipment_importers || []
      };
      window.importerState = importerState;
      return true;
    } catch (error) {
      console.error('[clients importers]', error);
      return false;
    }
  }

  function importerNamesForClient(clientId) {
    const ids = new Set(
      importerState.client_importers
        .filter(link => String(link.client_id) === String(clientId))
        .map(link => String(link.importer_id))
    );
    return importerState.importers
      .filter(importer => ids.has(String(importer.id)))
      .map(importer => importer.name);
  }

  function splitImporterNames(value) {
    const map = new Map();
    String(value || '').split(',').forEach(item => {
      const clean = item.trim().replace(/\s+/g, ' ');
      if (clean) map.set(clean.toUpperCase(), clean);
    });
    return [...map.values()];
  }

  function importerInputValue(clientId) {
    return importerNamesForClient(clientId).join(', ');
  }

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
          <label for="clientImporters">Importadoras cubanas registradas</label>
          <input id="clientImporters" placeholder="Ejemplo: Quimimport, Consumimport, Alimport">
          <div class="client-importer-help">Puedes registrar varias importadoras separadas por comas. Se guardan en la ficha del cliente, pero no se acumulan en la tabla principal.</div>
          <label for="clientPhone">WhatsApp *</label>
          <input id="clientPhone" placeholder="+5351234567" autocomplete="tel" inputmode="tel">
          <label for="clientEmail">Correo</label>
          <input id="clientEmail" type="email" autocomplete="email">
          <div style="margin-top:14px"><button id="saveClient" class="orange" type="button">Guardar cliente</button></div>
          <div id="clientMsg" class="msg" role="status" aria-live="polite"></div>
        </section>
        <section class="card"><h2>Clientes registrados</h2><div id="clients"></div></section>
      </div>`;
  }

  function clientPayload(mode = 'create') {
    const id = name => mode === 'create' ? `client${name}` : `clientEdit${name}`;
    return {
      name: byId(id('Name'))?.value || '',
      company: byId(id('Company'))?.value || '',
      mipyme_name: byId(id('Mipyme'))?.value || '',
      phone: byId(id('Phone'))?.value || '',
      email: byId(id('Email'))?.value || ''
    };
  }

  function importerPayload(mode = 'create') {
    const id = mode === 'create' ? 'clientImporters' : 'clientEditImporters';
    return splitImporterNames(byId(id)?.value || '');
  }

  async function syncClientImporters(clientId, names) {
    const result = await api('/api/importers', {
      method: 'POST',
      body: JSON.stringify({ action: 'sync_client', client_id: clientId, importer_names: names })
    });
    if (result.state) {
      importerState = result.state;
      window.importerState = importerState;
    } else {
      await loadImporterState();
    }
    window.dispatchEvent(new CustomEvent('export-mca:importers-changed'));
    return result;
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

  function findClient(id) {
    return Array.isArray(clients) ? clients.find(item => String(item.id) === String(id)) : null;
  }

  function notifyClientsChanged() {
    window.dispatchEvent(new CustomEvent('export-mca:clients-changed'));
  }

  function informationRow(label, value) {
    return `<div class="client-information-row"><div class="client-information-label">${escapeHtml(label)}</div><div class="client-information-value">${escapeHtml(value || 'No disponible')}</div></div>`;
  }

  function importerInformationBlock(clientId) {
    const importerNames = importerNamesForClient(clientId);
    return `<div class="client-information-row">
      <div class="client-information-label">Empresas / importadoras donde está inscrito</div>
      <div class="client-information-value">
        ${importerNames.length
          ? `<div class="client-importer-detail-list">${importerNames.map(name => `<div class="client-importer-detail-item">${escapeHtml(name)}</div>`).join('')}</div><div class="client-importer-summary">${importerNames.length} registro${importerNames.length === 1 ? '' : 's'} asociado${importerNames.length === 1 ? '' : 's'} a este cliente.</div>`
          : '<span class="muted">Sin registrar</span>'}
      </div>
    </div>`;
  }

  function informationHtml(client) {
    return `
      <div class="client-information-grid">
        <section>
          ${informationRow('Nombre completo', client.name)}
          ${informationRow('Empresa', client.company)}
          ${informationRow('Nombre de la MIPYME', client.mipyme_name)}
          ${importerInformationBlock(client.id)}
        </section>
        <section>
          ${informationRow('WhatsApp', client.phone)}
          ${informationRow('Correo', client.email)}
          ${informationRow('Estado de bienvenida', client.welcome_status || 'pending')}
          ${informationRow('Error de bienvenida', client.welcome_error)}
          ${informationRow('Fecha de bienvenida', formatDate(client.welcome_sent_at))}
          ${informationRow('Cliente creado', formatDate(client.created_at))}
          ${informationRow('Última actualización', formatDate(client.updated_at))}
        </section>
      </div>`;
  }

  function openClientInformation(id) {
    const client = findClient(id);
    if (!client) return alert('Cliente no encontrado. Actualiza la lista e inténtalo nuevamente.');
    openModal(`Información · ${client.name || 'Cliente'}`, informationHtml(client));
  }

  function closeClientMenu() {
    menuPopover?.classList.add('hidden');
    if (menuPopover) menuPopover.innerHTML = '';
    menuBackdrop?.classList.remove('show');
    document.body.classList.remove('client-actions-open');
    activeMenuTrigger?.setAttribute('aria-expanded', 'false');
    activeMenuTrigger = null;
    activeMenuClientId = null;
  }

  function positionClientMenu(trigger) {
    if (!menuPopover || window.matchMedia('(max-width:700px)').matches) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(230, menuPopover.offsetWidth || 230);
    const height = Math.max(230, menuPopover.offsetHeight || 230);
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    let top = rect.bottom + 7;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 7);
    Object.assign(menuPopover.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
  }

  function openClientMenu(client, trigger) {
    if (!menuPopover || !menuBackdrop) return;
    if (activeMenuTrigger === trigger && !menuPopover.classList.contains('hidden')) return closeClientMenu();
    closeClientMenu();
    activeMenuTrigger = trigger;
    activeMenuClientId = client.id;
    trigger.setAttribute('aria-expanded', 'true');
    const actions = [
      ['information', 'Información', ''],
      ['edit', 'Editar', ''],
      ['welcome', welcomeLabel(client.welcome_status), ''],
      ['history', 'Historial', ''],
      ['delete', 'Eliminar', 'danger']
    ];
    menuPopover.innerHTML = actions.map(([action, label, className]) => `<button type="button" class="${className}" data-client-action="${action}" data-client-id="${escapeHtml(client.id)}">${escapeHtml(label)}</button>`).join('');
    menuPopover.classList.remove('hidden');
    if (window.matchMedia('(max-width:700px)').matches) {
      menuBackdrop.classList.add('show');
      document.body.classList.add('client-actions-open');
    } else {
      requestAnimationFrame(() => positionClientMenu(trigger));
    }
  }

  function ensureActionMenu() {
    installStyles();
    menuBackdrop = document.querySelector('.client-actions-backdrop') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'client-actions-backdrop' }));
    menuPopover = document.querySelector('.client-actions-popover') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'client-actions-popover hidden' }));
    menuPopover.setAttribute('role', 'menu');
    menuBackdrop.addEventListener('click', closeClientMenu);
    menuPopover.addEventListener('click', event => {
      const button = event.target.closest('[data-client-action]');
      if (!button) return;
      const action = button.dataset.clientAction;
      const id = button.dataset.clientId || activeMenuClientId;
      closeClientMenu();
      Promise.resolve(executeClientAction(action, id)).catch(error => alert(error.message));
    });
    document.addEventListener('pointerdown', event => {
      if (menuPopover?.classList.contains('hidden')) return;
      if (!menuPopover?.contains(event.target) && !activeMenuTrigger?.contains(event.target)) closeClientMenu();
    }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeClientMenu(); });
    window.addEventListener('resize', closeClientMenu);
    window.addEventListener('scroll', closeClientMenu, true);
  }

  function renderClientTable() {
    const target = byId('clients');
    if (!target) return;
    closeClientMenu();
    if (!Array.isArray(clients) || clients.length === 0) {
      target.innerHTML = '<div class="empty-state">No hay clientes registrados.</div>';
      return;
    }
    target.innerHTML = `<table><thead><tr><th>Nombre</th><th>Empresa</th><th>WhatsApp</th><th>Bienvenida</th><th>Acciones</th></tr></thead><tbody>${clients.map(client => `
      <tr data-client-id="${escapeHtml(client.id)}">
        <td><b>${escapeHtml(client.name)}</b></td>
        <td>${escapeHtml(client.company || '-')}</td>
        <td>${escapeHtml(client.phone || '-')}</td>
        <td><span class="pill ${client.welcome_status === 'sent' ? 'done' : ''}">${escapeHtml(client.welcome_status || 'pending')}</span></td>
        <td class="client-actions-cell"><button class="client-actions-trigger" type="button" data-client-menu-trigger aria-label="Abrir acciones del cliente" aria-haspopup="menu" aria-expanded="false" title="Acciones">⋮</button></td>
      </tr>`).join('')}</tbody></table>`;
  }

  async function saveClientRecord() {
    const button = byId('saveClient');
    if (!button || button.disabled) return;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Guardando...';
    let rollbackClientId = null;
    try {
      const importerNames = importerPayload('create');
      const result = await api('/api/clients', { method: 'POST', body: JSON.stringify(clientPayload('create')) });
      rollbackClientId = result.client?.id || null;
      if (rollbackClientId) {
        try {
          await syncClientImporters(rollbackClientId, importerNames);
        } catch (syncError) {
          try { await api('/api/clients?id=' + encodeURIComponent(rollbackClientId), { method: 'DELETE' }); } catch {}
          rollbackClientId = null;
          throw syncError;
        }
      }
      rollbackClientId = null;
      note('clientMsg', createMessage(result.welcome), true);
      CLIENT_FIELD_IDS.forEach(id => { const field = byId(id); if (field) field.value = ''; });
      try { await loadAll(); } catch (refreshError) { console.error('[clients refresh]', refreshError); }
      await loadImporterState();
      notifyClientsChanged();
      renderClientTable();
    } catch (error) {
      note('clientMsg', error.message);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function editorHtml(client) {
    return `<div class="grid">
      <div><label for="clientEditName">Nombre completo *</label><input id="clientEditName" value="${escapeHtml(client.name || '')}" autocomplete="name"></div>
      <div><label for="clientEditCompany">Empresa</label><input id="clientEditCompany" value="${escapeHtml(client.company || '')}" autocomplete="organization"></div>
      <div><label for="clientEditMipyme">Nombre de la MIPYME</label><input id="clientEditMipyme" value="${escapeHtml(client.mipyme_name || '')}"></div>
      <div><label for="clientEditImporters">Importadoras cubanas registradas</label><input id="clientEditImporters" value="${escapeHtml(importerInputValue(client.id))}" placeholder="Quimimport, Consumimport, Alimport"><div class="client-importer-help">Varias importadoras pueden estar asociadas al mismo cliente. Sepáralas por comas.</div></div>
      <div><label for="clientEditPhone">WhatsApp *</label><input id="clientEditPhone" value="${escapeHtml(client.phone || '')}" autocomplete="tel" inputmode="tel"></div>
      <div><label for="clientEditEmail">Correo</label><input id="clientEditEmail" type="email" value="${escapeHtml(client.email || '')}" autocomplete="email"></div>
    </div><div class="toolbar" style="justify-content:flex-end;margin-top:18px"><button id="cancelClientEdit" class="alt" type="button">Cancelar</button><button id="saveClientEdit" class="orange" type="button">Guardar cambios</button></div><div id="clientEditMsg" class="msg" role="status" aria-live="polite"></div>`;
  }

  function openClientEditor(id) {
    const client = findClient(id);
    if (!client) return alert('Cliente no encontrado. Actualiza la lista e inténtalo nuevamente.');
    openModal(`Editar cliente · ${client.name}`, editorHtml(client));
    byId('cancelClientEdit')?.addEventListener('click', closeModal, { once: true });
    byId('saveClientEdit')?.addEventListener('click', async () => {
      const button = byId('saveClientEdit');
      if (!button || button.disabled) return;
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Guardando...';
      try {
        await api('/api/clients', { method: 'PATCH', body: JSON.stringify({ id: client.id, ...clientPayload('edit') }) });
        await syncClientImporters(client.id, importerPayload('edit'));
        closeModal();
        await loadAll();
        await loadImporterState();
        notifyClientsChanged();
        renderClientTable();
      } catch (error) {
        const target = byId('clientEditMsg');
        if (target) {
          target.textContent = error.message;
          target.className = 'msg bad';
        }
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  }

  async function executeClientAction(action, id) {
    const client = findClient(id);
    if (!client) return;
    if (action === 'information') return openClientInformation(id);
    if (action === 'edit') return openClientEditor(id);
    if (action === 'welcome') return welcome(id);
    if (action === 'history') return clientHistory(id, client.name);
    if (action === 'delete') return delClient(id, client.name);
  }

  function handleClientListClick(event) {
    const trigger = event.target.closest('[data-client-menu-trigger]');
    if (!trigger) return;
    const client = findClient(trigger.closest('[data-client-id]')?.dataset.clientId);
    if (client) openClientMenu(client, trigger);
  }

  async function mount() {
    const section = byId('clientsSection');
    if (!section) return;
    section.innerHTML = clientsSectionHtml();
    ensureActionMenu();
    await loadImporterState();
    byId('saveClient')?.addEventListener('click', saveClientRecord);
    byId('clients')?.addEventListener('click', handleClientListClick);
    window.renderClients = renderClientTable;
    window.editClient = openClientEditor;
    try { renderClients = renderClientTable; } catch {}
    try { editClient = openClientEditor; } catch {}
    renderClientTable();
    window.addEventListener('export-mca:data-loaded', renderClientTable);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
