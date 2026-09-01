(() => {
  if (window.__salesExistingLoadLinkV2Installed) return;
  window.__salesExistingLoadLinkV2Installed = true;

  const byId = id => document.getElementById(id);
  const token = () => localStorage.getItem('export_mca_token') || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num = value => Number(value || 0);
  const statusLabel = value => ({draft:'Borrador',reserved:'Reservado',loading:'En carga',loaded:'Cargado',dispatched:'Despachado',cancelled:'Cancelado'})[String(value||'').toLowerCase()] || 'Sin estado';
  let selectedOrderId = '';
  let linking = false;

  async function request(path, options={}) {
    const response = await fetch(path, {
      ...options,
      headers:{'Content-Type':'application/json',...(token() ? {Authorization:`Bearer ${token()}`} : {}),...(options.headers || {})}
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo procesar la vinculación');
    return data;
  }

  function currentOrders() {
    try { return Array.isArray(orders) ? orders : []; }
    catch { return []; }
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
    if (byId('existingLoadLinkV2Styles')) return;
    const style = document.createElement('style');
    style.id='existingLoadLinkV2Styles';
    style.textContent=`.existing-load-list{display:grid;gap:10px;margin-top:14px}.existing-load-card{border:1px solid #dde3ea;border-radius:10px;padding:14px;background:#fff;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center}.existing-load-card .meta{font-size:12px;color:#667085;margin-top:5px;line-height:1.45}.existing-load-card .items{font-size:13px;margin-top:7px}.existing-load-note{padding:10px 12px;border-radius:8px;background:#f8fafc;border:1px solid #e5e7eb;margin-top:12px;font-size:12px;color:#475467}.existing-load-decision{position:fixed;inset:0;z-index:2600;background:rgba(16,24,40,.5);display:flex;align-items:center;justify-content:center;padding:18px}.existing-load-decision.hidden{display:none}.existing-load-decision-box{width:min(520px,100%);background:#fff;border:1px solid #dde3ea;border-radius:14px;padding:18px;box-shadow:0 24px 70px rgba(16,24,40,.22)}.existing-load-decision-box h3{margin:0;color:#06204a}.existing-load-decision-box p{margin:9px 0 0;color:#475467;line-height:1.5}.existing-load-decision-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}@media(max-width:720px){.existing-load-card{grid-template-columns:1fr}.existing-load-card button{width:100%}.existing-load-decision{align-items:flex-end;padding:0}.existing-load-decision-box{border-radius:20px 20px 0 0;padding:20px 18px calc(20px + env(safe-area-inset-bottom))}}`;
    document.head.appendChild(style);
  }

  function ensureModal() {
    if (byId('existingLoadModal')) return;
    const modal=document.createElement('div');
    modal.id='existingLoadModal';
    modal.className='modal hidden';
    modal.innerHTML=`<div class="dialog"><div class="dialog-head"><div><h2>Vincular Cargue existente</h2><div class="muted">Solo para mercancía que ya tiene Cargue físico, pero todavía no quedó relacionada con esta venta.</div></div><button type="button" class="btn" data-existing-close>✕</button></div><div><label>Venta</label><select id="existingLoadOrder"></select></div><div class="existing-load-note">Se muestran únicamente Cargues sin otra venta asociada cuya mercancía coincida exactamente con el saldo pendiente. Vincular no reserva, carga ni despacha inventario otra vez.</div><div id="existingLoadList" class="existing-load-list"></div><div id="existingLoadMsg" class="msg"></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-existing-close]').onclick=close;
    modal.addEventListener('click',event=>{if(event.target===modal)close()});
    byId('existingLoadOrder').onchange=event=>{selectedOrderId=event.target.value;loadCandidates()};
  }

  function decision({title,copy,accept='Vincular'}) {
    return new Promise(resolve => {
      document.querySelector('.existing-load-decision')?.remove();
      const overlay=document.createElement('div');
      overlay.className='existing-load-decision';
      overlay.innerHTML=`<div class="existing-load-decision-box" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><p>${esc(copy)}</p><div class="existing-load-decision-actions"><button type="button" class="btn" data-decision-cancel>Cancelar</button><button type="button" class="btn orange" data-decision-accept>${esc(accept)}</button></div></div>`;
      let done=false;
      const finish=value=>{if(done)return;done=true;document.removeEventListener('keydown',onKey);overlay.remove();resolve(value)};
      const onKey=event=>{if(event.key==='Escape')finish(false)};
      overlay.querySelector('[data-decision-cancel]').onclick=()=>finish(false);
      overlay.querySelector('[data-decision-accept]').onclick=()=>finish(true);
      overlay.addEventListener('click',event=>{if(event.target===overlay)finish(false)});
      document.addEventListener('keydown',onKey);
      document.body.appendChild(overlay);
      overlay.querySelector('[data-decision-accept]')?.focus();
    });
  }

  function close() { byId('existingLoadModal')?.classList.add('hidden'); }

  async function openForOrder(orderId) {
    ensureStyles();ensureModal();
    const eligible=currentOrders().filter(hasPending);
    const requested=eligible.find(order=>String(order.id)===String(orderId || ''));
    const select=byId('existingLoadOrder');
    select.innerHTML=eligible.length ? eligible.map(order=>`<option value="${esc(order.id)}">${esc(orderLabel(order))}</option>`).join('') : '<option value="">No hay ventas pendientes</option>';
    selectedOrderId=requested?.id || eligible[0]?.id || '';
    if(selectedOrderId)select.value=selectedOrderId;
    byId('existingLoadMsg').className='msg';byId('existingLoadMsg').textContent='';
    byId('existingLoadModal').classList.remove('hidden');
    await loadCandidates();
  }

  async function loadCandidates() {
    const list=byId('existingLoadList'),msg=byId('existingLoadMsg');
    if(!selectedOrderId){list.innerHTML='<div class="empty">No hay ventas confirmadas con mercancía pendiente.</div>';return}
    list.innerHTML='<div class="empty">Buscando Cargues compatibles…</div>';msg.textContent='';
    try{
      const data=await request(`/api/sales-loads?mode=link_candidates&sales_order_id=${encodeURIComponent(selectedOrderId)}`);
      const candidates=Array.isArray(data.candidates)?data.candidates:[];
      list.innerHTML=candidates.length?candidates.map(row=>`<div class="existing-load-card"><div><b>${esc(row.load_number || 'Cargue')}</b><div class="meta">Estado: ${esc(statusLabel(row.load_status))} · Contenedor: ${esc(row.container_number || 'Sin asignar')} · Almacén: ${esc(row.warehouse_name || '—')}</div><div class="items">${esc(row.item_summary || '')}</div></div><button type="button" class="btn orange" data-link-load="${esc(row.load_id)}" data-link-number="${esc(row.load_number || 'Cargue')}">Vincular</button></div>`).join(''):'<div class="empty">No hay Cargues que coincidan exactamente con esta venta.</div>';
      list.querySelectorAll('[data-link-load]').forEach(button=>button.onclick=()=>linkCandidate(button.dataset.linkLoad,button.dataset.linkNumber));
    }catch(error){list.innerHTML='<div class="empty">No se pudieron consultar los Cargues.</div>';msg.textContent=error.message}
  }

  async function linkCandidate(loadId,loadNumber) {
    if(linking || !selectedOrderId || !loadId)return;
    const order=currentOrders().find(row=>String(row.id)===String(selectedOrderId));
    const approved=await decision({title:`Vincular ${loadNumber}`,copy:`Se relacionará con ${order?.so_number || 'esta venta'} sin volver a reservar, cargar ni despachar inventario.`});
    if(!approved)return;
    linking=true;const msg=byId('existingLoadMsg');msg.className='msg';msg.textContent='Vinculando…';
    try{
      const result=await request('/api/sales-loads',{method:'POST',body:JSON.stringify({action:'link_existing_load',sales_order_id:selectedOrderId,load_id:loadId})});
      await window.SalesOrderController?.refresh?.();
      close();
      await window.SalesWorkspace?.open?.(selectedOrderId);
      const detailMsg=byId('detailMsg');if(detailMsg){detailMsg.className='msg ok';detailMsg.textContent=`${result.linked?.load_number || loadNumber} quedó vinculado correctamente.`}
    }catch(error){msg.className='msg';msg.textContent=error.message}
    finally{linking=false}
  }

  ensureStyles();ensureModal();
  window.SalesExistingLoadLink=Object.freeze({openForOrder,close,owner:'sales-existing-load-link-v2.js'});
})();
