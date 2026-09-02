(() => {
  'use strict';

  if (window.__workersModuleInstalled) return;
  window.__workersModuleInstalled = true;

  const byId = id => document.getElementById(id);
  const escW = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[character]));
  const state = { workers:[], writeAccess:false, mounted:false, loading:false };
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

  function can(permission) {
    return window.ExportMcaAccessControl?.can?.(permission) === true;
  }

  function safeWorkerMessage(error, fallback = 'No se pudo completar la operación. Intenta nuevamente.') {
    const message = String(error?.message || '').trim();
    return SAFE_WORKER_MESSAGES.has(message) ? message : fallback;
  }

  function reportError(area, error, fallback) {
    console.error(`[workers ${area}]`, error);
    return safeWorkerMessage(error, fallback);
  }

  function setMessage(id, text = '', ok = false) {
    const node = byId(id);
    if (!node) return;
    node.textContent = text;
    node.className = `workers-message ${text ? (ok ? 'ok' : 'bad') : ''}`;
  }

  function setBusy(button, busy, busyLabel = 'Guardando…') {
    if (!button) return;
    if (busy) {
      button.dataset.idleLabel = button.textContent;
      button.textContent = busyLabel;
    } else if (button.dataset.idleLabel) {
      button.textContent = button.dataset.idleLabel;
      delete button.dataset.idleLabel;
    }
    button.disabled = busy;
  }

  function actionAllowed(worker, action) {
    return worker?.capabilities?.actions?.[action]?.allowed === true;
  }

  function workerById(id) {
    return state.workers.find(worker => String(worker.id) === String(id));
  }

  function formatDate(value) {
    if (!value) return 'Fecha no disponible';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : date.toLocaleString('es-US');
  }

  function workerRows(list, inactive = false) {
    if (!list.length) {
      return `<div class="workers-empty"><span class="workers-empty-icon" aria-hidden="true">${inactive ? '○' : '✓'}</span><strong>${inactive ? 'No hay trabajadores desactivados' : 'No hay trabajadores activos'}</strong><span>${inactive ? 'Cuando se desactive una persona, aparecerá aquí con su motivo.' : 'Agrega el primer trabajador para comenzar a asignarlo a operaciones.'}</span></div>`;
    }

    return `<div class="workers-table-wrap"><table class="workers-table"><thead><tr><th>Trabajador</th><th>Cargo</th><th>Contacto</th>${inactive ? '<th>Motivo</th>' : ''}<th>Estado</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody>${list.map(worker => {
      const history = actionAllowed(worker, 'history') ? `<button type="button" class="workers-action secondary" data-worker-action="history" data-worker-id="${escW(worker.id)}">Historial</button>` : '';
      const edit = actionAllowed(worker, 'edit') ? `<button type="button" class="workers-action secondary" data-worker-action="edit" data-worker-id="${escW(worker.id)}">Editar</button>` : '';
      const statusAction = actionAllowed(worker, 'deactivate')
        ? `<button type="button" class="workers-action danger" data-worker-action="deactivate" data-worker-id="${escW(worker.id)}">Desactivar</button>`
        : actionAllowed(worker, 'reactivate')
          ? `<button type="button" class="workers-action success" data-worker-action="reactivate" data-worker-id="${escW(worker.id)}">Reactivar</button>`
          : '';
      return `<tr><td data-label="Trabajador"><div class="workers-person"><span class="workers-avatar" aria-hidden="true">${escW(String(worker.full_name || '?').charAt(0).toUpperCase())}</span><div><strong>${escW(worker.full_name)}</strong><small>${escW(worker.position || 'Cargo sin especificar')}</small></div></div></td><td data-label="Cargo">${escW(worker.position || 'Sin especificar')}</td><td data-label="Contacto"><a class="workers-phone" href="tel:${escW(worker.phone)}">${escW(worker.phone)}</a></td>${inactive ? `<td data-label="Motivo">${escW(worker.deactivation_reason || 'Sin motivo registrado')}</td>` : ''}<td data-label="Estado"><span class="workers-status ${inactive ? 'inactive' : 'active'}">${inactive ? 'Desactivado' : 'Activo'}</span></td><td data-label="Acciones"><div class="workers-actions">${history}${edit}${statusAction}</div></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function renderWorkers() {
    const target = byId('workers');
    if (!target) return;
    const active = state.workers.filter(worker => worker.is_active !== false);
    const inactive = state.workers.filter(worker => worker.is_active === false);

    byId('workersActiveCount').textContent = String(active.length);
    byId('workersInactiveCount').textContent = String(inactive.length);
    byId('workerCreatePanel').hidden = !state.writeAccess;
    byId('workersReadOnlyNote').hidden = state.writeAccess;

    target.innerHTML = `<section class="workers-roster-section" aria-labelledby="workersActiveTitle"><div class="workers-section-head"><div><span class="workers-eyebrow">Equipo disponible</span><h3 id="workersActiveTitle">Trabajadores activos</h3><p>Personas disponibles para asignar a operaciones, productos y publicaciones.</p></div><button type="button" class="workers-refresh" data-worker-action="reload">Actualizar lista</button></div>${workerRows(active)}</section><section class="workers-roster-section inactive" aria-labelledby="workersInactiveTitle"><div class="workers-section-head"><div><span class="workers-eyebrow">Histórico laboral</span><h3 id="workersInactiveTitle">Trabajadores desactivados</h3><p>Personas que ya no están disponibles para nuevas asignaciones.</p></div></div>${workerRows(inactive, true)}</section>`;
  }

  function renderLoadFailure(message) {
    const target = byId('workers');
    if (!target) return;
    target.innerHTML = `<div class="workers-empty error" role="status"><span class="workers-empty-icon" aria-hidden="true">!</span><strong>No pudimos cargar los trabajadores</strong><span>${escW(message)}</span><button type="button" class="workers-refresh" data-worker-action="reload">Intentar nuevamente</button></div>`;
  }

  async function loadWorkers() {
    if (state.loading) return;
    state.loading = true;
    const target = byId('workers');
    if (target) target.innerHTML = '<div class="workers-loading" role="status"><span class="workers-spinner" aria-hidden="true"></span>Cargando equipo…</div>';
    try {
      const result = await api('/api/admins?resource=workers');
      state.workers = Array.isArray(result.workers) ? result.workers : [];
      state.writeAccess = result.write_access === true && can('administration.workers.write');
      window.exportMcaWorkers = state.workers.filter(worker => worker.is_active !== false);
      setMessage('workersFeedback');
      renderWorkers();
    } catch (error) {
      renderLoadFailure(reportError('load', error, 'No se pudo cargar el equipo. Intenta nuevamente.'));
    } finally {
      state.loading = false;
    }
  }

  async function saveWorker(event) {
    event.preventDefault();
    if (!state.writeAccess) return setMessage('workerMsg', 'No tienes permiso para agregar trabajadores.');
    const button = byId('saveWorker');
    setMessage('workerMsg');
    setBusy(button, true, 'Guardando…');
    try {
      await api('/api/admins?resource=workers', {
        method:'POST',
        body:JSON.stringify({
          full_name:byId('workerName')?.value || '',
          phone:byId('workerPhone')?.value || '',
          position:byId('workerPosition')?.value || ''
        })
      });
      byId('workerCreateForm')?.reset();
      await loadWorkers();
      setMessage('workersFeedback', 'Trabajador guardado correctamente.', true);
    } catch (error) {
      setMessage('workerMsg', reportError('create', error, 'No se pudo guardar el trabajador. Revisa los datos e intenta nuevamente.'));
    } finally {
      setBusy(button, false);
    }
  }

  async function openWorkerHistory(id) {
    const worker = workerById(id);
    if (!worker || !actionAllowed(worker, 'history')) return;
    openModal(`Historial · ${worker.full_name}`, '<div id="workerHistoryContent" class="workers-loading" role="status"><span class="workers-spinner" aria-hidden="true"></span>Cargando historial…</div>');
    try {
      const result = await api(`/api/admins?resource=worker_history&worker_id=${encodeURIComponent(id)}`);
      const history = Array.isArray(result.history) ? result.history : [];
      const content = byId('workerHistoryContent');
      if (!content) return;
      content.className = 'workers-history';
      content.innerHTML = history.length ? history.map(event => {
        const deactivated = event.action === 'deactivated';
        return `<article class="workers-history-event"><span class="workers-history-dot ${deactivated ? 'inactive' : 'active'}" aria-hidden="true"></span><div><strong>${deactivated ? 'Trabajador desactivado' : 'Trabajador reactivado'}</strong><p>${escW(event.reason || (deactivated ? 'Sin motivo registrado' : 'Sin nota de reactivación'))}</p><time>${escW(formatDate(event.created_at))}</time></div></article>`;
      }).join('') : '<div class="workers-empty compact"><strong>Sin cambios de estado</strong><span>Este trabajador todavía no tiene movimientos en su historial.</span></div>';
    } catch (error) {
      const content = byId('workerHistoryContent');
      if (content) {
        content.className = 'workers-empty error compact';
        content.textContent = reportError('history', error, 'No se pudo cargar el historial. Intenta nuevamente.');
      }
    }
  }

  function openWorkerEditor(id) {
    const worker = workerById(id);
    if (!worker || !actionAllowed(worker, 'edit')) return;
    openModal('Editar trabajador', `<form id="editWorkerForm" class="workers-modal-form"><div class="workers-form-grid"><div><label for="editWorkerName">Nombre completo</label><input id="editWorkerName" value="${escW(worker.full_name)}" required></div><div><label for="editWorkerPhone">Teléfono / WhatsApp</label><input id="editWorkerPhone" value="${escW(worker.phone)}" required></div></div><div><label for="editWorkerPosition">Cargo</label><input id="editWorkerPosition" value="${escW(worker.position || '')}" placeholder="Ventas, logística, comercial…"></div><div id="editWorkerMsg" class="workers-message" role="status" aria-live="polite"></div><div class="workers-modal-actions"><button type="button" class="workers-action secondary" data-worker-modal-close>Cancelar</button><button id="confirmWorkerEdit" type="submit" class="workers-action primary">Guardar cambios</button></div></form>`);
    byId('editWorkerForm')?.addEventListener('submit', event => saveWorkerChanges(event, id));
  }

  async function saveWorkerChanges(event, id) {
    event.preventDefault();
    const worker = workerById(id);
    if (!worker || !actionAllowed(worker, 'edit')) return setMessage('editWorkerMsg', 'Esta acción ya no está disponible.');
    const button = byId('confirmWorkerEdit');
    setBusy(button, true, 'Guardando…');
    try {
      await api('/api/admins?resource=workers', {
        method:'PATCH',
        body:JSON.stringify({
          id,
          full_name:byId('editWorkerName')?.value || '',
          phone:byId('editWorkerPhone')?.value || '',
          position:byId('editWorkerPosition')?.value || ''
        })
      });
      closeModal();
      await loadWorkers();
      setMessage('workersFeedback', 'Datos del trabajador actualizados.', true);
    } catch (error) {
      setMessage('editWorkerMsg', reportError('edit', error, 'No se pudieron guardar los cambios. Intenta nuevamente.'));
    } finally {
      setBusy(button, false);
    }
  }

  function openDeactivateWorker(id) {
    const worker = workerById(id);
    if (!worker || !actionAllowed(worker, 'deactivate')) return;
    openModal('Desactivar trabajador', `<form id="deactivateWorkerForm" class="workers-modal-form"><div class="workers-decision"><span class="workers-decision-icon danger" aria-hidden="true">!</span><div><strong>${escW(worker.full_name)}</strong><p>Dejará de estar disponible para nuevas asignaciones. Su historial se conserva.</p></div></div><div><label for="workerDeactivationReason">Motivo de desactivación</label><textarea id="workerDeactivationReason" rows="4" placeholder="Ejemplo: terminó la relación laboral" required></textarea></div><div id="deactivateWorkerMsg" class="workers-message" role="status" aria-live="polite"></div><div class="workers-modal-actions"><button type="button" class="workers-action secondary" data-worker-modal-close>Cancelar</button><button id="confirmWorkerDeactivate" type="submit" class="workers-action danger">Desactivar trabajador</button></div></form>`);
    byId('deactivateWorkerForm')?.addEventListener('submit', event => deactivateWorker(event, id));
  }

  async function deactivateWorker(event, id) {
    event.preventDefault();
    const worker = workerById(id);
    const reason = String(byId('workerDeactivationReason')?.value || '').trim();
    if (!worker || !actionAllowed(worker, 'deactivate')) return setMessage('deactivateWorkerMsg', 'Esta acción ya no está disponible.');
    if (reason.length < 3) return setMessage('deactivateWorkerMsg', 'Escribe el motivo de desactivación.');
    const button = byId('confirmWorkerDeactivate');
    setBusy(button, true, 'Desactivando…');
    try {
      await api('/api/admins?resource=workers', { method:'PATCH', body:JSON.stringify({ id, is_active:false, deactivation_reason:reason }) });
      closeModal();
      await loadWorkers();
      setMessage('workersFeedback', 'Trabajador desactivado. El historial quedó actualizado.', true);
    } catch (error) {
      setMessage('deactivateWorkerMsg', reportError('deactivate', error, 'No se pudo desactivar al trabajador. Intenta nuevamente.'));
    } finally {
      setBusy(button, false);
    }
  }

  function openReactivateWorker(id) {
    const worker = workerById(id);
    if (!worker || !actionAllowed(worker, 'reactivate')) return;
    openModal('Reactivar trabajador', `<form id="reactivateWorkerForm" class="workers-modal-form"><div class="workers-decision"><span class="workers-decision-icon success" aria-hidden="true">✓</span><div><strong>${escW(worker.full_name)}</strong><p>Volverá a estar disponible para nuevas asignaciones.</p></div></div><div><label for="workerReactivationReason">Nota de reactivación</label><textarea id="workerReactivationReason" rows="3" placeholder="Ejemplo: reincorporación o nuevo contrato"></textarea><small>La nota es opcional y quedará guardada en el historial.</small></div><div id="reactivateWorkerMsg" class="workers-message" role="status" aria-live="polite"></div><div class="workers-modal-actions"><button type="button" class="workers-action secondary" data-worker-modal-close>Cancelar</button><button id="confirmWorkerReactivate" type="submit" class="workers-action success">Reactivar trabajador</button></div></form>`);
    byId('reactivateWorkerForm')?.addEventListener('submit', event => reactivateWorker(event, id));
  }

  async function reactivateWorker(event, id) {
    event.preventDefault();
    const worker = workerById(id);
    if (!worker || !actionAllowed(worker, 'reactivate')) return setMessage('reactivateWorkerMsg', 'Esta acción ya no está disponible.');
    const button = byId('confirmWorkerReactivate');
    setBusy(button, true, 'Reactivando…');
    try {
      await api('/api/admins?resource=workers', { method:'PATCH', body:JSON.stringify({ id, is_active:true, reactivation_reason:byId('workerReactivationReason')?.value.trim() || '' }) });
      closeModal();
      await loadWorkers();
      setMessage('workersFeedback', 'Trabajador reactivado y disponible para asignaciones.', true);
    } catch (error) {
      setMessage('reactivateWorkerMsg', reportError('reactivate', error, 'No se pudo reactivar al trabajador. Intenta nuevamente.'));
    } finally {
      setBusy(button, false);
    }
  }

  function handleAction(event) {
    const close = event.target.closest('[data-worker-modal-close]');
    if (close) return closeModal();
    const button = event.target.closest('[data-worker-action]');
    if (!button) return;
    const id = button.dataset.workerId;
    if (button.dataset.workerAction === 'reload') return loadWorkers();
    if (button.dataset.workerAction === 'history') return openWorkerHistory(id);
    if (button.dataset.workerAction === 'edit') return openWorkerEditor(id);
    if (button.dataset.workerAction === 'deactivate') return openDeactivateWorker(id);
    if (button.dataset.workerAction === 'reactivate') return openReactivateWorker(id);
  }

  function mount() {
    if (state.mounted || !can('administration.workers.read')) return;
    state.mounted = true;
    byId('workerCreateForm')?.addEventListener('submit', saveWorker);
    byId('workersSection')?.addEventListener('click', handleAction);
    byId('modal')?.addEventListener('click', handleAction);
    loadWorkers();
  }

  window.reloadWorkersList = loadWorkers;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})();
