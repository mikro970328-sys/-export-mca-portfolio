(() => {
  'use strict';

  if (window.__clientsModuleInstalled) return;
  window.__clientsModuleInstalled = true;

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[character]));
  const state = {
    importerState:{ importers:[], client_importers:[], shipment_importers:[] },
    query:''
  };
  const SAFE_CLIENT_ERRORS = new Set([
    'El nombre del cliente es obligatorio',
    'Ese cliente ya existe',
    'Cliente no encontrado',
    'El nombre es obligatorio',
    'Otro cliente ya utiliza ese WhatsApp o correo',
    'Número de WhatsApp inválido. Usa formato internacional, por ejemplo +5351234567.',
    'No tienes permiso para realizar esta acción',
    'No autorizado'
  ]);
  const WELCOME_LABELS = {
    sent:'Enviada',
    failed:'Fallida',
    pending:'Pendiente',
    pending_config:'Pendiente'
  };
  let menu = null;
  let backdrop = null;
  let activeClientId = null;
  let menuTrigger = null;

  function canWriteClients() {
    return window.ExportMcaAccessControl?.can?.('clients.write') === true;
  }

  function safeClientMessage(error,fallback) {
    const message = String(error?.message || '').trim();
    return SAFE_CLIENT_ERRORS.has(message) ? message : fallback;
  }

  function setClientMessage(message = '', ok = false) {
    const node = byId('clientMsg');
    if (!node) return;
    node.textContent = message;
    node.className = `clients-message ${message ? (ok ? 'ok' : 'bad') : ''}`;
  }

  function setEditMessage(message = '', ok = false) {
    const node = byId('clientEditMsg');
    if (!node) return;
    node.textContent = message;
    node.className = `clients-message ${message ? (ok ? 'ok' : 'bad') : ''}`;
  }

  function formatDate(value) {
    if (!value) return 'No disponible';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'No disponible' : date.toLocaleString('es-US');
  }

  function welcomeLabel(value) {
    return WELCOME_LABELS[String(value || 'pending')] || 'Pendiente';
  }

  function welcomeClass(value) {
    const status = String(value || 'pending');
    if (status === 'sent') return 'sent';
    if (status === 'failed') return 'failed';
    return 'pending';
  }

  async function loadImporters() {
    try {
      const result = await api('/api/importers');
      state.importerState = {
        importers:Array.isArray(result.importers) ? result.importers : [],
        client_importers:Array.isArray(result.client_importers) ? result.client_importers : [],
        shipment_importers:Array.isArray(result.shipment_importers) ? result.shipment_importers : []
      };
      window.importerState = state.importerState;
    } catch (error) {
      console.error('CLIENT_IMPORTERS_LOAD_FAILED', error);
      setClientMessage('Los clientes están disponibles, pero no se pudieron cargar sus importadoras. Intenta actualizar.', false);
    }
  }

  function importerNames(clientId) {
    const ids = new Set(state.importerState.client_importers
      .filter(link => String(link.client_id) === String(clientId))
      .map(link => String(link.importer_id)));
    return state.importerState.importers
      .filter(item => ids.has(String(item.id)))
      .map(item => item.name);
  }

  function parseImporterNames(value) {
    const names = new Map();
    String(value || '').split(',').forEach(raw => {
      const clean = raw.trim().replace(/\s+/g, ' ');
      if (clean) names.set(clean.toUpperCase(), clean);
    });
    return [...names.values()];
  }

  async function syncImporters(clientId,names) {
    const result = await api('/api/importers', {
      method:'POST',
      body:JSON.stringify({ action:'sync_client', client_id:clientId, importer_names:names })
    });
    if (result.state) {
      state.importerState = result.state;
      window.importerState = state.importerState;
    } else {
      await loadImporters();
    }
    window.dispatchEvent(new CustomEvent('export-mca:importers-changed'));
  }

  function findClient(id) {
    return Array.isArray(window.clients)
      ? window.clients.find(item => String(item.id) === String(id))
      : null;
  }

  function payload(prefix = 'client') {
    return {
      name:byId(`${prefix}Name`)?.value || '',
      company:byId(`${prefix}Company`)?.value || '',
      mipyme_name:byId(`${prefix}Mipyme`)?.value || '',
      phone:byId(`${prefix}Phone`)?.value || '',
      email:byId(`${prefix}Email`)?.value || ''
    };
  }

  function searchableText(client) {
    return [
      client.name,
      client.company,
      client.mipyme_name,
      client.phone,
      client.email,
      ...importerNames(client.id)
    ].filter(Boolean).join(' ').toLocaleLowerCase('es');
  }

  function filteredClients(rows) {
    const query = state.query.trim().toLocaleLowerCase('es');
    return query ? rows.filter(client => searchableText(client).includes(query)) : rows;
  }

  function renderSummary(rows) {
    const welcomed = rows.filter(client => client.welcome_status === 'sent').length;
    const companies = rows.filter(client => client.company || client.mipyme_name).length;
    if (byId('clientTotal')) byId('clientTotal').textContent = String(rows.length);
    if (byId('clientWelcomed')) byId('clientWelcomed').textContent = String(welcomed);
    if (byId('clientCompanies')) byId('clientCompanies').textContent = String(companies);
  }

  function emptyState(hasRows) {
    if (hasRows) {
      return '<div class="clients-empty"><span class="clients-empty-icon" aria-hidden="true">⌕</span><strong>No encontramos coincidencias</strong><span>Prueba con otro nombre, empresa, teléfono o correo.</span></div>';
    }
    const action = canWriteClients()
      ? '<span>Agrega el primer contacto para comenzar tu cartera comercial.</span>'
      : '<span>Cuando se registren clientes, aparecerán aquí.</span>';
    return `<div class="clients-empty"><span class="clients-empty-icon" aria-hidden="true">+</span><strong>No hay clientes registrados</strong>${action}</div>`;
  }

  function clientRow(client) {
    const writeAccess = canWriteClients();
    const identity = String(client.name || '?').trim();
    const company = client.company || client.mipyme_name || 'Sin empresa registrada';
    return `<tr data-client-id="${esc(client.id)}">
      <td data-label="Cliente"><div class="client-person"><span class="client-avatar" aria-hidden="true">${esc(identity.charAt(0).toUpperCase())}</span><div><strong>${esc(client.name || 'Cliente sin nombre')}</strong><small>${esc(client.email || 'Correo no registrado')}</small></div></div></td>
      <td data-label="Empresa"><strong class="client-company">${esc(company)}</strong>${client.company && client.mipyme_name ? `<small class="client-company-detail">${esc(client.mipyme_name)}</small>` : ''}</td>
      <td data-label="WhatsApp"><span class="client-contact">${esc(client.phone || 'No registrado')}</span></td>
      <td data-label="Bienvenida"><span class="client-welcome-status ${welcomeClass(client.welcome_status)}"><span aria-hidden="true"></span>${esc(welcomeLabel(client.welcome_status))}</span></td>
      <td data-label="Acciones" class="client-actions-cell"><button class="client-actions-trigger" type="button" data-client-menu aria-haspopup="menu" aria-expanded="false" aria-label="Abrir acciones de ${esc(client.name || 'cliente')}"><span aria-hidden="true">•••</span><span class="clients-visually-hidden">${writeAccess ? 'Gestionar cliente' : 'Consultar cliente'}</span></button></td>
    </tr>`;
  }

  function applyClientAccess() {
    const writeAccess = canWriteClients();
    const createPanel = byId('clientCreatePanel');
    const readOnlyNote = byId('clientsReadOnlyNote');
    const layout = byId('clientsLayout');
    if (createPanel) createPanel.hidden = !writeAccess;
    if (readOnlyNote) readOnlyNote.hidden = writeAccess;
    layout?.classList.toggle('is-readonly', !writeAccess);
  }

  function render() {
    const target = byId('clients');
    if (!target) return;
    closeMenu({ restoreFocus:false });
    applyClientAccess();
    const rows = Array.isArray(window.clients) ? window.clients : [];
    const visibleRows = filteredClients(rows);
    renderSummary(rows);
    if (!visibleRows.length) {
      target.innerHTML = `${emptyState(rows.length > 0)}<div class="client-list-footer">${state.query ? `0 de ${rows.length}` : '0'} clientes</div>`;
      return;
    }
    target.innerHTML = `<div class="clients-table-wrap"><table class="clients-table"><thead><tr><th>Cliente</th><th>Empresa</th><th>WhatsApp</th><th>Bienvenida</th><th><span class="clients-visually-hidden">Acciones</span></th></tr></thead><tbody>${visibleRows.map(clientRow).join('')}</tbody></table></div><div class="client-list-footer">${state.query ? `${visibleRows.length} de ${rows.length}` : visibleRows.length} cliente${visibleRows.length === 1 ? '' : 's'}</div>`;
  }

  function infoRow(label,value) {
    return `<div class="client-information-row"><div class="client-information-label">${esc(label)}</div><div class="client-information-value">${esc(value || 'No disponible')}</div></div>`;
  }

  function openInformation(id) {
    const client = findClient(id);
    if (!client) {
      setClientMessage('El cliente ya no está disponible.', false);
      return false;
    }
    const importers = importerNames(id);
    if (typeof window.openModal !== 'function') {
      setClientMessage('No se pudo abrir la información del cliente.', false);
      return false;
    }
    window.openModal(`Información · ${client.name || 'Cliente'}`, `<div class="client-information-grid"><section>${infoRow('Nombre completo', client.name)}${infoRow('Empresa', client.company)}${infoRow('MIPYME', client.mipyme_name)}<div class="client-information-row"><div class="client-information-label">Importadoras</div><div class="client-information-value">${importers.length ? `<div class="client-importer-list">${importers.map(name => `<div class="client-importer-item">${esc(name)}</div>`).join('')}</div><div class="client-information-count">${importers.length} registro${importers.length === 1 ? '' : 's'}</div>` : 'Sin registrar'}</div></div></section><section>${infoRow('WhatsApp', client.phone)}${infoRow('Correo', client.email)}${infoRow('Bienvenida', welcomeLabel(client.welcome_status))}${infoRow('Cliente creado', formatDate(client.created_at))}${infoRow('Última actualización', formatDate(client.updated_at))}</section></div>`);
    return true;
  }

  function editorHtml(client) {
    return `<form id="clientEditForm" class="client-editor"><div class="client-editor-grid"><div><label for="clientEditName">Nombre completo <span aria-hidden="true">*</span></label><input id="clientEditName" value="${esc(client.name || '')}" required></div><div><label for="clientEditCompany">Empresa</label><input id="clientEditCompany" value="${esc(client.company || '')}"></div><div><label for="clientEditMipyme">MIPYME</label><input id="clientEditMipyme" value="${esc(client.mipyme_name || '')}"></div><div><label for="clientEditImporters">Importadoras</label><input id="clientEditImporters" value="${esc(importerNames(client.id).join(', '))}"></div><div><label for="clientEditPhone">WhatsApp <span aria-hidden="true">*</span></label><input id="clientEditPhone" value="${esc(client.phone || '')}" required></div><div><label for="clientEditEmail">Correo</label><input id="clientEditEmail" type="email" value="${esc(client.email || '')}"></div></div><div id="clientEditMsg" class="clients-message" role="status" aria-live="polite"></div><div class="client-editor-actions"><button id="cancelClientEdit" type="button" class="alt">Cancelar</button><button id="saveClientEdit" type="submit" class="clients-primary">Guardar cambios</button></div></form>`;
  }

  function openEditor(id) {
    if (!canWriteClients()) return setClientMessage('No tienes permiso para editar clientes.', false);
    const client = findClient(id);
    if (!client) return setClientMessage('El cliente ya no está disponible.', false);
    if (typeof window.openModal !== 'function') return setClientMessage('No se pudo abrir el editor del cliente.', false);
    window.openModal(`Editar cliente · ${client.name}`, editorHtml(client));
    byId('cancelClientEdit')?.addEventListener('click', () => window.closeModal?.());
    byId('clientEditForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const button = byId('saveClientEdit');
      if (!button || button.disabled) return;
      button.disabled = true;
      button.textContent = 'Guardando…';
      setEditMessage('Guardando cambios…', true);
      try {
        await api('/api/clients', {
          method:'PATCH',
          body:JSON.stringify({ id:client.id, ...payload('clientEdit') })
        });
        await syncImporters(client.id, parseImporterNames(byId('clientEditImporters')?.value));
        window.closeModal?.();
        await loadAll();
        await loadImporters();
        render();
        setClientMessage('Cliente actualizado.', true);
        window.dispatchEvent(new CustomEvent('export-mca:clients-changed'));
      } catch (error) {
        console.error('CLIENT_UPDATE_FAILED', error);
        setEditMessage(safeClientMessage(error,'No se pudo actualizar el cliente. Intenta nuevamente.'), false);
        button.disabled = false;
        button.textContent = 'Guardar cambios';
      }
    });
  }

  async function save() {
    if (!canWriteClients()) return setClientMessage('No tienes permiso para agregar clientes.', false);
    const button = byId('saveClient');
    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = 'Guardando…';
    let createdId = null;
    setClientMessage('Guardando cliente…', true);
    try {
      const result = await api('/api/clients', {
        method:'POST',
        body:JSON.stringify(payload('client'))
      });
      createdId = result.client?.id || null;
      if (createdId) await syncImporters(createdId, parseImporterNames(byId('clientImporters')?.value));
      byId('clientCreateForm')?.reset();
      await loadAll();
      await loadImporters();
      render();
      setClientMessage('Cliente guardado. La bienvenida se envía desde sus acciones.', true);
      window.dispatchEvent(new CustomEvent('export-mca:clients-changed'));
    } catch (error) {
      console.error('CLIENT_CREATE_FAILED', error);
      if (createdId) {
        try {
          await api(`/api/clients?id=${encodeURIComponent(createdId)}`, { method:'DELETE' });
        } catch (rollbackError) {
          console.error('CLIENT_CREATE_ROLLBACK_FAILED', rollbackError);
        }
      }
      setClientMessage(safeClientMessage(error,'No se pudo guardar el cliente. Revisa los datos e intenta nuevamente.'), false);
    } finally {
      button.disabled = false;
      button.textContent = 'Guardar cliente';
    }
  }

  function clientDecision(title,message,confirmLabel = 'Confirmar') {
    return new Promise(resolve => {
      document.querySelector('.client-decision-overlay')?.remove();
      const previousFocus = document.activeElement;
      const overlay = document.createElement('div');
      overlay.className = 'client-decision-overlay';
      overlay.innerHTML = `<div class="client-decision-panel" role="alertdialog" aria-modal="true" aria-labelledby="clientDecisionTitle" aria-describedby="clientDecisionDescription"><span class="client-decision-icon" aria-hidden="true">!</span><h3 id="clientDecisionTitle">${esc(title)}</h3><p id="clientDecisionDescription">${esc(message)}</p><div class="client-decision-actions"><button type="button" class="alt" data-client-decision-cancel>Cancelar</button><button type="button" class="danger" data-client-decision-confirm>${esc(confirmLabel)}</button></div></div>`;
      document.body.appendChild(overlay);
      const onKeydown = event => {
        if (event.key === 'Escape') finish(false);
      };
      const finish = value => {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
        resolve(value);
      };
      document.addEventListener('keydown', onKeydown);
      overlay.querySelector('[data-client-decision-cancel]')?.addEventListener('click', () => finish(false));
      overlay.querySelector('[data-client-decision-confirm]')?.addEventListener('click', () => finish(true));
      overlay.addEventListener('click', event => {
        if (event.target === overlay) finish(false);
      });
      requestAnimationFrame(() => overlay.querySelector('[data-client-decision-cancel]')?.focus());
    });
  }

  async function sendWelcome(id) {
    if (!canWriteClients()) return setClientMessage('No tienes permiso para enviar bienvenidas.', false);
    const client = findClient(id);
    if (!client) return setClientMessage('El cliente ya no está disponible.', false);
    setClientMessage('Enviando bienvenida…', true);
    try {
      const result = await api('/api/clients', {
        method:'PATCH',
        body:JSON.stringify({ id, action:'resend_welcome' })
      });
      const status = String(result?.welcome?.status || 'pending');
      if (status === 'sent') setClientMessage('Bienvenida enviada correctamente.', true);
      else if (status === 'pending_config') setClientMessage('La bienvenida quedó pendiente porque la plantilla de envío no está disponible.', false);
      else if (status === 'failed') setClientMessage('No se pudo enviar la bienvenida. Revisa el Centro de alertas y comunicaciones.', false);
      else setClientMessage('La bienvenida quedó pendiente de envío.', false);
      await loadAll();
      if (typeof window.loadNotifications === 'function') await window.loadNotifications();
    } catch (error) {
      console.error('CLIENT_WELCOME_FAILED', error);
      setClientMessage(safeClientMessage(error,'No se pudo procesar la bienvenida. Intenta nuevamente.'), false);
    }
  }

  async function openHistory(id,title) {
    try {
      const result = await api(`/api/history?client_id=${encodeURIComponent(id)}`);
      const events = [
        ...(result.events || []),
        ...(result.notifications || []),
        ...(result.audit_events || [])
      ].sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      const html = events.length
        ? `<div class="timeline">${events.map(event => `<div class="event"><b>${esc(event.title || event.action || event.event_type || 'Evento')}</b><div>${esc(event.details || event.status || event.delivery_status || '')}</div><div class="muted">${esc(formatDate(event.created_at))}</div></div>`).join('')}</div>`
        : '<div class="empty-state">No hay actividad registrada para este cliente.</div>';
      if (typeof window.openModal === 'function') window.openModal(`Cliente · ${title || 'Historial'}`, html);
      else setClientMessage('No se pudo abrir el historial del cliente.', false);
    } catch (error) {
      console.error('CLIENT_HISTORY_FAILED', error);
      setClientMessage('No se pudo cargar el historial del cliente. Intenta nuevamente.', false);
    }
  }

  async function deleteClient(id,name) {
    if (!canWriteClients()) return setClientMessage('No tienes permiso para eliminar clientes.', false);
    const approved = await clientDecision(
      'Eliminar cliente',
      `Se eliminará ${name || 'este cliente'}. Esta acción solo debe usarse cuando el registro ya no deba permanecer en el ERP.`,
      'Eliminar'
    );
    if (!approved) return;
    setClientMessage('Eliminando cliente…', true);
    try {
      await api(`/api/clients?id=${encodeURIComponent(id)}`, { method:'DELETE' });
      await loadAll();
      await loadImporters();
      render();
      setClientMessage('Cliente eliminado.', true);
      window.dispatchEvent(new CustomEvent('export-mca:clients-changed'));
    } catch (error) {
      console.error('CLIENT_DELETE_FAILED', error);
      setClientMessage(safeClientMessage(error,'No se pudo eliminar el cliente. Puede tener operaciones relacionadas.'), false);
    }
  }

  function ensureMenu() {
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'client-actions-backdrop';
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.appendChild(backdrop);
      backdrop.addEventListener('click', () => closeMenu());
    }
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'client-actions-popover hidden';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-hidden', 'true');
      document.body.appendChild(menu);
      menu.addEventListener('click', event => {
        const button = event.target.closest('[data-client-action]');
        if (!button) return;
        const id = activeClientId;
        const action = button.dataset.clientAction;
        const client = findClient(id);
        closeMenu();
        if (!client) return setClientMessage('El cliente ya no está disponible.', false);
        if(action==='information')openInformation(id);
        else if(action==='edit')openEditor(id);
        else if(action==='welcome')sendWelcome(id);
        else if(action==='history')openHistory(id,client.name);
        else if(action==='delete')deleteClient(id,client.name);
      });
    }
  }

  function closeMenu({ restoreFocus = true } = {}) {
    menu?.classList.add('hidden');
    menu?.classList.remove('is-mobile');
    menu?.setAttribute('aria-hidden', 'true');
    backdrop?.classList.remove('show');
    document.body.classList.remove('client-actions-open');
    if (menuTrigger) menuTrigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && menuTrigger?.isConnected) menuTrigger.focus();
    menuTrigger = null;
    activeClientId = null;
  }

  function openMenu(client,trigger) {
    ensureMenu();
    closeMenu({ restoreFocus:false });
    activeClientId = client.id;
    menuTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    const writeActions = canWriteClients() ? `<button type="button" role="menuitem" data-client-action="edit">Editar</button><button type="button" role="menuitem" data-client-action="welcome">${client.welcome_status === 'sent' ? 'Reenviar bienvenida' : 'Enviar bienvenida'}</button>` : '';
    const deleteAction = canWriteClients() ? '<button type="button" role="menuitem" class="danger" data-client-action="delete">Eliminar</button>' : '';
    menu.innerHTML = `<button type="button" role="menuitem" data-client-action="information">Información</button>${writeActions}<button type="button" role="menuitem" data-client-action="history">Historial</button>${deleteAction}`;
    const mobile = window.matchMedia('(max-width:700px)').matches;
    menu.classList.toggle('is-mobile', mobile);
    menu.classList.remove('hidden');
    menu.setAttribute('aria-hidden', 'false');
    if (mobile) {
      backdrop.classList.add('show');
      document.body.classList.add('client-actions-open');
    } else {
      const rect = trigger.getBoundingClientRect();
      const width = 232;
      const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
      const top = Math.min(rect.bottom + 8, window.innerHeight - menu.offsetHeight - 12);
      menu.style.setProperty('--client-menu-left', `${left}px`);
      menu.style.setProperty('--client-menu-top', `${Math.max(12, top)}px`);
    }
    requestAnimationFrame(() => menu.querySelector('[role="menuitem"]')?.focus());
  }

  function bindEvents() {
    byId('clientCreateForm')?.addEventListener('submit', event => {
      event.preventDefault();
      save();
    });
    byId('clientSearch')?.addEventListener('input', event => {
      state.query = event.target.value || '';
      render();
    });
    byId('clients')?.addEventListener('click', event => {
      const trigger = event.target.closest('[data-client-menu]');
      if (!trigger) return;
      const client = findClient(trigger.closest('[data-client-id]')?.dataset.clientId);
      if (client) openMenu(client,trigger);
    });
    document.addEventListener('click', event => {
      if (!menu || menu.classList.contains('hidden')) return;
      if (!menu.contains(event.target) && !event.target.closest('[data-client-menu]')) closeMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu && !menu.classList.contains('hidden')) closeMenu();
    });
  }

  async function mount() {
    const section = byId('clientsSection');
    const requiredIds = ['clientCreateForm','clientSearch','clients','clientMsg'];
    if (!section || requiredIds.some(id => !byId(id))) {
      console.error('CLIENTS_MARKUP_MISSING');
      return;
    }
    ensureMenu();
    bindEvents();
    applyClientAccess();
    render();
    window.renderClients=render;
    window.editClient=openEditor;
    window.ClientsModule=Object.freeze({ render,openInformation,openEditor,sendWelcome,openHistory,deleteClient,owner:'clients-module.js' });
    window.addEventListener('export-mca:data-loaded', render);
    await loadImporters();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})();
