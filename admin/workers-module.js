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
            <p>Consulta el equipo y registra sus salarios y propinas por mes desde Finanzas → Rentabilidad → Empresa.</p>
            <div class="workers-hero-state">
              <span id="workersOperationalState">Preparando directorio laboral</span>
              <span id="workersLastUpdated">Preparando…</span>
            </div>
          </div>
          <div class="workers-head-actions native-workspace-actions">
            <button type="button" class="alt workers-secondary" data-worker-action="reload">Actualizar</button>
            <button id="workersPayrollLink" type="button" class="alt workers-secondary" data-worker-action="payroll" title="${can('finance.write')?'Registrar el salario y las propinas de un mes':'Consultar los salarios del equipo'}" ${can('finance.read') ? '' : 'hidden'}>${can('finance.write')?'Registrar salario mensual':'Ver salarios y propinas'}</button>
            <button id="workersCreateButton" type="button" class="workers-primary" data-worker-action="create" ${can('administration.workers.write') ? '' : 'hidden'}>Nuevo trabajador</button>
          </div>
        </div>
      </header>
      <div id="workersSummary" class="workers-summary native-workspace-summary" aria-label="Resumen de trabajadores"></div>

      <section class="workers-command" aria-label="Buscar y filtrar trabajadores">
        <div class="workers-tabs" role="tablist" aria-label="Estado laboral">
          <button type="button" role="tab" data-worker-filter="active" aria-selected="true" aria-controls="workersDirectory">Activos</button>
          <button type="button" role="tab" data-worker-filter="all" aria-selected="false" aria-controls="workersDirectory">Todos</button>
          <button type="button" role="tab" data-worker-filter="inactive" aria-selected="false" aria-controls="workersDirectory">Desactivados</button>
        </div>
        <div class="workers-search-row">        <label class="workers-search-field" for="workersSearch">
          <span>Buscar trabajadores</span>
          <input id="workersSearch" type="search" placeholder="Nombre, cargo o teléfono" autocomplete="off">
        </label>
<button type="button" class="workers-clear" data-worker-action="clear">Limpiar búsqueda</button></div>
      </section>

      <div id="workersReadOnlyNote" class="workers-readonly" role="note" hidden>
        <span>Puedes consultar el equipo y su historial. La edición requiere permiso de administración de trabajadores.</span>
      </div>
      <div id="workersFeedback" class="workers-message" role="status" aria-live="polite"></div>

      <section id="workersPanel" class="workers-panel native-workspace-panel" aria-labelledby="workersDirectoryTitle">
        <div class="workers-panel-head">
          <div>
            <h3 id="workersDirectoryTitle">Equipo registrado</h3>
          </div>
          <span id="workersResultCount" class="workers-result-count" aria-live="polite">Consultando…</span>
        </div>
        <div class="workers-columns" aria-hidden="true"><span>Trabajador</span><span>Cargo</span><span>Contacto</span><span>Estado</span><span>Acciones</span></div>
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
    if (updated) updated.textC