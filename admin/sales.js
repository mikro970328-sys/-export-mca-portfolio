const token=localStorage.getItem('export_mca_token');
if(!token) location.href='/admin/';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>Number(v||0);
const fmt=v=>new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(n(v));
const money=(v,c='USD')=>(v===null||v===undefined||v==='')?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:c,maximumFractionDigits:2}).format(Number(v));
const pad=v=>String(v).padStart(2,'0');
let orders=[],clients=[],importers=[],clientImporters=[],products=[],writeAccess=false,view='open',editing=null,detailOrder=null,lineSeq=0,loadOrder=null,loadOptions=null;

async function api(path,opt={}){
  const r=await fetch(path,{...opt,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(opt.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(r.status===401){localStorage.removeItem('export_mca_token');location.href='/admin/';throw new Error('Sesión vencida')}
  if(!r.ok)throw new Error(d.error||'Error');return d;
}
function localDateToday(){const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function localToIso(v){if(!v)return null;const d=new Date(v);if(Number.isNaN(d.getTime()))throw new Error('Fecha y hora inválida');return d.toISOString()}
function toLocalInput(v){if(!v)return '';const d=new Date(v);if(Number.isNaN(d.getTime()))return '';return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function date(v){if(!v)return '—';const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[2]}/${m[3]}/${m[1]}`:new Date(v).toLocaleDateString('es-US')}
function dateTime(v){return v?new Date(v).toLocaleString('es-US'):'—'}
function statusLabel(s){return({draft:'Borrador',confirmed:'Confirmada',closed:'Cerrada',cancelled:'Cancelada'})[s]||s}
function statusClass(s){return s==='confirmed'?'ok':s==='cancelled'?'bad':s==='closed'?'off':''}
function fulfillmentLabel(s){return({pending:'Pendiente',partial:'Parcial',planned:'Planificado',prepared:'Preparado',dispatched:'Despachado'})[s]||s||'Pendiente'}
function fulfillmentClass(s){return s==='dispatched'?'ok':['partial','prepared','planned'].includes(s)?'warn':''}
function loadStatusLabel(s){return({draft:'Borrador',reserved:'Reservado',loading:'Cargando',loaded:'Cargado',dispatched:'Despachado',cancelled:'Cancelado'})[s]||s||'—'}
function clientName(c){return c?.company||c?.mipyme_name||c?.name||'—'}
function orderTotal(o){const value=o?.progress?.order_total;return value===null||value===undefined||value===''?null:Number(value)}
function capability(order,key){return order?.capabilities?.actions?.[key]||{allowed:false,reason:'CAPABILITY_UNAVAILABLE'}}
function can(order,key){return capability(order,key).allowed===true}
const SAFE_SALES_ERROR_PATTERNS=[
  /^(?:Selecciona|Indica|Falta|Agrega|No tienes|No hay|Esta Sales Order|La Sales Order|La cantidad|Los pallets|Uno de los WR|Fecha y hora|Sesión vencida)/i,
  /^No se pudo procesar (?:Ventas|el Cargue)$/i
];
function safeSalesMessage(error,fallback='No se pudo completar la operación. Intenta nuevamente.'){
  const message=String(error?.message||'').trim();
  return message&&SAFE_SALES_ERROR_PATTERNS.some(pattern=>pattern.test(message))?message:fallback;
}
function reportSalesError(context,error,fallback){console.error('SALES_UI_FAILED',{context,error});return safeSalesMessage(error,fallback)}

async function load(){
  const d=await api('/api/sales');
  orders=d.orders||[];clients=d.clients||[];importers=d.importers||[];clientImporters=d.client_importers||[];products=d.products||[];
  writeAccess=d.write_access===true;
  $('newOrder').hidden=!writeAccess;
  if($('salesAccessNote'))$('salesAccessNote').hidden=writeAccess;
  fillMasters();
  render();
}
function fillMasters(){
  $('oClient').innerHTML='<option value="">Seleccionar cliente</option>'+clients.map(c=>`<option value="${c.id}">${esc(clientName(c))}</option>`).join('');
  syncImporters();
}
function syncImporters(selected=''){
  const cid=$('oClient').value;
  const allowed=new Set(clientImporters.filter(x=>x.client_id===cid).map(x=>x.importer_id));
  $('oImporter').innerHTML='<option value="">Sin importador definido</option>'+importers.filter(i=>allowed.has(i.id)).map(i=>`<option value="${i.id}" ${i.id===selected?'selected':''}>${esc(i.name)}</option>`).join('');
}
function filtered(){const q=$('search').value.trim().toLowerCase();return orders.filter(o=>{const ok=view==='all'||(view==='draft'?o.status==='draft':view==='closed'?['closed','cancelled'].includes(o.status):o.status==='confirmed');const hay=[o.so_number,clientName(o.client),o.importer?.name,o.customer_reference,...(o.items||[]).flatMap(i=>[i.product?.sku,i.product?.name,i.product?.brand])].join(' ').toLowerCase();return ok&&(!q||hay.includes(q))})}
function render(){
  const confirmed=orders.filter(o=>o.status==='confirmed').length,draft=orders.filter(o=>o.status==='draft').length,partial=orders.filter(o=>o.progress?.fulfillment_status==='partial').length,dispatched=orders.filter(o=>o.progress?.fulfillment_status==='dispatched').length;
  $('metrics').innerHTML=`<article class="metric sales-metric-total"><span>Total ventas</span><b>${orders.length}</b></article><article class="metric sales-metric-draft"><span>Borradores</span><b>${draft}</b></article><article class="metric sales-metric-confirmed"><span>Confirmadas</span><b>${confirmed}</b></article><article class="metric sales-metric-progress"><span>En proceso</span><b>${partial}</b></article><article class="metric sales-metric-dispatched"><span>Despachadas</span><b>${dispatched}</b></article>`;
  const list=filtered();
  const rowsHtml=list.length?list.map(o=>`<article class="row sales-order-row"><div class="sales-order-cell sales-order-identity"><span class="sales-order-cell-label">Venta</span><div class="po">${esc(o.so_number)}</div><div class="small">${date(o.order_date)}</div></div><div class="sales-order-cell sales-order-client"><span class="sales-order-cell-label">Cliente</span><b>${esc(clientName(o.client))}</b><div class="small">${esc(o.importer?.name||'Sin importador')}</div></div><div class="sales-order-cell"><span class="sales-order-cell-label">Valor</span><b class="sales-order-total">${money(orderTotal(o),o.currency)}</b><div class="small">${(o.items||[]).length} línea(s)</div></div><div class="sales-order-cell"><span class="sales-order-cell-label">Estado</span><span class="pill ${statusClass(o.status)}">${esc(statusLabel(o.status))}</span></div><div class="sales-order-cell"><span class="sales-order-cell-label">Cumplimiento</span><span class="pill ${fulfillmentClass(o.progress?.fulfillment_status)}">${esc(fulfillmentLabel(o.progress?.fulfillment_status))}</span><div class="small">${o.progress?.fully_dispatched_items||0}/${o.progress?.item_count||0} completas</div></div><div class="sales-order-cell sales-order-reference"><span class="sales-order-cell-label">Referencia / objetivo</span>${esc(o.customer_reference||'—')}<div class="small">${dateTime(o.requested_at)}</div></div><div class="actions sales-order-actions" aria-label="Acciones de ${esc(o.so_number)}"><button class="btn" type="button" data-view-order="${o.id}">Abrir</button><button class="btn" type="button" data-supply-order="${o.id}">Origen / Direct Ship</button>${can(o,'edit')?`<button class="btn" type="button" data-edit-order="${o.id}">Editar</button>`:''}${can(o,'allocate_load')?`<button class="btn orange" type="button" data-load-order="${o.id}">Crear Cargue</button>`:''}</div></article>`).join(''):'<div class="empty sales-empty"><strong>No hay ventas en esta vista</strong><span>Prueba otro filtro o busca una referencia diferente.</span></div>';
  $('orderList').innerHTML=rowsHtml+`<div class="small sales-list-count">${list.length} venta${list.length===1?'':'s'}${list.length!==orders.length?` visibles · ${orders.length} registradas`:''}</div>`;
  document.querySelectorAll('[data-view-order]').forEach(b=>b.onclick=()=>openDetail(b.dataset.viewOrder));
  document.querySelectorAll('[data-supply-order]').forEach(b=>b.onclick=()=>window.SalesSupplyWorkspace?.open(b.dataset.supplyOrder));
  document.querySelectorAll('[data-edit-order]').forEach(b=>b.onclick=()=>openOrder(orders.find(o=>o.id===b.dataset.editOrder)));
  document.querySelectorAll('[data-load-order]').forEach(b=>b.onclick=()=>openLoad(orders.find(o=>o.id===b.dataset.loadOrder)));
}
function productOptions(selected=''){return '<option value="">Seleccionar producto</option>'+products.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.sku?p.sku+' · ':'')}${esc(p.name)}</option>`).join('')}
function addLine(seed={}){
  lineSeq++;const div=document.createElement('div');div.className='line';
  div.innerHTML=`<div class="line-head"><div class="line-title">Línea ${$('orderLines').children.length+1}</div><button class="btn danger" type="button">Quitar</button></div><div class="grid3"><div><label>Producto *</label><select class="lProduct">${productOptions(seed.product_id||'')}</select></div><div><label>Cantidad vendida *</label><input class="lQty" type="number" min="0" step="0.001" value="${esc(seed.ordered_quantity||'')}"></div><div><label>Pallets</label><input class="lPallets" type="number" min="0" step="0.001" value="${esc(seed.ordered_pallets||'')}"></div></div><div class="grid3"><div><label>Unidades por pallet</label><input class="lUpp" type="number" min="0" step="0.001" value="${esc(seed.units_per_pallet||'')}"></div><div><label>Precio unitario *</label><input class="lPrice" type="number" min="0" step="0.0001" value="${esc(seed.unit_price??'')}"></div><div><label>Notas</label><input class="lNotes" value="${esc(seed.notes||'')}"></div></div><div class="small lProductInfo"></div>`;
  $('orderLines').appendChild(div);div.querySelector('button').onclick=()=>{div.remove();if(!$('orderLines').children.length)addLine()};div.querySelector('.lProduct').onchange=()=>syncProduct(div);syncProduct(div);window.SalesOrderUX?.mountLine?.(div)
}
function syncProduct(div){const p=products.find(x=>x.id===div.querySelector('.lProduct').value);div.querySelector('.lProductInfo').textContent=p?[p.brand,p.unit,p.package_format].filter(Boolean).join(' · '):'';if(p&&!div.querySelector('.lUpp').value&&p.default_units_per_pallet)div.querySelector('.lUpp').value=p.default_units_per_pallet}
function openOrder(order=null){if(order&&!can(order,'edit'))throw new Error('Esta Sales Order ya no admite edición.');if(!order&&!writeAccess)throw new Error('No tienes permiso para crear ventas.');editing=order||null;$('orderTitle').textContent=order?`Editar ${order.so_number}`:'Nueva venta';$('oClient').value=order?.client_id||'';syncImporters(order?.importer_id||'');$('oCurrency').value=order?.currency||'USD';$('oDate').value=order?.order_date||localDateToday();$('oRequested').value=toLocalInput(order?.requested_at);$('oReference').value=order?.customer_reference||'';$('oNotes').value=order?.notes||'';$('orderLines').innerHTML='';(order?.items?.length?order.items:[{}]).forEach(addLine);$('orderMsg').textContent='';$('orderModal').classList.remove('hidden');window.SalesOrderUX?.onOrderOpen?.(order||null)}
function closeModal(name){$(name+'Modal').classList.add('hidden');if(name==='order')editing=null;if(name==='detail')detailOrder=null;if(name==='load'){loadOrder=null;loadOptions=null}}
function progressText(p,item){if(!p)return 'Sin planificación física';return `Planificado: ${fmt(p.planned_quantity)} · Preparado: ${fmt(p.prepared_quantity)} · Despachado: ${fmt(p.dispatched_quantity)} · Pendiente de despacho: ${fmt(p.remaining_to_dispatch_quantity)} ${esc(item.unit)}`}
function openDetail(id){
  detailOrder=orders.find(o=>o.id===id);if(!detailOrder)return;const o=detailOrder;$('detailTitle').textContent=o.so_number;$('detailSubtitle').textContent=`${clientName(o.client)} · ${statusLabel(o.status)} · ${fulfillmentLabel(o.progress?.fulfillment_status)}`;
  $('detailBody').innerHTML=`<div class="summary"><div><b>Cliente</b>${esc(clientName(o.client))}</div><div><b>Importador</b>${esc(o.importer?.name||'—')}</div><div><b>Fecha / objetivo</b>${date(o.order_date)}<br><span class="small">${dateTime(o.requested_at)}</span></div><div><b>Total venta</b>${money(orderTotal(o),o.currency)}</div></div><div class="summary"><div><b>Estado comercial</b><span class="pill ${statusClass(o.status)}">${statusLabel(o.status)}</span></div><div><b>Cumplimiento</b><span class="pill ${fulfillmentClass(o.progress?.fulfillment_status)}">${fulfillmentLabel(o.progress?.fulfillment_status)}</span></div><div><b>Referencia cliente</b>${esc(o.customer_reference||'—')}</div><div><b>Notas</b>${esc(o.notes||'—')}</div></div><div class="detail-items">${(o.items||[]).map(i=>`<div class="detail-item"><div class="line-head"><div><b>${esc(i.product?.sku?i.product.sku+' · ':'')}${esc(i.product?.name||'Producto')}</b><div class="small">${esc(i.product?.brand||'')} ${esc(i.product?.package_format||'')}</div></div><span class="pill ${fulfillmentClass(i.progress?.fulfillment_stage)}">${fulfillmentLabel(i.progress?.fulfillment_stage)}</span></div><div class="progress">Vendido: <b>${fmt(i.ordered_quantity)} ${esc(i.unit)}</b>${n(i.ordered_pallets)?` · ${fmt(i.ordered_pallets)} pallets`:''} · Precio: <b>${money(i.unit_price,o.currency)}</b></div><div class="small">${progressText(i.progress,i)}</div>${(i.allocations||[]).length?`<div class="small">Cargues: ${(i.allocations||[]).map(a=>`${esc(a.load_item?.load?.load_number||'—')} · ${esc(loadStatusLabel(a.load_item?.load?.status))} · ${fmt(a.allocated_quantity)} ${esc(i.unit)}`).join(' | ')}</div>`:''}</div>`).join('')}</div>`;
  const acts=[];if(can(o,'edit'))acts.push('<button class="btn" data-action="edit">Editar</button>');if(can(o,'confirm'))acts.push('<button class="btn primary" data-action="confirm">Confirmar venta</button>');if(can(o,'allocate_load'))acts.push('<button class="btn orange" data-action="create_load">Crear Cargue</button>');if(can(o,'close'))acts.push('<button class="btn primary" data-action="close">Cerrar venta</button>');if(can(o,'cancel'))acts.push('<button class="btn danger" data-action="cancel">Cancelar</button>');$('detailActions').innerHTML=acts.join('');$('detailActions').querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>detailAction(b.dataset.action));$('detailMsg').className='msg';$('detailMsg').textContent='';$('detailModal').classList.remove('hidden')
}
function detailActionKey(action){return({edit:'edit',confirm:'confirm',create_load:'allocate_load',close:'close',cancel:'cancel'})[action]||null}
function detailActionPrompt(action){return({confirm:'Confirmar esta venta bloqueará la edición de sus líneas.',cancel:'Confirma que deseas cancelar esta venta.',close:'Confirma que deseas cerrar esta venta completamente despachada.'})[action]||'Confirma esta acción.'}
function detailAction(action){if(!detailOrder)return;const key=detailActionKey(action);if(!key||!can(detailOrder,key)){$('detailMsg').textContent='Esta acción ya no está disponible para la venta.';return}if(action==='edit'){const o=detailOrder;closeModal('detail');openOrder(o);return}if(action==='create_load'){const o=detailOrder;closeModal('detail');openLoad(o);return}$('detailMsg').className='msg';$('detailMsg').innerHTML=`${esc(detailActionPrompt(action))} <button type="button" class="btn primary" data-confirm-detail>Confirmar</button> <button type="button" class="btn" data-cancel-detail>Volver</button>`;$('detailMsg').querySelector('[data-confirm-detail]').onclick=()=>executeDetailAction(action);$('detailMsg').querySelector('[data-cancel-detail]').onclick=()=>{$('detailMsg').textContent=''}}
async function executeDetailAction(action){if(!detailOrder)return;const key=detailActionKey(action);if(!key||!can(detailOrder,key)){$('detailMsg').textContent='Esta acción ya no está disponible para la venta.';return}try{$('detailMsg').textContent='';await api('/api/sales',{method:'POST',body:JSON.stringify({action,sales_order_id:detailOrder.id})});closeModal('detail');await load()}catch(e){$('detailMsg').textContent=reportSalesError('transition',e,'No se pudo actualizar la venta. Intenta nuevamente.')}}

async function openLoad(order){
  if(!order||!can(order,'allocate_load'))throw new Error('Esta Sales Order ya no tiene mercancía disponible para asignar a un Cargue.');loadOrder=order;loadOptions=null;$('loadTitle').textContent=`Crear Cargue · ${order.so_number}`;$('loadMsg').className='msg';$('loadMsg').textContent='Cargando inventario disponible…';$('loadLines').innerHTML='';$('lWarehouse').innerHTML='<option value="">Cargando…</option>';$('lScheduled').value='';$('lNotes').value='';$('loadModal').classList.remove('hidden');
  try{
    const data=await api(`/api/sales-loads?sales_order_id=${encodeURIComponent(order.id)}`);loadOptions=data;$('lWarehouse').innerHTML='<option value="">Seleccionar almacén</option>'+(data.warehouses||[]).map(w=>`<option value="${w.id}">${esc(w.code||'')} · ${esc(w.name)}</option>`).join('');
    const sourceWarehouses=[...new Set((data.sources||[]).map(s=>s.warehouse_id))];if(sourceWarehouses.length===1)$('lWarehouse').value=sourceWarehouses[0];$('loadMsg').textContent='';renderLoadLines();
  }catch(e){$('loadMsg').textContent=reportSalesError('load-options',e,'No se pudo cargar el inventario disponible. Intenta nuevamente.');$('loadLines').innerHTML='<div class="empty">No se pudo cargar el inventario disponible.</div>'}
}
function renderLoadLines(){
  if(!loadOptions)return;const warehouseId=$('lWarehouse').value;const pending=(loadOptions.order?.items||[]).filter(i=>n(i.progress?.unallocated_quantity)>0||n(i.progress?.unallocated_pallets)>0);
  if(!warehouseId){$('loadLines').innerHTML='<div class="empty">Selecciona un almacén para ver los WR disponibles.</div>';return}
  $('loadLines').innerHTML=pending.map(item=>{
    const sources=(loadOptions.sources||[]).filter(s=>s.product_id===item.product_id&&s.warehouse_id===warehouseId);
    const rows=sources.length?sources.map(s=>`<div class="receive-line" data-wr="${s.receipt_item_id}"><div><b>${esc(s.receipt_number||'WR')}</b><div class="receive-meta">${date(s.received_at)}${s.lot_number?` · Lote ${esc(s.lot_number)}`:''} · Disponible ${fmt(s.available_quantity)} ${esc(item.unit)}${n(s.available_pallets)>0?` / ${fmt(s.available_pallets)} pallets`:''}</div></div><div><label>Cantidad</label><input class="wrQty" type="number" min="0" max="${n(s.available_quantity)}" step="0.001" value="0"></div><div><label>Pallets</label><input class="wrPallets" type="number" min="0" max="${n(s.available_pallets)}" step="0.001" value="0"></div><div><label>Unidades/pallet</label><input value="${esc(s.units_per_pallet||'—')}" disabled></div></div>`).join(''):'<div class="small">No hay WR disponibles de este producto en el almacén seleccionado.</div>';
    return `<div class="line" data-so-item="${item.id}"><div class="line-head"><div><div class="line-title">${esc(item.product?.sku?item.product.sku+' · ':'')}${esc(item.product?.name||'Producto')}</div><div class="small">Pendiente por planificar: ${fmt(item.progress?.unallocated_quantity)} ${esc(item.unit)}${n(item.progress?.unallocated_pallets)>0?` · ${fmt(item.progress.unallocated_pallets)} pallets`:''}</div></div></div>${rows}</div>`
  }).join('')||'<div class="empty">Esta venta ya no tiene saldo pendiente por planificar.</div>';
}
function collectLoadLines(){
  if(!loadOptions)throw new Error('No se cargó el inventario disponible.');const lines=[];
  document.querySelectorAll('#loadLines [data-so-item]').forEach(div=>{
    const item=loadOptions.order.items.find(i=>i.id===div.dataset.soItem);if(!item)return;const allocations=[];let totalQty=0,totalPallets=0;
    div.querySelectorAll('[data-wr]').forEach(row=>{const qtyInput=row.querySelector('.wrQty'),palletInput=row.querySelector('.wrPallets'),qty=n(qtyInput.value),pallets=n(palletInput.value),maxQty=n(qtyInput.max),maxPallets=n(palletInput.max);if(qty>maxQty+1e-9)throw new Error(`La cantidad indicada supera el saldo disponible del WR.`);if(pallets>maxPallets+1e-9)throw new Error(`Los pallets indicados superan el saldo disponible del WR.`);if(qty>0||pallets>0){allocations.push({receipt_item_id:row.dataset.wr,allocated_quantity:qty,allocated_pallets:pallets});totalQty+=qty;totalPallets+=pallets}});
    if(!allocations.length)return;if(totalQty>n(item.progress?.unallocated_quantity)+1e-9)throw new Error(`La cantidad de ${item.product?.name||'una línea'} excede el saldo pendiente.`);if(n(item.ordered_pallets)>0&&totalPallets>n(item.progress?.unallocated_pallets)+1e-9)throw new Error(`Los pallets de ${item.product?.name||'una línea'} exceden el saldo pendiente.`);lines.push({sales_order_item_id:item.id,allocations})
  });
  if(!lines.length)throw new Error('Selecciona cantidad de al menos un WR.');return lines;
}
async function saveLoad(){
  const btn=$('saveLoad');try{btn.disabled=true;$('loadMsg').className='msg';$('loadMsg').textContent='';if(!loadOrder)throw new Error('Falta la venta.');if(!can(loadOrder,'allocate_load'))throw new Error('Esta Sales Order ya no admite crear un Cargue.');if(!$('lWarehouse').value)throw new Error('Selecciona el almacén.');const orderId=loadOrder.id;const result=await api('/api/sales-loads',{method:'POST',body:JSON.stringify({action:'create_load',sales_order_id:orderId,warehouse_id:$('lWarehouse').value,scheduled_at:localToIso($('lScheduled').value),notes:$('lNotes').value,lines:collectLoadLines()})});const loadNumber=result.load?.load_number||'Cargue';closeModal('load');await load();openDetail(orderId);$('detailMsg').className='msg ok';$('detailMsg').textContent=`${loadNumber} creado correctamente desde la venta.`
  }catch(e){$('loadMsg').textContent=reportSalesError('create-load',e,'No se pudo crear el Cargue. Revisa los datos e intenta nuevamente.')}finally{btn.disabled=false}
}

$('newOrder').onclick=()=>{if(writeAccess)openOrder()};$('refresh').onclick=load;$('addOrderLine').onclick=()=>addLine();$('saveLoad').onclick=saveLoad;$('oClient').onchange=()=>syncImporters();$('lWarehouse').onchange=renderLoadLines;$('search').oninput=render;document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>{const active=x===b;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active))});render()});document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id.replace('Modal',''))}));document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal:not(.hidden)').forEach(m=>closeModal(m.id.replace('Modal','')))});
load().catch(e=>{$('orderList').innerHTML=`<div class="empty">${esc(reportSalesError('bootstrap',e,'No se pudieron cargar las ventas. Intenta nuevamente.'))}</div>`});
