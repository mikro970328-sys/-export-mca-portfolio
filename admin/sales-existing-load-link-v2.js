(() => {
  if (window.__salesExistingLoadLinkV2Installed) return;
  window.__salesExistingLoadLinkV2Installed = true;

  const byId = id => document.getElementById(id);
  const token = () => localStorage.getItem('export_mca_token') || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const statusLabel = value => ({draft:'Borrador',reserved:'Reservado',loading:'En carga',loaded:'Cargado',dispatched:'Despachado',cancelled:'Cancelado'})[String(value||'').toLowerCase()] || 'Sin estado';
  const SAFE_LINK_ERROR_PATTERNS = [
    /^(?:La Sales Order|Esta Sales Order|Ese Cargue|El Cargue|No tienes|No hay|La mercancía|El cliente|La importadora)/i,
    /^No se pudo procesar (?:la vinculación|el Cargue)$/i
  ];
  const safeLinkMessage = (error,fallback='No se pudo completar la vinculación. Intenta nuevamente.') => {
    const message=String(error?.message||'').trim();
    return message&&SAFE_LINK_ERROR_PATTERNS.some(pattern=>pattern.test(message))?message:fallback;
  };
  const reportLinkError = (context,error,fallback) => {
    console.error('SALES_LOAD_LINK_UI_FAILED',{context,error});
    return safeLinkMessage(error,fallback);
  };
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
  function canLink(order) { return order?.capabilities?.actions?.allocate_load?.allowed === true; }
  function orderLabel(order) {
    const client = order?.client?.company || order?.client?.mipyme_name || order?.client?.name || 'Cliente';
    return `${order?.so_number || 'SO'} · ${client}`;
  }

  function ensureModal() {
    if (byId('existingLoadModal')) return;
    const modal=document.createElement('div');
    modal.id='existingLoadModal';
    modal.className='modal hidden';
    modal.innerHTML=`<div class="dialog"><div class="dialog-head"><div><h2>Vincular Cargue existente</h2><div class="muted">Solo para mercancía que ya tiene Cargue físico, pero todavía no quedó relacionada con esta venta.</div></div><button type="button" class="btn" data-existing-close>✕</button></div><div id="existingLoadOrderSummary" class="existing-load-context"><span>Venta seleccionada</span><b>Venta</b></div><div class="existing-load-note">Se muestran únicamente Cargues sin otra venta asociada cuya mercancía coincida exactamente con el saldo pendiente. Vincular no reserva, carga ni despacha inventario otra vez.</div><div id="existingLoadList" class="existing-load-list"></div><div id="existingLoadMsg" class="msg" role="status" aria-live="polite"></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-existing-close]').onclick=close;
    modal.addEventListener('click',event=>{if(event.target===modal)close()});
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
    ensureModal();
    const requested=currentOrders().find(order=>String(order.id)===String(orderId || ''));
    selectedOrderId=requested&&canLink(requested)?requested.id:'';
    byId('existingLoadOrderSummary').querySelector('b').textContent=requested?orderLabel(requested):'Venta no disponible';
    byId('existingLoadMsg').className='msg';byId('existingLoadMsg').textContent='';
    byId('existingLoadModal').classList.remove('hidden');
    if(!selectedOrderId){byId('existingLoadList').innerHTML='<div class="empty">Esta venta ya no admite vincular un Cargue.</div>';return}
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
    }catch(error){list.innerHTML='<div class="empty">No se pudieron consultar los Cargues.</div>';msg.textContent=reportLinkError('candidates',error,'No se pudieron consultar los Cargues. Intenta nuevamente.')}
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
    }catch(error){msg.className='msg';msg.textContent=reportLinkError('link',error,'No se pudo vincular el Cargue. Intenta nuevamente.')}
    finally{linking=false}
  }

  ensureModal();
  window.SalesExistingLoadLink=Object.freeze({openForOrder,close,owner:'sales-existing-load-link-v2.js'});
})();
