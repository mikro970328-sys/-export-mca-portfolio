(() => {
  const byId = id => document.getElementById(id);
  const token = () => localStorage.getItem('export_mca_token') || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num = value => Number(value || 0);
  const fmt = value => new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(num(value));
  let selectedOrderId = '';
  let linking = false;

  async function request(path, options={}) {
    const response = await fetch(path, {
      ...options,
      headers:{
        'Content-Type':'application/json',
        ...(token() ? {Authorization:`Bearer ${token()}`} : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo procesar la vinculación');
    return data;
  }

  function currentOrders() {
    try { return Array.isArray(orders) ? orders : []; } catch { return []; }
  }

  function hasPending(order) {
    return order?.status === 'confirmed' && (order.items || []).some(item =>
      num(item.progress?.unallocated_quantity) > 0 || num(item.progress?.unallocated_pallets) > 0
    );
  }

  function orderLabel(order) {
    const client = order?.client?.company || order?.client?.mipyme_name || order?.client?.name || 'Cliente';
    return `${order?.so_number || 'SO'} · ${client}`;
  }

  function ensureStyles() {
    if (byId('existingLoadLinkStyles')) return;
    const style = document.createElement('style');
    style.id = 'existingLoadLinkStyles';
    style.textContent = `
      .existing-load-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .existing-load-list{display:grid;gap:10px;margin-top:14px}
      .existing-load-card{border:1px solid #dde3ea;border-radius:10px;padding:14px;background:#fff;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center}
      .existing-load-card .meta{font-size:12px;color:#667085;margin-top:5px;line-height:1.45}
      .existing-load-card .items{font-size:13px;margin-top:7px}
      .existing-load-note{padding:10px 12px;border-radius:8px;background:#f8fafc;border:1px solid #e5e7eb;margin-top:12px;font-size:12px;color:#475467}
      @media(max-width:720px){.existing-load-card{grid-template-columns:1fr}.existing-load-card button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensureButton() {
    if (byId('linkExistingLoad')) return;
    const newOrder = byId('newOrder');
    if (!newOrder) return;
    const wrap = document.createElement('div');
    wrap.className = 'existing-load-toolbar';
    newOrder.parentNode.insertBefore(wrap,newOrder);
    wrap.appendChild(newOrder);
    const button = document.createElement('button');
    button.id = 'linkExistingLoad';
    button.type = 'button';
    button.className = 'btn';
    button.textContent = 'Vincular cargue existente';
    wrap.appendChild(button);
    button.onclick = openModal;
  }

  function ensureModal() {
    if (byId('existingLoadModal')) return;
    const modal = document.createElement('div');
    modal.id = 'existingLoadModal';
    modal.className = 'modal hidden';
    modal.innerHTML = `<div class="dialog">
      <div class="dialog-head"><div><h2>Vincular cargue existente</h2><div class="muted">Usa esta acción cuando la mercancía ya fue cargada o despachada, pero el Cargue no quedó creado desde la Sales Order.</div></div><button type="button" class="btn" data-existing-close>✕</button></div>
      <div><label>Sales Order confirmada</label><select id="existingLoadOrder"></select></div>
      <div class="existing-load-note">Solo se mostrarán Cargues sin otra venta asociada cuya mercancía coincida exactamente con el saldo pendiente de la SO. Vincular no vuelve a reservar ni despachar inventario.</div>
      <div id="existingLoadList" class="existing-load-list"></div>
      <div id="existingLoadMsg" class="msg"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-existing-close]').onclick = closeModal;
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
    byId('existingLoadOrder').onchange = event => {
      selectedOrderId = event.target.value;
      loadCandidates();
    };
  }

  async function openModal() {
    ensureModal();
    const eligible = currentOrders().filter(hasPending);
    const select = byId('existingLoadOrder');
    select.innerHTML = eligible.length
      ? eligible.map(order => `<option value="${esc(order.id)}">${esc(orderLabel(order))}</option>`).join('')
      : '<option value="">No hay SO confirmadas pendientes</option>';
    selectedOrderId = eligible[0]?.id || '';
    byId('existingLoadMsg').textContent = '';
    byId('existingLoadModal').classList.remove('hidden');
    await loadCandidates();
  }

  function closeModal() {
    byId('existingLoadModal')?.classList.add('hidden');
  }

  async function loadCandidates() {
    const list = byId('existingLoadList');
    const msg = byId('existingLoadMsg');
    if (!list || !msg) return;
    msg.textContent = '';
    if (!selectedOrderId) {
      list.innerHTML = '<div class="empty">No hay Sales Orders confirmadas con mercancía pendiente de vincular.</div>';
      return;
    }
    list.innerHTML = '<div class="empty">Buscando Cargues compatibles…</div>';
    try {
      const data = await request(`/api/sales-loads?mode=link_candidates&sales_order_id=${encodeURIComponent(selectedOrderId)}`);
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      list.innerHTML = candidates.length ? candidates.map(row => `<div class="existing-load-card">
        <div><b>${esc(row.load_number || 'Cargue')}</b><div class="meta">Estado: ${esc(row.load_status || '—')} · Contenedor: ${esc(row.container_number || 'Sin asignar')} · Almacén: ${esc(row.warehouse_name || '—')}</div><div class="items">${esc(row.item_summary || '')}</div></div>
        <button type="button" class="btn orange" data-link-load="${esc(row.load_id)}" data-link-number="${esc(row.load_number || 'Cargue')}">Vincular</button>
      </div>`).join('') : '<div class="empty">No hay Cargues que coincidan exactamente con esta Sales Order.</div>';
      list.querySelectorAll('[data-link-load]').forEach(button => {
        button.onclick = () => linkCandidate(button.dataset.linkLoad, button.dataset.linkNumber);
      });
    } catch (error) {
      list.innerHTML = '<div class="empty">No se pudieron consultar los Cargues.</div>';
      msg.textContent = error.message;
    }
  }

  async function linkCandidate(loadId, loadNumber) {
    if (linking || !selectedOrderId || !loadId) return;
    const order = currentOrders().find(row => String(row.id) === String(selectedOrderId));
    if (!confirm(`¿Vincular ${loadNumber} con ${order?.so_number || 'esta Sales Order'}?\n\nEsto solo reconstruye la trazabilidad comercial. No crea movimientos nuevos de inventario.`)) return;
    linking = true;
    const msg = byId('existingLoadMsg');
    msg.textContent = 'Vinculando…';
    try {
      const result = await request('/api/sales-loads', {
        method:'POST',
        body:JSON.stringify({action:'link_existing_load',sales_order_id:selectedOrderId,load_id:loadId})
      });
      if (typeof load === 'function') await load();
      msg.className = 'msg ok';
      msg.textContent = `${result.linked?.load_number || loadNumber} quedó vinculado correctamente.`;
      await loadCandidates();
    } catch (error) {
      msg.className = 'msg';
      msg.textContent = error.message;
    } finally {
      linking = false;
    }
  }

  ensureStyles();
  ensureButton();
  ensureModal();
})();
