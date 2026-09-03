(() => {
  'use strict';

  if (window.__workersModuleInstalled) return;
  window.__workersModuleInstalled = true;

  const OWNER = 'workers-module.js';
  const state = {
    workers:[], writeAccess:false, mounted:false, loaded:false, loading:false,
    loadError:'', lastUpdated:null, status:'active', query:'', busyAction:'',
    selectedWorkerId:null, modalMode:'', modalRequest:0, lastFocused:null
  };

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[character]);
  const can = permission => window.ExportMcaAccessControl?.can?.(permission) === true;
  const SAFE_WORKER_MESSAGES = new Set([
    'El nombre completo es obligatorio',
    'El número de teléfono no es válido',
    'Ese teléfono ya está registrado',
    'El motivo de desactivación es obligatorio',
    'No hay cambios para guardar',
    'Trabajador inválido',
    'No tienes permiso para realizar esta acción',
    'Método no permitido'
  ]);
  const WORKER_ERROR_MESSAGES = Object.freeze({
    WORKER_WRITE_PERMISSION_REQUIRED:'No tienes permiso para modificar trabajadores.',
    WORKER_ALREADY_INACTIVE:'El trabajador ya está desactivado.',
    WORKER_ALREADY_ACTIVE:'El trabajador ya está activo.'
  });

  function safeWorkerMessage(error, fallback = 'No se pudo completar la operación. Intenta nuevamente.') {
    const message = String(error?.message || '').trim();
    const code = String(error?.code || '').trim();
    if (WORKER_ERROR_MESSAGES[code]) return WORKER_ERROR_MESSAGES[code];
    if (error?.status === 401) return 'Tu sesión terminó. Inicia sesión nuevamente para continuar.';
    if (error?.status === 403) return 'No tienes permiso para completar esta acción.';
    if (SAFE_WORKER_MESSAGES.has(message)) return message;
    return fallback;
  }

  function reportError(area, error, fallback) {
    console.error('WORKERS_UI_FAILED', {
      area,
      status:error?.status || null,
      code:error?.code || null,
      error
    });
    return safeWorkerMessage(error, fallback);
  }

  async function request(path, options = {}) {
    if (typeof window.api !== 'function') throw new Error('API no disponible');
    return window.api(path, options);
  }

  function normalizeSearch(value) {
    return String(value || '').trim().toLowerCase();
  }

  function workerMetrics(workers = []) {
    const active = workers.filter(worker => worker?.is_active !== false);
    const inactive = workers.filter(worker => worker?.is_active === false);
    return {
      total:workers.length,
      active:active.length,
      inactive:inactive.length,
      withoutPosition:active.filter(worker => !String(worker?.position || '').trim()).length
    };
  }

  function visibleWorkers(workers = [], filters = {}) {
    const status = String(filters.status || 'all');
    const query = normalizeSearch(filters.query);
    return workers.filter(worker => {
      const active = worker?.is_active !== false;
      if (status === 'active' && !active) return false;
      if (status === 'inactive' && active) return false;
      if (!query) return true;
      return normalizeSearch([
        worker?.full_name,
        worker?.phone,
        worker?.position,
        worker?.deactivation_reason
      ].filter(Boolean).join(' ')).includes(query);
    });
  }

  function currentFilters() {
    return { status:state.status, query:state.query };
  }

  function getState() {
    return {
      owner:OWNER,
      loaded:state.loaded,
      loading:state.loading,
      loadError:Boolean(state.loadError),
      lastUpdated:state.lastUpdated,
      status:state.status,
      total:state.workers.length,
      visible:visibleWorkers(state.workers, currentFilters()).length,
      writeAccess:state.writeAccess,
      metrics:workerMetrics(state.workers),
      modalOpen:Boolean(state.modalMode)
    };
  }

  function shellMarkup() {
    return `<div class="workers-shell native-workspace-shell">
      <header class="workers-head native-workspace-hero">
        <div class="workers-hero-main">
          <div class="native-workspace-heading">
            <span class="native-workspace-kicker">Administración de equipo</span>
            <h2>Trabajadores</h2>
            <p>Consulta disponibilidad, conserva el historial laboral y administra quién puede recibir nuevas asignaciones.</p>
            <div class="workers-hero-state">
              <span class="workers-state-dot" aria-hidden="true"></span>
              <span id="workersOperationalState">Preparando directorio laboral</span>
              <span id="workersLastUpdated">Preparando…</span>
            </div>
          </div>
          <div class="workers-head-actions native-workspace-actions">
            <button type="button" class="alt workers-secondary" data-worker-action="reload">Actualizar</button>
            <button id="workersCreateButton" type="button" class="workers-primary" data-worker-action="create" ${can('administration.workers.write') ? '' : 'hidden'}>Nuevo trabajador</button>
          </div>
        </div>
        <div id="workersSummary" class="workers-summary native-workspace-summary" aria-label="Resumen de trabajadores"></div>
      </header>

      <section class="workers-command" aria-label="Buscar y filtrar trabajadores">
        <label class="workers-search-field" for="workersSearch">
          <span>Buscar</span>
          <input id="workersSearch" type="search" placeholder="Nombre, cargo o teléfono" autocomplete="off">
        </label>
        <div class="workers-tabs" role="tablist" aria-label="Estado laboral">
          <button type="button" role="tab" data-worker-filter="active" aria-selected="true" aria-controls="workersDirectory">Activos</button>
          <button type="button" role="tab" data-worker-filter="all" aria-selected="false" aria-controls="workersDirectory">Todos</button>
          <button type="button" role="tab" data-worker-filter="inactive" aria-selected="false" aria-controls="workersDirectory">Desactivados</button>
        </div>
        <button type="button" class="workers-clear" data-worker-action="clear">Limpiar búsqueda</button>
      </section>

      <div id="workersReadOnlyNote" class="workers-readonly" role="note" hidden>
        <span class="workers-readonly-icon" aria-hidden="true">i</span>
        <span>Puedes consultar el equipo y su historial. La edición requiere permiso de administración de trabajadores.</span>
      </div>
      <div id="workersFeedback" class="workers-message" role="status" aria-live="polite"></div>

      <section id="workersPanel" class="workers-panel native-workspace-panel" aria-labelledby="workersDirectoryTitle">
        <div class="workers-panel-head">
          <div>
            <span class="workers-eyebrow">Directorio laboral</span>
            <h3 id="workersDirectoryTitle">Equipo registrado</h3>
            <p>Abre el historial o usa únicamente las acciones habilitadas por el backend para cada persona.</p>
          </div>
          <span id="workersResultCount" class="workers-result-count" aria-live="polite">Consultando…</span>
        </div>
        <div id="workersDirectory" class="workers-directory" role="list"></div>
      </section>
    </div>

    <div id="workersModal" class="workers-modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="workersModalTitle">
      <div class="workers-dialog" role="document" tabindex="-1">
        <div class="workers-modal-head">
          <div><span class="workers-modal-kicker">Directorio laboral</span><h3 id="workersModalTitle">Trabajador</h3></div>
          <button type="button" class="alt workers-modal-close" data-worker-modal-close aria-label="Cerrar diálogo">Cerrar</button>
        </div>
        <div id="workersModalBody" class="workers-modal-body"></div>
      </div>
    </div>`;
  }

  function setMessage(message = '', ok = true) {
    const node = byId('workersFeedback');
    if (!node) return;
    node.textContent = message;
    node.className = `workers-message ${message ? (ok ? 'ok' : 'bad') : ''}`;
  }

  function setModalMessage(id, message = '', ok = false) {
    const node = byId(id);
    if (!node) return;
    node.textContent = message;
    node.className = `workers-message ${message ? (ok ? 'ok' : 'bad') : ''}`;
  }

  function formatUpdatedAt(value) {
    if (!value) return 'Preparando…';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Actualización disponible';
    return `Actualizado ${date.toLocaleTimeString('es-US', { hour:'2-digit', minute:'2-digit' })}`;
  }

  function formatDate(value) {
    if (!value) return 'Fecha no disponible';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
    return date.toLocaleString('es-US', {
      year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit'
    });
  }

  function initials(value) {
    const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return `${parts[0][0] || ''}${parts.length > 1 ? parts.at(-1)[0] || '' : ''}`.toUpperCase();
  }

  function actionAllowed(worker, action) {
    return worker?.capabilities?.actions?.[action]?.allowed === true;
  }

  function workerById(id) {
    return state.workers.find(worker => String(worker.id) === String(id));
  }

  function renderOperationalState() {
    const metrics = workerMetrics(state.workers);
    const status = byId('workersOperationalState');
    const updated = byId('workersLastUpdated');
    const panel = byId('workersPanel');
    if (status) {
      status.textContent = state.loading
        ? 'Sincronizando directorio laboral'
        : state.loadError
          ? 'El directorio requiere atención'
          : `${metrics.active} disponible${metrics.active === 1 ? '' : 's'} para asignaciones`;
    }
    if (updated) updated.textContent = formatUpdatedAt(state.lastUpdated);
    if (panel) panel.setAttribute('aria-busy', state.loading ? 'true' : 'false');
  }

  function renderSummary() {
    const node = byId('workersSummary');
    if (!node) return;
    const metrics = workerMetrics(state.workers);
    const cards = [
      ['workersMetricActive', 'Activos', metrics.active],
      ['workersMetricInactive', 'Desactivados', metrics.inactive],
      ['workersMetricTotal', 'Total', metrics.total],
      ['workersMetricWithoutPosition', 'Activos sin cargo', metrics.withoutPosition]
    ];
    node.innerHTML = cards.map(([id, label, value]) => `<div id="${id}" class="workers-summary-card native-workspace-summary-card"><span>${label}</span><strong>${value}</strong></div>`).join('');
  }

  function renderAccessState() {
    const create = byId('workersCreateButton');
    const readOnly = byId('workersReadOnlyNote');
    if (create) create.hidden = state.loaded ? !state.writeAccess : !can('administration.workers.write');
    if (readOnly) readOnly.hidden = !state.loaded || state.writeAccess;
  }

  function renderFilters() {
    document.querySelectorAll('#workersSection [data-worker-filter]').forEach(button => {
      const selected = button.dataset.workerFilter === state.status;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function workerActions(worker) {
    const actions = [];
    if (actionAllowed(worker, 'history')) actions.push(`<button type="button" class="workers-action secondary" data-worker-action="history" data-worker-id="${esc(worker.id)}">Historial</button>`);
    if (actionAllowed(worker, 'edit')) actions.push(`<button type="button" class="workers-action secondary" data-worker-action="edit" data-worker-id="${esc(worker.id)}">Editar</button>`);
    if (actionAllowed(worker, 'deactivate')) actions.push(`<button type="button" class="workers-action danger" data-worker-action="deactivate" data-worker-id="${esc(worker.id)}">Desactivar</button>`);
    if (actionAllowed(worker, 'reactivate')) actions.push(`<button type="button" class="workers-action success" data-worker-action="reactivate" data-worker-id="${esc(worker.id)}">Reactivar</button>`);
    return actions.length ? actions.join('') : '<span class="workers-action-note">Consulta habilitada</span>';
  }

  function workerCard(worker) {
    const inactive = worker?.is_active === false;
    const position = String(worker?.position || '').trim() || 'Cargo sin especificar';
    return `<article class="workers-card ${inactive ? 'is-inactive' : ''}" role="listitem">
      <div class="workers-card-main">
        <span class="workers-avatar" aria-hidden="true">${esc(initials(worker?.full_name))}</span>
        <div class="workers-identity">
          <div class="workers-card-title-row">
            <h4>${esc(worker?.full_name || 'Trabajador sin nombre')}</h4>
            <span class="workers-status ${inactive ? 'inactive' : 'active'}">${inactive ? 'Desactivado' : 'Activo'}</span>
          </div>
          <p>${esc(position)}</p>
        </div>
      </div>
      <dl class="workers-card-meta">
        <div><dt>Contacto</dt><dd><a class="workers-phone" href="tel:${esc(worker?.phone || '')}">${esc(worker?.phone || 'Sin teléfono')}</a></dd></div>
        <div><dt>Cargo</dt><dd>${esc(position)}</dd></div>
        <div><dt>Actualización</dt><dd>${esc(formatDate(worker?.updated_at || worker?.created_at))}</dd></div>
        ${inactive ? `<div class="workers-card-reason"><dt>Motivo</dt><dd>${esc(worker?.deactivation_reason || 'Sin motivo registrado')}</dd></div>` : ''}
      </dl>
      <div class="workers-card-foot">${workerActions(worker)}</div>
    </article>`;
  }

  function emptyCopy() {
    if (state.query) return ['No hay coincidencias para esta búsqueda', 'Prueba con otro nombre, cargo o número de teléfono.'];
    if (state.status === 'inactive') return ['No hay trabajadores desactivados', 'Cuando se desactive una persona, aparecerá aquí con su motivo.'];
    if (state.status === 'active') return ['No hay trabajadores activos', 'Agrega el primer trabajador para comenzar a asignarlo a operaciones.'];
    return ['No hay trabajadores registrados', 'El directorio aparecerá aquí cuando se agregue la primera persona.'];
  }

  function renderDirectory() {
    const target = byId('workersDirectory');
    const result = byId('workersResultCount');
    if (!target) return;

    if (state.loading && !state.loaded) {
      if (result) result.textContent = 'Consultando…';
      target.innerHTML = '<div class="workers-loading" role="status"><span class="workers-spinner" aria-hidden="true"></span><div><strong>Organizando el directorio</strong><p>Estamos consultando personas, estados y acciones disponibles.</p></div></div>';
      return;
    }

    if (state.loadError && !state.loaded) {
      if (result) result.textContent = 'Sin datos';
      target.innerHTML = '<div class="workers-empty error" role="status"><span class="workers-empty-icon" aria-hidden="true">!</span><strong>No pudimos cargar los trabajadores</strong><p>Revisa tu conexión e inténtalo nuevamente.</p><button type="button" class="alt workers-secondary" data-worker-action="reload">Intentar nuevamente</button></div>';
      return;
    }

    const rows = visibleWorkers(state.workers, currentFilters());
    if (result) result.textContent = `${rows.length} de ${state.workers.length}`;
    if (!rows.length) {
      const [title, detail] = emptyCopy();
      target.innerHTML = `<div class="workers-empty"><span class="workers-empty-icon" aria-hidden="true">${state.status === 'inactive' ? '○' : '✓'}</span><strong>${esc(title)}</strong><p>${esc(detail)}</p>${state.query ? '<button type="button" class="alt workers-secondary" data-worker-action="clear">Limpiar búsqueda</button>' : ''}</div><div class="workers-footer">0 trabajadores visibles</div>`;
      return;
    }

    target.innerHTML = `<div class="workers-directory-list">${rows.map(workerCard).join('')}</div><div class="workers-footer">${rows.length} trabajador${rows.length === 1 ? '' : 'es'} visible${rows.length === 1 ? '' : 's'} · ${state.workers.length} en el directorio</div>`;
  }

  function render() {
    renderOperationalState();
    renderSummary();
    renderAccessState();
    renderFilters();
    renderDirectory();
  }

  async function loadWorkers(options = {}) {
    if (state.loading) return false;
    state.loading = true;
    state.loadError = '';
    setMessage('');
    render();
    try {
      const result = await request('/api/admins?resource=workers');
      state.workers = Array.isArray(result.workers) ? result.workers : [];
      state.writeAccess = result.write_access === true && can('administration.workers.write');
      state.loaded = true;
      state.lastUpdated = new Date().toISOString();
      window.exportMcaWorkers = state.workers.filter(worker => worker.is_active !== false);
      if (options.successMessage) setMessage(options.successMessage, true);
      return true;
    } catch (error) {
      state.loadError = reportError('load', error, 'No se pudo cargar el equipo. Intenta nuevamente.');
      setMessage(state.loadError, false);
      return false;
    } finally {
      state.loading = false;
      render();
    }
  }

  function focusFirstModalControl() {
    const modal = byId('workersModal');
    if (!modal || modal.classList.contains('hidden')) return;
    const target = modal.querySelector('input:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])');
    target?.focus?.();
  }

  function openModal(title, body, mode, workerId = null) {
    const modal = byId('workersModal');
    if (!modal) return 0;
    if (modal.classList.contains('hidden')) state.lastFocused = document.activeElement;
    state.modalMode = mode || '';
    state.selectedWorkerId = workerId;
    state.modalRequest += 1;
    const titleNode = byId('workersModalTitle');
    const bodyNode = byId('workersModalBody');
    if (titleNode) titleNode.textContent = title;
    if (bodyNode) bodyNode.innerHTML = body;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    modal.removeAttribute('aria-busy');
    document.body.classList.add('workers-dialog-open');
    setTimeout(focusFirstModalControl, 0);
    return state.modalRequest;
  }

  function closeModal() {
    const modal = byId('workersModal');
    if (!modal || modal.classList.contains('hidden') || state.busyAction) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    modal.removeAttribute('aria-busy');
    document.body.classList.remove('workers-dialog-open');
    if (byId('workersModalBody')) byId('workersModalBody').innerHTML = '';
    state.modalMode = '';
    state.selectedWorkerId = null;
    state.modalRequest += 1;
    const previous = state.lastFocused;
    state.lastFocused = null;
    if (previous?.isConnected) previous.focus?.();
  }

  function setModalBusy(busy) {
    const modal = byId('workersModal');
    if (!modal) return;
    modal.setAttribute('aria-busy', busy ? 'true' : 'false');
    modal.querySelectorAll('button,input,textarea').forEach(control => {
      control.disabled = busy;
    });
  }

  function finishModalMutation(action) {
    if (state.busyAction && state.busyAction !== action) return;
    state.busyAction = '';
    setModalBusy(false);
  }

  function openCreateWorker() {
    if (!state.writeAccess) return;
    openModal('Nuevo trabajador', `<form id="workerCreateForm" class="workers-modal-form">
      <label><span>Nombre completo</span><input id="workerName" name="full_name" autocomplete="name" placeholder="Nombre y apellidos" required></label>
      <div class="workers-form-grid">
        <label><span>Teléfono / WhatsApp</span><input id="workerPhone" name="phone" autocomplete="tel" inputmode="tel" placeholder="+5351234567" required></label>
        <label><span>Cargo</span><input id="workerPosition" name="position" placeholder="Ventas, logística, comercial…"></label>
      </div>
      <div id="workerMsg" class="workers-message" role="status" aria-live="polite"></div>
      <div class="workers-modal-actions"><button type="button" class="alt workers-secondary" data-worker-modal-close>Cancelar</button><button id="saveWorker" type="submit" class="workers-primary">Guardar trabajador</button></div>
    </form>`, 'create');
  }

  async function saveWorker(event) {
    event.preventDefault();
    if (!state.writeAccess || state.busyAction) return setModalMessage('workerMsg', 'No tienes permiso para agregar trabajadores.');
    state.busyAction = 'create';
    setModalMessage('workerMsg');
    setModalBusy(true);
    try {
      await request('/api/admins?resource=workers', {
        method:'POST',
        body:JSON.stringify({
          full_name:byId('workerName')?.value || '',
          phone:byId('workerPhone')?.value || '',
          position:byId('workerPosition')?.value || ''
        })
      });
      finishModalMutation('create');
      closeModal();
      await loadWorkers({ successMessage:'Trabajador guardado correctamente.' });
    } catch (error) {
      setModalMessage('workerMsg', reportError('create', error, 'No se pudo guardar el trabajador. Revisa los datos e intenta nuevamente.'));
    } finally {
      finishModalMutation('create');
    }
  }

  async function openWorkerHistory(id) {
    const worker = workerById(id);
    if (!worker || !actionAllowed(worker, 'history')) return;
    const requestId = openModal(`Historial · ${worker.full_name}`, '<div id="workerHistoryContent" class="workers-loading" role="status"><span class="workers-spinner" aria-hidden="true"></span><div><strong>Cargando historial</strong><p>Consultando cambios de estado registrados.</p></div></div>', 'history', id);
    try {
      const result = await request(`/api/admins?resource=worker_history&worker_id=${encodeURIComponent(id)}`);
      if (requestId !== state.modalRequest || state.modalMode !== 'history') return;
      const history = Array.isArray(result.history) ? result.history : [];
      const content = byId('workerHistoryContent');
      if (!content) return;
      content.className = 'workers-history';
      content.innerHTML = history.length ? history.map(event => {
        const deactivated = event.action === 'deactivated';
        return `<article class="workers-history-event"><span class="workers-history-dot ${deactivated ? 'inactive' : 'active'}" aria-hidden="true"></span><div><strong>${deactivated ? 'Trabajador desactivado' : 'Trabajador reactivado'}</strong><p>${esc(event.reason || (deactivated ? 'Sin motivo registrado' : 'Sin nota de reactivación'))}</p><time>${esc(formatDate(event.created_at))}</time></div></article>`;
      }).join('') : '<div class="workers-empty compact"><strong>Sin cambios de estado</strong><p>Este trabajador todavía no tiene movimientos en su historial.</p></div>';
    } catch (error) {
      if (requestId !== state.modalRequest || state.modalMode !== 'history') return;
      const content = byId('workerHistoryContent');
      if (content) {
        content.className = 'workers-empty error compact';
        content.innerHTML = `<strong>No se pudo cargar el historial</strong><p>${esc(reportError('history', error, 'Intenta nuevamente.'))}</p>`;
      }
    }
  }

  function openWorkerEditor(id) {
    const worker = workerById(id);
    if (!worker || !actionAllowed(worker, 'edit')) return;
    openModal('Editar trabajador', `<form id="editWorkerForm" class="workers-modal-form">
      <label><span>Nombre completo</span><input id="editWorkerName" name="full_name" value="${esc(worker.full_name)}" autocomplete="name" required></label>
      <div class="workers-form-grid">
        <label><span>Teléfono / WhatsApp</span><input id="editWorkerPhone" name="phone" value="${esc(worker.phone)}" autocomplete="tel" inputmode="tel" required></label>
        <label><span>Cargo</span><input id="editWorkerPosition" name="position" value="${esc(worker.position || '')}" placeholder="Ventas, logística, comercial…"></label>
      </div>
      <div id="editWorkerMsg" class="workers-message" role="status" aria-live="polite"></div>
      <div class="workers-modal-actions"><button type="button" class="alt workers-secondary" data-worker-modal-close>Cancelar</button><button id="confirmWorkerEdit" type="submit" class="workers-primary">Guardar cambios</button></div>
    </form>`, 'edit', id);
  }

  async function saveWorkerChanges(event) {
    event.preventDefault();
    const id = state.selectedWorkerId;
    const worker = workerById(id);
    if (!worker || !actionAllowed(worker, 'edit') || state.busyAction) return setModalMessage('editWorkerMsg', 'Esta acción ya no está disponible.');
    state.busyAction = 'edit';
    setModalMessage('editWorkerMsg');
    setModalBusy(true);
    try {
      await request('/api/admins?resource=workers', {
        method:'PATCH',
        body:JSON.stringify({
          id,
          full_name:byId('editWorkerName')?.value || '',
          phone:byId('editWorkerPhone')?.value || '',
          position:byId('editWorkerPosition')?.value || ''
        })
      });
      finishModalMutation('edit');
      closeModal();
      await loadWorkers({ successMessage:'Datos del trabajador actualizados.' });
    } catch (error) {
      setModalMessage('editWorkerMsg', reportError('edit', error, 'No se pudieron guardar los cambios. Intenta nuevamente.'));
    } finally {
      finishModalMutation('edit');
    }
  }

  function openDeactivateWorker(id) {
    const worker = workerById(id);
    if (!worker || !actionAllowed(worker, 'deactivate')) return;
    openModal('Desactivar trabajador', `<form id="deactivateWorkerForm" class="workers-modal-form">
      <div class="workers-decision"><span class="workers-decision-icon danger" aria-hidden="true">!</span><div><strong>${esc(worker.full_name)}</strong><p>Dejará de estar disponible para nuevas asignaciones. Su historial se conserva.</p></div></div>
      <label><span>Motivo de desactivación</span><textarea id="workerDeactivationReason" name="reason" rows="4" placeholder="Ejemplo: terminó la relación laboral" required></textarea></label>
      <div id="deactivateWorkerMsg" class="workers-message" role="status" aria-live="polite"></div>
      <div class="workers-modal-actions"><button type="button" class="alt workers-secondary" data-worker-modal-close>Cancelar</button><button id="confirmWorkerDeactivate" type="submit" class="workers-action danger">Desactivar trabajador</button></div>
    </form>`, 'deactivate', id);
  }

  async function deactivateWorker(event) {
    event.preventDefault();
    const id = state.selectedWorkerId;
    const worker = workerById(id);
    const reason = String(byId('workerDeactivationReason')?.value || '').trim();
    if (!worker || !actionAllowed(worker, 'deactivate') || state.busyAction) return setModalMessage('deactivateWorkerMsg', 'Esta acción ya no está disponible.');
    if (reason.length < 3) return setModalMessage('deactivateWorkerMsg', 'Escribe el motivo de desactivación.');
    state.busyAction = 'deactivate';
    setModalMessage('deactivateWorkerMsg');
    setModalBusy(true);
    try {
      await request('/api/admins?resource=workers', {
        method:'PATCH',
        body:JSON.stringify({ id, is_active:false, deactivation_reason:reason })
      });
      finishModalMutation('deactivate');
      closeModal();
      await loadWorkers({ successMessage:'Trabajador desactivado. El historial quedó actualizado.' });
    } catch (error) {
      setModalMessage('deactivateWorkerMsg', reportError('deactivate', error, 'No se pudo desactivar al trabajador. Intenta nuevamente.'));
    } finally {
      finishModalMutation('deactivate');
    }
  }

  function openReactivateWorker(id) {
    const worker = workerById(id);
    if (!worker || !actionAllowed(worker, 'reactivate')) return;
    openModal('Reactivar trabajador', `<form id="reactivateWorkerForm" class="workers-modal-form">
      <div class="workers-decision"><span class="workers-decision-icon success" aria-hidden="true">✓</span><div><strong>${esc(worker.full_name)}</strong><p>Volverá a estar disponible para nuevas asignaciones.</p></div></div>
      <label><span>Nota de reactivación</span><textarea id="workerReactivationReason" name="reason" rows="3" placeholder="Ejemplo: reincorporación o nuevo contrato"></textarea><small>La nota es opcional y quedará guardada en el historial.</small></label>
      <div id="reactivateWorkerMsg" class="workers-message" role="status" aria-live="polite"></div>
      <div class="workers-modal-actions"><button type="button" class="alt workers-secondary" data-worker-modal-close>Cancelar</button><button id="confirmWorkerReactivate" type="submit" class="workers-action success">Reactivar trabajador</button></div>
    </form>`, 'reactivate', id);
  }

  async function reactivateWorker(event) {
    event.preventDefault();
    const id = state.selectedWorkerId;
    const worker = workerById(id);
    if (!worker || !actionAllowed(worker, 'reactivate') || state.busyAction) return setModalMessage('reactivateWorkerMsg', 'Esta acción ya no está disponible.');
    state.busyAction = 'reactivate';
    setModalMessage('reactivateWorkerMsg');
    setModalBusy(true);
    try {
      await request('/api/admins?resource=workers', {
        method:'PATCH',
        body:JSON.stringify({
          id,
          is_active:true,
          reactivation_reason:byId('workerReactivationReason')?.value.trim() || ''
        })
      });
      finishModalMutation('reactivate');
      closeModal();
      await loadWorkers({ successMessage:'Trabajador reactivado y disponible para asignaciones.' });
    } catch (error) {
      setModalMessage('reactivateWorkerMsg', reportError('reactivate', error, 'No se pudo reactivar al trabajador. Intenta nuevamente.'));
    } finally {
      finishModalMutation('reactivate');
    }
  }

  function resetSearch() {
    state.query = '';
    const search = byId('workersSearch');
    if (search) search.value = '';
    render();
  }

  function handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-worker-modal-close]')) return closeModal();
    if (target === byId('workersModal')) return closeModal();
    const filter = target.closest('[data-worker-filter]');
    if (filter) {
      state.status = filter.dataset.workerFilter;
      render();
      return;
    }
    const button = target.closest('[data-worker-action]');
    if (!button) return;
    const id = button.dataset.workerId;
    const action = button.dataset.workerAction;
    if (action === 'reload') return loadWorkers();
    if (action === 'clear') return resetSearch();
    if (action === 'create') return openCreateWorker();
    if (action === 'history') return openWorkerHistory(id);
    if (action === 'edit') return openWorkerEditor(id);
    if (action === 'deactivate') return openDeactivateWorker(id);
    if (action === 'reactivate') return openReactivateWorker(id);
  }

  function handleInput(event) {
    if (event.target?.id !== 'workersSearch') return;
    state.query = event.target.value;
    renderDirectory();
  }

  function handleSubmit(event) {
    if (event.target?.id === 'workerCreateForm') return saveWorker(event);
    if (event.target?.id === 'editWorkerForm') return saveWorkerChanges(event);
    if (event.target?.id === 'deactivateWorkerForm') return deactivateWorker(event);
    if (event.target?.id === 'reactivateWorkerForm') return reactivateWorker(event);
  }

  function handleSectionKeydown(event) {
    const tab = event.target?.closest?.('[data-worker-filter]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('#workersSection [data-worker-filter]')];
    const current = tabs.indexOf(tab);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === 'Home'
      ? tabs[0]
      : event.key === 'End'
        ? tabs.at(-1)
        : tabs[(current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next?.focus?.();
    next?.click?.();
  }

  function handleDocumentKeydown(event) {
    const modal = byId('workersModal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter(node => node.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function renderBase() {
    const section = byId('workersSection');
    if (!section) return false;
    section.dataset.workersOwner = 'workers-module.js';
    section.innerHTML = shellMarkup();
    section.addEventListener('click', handleClick);
    section.addEventListener('input', handleInput);
    section.addEventListener('submit', handleSubmit);
    section.addEventListener('keydown', handleSectionKeydown);
    document.addEventListener('keydown', handleDocumentKeydown);
    state.mounted = true;
    render();
    return true;
  }

  async function mount() {
    if (state.mounted || !can('administration.workers.read')) return;
    if (!renderBase()) return;
    await loadWorkers();
    window.addEventListener('export-mca:section-changed', event => {
      if (event.detail?.id === 'workersSection' && !state.loaded) loadWorkers();
    });
  }

  window.WorkersModule = Object.freeze({
    owner:OWNER,
    load:loadWorkers,
    visibleWorkers,
    workerMetrics,
    render,
    getState,
    openHistory:openWorkerHistory,
    state
  });
  window.reloadWorkersList = loadWorkers;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})();
