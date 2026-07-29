(() => {
  const byId = id => document.getElementById(id);
  const escW = value => String(value ?? '').replace(/[&<>'\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
  let workers = [];

  function mount() {
    if (window.__workersModuleMounted || currentUser?.role !== 'master_admin') return;
    window.__workersModuleMounted = true;

    // The navigation button already exists in admin/index.html. Reuse it instead
    // of creating a second Trabajadores entry.
    const navButton = document.querySelector('[data-section="workersSection"]');
    if (navButton) navButton.onclick = () => showSection('workersSection');

    // Keep the mobile menu control clearly visible over the white top bar.
    const mobileButton = byId('mobileMenuBtn');
    if (mobileButton) {
      mobileButton.style.background = '#06204a';
      mobileButton.style.color = '#ffffff';
      mobileButton.style.border = '1px solid #06204a';
      mobileButton.setAttribute('aria-label', 'Abrir menú');
    }

    const main = document.querySelector('.main-shell main');
    let section = byId('workersSection');
    if (!section) {
      section = document.createElement('section');
      section.id = 'workersSection';
      section.className = 'app-section hidden';
      section.innerHTML = `<div class="grid"><section class="card"><h2>Agregar trabajador</h2><label>Nombre completo *</label><input id="workerName" placeholder="Nombre del trabajador"><label>Número de teléfono / WhatsApp *</label><input id="workerPhone" placeholder="+5351234567"><div style="margin-top:14px"><button id="saveWorker" class="orange">Guardar trabajador</button></div><div id="workerMsg" class="msg"></div></section><section class="card"><div class="section-head"><div><h2>Trabajadores guardados</h2><div class="muted">Podrás asignarlos a cada publicación o producto.</div></div><button id="reloadWorkers" class="alt">Actualizar</button></div><div id="workersList">Cargando...</div></section></div>`;
      main.appendChild(section);
    }

    if (typeof titles === 'object') titles.workersSection = 'Trabajadores';
    byId('saveWorker').onclick = saveWorker;
    byId('reloadWorkers').onclick = loadWorkers;
    loadWorkers();
  }

  async function loadWorkers() {
    try {
      const result = await api('/api/admins?resource=workers');
      workers = result.workers || [];
      renderWorkers();
    } catch (error) {
      byId('workersList').textContent = error.message;
    }
  }

  function renderWorkers() {
    const target = byId('workersList');
    if (!target) return;
    target.innerHTML = workers.length ? `<table><thead><tr><th>Nombre</th><th>Teléfono</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${workers.map(w => `<tr><td><b>${escW(w.full_name)}</b></td><td>${escW(w.phone)}</td><td><span class="pill ${w.is_active ? 'done' : ''}">${w.is_active ? 'Activo' : 'Inactivo'}</span></td><td><div class="actions"><button class="alt" onclick="editWorker('${w.id}')">Editar</button><button class="${w.is_active ? 'danger' : 'success'}" onclick="toggleWorker('${w.id}',${!w.is_active})">${w.is_active ? 'Desactivar' : 'Activar'}</button></div></td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">No hay trabajadores registrados.</div>';
  }

  async function saveWorker() {
    try {
      await api('/api/admins?resource=workers', { method: 'POST', body: JSON.stringify({ full_name: byId('workerName').value, phone: byId('workerPhone').value }) });
      note('workerMsg', 'Trabajador guardado correctamente.', true);
      byId('workerName').value = '';
      byId('workerPhone').value = '';
      await loadWorkers();
    } catch (error) { note('workerMsg', error.message); }
  }

  window.editWorker = async id => {
    const worker = workers.find(w => w.id === id);
    if (!worker) return;
    const full_name = prompt('Nombre completo', worker.full_name);
    if (full_name === null) return;
    const phone = prompt('Número de teléfono / WhatsApp', worker.phone);
    if (phone === null) return;
    await api('/api/admins?resource=workers', { method: 'PATCH', body: JSON.stringify({ id, full_name, phone }) });
    await loadWorkers();
  };

  window.toggleWorker = async (id, is_active) => {
    await api('/api/admins?resource=workers', { method: 'PATCH', body: JSON.stringify({ id, is_active }) });
    await loadWorkers();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();