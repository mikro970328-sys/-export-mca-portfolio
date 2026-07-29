(() => {
  const byId = id => document.getElementById(id);
  const escW = value => String(value ?? '').replace(/[&<>'\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
  let workers = [];

  function mount() {
    if (window.__workersModuleMounted || currentUser?.role !== 'master_admin') return;
    window.__workersModuleMounted = true;

    const navButton = document.querySelector('[data-section="workersSection"]');
    if (navButton) navButton.onclick = () => showSection('workersSection');

    const mobileButton = byId('mobileMenuBtn');
    if (mobileButton) {
      mobileButton.style.background = '#06204a';
      mobileButton.style.color = '#ffffff';
      mobileButton.style.border = '1px solid #06204a';
      mobileButton.setAttribute('aria-label', 'Abrir menú');
    }

    if (typeof titles === 'object') titles.workersSection = 'Trabajadores';
    const saveButton = byId('saveWorker');
    if (saveButton) saveButton.onclick = saveWorker;
    loadWorkers();
  }

  async function loadWorkers() {
    const target = byId('workers');
    if (target) target.textContent = 'Cargando...';
    try {
      const result = await api('/api/admins?resource=workers');
      workers = result.workers || [];
      window.exportMcaWorkers = workers.filter(w => w.is_active !== false);
      renderWorkers();
    } catch (error) {
      if (target) target.textContent = error.message;
    }
  }

  function workerTable(list, inactive = false) {
    if (!list.length) {
      return `<div class="empty-state">${inactive ? 'No hay trabajadores desactivados.' : 'No hay trabajadores activos.'}</div>`;
    }
    return `<table><thead><tr><th>Nombre</th><th>Cargo</th><th>Teléfono / WhatsApp</th>${inactive ? '<th>Motivo</th>' : ''}<th>Estado</th><th>Acciones</th></tr></thead><tbody>${list.map(w => `<tr><td><b>${escW(w.full_name)}</b></td><td>${escW(w.position || '-')}</td><td>${escW(w.phone)}</td>${inactive ? `<td>${escW(w.deactivation_reason || 'Sin motivo registrado')}</td>` : ''}<td><span class="pill ${w.is_active ? 'done' : ''}">${w.is_active ? 'Activo' : 'Desactivado'}</span></td><td><div class="actions"><button class="alt" data-worker-edit="${w.id}">Editar</button>${w.is_active ? `<button class="danger" data-worker-deactivate="${w.id}">Desactivar</button>` : `<button class="success" data-worker-reactivate="${w.id}">Reactivar</button>`}</div></td></tr>`).join('')}</tbody></table>`;
  }

  function renderWorkers() {
    const target = byId('workers');
    if (!target) return;
    const active = workers.filter(w => w.is_active !== false);
    const inactive = workers.filter(w => w.is_active === false);
    target.innerHTML = `
      <div class="section-head"><div><h3 style="margin:0">Trabajadores activos</h3><div class="muted">Disponibles para asignar a operaciones, productos y publicaciones.</div></div><button id="reloadWorkersButton" class="alt">Actualizar</button></div>
      ${workerTable(active)}
      <div style="margin-top:28px;padding-top:22px;border-top:1px solid var(--line)">
        <div class="section-head"><div><h3 style="margin:0">Trabajadores desactivados</h3><div class="muted">Personas que ya no trabajan actualmente con la empresa.</div></div></div>
        ${workerTable(inactive, true)}
      </div>`;

    byId('reloadWorkersButton')?.addEventListener('click', loadWorkers);
    target.querySelectorAll('[data-worker-edit]').forEach(button => button.addEventListener('click', () => openWorkerEditor(button.dataset.workerEdit)));
    target.querySelectorAll('[data-worker-deactivate]').forEach(button => button.addEventListener('click', () => openDeactivateWorker(button.dataset.workerDeactivate)));
    target.querySelectorAll('[data-worker-reactivate]').forEach(button => button.addEventListener('click', () => openReactivateWorker(button.dataset.workerReactivate)));
  }

  async function saveWorker() {
    try {
      await api('/api/admins?resource=workers', {
        method: 'POST',
        body: JSON.stringify({
          full_name: byId('workerName').value,
          phone: byId('workerPhone').value,
          position: byId('workerPosition')?.value || ''
        })
      });
      note('workerMsg', 'Trabajador guardado correctamente.', true);
      ['workerName','workerPhone','workerPosition'].forEach(id => { if (byId(id)) byId(id).value = ''; });
      await loadWorkers();
    } catch (error) {
      note('workerMsg', error.message);
    }
  }

  function openWorkerEditor(id) {
    const worker = workers.find(w => w.id === id);
    if (!worker) return;
    openModal('Editar trabajador', `
      <div class="grid" style="grid-template-columns:1fr 1fr">
        <div><label>Nombre completo *</label><input id="editWorkerName" value="${escW(worker.full_name)}"></div>
        <div><label>Teléfono / WhatsApp *</label><input id="editWorkerPhone" value="${escW(worker.phone)}"></div>
      </div>
      <label>Cargo</label><input id="editWorkerPosition" value="${escW(worker.position || '')}" placeholder="Ventas, logística, comercial...">
      <div class="toolbar" style="justify-content:flex-end;margin-top:18px">
        <button id="cancelWorkerEdit" class="alt">Cancelar</button>
        <button id="confirmWorkerEdit" class="orange">Guardar cambios</button>
      </div>
      <div id="editWorkerMsg" class="msg"></div>`);
    byId('cancelWorkerEdit').onclick = closeModal;
    byId('confirmWorkerEdit').onclick = () => saveWorkerChanges(id);
  }

  async function saveWorkerChanges(id) {
    try {
      await api('/api/admins?resource=workers', {
        method: 'PATCH',
        body: JSON.stringify({
          id,
          full_name: byId('editWorkerName').value,
          phone: byId('editWorkerPhone').value,
          position: byId('editWorkerPosition').value
        })
      });
      closeModal();
      await loadWorkers();
    } catch (error) {
      note('editWorkerMsg', error.message);
    }
  }

  function openDeactivateWorker(id) {
    const worker = workers.find(w => w.id === id);
    if (!worker) return;
    openModal('Desactivar trabajador', `
      <p>Vas a desactivar a <b>${escW(worker.full_name)}</b>.</p>
      <label>Motivo de desactivación *</label>
      <textarea id="workerDeactivationReason" rows="4" placeholder="Ejemplo: terminó relación laboral, renuncia, cambio de puesto..."></textarea>
      <div class="toolbar" style="justify-content:flex-end;margin-top:18px">
        <button id="cancelWorkerDeactivate" class="alt">Cancelar</button>
        <button id="confirmWorkerDeactivate" class="danger">Desactivar trabajador</button>
      </div>
      <div id="deactivateWorkerMsg" class="msg"></div>`);
    byId('cancelWorkerDeactivate').onclick = closeModal;
    byId('confirmWorkerDeactivate').onclick = () => deactivateWorker(id);
  }

  async function deactivateWorker(id) {
    const reason = byId('workerDeactivationReason').value.trim();
    if (reason.length < 3) return note('deactivateWorkerMsg', 'Escribe el motivo de desactivación.');
    try {
      await api('/api/admins?resource=workers', {
        method: 'PATCH',
        body: JSON.stringify({ id, is_active: false, deactivation_reason: reason })
      });
      closeModal();
      await loadWorkers();
    } catch (error) {
      note('deactivateWorkerMsg', error.message);
    }
  }

  function openReactivateWorker(id) {
    const worker = workers.find(w => w.id === id);
    if (!worker) return;
    openModal('Reactivar trabajador', `
      <p>¿Deseas volver a activar a <b>${escW(worker.full_name)}</b>?</p>
      <div class="muted">Al reactivarlo volverá a estar disponible para asignaciones futuras.</div>
      <div class="toolbar" style="justify-content:flex-end;margin-top:18px">
        <button id="cancelWorkerReactivate" class="alt">Cancelar</button>
        <button id="confirmWorkerReactivate" class="success">Reactivar trabajador</button>
      </div>
      <div id="reactivateWorkerMsg" class="msg"></div>`);
    byId('cancelWorkerReactivate').onclick = closeModal;
    byId('confirmWorkerReactivate').onclick = () => reactivateWorker(id);
  }

  async function reactivateWorker(id) {
    try {
      await api('/api/admins?resource=workers', {
        method: 'PATCH',
        body: JSON.stringify({ id, is_active: true })
      });
      closeModal();
      await loadWorkers();
    } catch (error) {
      note('reactivateWorkerMsg', error.message);
    }
  }

  window.reloadWorkersList = loadWorkers;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();