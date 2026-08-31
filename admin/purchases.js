const token=localStorage.getItem('export_mca_token');
if(!token)location.href='/admin/';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let orders=[],suppliers=[],warehouses=[],products=[],view='open',editing=null,detailOrder=null,receiving=null,receivingMode='remaining',lineSeq=0;

async function api(path,opt={}){
  const r=await fetch(path,{...opt,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(opt.headers||{})}}),d=await r.json().catch(()=>({}));
  if(r.status===401){localStorage.removeItem('export_mca_token');location.href='/admin/';throw new Error('Sesión vencida');}
  if(!r.ok)throw new Error(d.error||'Error');
  return d;
}
const n=v=>Number(v||0);
const fmt=v=>new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(n(v));
const money=(v,c='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency:c,maximumFractionDigits:2}).format(n(v));
const pad=v=>String(v).padStart(2,'0');
function localDateToday(){const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
function localNow(){const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;}
function localToIso(value){if(!value)return null;const d=new Date(value);if(Number.isNaN(d.getTime()))throw new Error('Fecha y hora inválida');return d.toISOString();}
function toLocalInput(value){if(!value)return '';const d=new Date(value);if(Number.isNaN(d.getTime()))return '';return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;}
function date(v){if(!v)return '—';const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(m)return `${m[2]}/${m[3]}/${m[1]}`;return new Date(v).toLocaleDateString('es-US');}
function dateTime(v){return v?new Date(v).toLocaleString('es-US'):'—';}
function commercialLabel(s){return ({draft:'Borrador',issued:'Emitida',confirmed:'Confirmada',closed:'Cerrada',cancelled:'Cancelada'})[s]||s;}
function receiptLabel(s){return ({pending:'Pendiente',partial:'Parcial',received:'Recibida'})[s]||s||'Pendiente';}
function commercialClass(s){return s==='cancelled'?'bad':s==='closed'?'off':s==='confirmed'?'ok':s==='issued'?'warn':'';}
function receiptClass(s,excess){return excess?'warn':s==='received'?'ok':s==='partial'?'warn':'';}
function orderTotal(o){return (o.items||[]).reduce((sum,i)=>sum+n(i.ordered_quantity)*n(i.unit_cost),0);}
function capability(order,key){return order?.capabilities?.actions?.[key]||{allowed:false,reason:'CAPABILITY_UNAVAILABLE'};}
function can(order,key){return capability(order,key).allowed===true;}

async function load(){const d=await api('/api/purchases');orders=d.orders||[];suppliers=d.suppliers||[];warehouses=d.warehouses||[];products=d.products||[];render();fillMasters();}
function fillMasters(){
  $('oSupplier').innerHTML='<option value="">Seleccionar proveedor</option>'+suppliers.map(x=>`<option value="${x.id}">${esc(x.name)}${x.country?' · '+esc(x.country):''}</option>`).join('');
  const w='<option value="">Sin almacén definido</option>'+warehouses.map(x=>`<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}</option>`).join('');
  $('oWarehouse').innerHTML=w;$('rWarehouse').innerHTML='<option value="">Seleccionar almacén</option>'+warehouses.map(x=>`<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}</option>`).join('');
}
function filtered(){
  const q=$('search').value.trim().toLowerCase();
  return orders.filter(o=>{const statusOk=view==='all'||(view==='draft'?o.status==='draft':view==='closed'?['closed','cancelled'].includes(o.status):['issued','confirmed'].includes(o.status));const hay=[o.po_number,o.supplier?.name,o.supplier_reference,...(o.items||[]).flatMap(i=>[i.product?.sku,i.product?.name,i.product?.brand])].join(' ').toLowerCase();return statusOk&&(!q||hay.includes(q));});
}
function render(){
  const open=orders.filter(o=>['issued','confirmed'].includes(o.status)).length,draft=orders.filter(o=>o.status==='draft').length,received=orders.filter(o=>o.progress?.receipt_status==='received').length,partial=orders.filter(o=>o.progress?.receipt_status==='partial').length;
  $('metrics').innerHTML=`<div class="metric"><span>Total PO</span><b>${orders.length}</b></div><div class="metric"><span>Borradores</span><b>${draft}</b></div><div class="metric"><span>Abiertas</span><b>${open}</b></div><div class="metric"><span>Parciales</span><b>${partial}</b></div><div class="metric"><span>Recibidas</span><b>${received}</b></div>`;
  const list=filtered();
  $('orderList').innerHTML=list.length?list.map(o=>`<article class="row"><div><div class="po">${esc(o.po_number)}</div><div class="small">${date(o.order_date)}</div></div><div><b>${esc(o.supplier?.name||'—')}</b><div class="small">${esc(o.supplier_reference||'Sin referencia')}</div></div><div>${esc(o.warehouse?.code||'—')}<div class="small">${esc(o.warehouse?.name||'Sin almacén')}</div></div><div><span class="pill ${commercialClass(o.status)}">${commercialLabel(o.status)}</span></div><div><span class="pill ${receiptClass(o.progress?.receipt_status,o.progress?.has_excess)}">${o.progress?.has_excess?'Exceso · ':''}${receiptLabel(o.progress?.receipt_status)}</span><div class="small">${o.progress?.received_items||0}/${o.progress?.item_count||0} líneas completas</div></div><div><b>${money(orderTotal(o),o.currency)}</b><div class="small">${(o.items||[]).length} línea(s)</div></div><div class="actions"><button class="btn" data-view-order="${o.id}">Ver</button>${can(o,'edit')?`<button class="btn" data-edit-order="${o.id}">Editar</button>`:''}${can(o,'receive_remaining')?`<button class="btn orange" data-receive-order="${o.id}">Recibir</button>`:''}</div></article>`).join(''):'<div class="empty">No hay Purchase Orders en esta vista.</div>';
  bindRows();
}
function bindRows(){document.querySelectorAll('[data-view-order]').forEach(b=>b.onclick=()=>openDetail(b.dataset.viewOrder));document.querySelectorAll('[data-edit-order]').forEach(b=>b.onclick=()=>openOrder(orders.find(o=>o.id===b.dataset.editOrder)));document.querySelectorAll('[data-receive-order]').forEach(b=>b.onclick=()=>openReceive(orders.find(o=>o.id===b.dataset.receiveOrder),'remaining'));}
function productOptions(selected=''){return '<option value="">Seleccionar producto</option>'+products.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.sku?p.sku+' · ':'')}${esc(p.name)}</option>`).join('');}
function addLine(seed={}){
  lineSeq++;const id=lineSeq,div=document.createElement('div');div.className='line';div.dataset.line=id;
  div.innerHTML=`<div class="line-head"><div class="line-title">Línea ${$('orderLines').children.length+1}</div><button class="btn danger" type="button" data-remove-line="${id}">Quitar</button></div><div class="grid3"><div><label>Producto *</label><select class="lProduct">${productOptions(seed.product_id||'')}</select></div><div><label>Cantidad ordenada</label><input class="lQty" type="number" min="0" step="0.001" value="${esc(seed.ordered_quantity||'')}"></div><div><label>Pallets</label><input class="lPallets" type="number" min="0" step="0.001" value="${esc(seed.ordered_pallets||'')}"></div></div><div class="grid3"><div><label>Unidades por pallet</label><input class="lUpp" type="number" min="0" step="0.001" value="${esc(seed.units_per_pallet||'')}"></div><div><label>Costo unitario</label><input class="lCost" type="number" min="0" step="0.0001" value="${esc(seed.unit_cost||'')}"></div><div><label>Notas</label><input class="lNotes" value="${esc(seed.notes||'')}"></div></div><div class="small lProductInfo"></div>`;
  $('orderLines').appendChild(div);div.querySelector('[data-remove-line]').onclick=()=>{div.remove();if(!$('orderLines').children.length)addLine();};div.querySelector('.lProduct').onchange=()=>syncProduct(div);syncProduct(div);
}
function syncProduct(div){const p=products.find(x=>x.id===div.querySelector('.lProduct').value);div.querySelector('.lProductInfo').textContent=p?[p.brand,p.unit,p.package_format].filter(Boolean).join(' · '):'';if(p&&!div.querySelector('.lUpp').value&&p.default_units_per_pallet)div.querySelector('.lUpp').value=p.default_units_per_pallet;}
function collectLines(){return [...document.querySelectorAll('#orderLines .line')].map(div=>({product_id:div.querySelector('.lProduct').value,ordered_quantity:div.querySelector('.lQty').value,ordered_pallets:div.querySelector('.lPallets').value,units_per_pallet:div.querySelector('.lUpp').value,unit_cost:div.querySelector('.lCost').value,notes:div.querySelector('.lNotes').value}));}
function openOrder(order=null){
  if(order&&!can(order,'edit'))throw new Error('Esta Purchase Order ya no admite edición.');
  editing=order||null;$('orderTitle').textContent=order?`Editar ${order.po_number}`:'Nueva Purchase Order';$('oSupplier').value=order?.supplier_id||'';$('oWarehouse').value=order?.warehouse_id||'';$('oCurrency').value=order?.currency||'USD';$('oDate').value=order?.order_date||localDateToday();$('oExpected').value=toLocalInput(order?.expected_at);$('oReference').value=order?.supplier_reference||'';$('oNotes').value=order?.notes||'';$('orderLines').innerHTML='';(order?.items?.length?order.items:[{}]).forEach(i=>addLine(i));$('orderMsg').textContent='';$('orderModal').classList.remove('hidden');
}
function closeModal(name){$(name+'Modal').classList.add('hidden');if(name==='order')editing=null;if(name==='detail')detailOrder=null;if(name==='receive'){receiving=null;receivingMode='remaining';}}
async function saveOrder(){const btn=$('saveOrder');try{btn.disabled=true;$('orderMsg').textContent='';const body={action:editing?'replace_plan':'create_plan',purchase_order_id:editing?.id,supplier_id:$('oSupplier').value,warehouse_id:$('oWarehouse').value,order_date:$('oDate').value,expected_at:localToIso($('oExpected').value),currency:$('oCurrency').value,supplier_reference:$('oReference').value,notes:$('oNotes').value,lines:collectLines()};await api('/api/purchases',{method:'POST',body:JSON.stringify(body)});closeModal('order');await load();}catch(e){$('orderMsg').textContent=e.message;}finally{btn.disabled=false;}}
function itemProgress(item){const active=(item.allocations||[]).filter(a=>a.receipt_item?.receipt?.status==='received'),rq=active.reduce((s,a)=>s+n(a.received_quantity),0),rp=active.reduce((s,a)=>s+n(a.received_pallets),0),complete=(n(item.ordered_quantity)===0||rq>=n(item.ordered_quantity))&&(n(item.ordered_pallets)===0||rp>=n(item.ordered_pallets));return {rq,rp,status:rq===0&&rp===0?'Pendiente':complete?'Recibido':'Parcial'};}
function openDetail(id){
  detailOrder=orders.find(o=>o.id===id);if(!detailOrder)return;const o=detailOrder;$('detailTitle').textContent=o.po_number;$('detailSubtitle').textContent=`${o.supplier?.name||'—'} · ${commercialLabel(o.status)} · ${receiptLabel(o.progress?.receipt_status)}`;
  $('detailBody').innerHTML=`<div class="summary"><div><b>Proveedor</b>${esc(o.supplier?.name||'—')}</div><div><b>Almacén esperado</b>${esc(o.warehouse?.name||'Sin definir')}</div><div><b>Fecha / ETA</b>${date(o.order_date)}<br><span class="small">${dateTime(o.expected_at)}</span></div><div><b>Total estimado</b>${money(orderTotal(o),o.currency)}</div></div><div class="summary"><div><b>Estado comercial</b><span class="pill ${commercialClass(o.status)}">${commercialLabel(o.status)}</span></div><div><b>Estado físico</b><span class="pill ${receiptClass(o.progress?.receipt_status,o.progress?.has_excess)}">${o.progress?.has_excess?'Exceso · ':''}${receiptLabel(o.progress?.receipt_status)}</span></div><div><b>Referencia proveedor</b>${esc(o.supplier_reference||'—')}</div><div><b>Notas</b>${esc(o.notes||'—')}</div></div><div class="detail-items">${(o.items||[]).map(i=>{const p=itemProgress(i);return `<div class="detail-item"><div class="line-head"><div><b>${esc(i.product?.sku?i.product.sku+' · ':'')}${esc(i.product?.name||'Producto')}</b><div class="small">${esc(i.product?.brand||'')} ${esc(i.product?.package_format||'')}</div></div><span class="pill ${p.status==='Recibido'?'ok':p.status==='Parcial'?'warn':''}">${p.status}</span></div><div class="progress">Ordenado: <b>${fmt(i.ordered_quantity)} ${esc(i.unit)}</b>${n(i.ordered_pallets)?` · ${fmt(i.ordered_pallets)} pallets`:''} · Recibido: <b>${fmt(p.rq)} ${esc(i.unit)}</b>${p.rp?` · ${fmt(p.rp)} pallets`:''} · Costo: ${i.unit_cost!=null?money(i.unit_cost,i.currency):'—'}</div>${(i.allocations||[]).length?`<div class="small">WR: ${(i.allocations||[]).map(a=>`${esc(a.receipt_item?.receipt?.receipt_number||'—')} (${a.receipt_item?.receipt?.status==='cancelled'?'anulado':fmt(a.received_quantity)})`).join(' · ')}</div>`:''}</div>`;}).join('')}</div>`;
  const acts=[];
  if(can(o,'edit'))acts.push('<button class="btn" data-detail-action="edit">Editar</button>');
  if(can(o,'issue'))acts.push('<button class="btn orange" data-detail-action="issue">Emitir PO</button>');
  if(can(o,'confirm'))acts.push('<button class="btn primary" data-detail-action="confirm">Confirmar</button>');
  if(can(o,'receive_remaining'))acts.push('<button class="btn orange" data-detail-action="receive">Recibir</button>');
  if(can(o,'receive_excess'))acts.push('<button class="btn" data-detail-action="receive_excess">Registrar exceso / ajuste</button>');
  if(can(o,'close'))acts.push('<button class="btn" data-detail-action="close">Cerrar</button>');
  if(can(o,'cancel'))acts.push('<button class="btn danger" data-detail-action="cancel">Cancelar</button>');
  $('detailActions').innerHTML=acts.join('');$('detailActions').querySelectorAll('[data-detail-action]').forEach(b=>b.onclick=()=>detailAction(b.dataset.detailAction));$('detailMsg').textContent='';$('detailModal').classList.remove('hidden');
}
async function detailAction(action){
  if(action==='edit'){closeModal('detail');openOrder(detailOrder);return;}
  if(action==='receive'){const order=detailOrder;closeModal('detail');openReceive(order,'remaining');return;}
  if(action==='receive_excess'){const order=detailOrder;closeModal('detail');openReceive(order,'excess');return;}
  const key=action==='issue'?'issue':action==='confirm'?'confirm':action==='close'?'close':action==='cancel'?'cancel':null;
  if(!key||!can(detailOrder,key))return;
  const label={issue:'emitir',confirm:'confirmar',cancel:'cancelar',close:'cerrar'}[action];
  if(!confirm(`¿Confirmas ${label} ${detailOrder.po_number}?`))return;
  try{await api('/api/purchases',{method:'POST',body:JSON.stringify({action,purchase_order_id:detailOrder.id})});closeModal('detail');await load();}catch(e){$('detailMsg').textContent=e.message;}
}
function openReceive(order,mode='remaining'){
  const key=mode==='excess'?'receive_excess':'receive_remaining';
  if(!order||!can(order,key))throw new Error(mode==='excess'?'Esta PO no admite un ajuste de exceso en su estado actual.':'Esta PO ya no tiene mercancía pendiente por recibir.');
  receiving=order;receivingMode=mode;$('receiveTitle').textContent=mode==='excess'?`Registrar exceso / ajuste · ${order.po_number}`:`Recibir ${order.po_number}`;$('rWarehouse').value=order.warehouse_id||'';$('rReceivedAt').value=localNow();$('rReference').value='';$('rTruck').value='';$('rDriver').value='';$('rNotes').value=mode==='excess'?'Ajuste explícito sobre PO recibida completamente.':'';$('receiveMsg').className='msg';$('receiveMsg').textContent=mode==='excess'?'Indica únicamente la mercancía adicional real que debe entrar al inventario.':'';
  $('receiveLines').innerHTML=(order.items||[]).map(i=>{const p=itemProgress(i),remQ=Math.max(0,n(i.ordered_quantity)-p.rq),remP=Math.max(0,n(i.ordered_pallets)-p.rp),defaultQ=mode==='excess'?'':(remQ||''),defaultP=mode==='excess'?'':(remP||'');return `<div class="line receive-line" data-receive-item="${i.id}"><div><div class="line-title">${esc(i.product?.sku?i.product.sku+' · ':'')}${esc(i.product?.name||'Producto')}</div><div class="receive-meta">Ordenado ${fmt(i.ordered_quantity)} ${esc(i.unit)} · Recibido ${fmt(p.rq)} · Pendiente ${fmt(remQ)}${n(i.ordered_pallets)?` · ${fmt(remP)} pallets`:''}</div></div><div><label>${mode==='excess'?'Cantidad adicional':'Recibir cantidad'}</label><input class="rrQty" type="number" min="0" step="0.001" value="${defaultQ}"></div><div><label>Pallets</label><input class="rrPallets" type="number" min="0" step="0.001" value="${defaultP}"></div><div><label>Lote</label><input class="rrLot"></div><input class="rrUpp" type="hidden" value="${esc(i.units_per_pallet||'')}"></div>`;}).join('');$('receiveModal').classList.remove('hidden');
}
function receiptLines(){return [...document.querySelectorAll('[data-receive-item]')].map(div=>({purchase_order_item_id:div.dataset.receiveItem,received_quantity:div.querySelector('.rrQty').value,received_pallets:div.querySelector('.rrPallets').value,units_per_pallet:div.querySelector('.rrUpp').value,lot_number:div.querySelector('.rrLot').value})).filter(x=>n(x.received_quantity)>0||n(x.received_pallets)>0);}
async function submitReceipt(allowOver=receivingMode==='excess'){
  const btn=$('saveReceipt');
  try{btn.disabled=true;$('receiveMsg').textContent='';const body={action:'receive',warehouse_id:$('rWarehouse').value,received_at:localToIso($('rReceivedAt').value),reference_number:$('rReference').value,truck_reference:$('rTruck').value,driver_name:$('rDriver').value,notes:$('rNotes').value,allow_over_receipt:allowOver,lines:receiptLines()};const d=await api('/api/purchases',{method:'POST',body:JSON.stringify(body)});$('receiveMsg').className='msg ok';$('receiveMsg').textContent=`${d.receipt.receipt_number} registrada correctamente.`;await load();setTimeout(()=>closeModal('receive'),500);}catch(e){if(receivingMode==='remaining'&&!allowOver&&String(e.message).includes('requiere confirmación explícita')&&confirm('La cantidad excede lo ordenado. ¿Confirmas registrar el exceso?')){btn.disabled=false;return submitReceipt(true);}$('receiveMsg').className='msg';$('receiveMsg').textContent=e.message;}finally{btn.disabled=false;}
}

$('newOrder').onclick=()=>openOrder();$('addOrderLine').onclick=()=>addLine();$('saveOrder').onclick=saveOrder;$('saveReceipt').onclick=()=>submitReceipt();$('refresh').onclick=load;$('search').oninput=render;document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===b));render();});document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));['order','detail','receive'].forEach(name=>$(name+'Modal').onclick=e=>{if(e.target===$(name+'Modal'))closeModal(name);});
load().catch(e=>$('orderList').innerHTML=`<div class="empty">${esc(e.message)}</div>`);
