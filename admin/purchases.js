const token=localStorage.getItem('export_mca_token');
if(!token)location.href='/admin/';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let orders=[],suppliers=[],warehouses=[],products=[],view='open',editing=null,detailOrder=null,receiving=null,receivingMode='remaining',lineSeq=0,quickProductTarget=null;
let purchaseDecisionResolve=null,purchaseDecisionReturnFocus=null;
const purchaseModalReturnFocus=new Map();
const SAFE_PURCHASE_ERROR_PATTERNS=[/^Sesión vencida$/i,/^No tienes permiso/i,/^No autorizado$/i,/^Agrega /i,/^Selecciona /i,/^Falta /i,/^Fecha y hora inválida$/i,/^Proveedor /i,/^El proveedor /i,/^Almacén /i,/^El almacén /i,/^Uno de los productos /i,/^La PO /i,/^La cantidad /i,/^El valor total /i,/^Cada línea /i,/^Las (?:líneas|unidades) /i,/^Solo una PO /i,/^La mercancía /i,/^El ajuste /i,/^Una misma recepción /i,/^La recepción /i,/^Indica /i,/^El peso /i,/^No se puede /i,/^Acción de /i,/^Transición de /i,/^Esta (?:PO|Purchase Order) /i,/^No se pudo procesar Compras/i];

async function api(path,opt={}){
  const r=await fetch(path,{...opt,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(opt.headers||{})}}),d=await r.json().catch(()=>({}));
  if(r.status===401){localStorage.removeItem('export_mca_token');location.href='/admin/';throw new Error('Sesión vencida');}
  if(!r.ok){const error=new Error(d.error||'No se pudo procesar la operación');error.code=d.details?.code||null;error.status=r.status;throw error;}
  return d;
}
function safePurchaseMessage(error,fallback='No se pudo completar la acción. Intenta nuevamente.'){
  const message=String(error?.message||'').trim();
  return SAFE_PURCHASE_ERROR_PATTERNS.some(pattern=>pattern.test(message))?message:fallback;
}
function openPurchaseModal(name,focusId){
  const modal=$(name+'Modal');
  if(!modal)return;
  if(modal.classList.contains('hidden'))purchaseModalReturnFocus.set(name,document.activeElement);
  modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>{const target=$(focusId)||modal.querySelector('button,select,input,textarea');target?.focus();});
}
function closePurchaseDecision(value=false){
  const modal=$('purchaseDecisionModal'),resolve=purchaseDecisionResolve,returnFocus=purchaseDecisionReturnFocus;
  purchaseDecisionResolve=null;purchaseDecisionReturnFocus=null;modal?.classList.add('hidden');modal?.setAttribute('aria-hidden','true');
  if(returnFocus instanceof HTMLElement)returnFocus.focus();
  resolve?.(value);
}
function purchaseDecision({title,copy,accept='Continuar',danger=false}){
  if(purchaseDecisionResolve)closePurchaseDecision(false);
  const modal=$('purchaseDecisionModal'),acceptButton=$('purchaseDecisionAccept');
  if(!modal||!acceptButton)return Promise.resolve(false);
  $('purchaseDecisionTitle').textContent=title;$('purchaseDecisionCopy').textContent=copy;$('purchaseDecisionMsg').textContent='';acceptButton.textContent=accept;acceptButton.className=`btn ${danger?'danger':'primary'}`;
  purchaseDecisionReturnFocus=document.activeElement;modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
  return new Promise(resolve=>{purchaseDecisionResolve=resolve;acceptButton.focus();});
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
function commercialLabel(s){return ({draft:'Borrador',issued:'Emitida',confirmed:'Confirmada',closed:'Cerrada',cancelled:'Cancelada'})[s]||'Estado no disponible';}
function receiptLabel(s){return ({pending:'Pendiente',partial:'Parcial',received:'Recibida'})[s]||(s?'Estado no disponible':'Pendiente');}
function commercialClass(s){return s==='cancelled'?'bad':s==='closed'?'off':s==='confirmed'?'ok':s==='issued'?'warn':'';}
function receiptClass(s,excess){return excess?'warn':s==='received'?'ok':s==='partial'?'warn':'';}
function isDirectPurchase(order){return !order?.warehouse_id;}
function hasEnteredLineTotal(item){return item?.entered_line_total!==null&&item?.entered_line_total!==undefined&&item?.entered_line_total!=='';}
function lineTotal(item){return hasEnteredLineTotal(item)?n(item.entered_line_total):n(item?.ordered_quantity)*n(item?.unit_cost);}
function orderTotal(o){return (o.items||[]).reduce((sum,i)=>sum+lineTotal(i),0);}
function capability(order,key){return order?.capabilities?.actions?.[key]||{allowed:false,reason:'CAPABILITY_UNAVAILABLE'};}
function can(order,key){return capability(order,key).allowed===true;}

async function load(){const d=await api('/api/purchases');orders=d.orders||[];suppliers=d.suppliers||[];warehouses=d.warehouses||[];products=d.products||[];render();fillMasters();}
function fillMasters(){
  $('oSupplier').innerHTML='<option value="">Seleccionar proveedor</option>'+suppliers.map(x=>`<option value="${x.id}">${esc(x.name)}${x.country?' · '+esc(x.country):''}</option>`).join('');
  const w='<option value="">Seleccionar almacén</option>'+warehouses.map(x=>`<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}</option>`).join('');
  $('oWarehouse').innerHTML=w;$('rWarehouse').innerHTML='<option value="">Seleccionar almacén</option>'+warehouses.map(x=>`<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}</option>`).join('');
}
function setPurchaseDestination(mode){const direct=mode==='direct';$('oDestinationMode').value=direct?'direct':'warehouse';$('oWarehouseField').hidden=direct;$('oWarehouse').disabled=direct;if(direct)$('oWarehouse').value='';$('oDestinationHelp').classList.toggle('direct',direct);$('oDestinationHelp').textContent=direct?'El proveedor envía la mercancía al cliente. Esta compra no crea WR ni entra a tu inventario; después se vincula desde Ventas → Origen / Direct Ship.':'La mercancía entrará físicamente a tu almacén. Al recibirla se creará un WR y entonces aparecerá en Existencias.';}
function filtered(){
  const q=$('search').value.trim().toLowerCase();
  return orders.filter(o=>{const statusOk=view==='all'||(view==='draft'?o.status==='draft':view==='closed'?['closed','cancelled'].includes(o.status):['issued','confirmed'].includes(o.status));const hay=[o.po_number,o.supplier?.name,o.supplier_reference,...(o.items||[]).flatMap(i=>[i.product?.sku,i.product?.name,i.product?.brand])].join(' ').toLowerCase();return statusOk&&(!q||hay.includes(q));});
}
function render(){
  const open=orders.filter(o=>['issued','confirmed'].includes(o.status)).length,draft=orders.filter(o=>o.status==='draft').length,received=orders.filter(o=>o.progress?.receipt_status==='received').length,partial=orders.filter(o=>o.progress?.receipt_status==='partial').length;
  $('metrics').innerHTML=`<div class="metric"><span>Total PO</span><b>${orders.length}</b></div><div class="metric purchase-metric-draft"><span>Borradores</span><b>${draft}</b></div><div class="metric purchase-metric-open"><span>Abiertas</span><b>${open}</b></div><div class="metric purchase-metric-partial"><span>Recepción parcial</span><b>${partial}</b></div><div class="metric purchase-metric-received"><span>Recibidas</span><b>${received}</b></div>`;
  const list=filtered();
  const rows=list.map(o=>`<article class="row purchase-order-row" aria-label="Purchase Order ${esc(o.po_number)}"><div class="purchase-order-cell"><span class="purchase-order-cell-label">Purchase Order</span><div class="po">${esc(o.po_number)}</div><div class="small">${date(o.order_date)}</div></div><div class="purchase-order-cell"><span class="purchase-order-cell-label">Proveedor</span><b>${esc(o.supplier?.name||'—')}</b><div class="small">${esc(o.supplier_reference||'Sin referencia')}</div></div><div class="purchase-order-cell"><span class="purchase-order-cell-label">Destino</span>${isDirectPurchase(o)?'<b>Direct Ship</b><div class="small">Proveedor → cliente · sin WR</div>':`${esc(o.warehouse?.code||'—')}<div class="small">${esc(o.warehouse?.name||'Almacén')}</div>`}</div><div class="purchase-order-cell"><span class="purchase-order-cell-label">Estado PO</span><span class="pill ${commercialClass(o.status)}">${esc(commercialLabel(o.status))}</span></div><div class="purchase-order-cell"><span class="purchase-order-cell-label">Recepción</span>${isDirectPurchase(o)?'<span class="pill purchase-direct-pill">No aplica</span><div class="small">No entra a inventario</div>':`<span class="pill ${receiptClass(o.progress?.receipt_status,o.progress?.has_excess)}">${o.progress?.has_excess?'Exceso · ':''}${esc(receiptLabel(o.progress?.receipt_status))}</span><div class="small">${o.progress?.received_items||0}/${o.progress?.item_count||0} líneas completas</div>`}</div><div class="purchase-order-cell purchase-order-value"><span class="purchase-order-cell-label">Valor estimado</span><b class="purchase-order-total">${money(orderTotal(o),o.currency)}</b><div class="small">${(o.items||[]).length} línea(s)</div></div><div class="actions purchase-order-actions"><button class="btn" type="button" data-view-order="${o.id}">Ver</button>${can(o,'edit')?`<button class="btn" type="button" data-edit-order="${o.id}">Editar</button>`:''}${can(o,'receive_remaining')?`<button class="btn orange" type="button" data-receive-order="${o.id}">Recibir</button>`:''}</div></article>`).join('');
  $('orderList').innerHTML=rows||'<div class="empty"><b>Sin compras en esta vista</b><div class="small">Cambia el filtro o registra una nueva orden de compra.</div></div>';
  $('orderList').insertAdjacentHTML('beforeend',`<div class="purchases-list-count">${list.length} compra${list.length===1?'':'s'}${list.length!==orders.length?` visibles · ${orders.length} registradas`:''}</div>`);
  bindRows();
}
function bindRows(){document.querySelectorAll('[data-view-order]').forEach(b=>b.onclick=()=>openDetail(b.dataset.viewOrder));document.querySelectorAll('[data-edit-order]').forEach(b=>b.onclick=()=>openOrder(orders.find(o=>o.id===b.dataset.editOrder)));document.querySelectorAll('[data-receive-order]').forEach(b=>b.onclick=()=>openReceive(orders.find(o=>o.id===b.dataset.receiveOrder),'remaining'));}
function productOptions(selected=''){return '<option value="">Seleccionar producto</option>'+products.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.sku?p.sku+' · ':'')}${esc(p.name)}</option>`).join('');}
function setLinePricingMode(div,mode,convert=false){
  const nextMode=mode==='total'?'total':'unit',previousMode=div.dataset.pricingMode||nextMode,input=div.querySelector('.lPriceValue'),typedQuantity=n(div.querySelector('.lQty')?.value),palletQuantity=n(div.querySelector('.lPallets')?.value)*n(div.querySelector('.lUpp')?.value),quantity=typedQuantity||palletQuantity;
  if(convert&&input?.value!==''&&previousMode!==nextMode&&quantity>0){const current=n(input.value);input.value=nextMode==='total'?(current*quantity).toFixed(2):String(current/quantity);}
  div.dataset.pricingMode=nextMode;div.querySelector('.lPriceMode').value=nextMode;div.querySelector('.lPriceLabel').textContent=nextMode==='total'?'Valor total de la línea':'Costo unitario';input.step=nextMode==='total'?'0.01':'0.0001';
  updateLineSummary(div);
}
function updateLineSummary(div){
  const typedQuantity=n(div.querySelector('.lQty').value),pallets=n(div.querySelector('.lPallets').value),unitsPerPallet=n(div.querySelector('.lUpp').value),quantity=typedQuantity||(pallets*unitsPerPallet),price=n(div.querySelector('.lPriceValue').value),mode=div.dataset.pricingMode||'unit';
  const pricing=div.querySelector('.lPricingHelp'),measurement=div.querySelector('.lMeasurementHelp'),currency=$('oCurrency').value.trim().toUpperCase()||'USD';
  const total=mode==='total'?price:quantity*price,unitCost=mode==='total'&&quantity>0?price/quantity:price;
  pricing.textContent=price>0?(mode==='total'?`Costo unitario calculado: ${money(unitCost,currency)} · Total: ${money(total,currency)}`:`Total calculado: ${money(total,currency)}`):(mode==='total'?'Escribe el valor total; calcularemos el costo unitario.':'Escribe el costo por unidad; calcularemos el total.');
  const hasCompleteMeasure=typedQuantity>0&&pallets>0&&unitsPerPallet>0,matches=!hasCompleteMeasure||Math.abs(typedQuantity-(pallets*unitsPerPallet))<=0.000001;
  measurement.classList.toggle('is-error',!matches);measurement.classList.toggle('is-ok',hasCompleteMeasure&&matches);
  measurement.textContent=!typedQuantity&&pallets>0&&unitsPerPallet>0?`Cantidad calculada: ${fmt(pallets*unitsPerPallet)} unidades`:!hasCompleteMeasure?'':matches?`${fmt(pallets)} pallets × ${fmt(unitsPerPallet)} = ${fmt(typedQuantity)} unidades`:`Revisa la medida: ${fmt(pallets)} pallets × ${fmt(unitsPerPallet)} son ${fmt(pallets*unitsPerPallet)}, no ${fmt(typedQuantity)}.`;
}
function addLine(seed={}){
  lineSeq++;const id=lineSeq,div=document.createElement('div'),pricingMode=hasEnteredLineTotal(seed)?'total':'unit',pricingValue=pricingMode==='total'?seed.entered_line_total:seed.unit_cost;div.className='line purchase-order-line';div.dataset.line=id;div.dataset.pricingMode=pricingMode;
  div.innerHTML=`<div class="line-head"><div class="line-title">Línea ${$('orderLines').children.length+1}</div><button class="btn danger" type="button" data-remove-line="${id}">Quitar</button></div><div class="grid3"><div class="purchase-product-field"><label>Producto *</label><select class="lProduct">${productOptions(seed.product_id||'')}</select><button class="btn product-create-inline" type="button" data-new-product="${id}">+ Nuevo producto</button></div><div><label>Cantidad ordenada</label><input class="lQty" type="number" min="0" step="0.001" value="${esc(seed.ordered_quantity||'')}"></div><div><label>Pallets</label><input class="lPallets" type="number" min="0" step="0.001" value="${esc(seed.ordered_pallets||'')}"></div></div><div class="purchase-line-details"><div><label>Unidades por pallet</label><input class="lUpp" type="number" min="0" step="0.001" value="${esc(seed.units_per_pallet||'')}"></div><div><label>Registrar precio por</label><select class="lPriceMode"><option value="unit">Costo unitario</option><option value="total">Valor total</option></select></div><div><label class="lPriceLabel">Costo unitario</label><input class="lPriceValue" type="number" min="0" step="0.0001" value="${esc(pricingValue??'')}"></div><div><label>Notas</label><input class="lNotes" value="${esc(seed.notes||'')}"></div></div><div class="purchase-line-feedback"><div class="small lProductInfo"></div><div class="small lPricingHelp"></div><div class="small lMeasurementHelp" role="status"></div></div>`;
  $('orderLines').appendChild(div);div.querySelector('[data-remove-line]').onclick=()=>{div.remove();if(!$('orderLines').children.length)addLine();};div.querySelector('[data-new-product]').onclick=()=>openQuickProduct(div);div.querySelector('.lProduct').onchange=()=>syncProduct(div);div.querySelector('.lPriceMode').onchange=event=>setLinePricingMode(div,event.target.value,true);['.lQty','.lPallets','.lUpp','.lPriceValue'].forEach(selector=>div.querySelector(selector).oninput=()=>updateLineSummary(div));setLinePricingMode(div,pricingMode);syncProduct(div);
}
function syncProduct(div){const p=products.find(x=>x.id===div.querySelector('.lProduct').value);div.querySelector('.lProductInfo').textContent=p?[p.brand,p.unit,p.package_format].filter(Boolean).join(' · '):'';if(p&&!div.querySelector('.lUpp').value&&p.default_units_per_pallet)div.querySelector('.lUpp').value=p.default_units_per_pallet;updateLineSummary(div);}
function collectLines(){return [...document.querySelectorAll('#orderLines [data-line]')].map((div,index)=>{const quantity=n(div.querySelector('.lQty').value),pallets=n(div.querySelector('.lPallets').value),unitsPerPallet=n(div.querySelector('.lUpp').value),mode=div.dataset.pricingMode||'unit',price=div.querySelector('.lPriceValue').value;if(quantity>0&&pallets>0&&unitsPerPallet>0&&Math.abs(quantity-(pallets*unitsPerPallet))>0.000001)throw new Error(`La cantidad de la línea ${index+1} debe ser igual a pallets × unidades por pallet.`);return {product_id:div.querySelector('.lProduct').value,ordered_quantity:div.querySelector('.lQty').value,ordered_pallets:div.querySelector('.lPallets').value,units_per_pallet:div.querySelector('.lUpp').value,unit_cost:mode==='unit'?price:'',line_total:mode==='total'?price:'',notes:div.querySelector('.lNotes').value};});}
function openOrder(order=null){
  if(order&&!can(order,'edit'))throw new Error('Esta Purchase Order ya no admite edición.');
  editing=order||null;$('orderTitle').textContent=order?`Editar ${order.po_number}`:'Nueva Purchase Order';$('oSupplier').value=order?.supplier_id||'';$('oWarehouse').value=order?.warehouse_id||'';setPurchaseDestination(order&&isDirectPurchase(order)?'direct':'warehouse');if(order?.warehouse_id)$('oWarehouse').value=order.warehouse_id;$('oCurrency').value=order?.currency||'USD';$('oDate').value=order?.order_date||localDateToday();$('oExpected').value=toLocalInput(order?.expected_at);$('oReference').value=order?.supplier_reference||'';$('oNotes').value=order?.notes||'';$('orderLines').innerHTML='';(order?.items?.length?order.items:[{}]).forEach(i=>addLine(i));$('orderMsg').textContent='';openPurchaseModal('order','oSupplier');
}
function closeModal(name){
  const modal=$(name+'Modal'),returnFocus=purchaseModalReturnFocus.get(name);
  modal?.classList.add('hidden');modal?.setAttribute('aria-hidden','true');purchaseModalReturnFocus.delete(name);
  if(name==='order')editing=null;if(name==='detail')detailOrder=null;if(name==='receive'){receiving=null;receivingMode='remaining';}if(name==='quickProduct')quickProductTarget=null;
  if(returnFocus instanceof HTMLElement)returnFocus.focus();
}
async function saveOrder(){const btn=$('saveOrder');try{btn.disabled=true;$('orderMsg').textContent='';const direct=$('oDestinationMode').value==='direct';if(!direct&&!$('oWarehouse').value)throw new Error('Selecciona el almacén que recibirá la mercancía o elige Direct Ship.');const body={action:editing?'replace_plan':'create_plan',purchase_order_id:editing?.id,supplier_id:$('oSupplier').value,warehouse_id:direct?null:$('oWarehouse').value,order_date:$('oDate').value,expected_at:localToIso($('oExpected').value),currency:$('oCurrency').value,supplier_reference:$('oReference').value,notes:$('oNotes').value,lines:collectLines()};await api('/api/purchases',{method:'POST',body:JSON.stringify(body)});closeModal('order');await load();}catch(error){console.error('PURCHASE_ORDER_SAVE_FAILED',{purchase_order_id:editing?.id||null,error});$('orderMsg').textContent=safePurchaseMessage(error,'No se pudo guardar la Purchase Order. Intenta nuevamente.');}finally{btn.disabled=false;}}
function itemProgress(item){const active=(item.allocations||[]).filter(a=>a.receipt_item?.receipt?.status==='received'),rq=active.reduce((s,a)=>s+n(a.received_quantity),0),rp=active.reduce((s,a)=>s+n(a.received_pallets),0),complete=(n(item.ordered_quantity)===0||rq>=n(item.ordered_quantity))&&(n(item.ordered_pallets)===0||rp>=n(item.ordered_pallets));return {rq,rp,status:rq===0&&rp===0?'Pendiente':complete?'Recibido':'Parcial'};}
function openDetail(id){
  detailOrder=orders.find(o=>o.id===id);if(!detailOrder)return;const o=detailOrder,direct=isDirectPurchase(o);$('detailTitle').textContent=o.po_number;$('detailSubtitle').textContent=`${o.supplier?.name||'—'} · ${commercialLabel(o.status)} · ${direct?'Direct Ship · sin WR':receiptLabel(o.progress?.receipt_status)}`;
  $('detailBody').innerHTML=`<div class="summary"><div><b>Proveedor</b>${esc(o.supplier?.name||'—')}</div><div><b>Destino</b>${isDirectPurchase(o)?'<span class="pill purchase-direct-pill">Direct Ship · sin WR</span>':esc(o.warehouse?.name||'Almacén')}</div><div><b>Fecha / ETA</b>${date(o.order_date)}<br><span class="small">${dateTime(o.expected_at)}</span></div><div><b>Total estimado</b>${money(orderTotal(o),o.currency)}</div></div><div class="summary"><div><b>Estado comercial</b><span class="pill ${commercialClass(o.status)}">${commercialLabel(o.status)}</span></div><div><b>Estado físico</b>${isDirectPurchase(o)?'<span class="pill purchase-direct-pill">No entra a inventario</span>':`<span class="pill ${receiptClass(o.progress?.receipt_status,o.progress?.has_excess)}">${o.progress?.has_excess?'Exceso · ':''}${receiptLabel(o.progress?.receipt_status)}</span>`}</div><div><b>Referencia proveedor</b>${esc(o.supplier_reference||'—')}</div><div><b>Notas</b>${esc(o.notes||'—')}</div></div>${isDirectPurchase(o)?'<div class="purchase-destination-help direct">Continúa esta compra desde Ventas → abre la venta → Origen / Direct Ship. Allí vinculas la PO y el contenedor sin crear una recepción de almacén.</div>':''}<div class="detail-items">${(o.items||[]).map(i=>{const p=itemProgress(i);return `<div class="detail-item"><div class="line-head"><div><b>${esc(i.product?.sku?i.product.sku+' · ':'')}${esc(i.product?.name||'Producto')}</b><div class="small">${esc(i.product?.brand||'')} ${esc(i.product?.package_format||'')}</div></div>${isDirectPurchase(o)?'<span class="pill purchase-direct-pill">Direct Ship</span>':`<span class="pill ${p.status==='Recibido'?'ok':p.status==='Parcial'?'warn':''}">${p.status}</span>`}</div><div class="progress">Ordenado: <b>${fmt(i.ordered_quantity)} ${esc(i.unit)}</b>${n(i.ordered_pallets)?` · ${fmt(i.ordered_pallets)} pallets`:''}${isDirectPurchase(o)?' · Sin recepción WR':` · Recibido: <b>${fmt(p.rq)} ${esc(i.unit)}</b>${p.rp?` · ${fmt(p.rp)} pallets`:''}`} · Costo unitario: ${i.unit_cost!=null?money(i.unit_cost,i.currency):'—'} · Total línea: <b>${money(lineTotal(i),i.currency)}</b></div>${(i.allocations||[]).length?`<div class="small">WR: ${(i.allocations||[]).map(a=>`${esc(a.receipt_item?.receipt?.receipt_number||'—')} (${a.receipt_item?.receipt?.status==='cancelled'?'anulado':fmt(a.received_quantity)})`).join(' · ')}</div>`:''}</div>`;}).join('')}</div>`;
  const acts=[];
  if(can(o,'edit'))acts.push('<button class="btn" data-detail-action="edit">Editar</button>');
  if(can(o,'issue'))acts.push('<button class="btn orange" data-detail-action="issue">Emitir PO</button>');
  if(can(o,'confirm'))acts.push('<button class="btn primary" data-detail-action="confirm">Confirmar</button>');
  if(can(o,'receive_remaining'))acts.push('<button class="btn orange" data-detail-action="receive">Recibir</button>');
  if(can(o,'receive_excess'))acts.push('<button class="btn" data-detail-action="receive_excess">Registrar exceso / ajuste</button>');
  if(can(o,'close'))acts.push('<button class="btn" data-detail-action="close">Cerrar</button>');
  if(can(o,'cancel'))acts.push('<button class="btn danger" data-detail-action="cancel">Cancelar</button>');
  $('detailActions').innerHTML=acts.join('');$('detailActions').querySelectorAll('[data-detail-action]').forEach(b=>b.onclick=()=>detailAction(b.dataset.detailAction));$('detailMsg').textContent='';openPurchaseModal('detail');
}
async function detailAction(action){
  if(action==='edit'){const order=detailOrder;closeModal('detail');openOrder(order);return;}
  if(action==='receive'){const order=detailOrder;closeModal('detail');openReceive(order,'remaining');return;}
  if(action==='receive_excess'){const order=detailOrder;closeModal('detail');openReceive(order,'excess');return;}
  const order=detailOrder,config={
    issue:{capability:'issue',title:'Emitir Purchase Order',copy:'La PO quedará emitida y su plan de mercancía dejará de admitir edición.',accept:'Emitir PO'},
    confirm:{capability:'confirm',title:'Confirmar Purchase Order',copy:isDirectPurchase(order)?'La PO quedará confirmada y disponible para vincularla al Direct Ship desde Ventas. No se creará un WR.':'La PO quedará confirmada y disponible para su recepción física.',accept:'Confirmar PO'},
    close:{capability:'close',title:'Cerrar Purchase Order',copy:isDirectPurchase(order)?'La PO quedará cerrada. Hazlo cuando la compra directa ya haya completado su recorrido al cliente.':'La PO quedará cerrada cuando su recepción ya esté completa.',accept:'Cerrar PO'},
    cancel:{capability:'cancel',title:'Cancelar Purchase Order',copy:'La PO quedará cancelada. Esta acción solo se permite cuando no existen recepciones activas.',accept:'Cancelar PO',danger:true}
  }[action];
  if(!config||!order||!can(order,config.capability))return;
  if(!await purchaseDecision(config))return;
  if(!can(order,config.capability))return;
  try{await api('/api/purchases',{method:'POST',body:JSON.stringify({action,purchase_order_id:order.id})});closeModal('detail');await load();}catch(error){console.error('PURCHASE_ORDER_TRANSITION_FAILED',{purchase_order_id:order.id,action,error});$('detailMsg').textContent=safePurchaseMessage(error);}
}
function openReceive(order,mode='remaining'){
  const key=mode==='excess'?'receive_excess':'receive_remaining';
  if(!order||!can(order,key))throw new Error(mode==='excess'?'Esta PO no admite un ajuste de exceso en su estado actual.':'Esta PO ya no tiene mercancía pendiente por recibir.');
  receiving=order;receivingMode=mode;$('receiveTitle').textContent=mode==='excess'?`Registrar exceso / ajuste · ${order.po_number}`:`Recibir ${order.po_number}`;$('rWarehouse').value=order.warehouse_id||'';$('rReceivedAt').value=localNow();$('rReference').value='';$('rTruck').value='';$('rDriver').value='';$('rNotes').value=mode==='excess'?'Ajuste explícito sobre PO recibida completamente.':'';$('receiveMsg').className='msg';$('receiveMsg').textContent=mode==='excess'?'Indica únicamente la mercancía adicional real que debe entrar al inventario.':'';
  $('receiveLines').innerHTML=(order.items||[]).map(i=>{const p=itemProgress(i),remQ=Math.max(0,n(i.ordered_quantity)-p.rq),remP=Math.max(0,n(i.ordered_pallets)-p.rp),defaultQ=mode==='excess'?'':(remQ||''),defaultP=mode==='excess'?'':(remP||'');return `<div class="line receive-line purchase-receive-line" data-receive-item="${i.id}"><div><div class="line-title">${esc(i.product?.sku?i.product.sku+' · ':'')}${esc(i.product?.name||'Producto')}</div><div class="receive-meta">Ordenado ${fmt(i.ordered_quantity)} ${esc(i.unit)} · Recibido ${fmt(p.rq)} · Pendiente ${fmt(remQ)}${n(i.ordered_pallets)?` · ${fmt(remP)} pallets`:''}</div></div><div><label>${mode==='excess'?'Cantidad adicional':'Recibir cantidad'}</label><input class="rrQty" type="number" min="0" step="0.001" value="${defaultQ}"></div><div><label>Pallets</label><input class="rrPallets" type="number" min="0" step="0.001" value="${defaultP}"></div><div><label>Lote</label><input class="rrLot"></div><input class="rrUpp" type="hidden" value="${esc(i.units_per_pallet||'')}"></div>`;}).join('');openPurchaseModal('receive','rWarehouse');
}
function receiptLines(){return [...document.querySelectorAll('[data-receive-item]')].map(div=>({purchase_order_item_id:div.dataset.receiveItem,received_quantity:div.querySelector('.rrQty').value,received_pallets:div.querySelector('.rrPallets').value,units_per_pallet:div.querySelector('.rrUpp').value,lot_number:div.querySelector('.rrLot').value})).filter(x=>n(x.received_quantity)>0||n(x.received_pallets)>0);}
async function submitReceipt(allowOver=receivingMode==='excess'){
  const btn=$('saveReceipt');
  try{btn.disabled=true;$('receiveMsg').textContent='';const body={action:'receive',warehouse_id:$('rWarehouse').value,received_at:localToIso($('rReceivedAt').value),reference_number:$('rReference').value,truck_reference:$('rTruck').value,driver_name:$('rDriver').value,notes:$('rNotes').value,allow_over_receipt:allowOver,lines:receiptLines()};const d=await api('/api/purchases',{method:'POST',body:JSON.stringify(body)});$('receiveMsg').className='msg ok';$('receiveMsg').textContent=`${d.receipt.receipt_number} registrada correctamente.`;await load();setTimeout(()=>closeModal('receive'),500);}catch(error){if(receivingMode==='remaining'&&!allowOver&&error.code==='PO_OVER_RECEIPT_REQUIRES_CONFIRMATION'){const accepted=await purchaseDecision({title:'Confirmar sobre-recepción',copy:'La cantidad indicada excede lo ordenado. Confirma solo si la mercancía adicional entró físicamente al almacén.',accept:'Registrar exceso',danger:true});if(accepted)return await submitReceipt(true);return;}$('receiveMsg').className='msg';console.error('PURCHASE_RECEIPT_SAVE_FAILED',{purchase_order_id:receiving?.id||null,allow_over_receipt:allowOver,error});$('receiveMsg').textContent=safePurchaseMessage(error,'No se pudo registrar la recepción. Intenta nuevamente.');}finally{btn.disabled=false;}
}

function clearQuickProductForm(){
  ['qpSku','qpName','qpBrand','qpCategory','qpFormat','qpUnitsPallet','qpOrigin','qpHs'].forEach(id=>{const field=$(id);if(field)field.value='';});
  if($('qpUnit'))$('qpUnit').value='unidades';
  if($('quickProductMsg'))$('quickProductMsg').textContent='';
}
function openQuickProduct(line){quickProductTarget=line||null;clearQuickProductForm();openPurchaseModal('quickProduct','qpName');}
function closeQuickProduct(){closeModal('quickProduct');}
async function refreshProductSelectors(newProductId){
  const data=await api('/api/products');products=(data.products||[]).filter(product=>product.active!==false);
  document.querySelectorAll('#orderLines [data-line]').forEach(line=>{const select=line.querySelector('.lProduct');if(!select)return;const selected=line===quickProductTarget&&newProductId?newProductId:select.value;select.innerHTML=productOptions(selected);select.value=selected||'';syncProduct(line);});
}
async function saveQuickProduct(){
  const button=$('saveQuickProduct'),msg=$('quickProductMsg');
  try{
    button.disabled=true;msg.textContent='';
    const body={sku:$('qpSku').value,name:$('qpName').value,brand:$('qpBrand').value,category:$('qpCategory').value,unit:$('qpUnit').value||'unidades',package_format:$('qpFormat').value,default_units_per_pallet:$('qpUnitsPallet').value,country_of_origin:$('qpOrigin').value,hs_code:$('qpHs').value};
    const created=await api('/api/products',{method:'POST',body:JSON.stringify(body)});
    if(!created.product?.id)throw new Error('No se pudo crear el producto');
    await refreshProductSelectors(created.product.id);closeQuickProduct();
  }catch(error){console.error('PURCHASE_PRODUCT_CREATE_FAILED',{error});msg.textContent=safePurchaseMessage(error,'No se pudo crear el producto. Intenta nuevamente.');}finally{button.disabled=false;}
}
async function openNewOrder(){
  const button=$('newOrder'),label=button.textContent;
  try{button.disabled=true;button.textContent='Actualizando…';await load();openOrder();}
  catch(error){console.error('PURCHASES_MASTER_REFRESH_FAILED',{error});$('orderList').innerHTML=`<div class="empty">${esc(safePurchaseMessage(error,'No se pudieron actualizar los proveedores. Intenta nuevamente.'))}</div>`;}
  finally{button.disabled=false;button.textContent=label;}
}
async function refreshPurchases(){const button=$('refresh');try{button.disabled=true;await load();}catch(error){console.error('PURCHASES_REFRESH_FAILED',{error});$('orderList').innerHTML=`<div class="empty">${esc(safePurchaseMessage(error,'No se pudieron actualizar las compras. Intenta nuevamente.'))}</div>`;}finally{button.disabled=false;}}
$('newOrder').onclick=openNewOrder;$('addOrderLine').onclick=()=>addLine();$('saveOrder').onclick=saveOrder;$('saveReceipt').onclick=()=>submitReceipt();$('saveQuickProduct').onclick=saveQuickProduct;$('refresh').onclick=refreshPurchases;$('search').oninput=render;$('oCurrency').oninput=()=>document.querySelectorAll('#orderLines [data-line]').forEach(updateLineSummary);$('oDestinationMode').onchange=event=>setPurchaseDestination(event.target.value);
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;document.querySelectorAll('[data-view]').forEach(tab=>{const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-pressed',String(active));});render();});
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>closeModal(button.dataset.close));document.querySelectorAll('[data-close-quick-product]').forEach(button=>button.onclick=closeQuickProduct);
['order','detail','receive'].forEach(name=>$(name+'Modal').onclick=event=>{if(event.target===$(name+'Modal'))closeModal(name);});$('quickProductModal').onclick=event=>{if(event.target===$('quickProductModal'))closeQuickProduct();};
$('purchaseDecisionCancel').onclick=()=>closePurchaseDecision(false);$('purchaseDecisionAccept').onclick=()=>closePurchaseDecision(true);$('purchaseDecisionModal').onclick=event=>{if(event.target===$('purchaseDecisionModal'))closePurchaseDecision(false);};
document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(!$('purchaseDecisionModal').classList.contains('hidden')){event.stopImmediatePropagation();closePurchaseDecision(false);return;}for(const name of ['quickProduct','receive','order','detail']){if(!$(name+'Modal').classList.contains('hidden')){closeModal(name);return;}}},true);
load().catch(error=>{console.error('PURCHASES_INITIAL_LOAD_FAILED',{error});$('orderList').innerHTML=`<div class="empty">${esc(safePurchaseMessage(error,'No se pudieron cargar las compras. Intenta nuevamente.'))}</div>`;});
