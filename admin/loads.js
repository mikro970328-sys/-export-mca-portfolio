const $=id=>document.getElementById(id);
let token=localStorage.getItem('export_mca_token')||'';
const embeddedMode=new URLSearchParams(location.search).get('embedded')==='1';
let moduleStarted=false;
let decisionResolver=null;
let contextRequest=0;
let pendingLoadId='';
const modalTriggers=new Map();

const state={
  loads:[],
  warehouses:[],
  sources:[],
  clients:[],
  importers:[],
  shipments:[],
  stats:{},
  write_access:false,
  selected:null,
  editing:null
};

const labels=Object.freeze({
  draft:'Borrador',
  reserved:'Reservado',
  loading:'En carga',
  loaded:'Cargado',
  dispatched:'Despachado',
  cancelled:'Cancelado'
});

const NEXT_STAGE=Object.freeze({
  draft:{action:'reserve',label:'Reservar cargue',target:'Reservado',copy:'Compromete en inventario el saldo de los WR seleccionados.'},
  reserved:{action:'start_loading',label:'Iniciar carga',target:'En carga',copy:'Confirma que comenzó la preparación física de la mercancía.'},
  loading:{action:'mark_loaded',label:'Marcar cargado',target:'Cargado',copy:'Confirma que toda la mercancía planificada quedó dentro del contenedor.'},
  loaded:{action:'dispatch',label:'Despachar cargue',target:'Despachado',copy:'Confirma la salida física y descuenta el inventario del almacén.'}
});

const ACTION_REASON_LABELS=Object.freeze({
  PERMISSION_REQUIRED:'Tu cuenta no tiene permiso para ejecutar este paso.',
  LOAD_HAS_NO_ITEMS:'Agrega mercancía al plan antes de reservar.',
  LOAD_ALLOCATIONS_REQUIRED:'Selecciona al menos un WR para cada producto.',
  LOAD_ALLOCATIONS_INCOMPLETE:'Las cantidades del producto y sus WR no coinciden.',
  INSUFFICIENT_WR_AVAILABLE_BALANCE:'La mercancía planificada supera el saldo disponible de uno de los WR. Edita el plan y ajusta la cantidad antes de reservar.',
  LOAD_RESERVATION_LEDGER_NOT_ZERO:'Existe una reserva anterior inconsistente que debe revisarse.',
  LOAD_RESERVATION_LEDGER_MISMATCH:'La reserva no coincide con el movimiento de inventario y debe revisarse.',
  LOAD_HAS_NO_CONTAINER:'Asigna un contenedor antes de despachar.',
  SHIPMENT_NOT_ELIGIBLE_FOR_LOAD:'El contenedor asignado ya no está activo o elegible para este cargue.',
  LOAD_NOT_DRAFT:'Este paso solo corresponde a un cargue en borrador.',
  LOAD_NOT_RESERVED:'Primero debes reservar el cargue.',
  LOAD_NOT_LOADING:'Primero debes iniciar la carga.',
  LOAD_NOT_LOADED:'Primero debes marcar el cargue como cargado.',
  LOAD_CANNOT_BE_CANCELLED:'Este cargue ya no puede cancelarse en su etapa actual.'
});

const SALES_STATUS_LABELS=Object.freeze({
  draft:'Borrador',
  confirmed:'Confirmada',
  allocated:'Asignada',
  in_fulfillment:'En preparación',
  dispatched:'Despachada',
  closed:'Cerrada',
  cancelled:'Cancelada'
});

const SAFE_LOAD_ERROR_PATTERNS=[
  /^(?:No tienes|El cargue|Este cargue|Solo un cargue|Cargue no encontrado|Asigna|Selecciona|Agrega|Falta|Acción|La acción|La referencia|La cantidad|Las cantidades|La fecha|La solicitud|Esa referencia|Uno de los WR|El ledger|El contenedor|La importadora|El cliente|Sesión vencida)/i,
  /^No se pudo procesar Cargues(?:\. Intenta nuevamente\.)?$/i
];

const esc=value=>String(value??'').replace(/[&<>"']/g,character=>({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  '"':'&quot;',
  "'":'&#39;'
}[character]));

function redirectToAdminLogin(){
  localStorage.removeItem('export_mca_token');
  localStorage.removeItem('export_mca_user');
  if(embeddedMode&&window.top!==window){
    window.top.location.replace('/admin/index.html');
    return;
  }
  location.replace('/admin/index.html');
}

async function api(url,opt={}){
  const response=await fetch(url,{
    ...opt,
    headers:{
      Authorization:`Bearer ${token}`,
      'Content-Type':'application/json',
      ...(opt.headers||{})
    }
  });
  const data=await response.json().catch(()=>({}));
  if(response.status===401){
    redirectToAdminLogin();
    const error=new Error('Sesión vencida');
    error.status=401;
    error.endpoint=String(url).split('?')[0];
    throw error;
  }
  if(!response.ok){
    const error=new Error(data.error||'No se pudo procesar Cargues');
    error.status=response.status;
    error.code=data.details?.code||data.code||null;
    error.endpoint=String(url).split('?')[0];
    throw error;
  }
  return data;
}

function safeLoadMessage(error,fallback='No se pudo completar la operación. Intenta nuevamente.',context='operation'){
  const message=String(error?.message||'').trim();
  const status=Number(error?.status||0);
  if(status===401||message==='Sesión vencida')return 'Tu sesión terminó. Inicia sesión nuevamente para continuar.';
  if(status===403)return 'No tienes permiso para completar esta acción.';
  if((status===0||[400,404,409,422].includes(status))&&SAFE_LOAD_ERROR_PATTERNS.some(pattern=>pattern.test(message)))return message;
  console.error('LOADS_UI_FAILED',{context,status:status||null,code:error?.code||null,endpoint:error?.endpoint||null,error});
  return fallback;
}

function reportLoadError(context,error,fallback){
  return safeLoadMessage(error,fallback,context);
}

function setFeedback(id,message='',tone='bad'){
  const element=$(id);
  if(!element)return;
  element.textContent=message;
  element.className=`load-feedback${message?` ${tone}`:''}`;
}

function showPageError(context,error,fallback='No se pudieron cargar los Cargues. Intenta nuevamente.'){
  setFeedback('pageMsg',reportLoadError(context,error,fallback));
}

const fmt=value=>{
  const number=Number(value||0);
  return Number.isFinite(number)?number.toLocaleString('en-US',{maximumFractionDigits:3}):'0';
};

const date=value=>{
  if(!value)return '—';
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?'—':parsed.toLocaleString('es-US',{dateStyle:'short',timeStyle:'short'});
};

const statusLabel=value=>labels[value]||'Estado no disponible';
const statusKey=value=>Object.prototype.hasOwnProperty.call(labels,value)?value:'unknown';
const salesStatusLabel=value=>SALES_STATUS_LABELS[value]||'Estado no disponible';
const unitLabel=value=>{
  const unit=String(value||'unidades').trim();
  return /^\d+([.,]\d+)?$/.test(unit)?'unidades':unit;
};
const capability=(load,key)=>load?.capabilities?.actions?.[key]||null;
const can=(load,key)=>capability(load,key)?.allowed===true;
const canonicalStatus=load=>load?.capabilities?.status||load?.status||'';
const nextStage=load=>NEXT_STAGE[canonicalStatus(load)]||null;

function canAdvance(load,key){
  const allowed={
    reserve:can(load,'reserve'),
    start_loading:can(load,'start_loading'),
    mark_loaded:can(load,'mark_loaded'),
    dispatch:can(load,'dispatch')
  };
  return allowed[key]===true;
}

function actionReason(load,key){
  const reason=capability(load,key)?.reason;
  return ACTION_REASON_LABELS[reason]||'Este paso todavía no está habilitado. Abre el cargue para revisar sus requisitos.';
}

function compactNextStep(load){
  const step=nextStage(load);
  if(!step)return `<div class="load-list-next complete"><span>Flujo</span><strong>${canonicalStatus(load)==='cancelled'?'Cancelado':'Finalizado'}</strong><button class="alt" type="button" data-open-load="${esc(load.id)}">Ver detalle</button></div>`;
  if(canAdvance(load,step.action))return `<div class="load-list-next ready"><span>Siguiente paso</span><strong>${esc(step.target)}</strong><button class="primary" type="button" data-quick-load="${esc(load.id)}" data-quick-action="${esc(step.action)}">${esc(step.label)}</button></div>`;
  return `<div class="load-list-next blocked"><span>Siguiente paso</span><strong>${esc(step.target)} bloqueado</strong><button class="alt" type="button" data-open-load="${esc(load.id)}">Revisar bloqueo</button><small>${esc(actionReason(load,step.action))}</small></div>`;
}

function quantityText(quantity,unit,pallets){
  const parts=[];
  if(Number(quantity)>0)parts.push(`${fmt(quantity)} ${esc(unitLabel(unit))}`);
  if(Number(pallets)>0)parts.push(`${fmt(pallets)} ${Number(pallets)===1?'pallet':'pallets'}`);
  return parts.length?parts.join(' · '):'0';
}

function movementText(quantity,unit,label){
  return Number(quantity)>0
    ?`<span class="active">${esc(label)}: ${fmt(quantity)} ${esc(unitLabel(unit))}</span>`
    :`<span class="muted">${esc(label)}: 0</span>`;
}

function emptyState(title,copy){
  return `<strong>${esc(title)}</strong><span>${esc(copy)}</span>`;
}

function metric(label,value,detail,tone=''){
  return `<article class="metric ${tone}"><span>${esc(label)}</span><b>${esc(value??0)}</b><small>${esc(detail)}</small></article>`;
}

function renderMetrics(){
  const stats=state.stats||{};
  $('metrics').innerHTML=[
    ['Total',stats.total,'Operaciones registradas',''],
    ['Borrador',stats.draft,'Planes en preparación',''],
    ['Reservados',stats.reserved,'Inventario comprometido','active'],
    ['En carga',stats.loading,'Preparación física','active'],
    ['Cargados',stats.loaded,'Listos para salida','ready'],
    ['Despachados',stats.dispatched,'Salida confirmada','ready']
  ].map(values=>metric(...values)).join('');
}

function hasActiveFilters(){
  return Boolean($('search').value.trim()||$('statusFilter').value);
}

function filteredLoads(){
  const query=$('search').value.trim().toLowerCase();
  const status=$('statusFilter').value;
  return state.loads.filter(load=>(!status||load.status===status)&&(!query||[
    load.load_number,
    load.warehouse?.name,
    load.warehouse?.code,
    load.shipment?.container_number,
    load.notes
  ].some(value=>String(value||'').toLowerCase().includes(query))));
}

function warehouseLabel(load){
  return [load.warehouse?.code,load.warehouse?.name].filter(Boolean).join(' · ')||'Sin almacén';
}

function containerLabel(load){
  return load.shipment?.container_number||'Pendiente de asignar';
}

function renderRows(){
  const rows=filteredLoads();
  $('loadCount').textContent=`${rows.length} cargue${rows.length===1?'':'s'}`;
  $('loadListContext').textContent=hasActiveFilters()
    ?'Resultados que coinciden con la consulta actual.'
    :'Abre un cargue para revisar mercancía, WR, acciones habilitadas y contenedor.';
  $('loadRows').innerHTML=rows.map(load=>{
    const key=statusKey(load.status);
    const label=statusLabel(load.status);
    return `<tr data-open-load="${esc(load.id)}" tabindex="0" role="button" aria-label="Abrir ${esc(load.load_number||'cargue')}">
      <td><strong class="loads-load-name">${esc(load.load_number||'Cargue')}</strong><span class="loads-load-meta">${esc(load.notes||'Operación de salida')}</span></td>
      <td><span class="pill ${esc(key)}">${esc(label)}</span></td>
      <td>${esc(warehouseLabel(load))}</td>
      <td>${esc(containerLabel(load))}</td>
      <td>${esc(date(load.scheduled_at))}</td>
      <td>${esc(date(load.updated_at))}</td>
      <td>${compactNextStep(load)}</td>
    </tr>`;
  }).join('');
  $('loadCards').innerHTML=rows.map(load=>{
    const key=statusKey(load.status);
    return `<article class="load-card">
      <span class="load-card-head"><strong>${esc(load.load_number||'Cargue')}</strong><span class="pill ${esc(key)}">${esc(statusLabel(load.status))}</span></span>
      <span class="load-card-grid">
        <span><span>Almacén</span><b>${esc(warehouseLabel(load))}</b></span>
        <span><span>Contenedor</span><b>${esc(containerLabel(load))}</b></span>
        <span><span>Programado</span><b>${esc(date(load.scheduled_at))}</b></span>
        <span><span>Actualizado</span><b>${esc(date(load.updated_at))}</b></span>
      </span>
      ${compactNextStep(load)}
    </article>`;
  }).join('');
  $('empty').classList.toggle('hidden',rows.length>0);
  $('empty').innerHTML=rows.length?'':hasActiveFilters()
    ?emptyState('Sin cargues coincidentes','Prueba otra referencia, contenedor, almacén o estado.')
    :emptyState('Aún no hay cargues','Crea el primer plan cuando exista mercancía disponible en un WR.');
}

function selectLabel(code,name,fallback){
  const parts=[code,name].filter(Boolean);
  return [...new Set(parts)].join(' · ')||fallback;
}

function fillSelects(){
  $('planWarehouse').innerHTML='<option value="">Seleccionar almacén…</option>'+state.warehouses.map(warehouse=>`<option value="${esc(warehouse.id)}">${esc(selectLabel(warehouse.code,warehouse.name,'Almacén'))}</option>`).join('');
  $('containerClient').innerHTML='<option value="">Sin asignar</option>'+state.clients.map(client=>`<option value="${esc(client.id)}">${esc(client.company||client.name||'Cliente')}</option>`).join('');
  $('containerImporter').innerHTML='<option value="">Sin asignar</option>'+state.importers.map(importer=>`<option value="${esc(importer.id)}">${esc(importer.name||'Importadora')}</option>`).join('');
  $('existingContainer').innerHTML='<option value="">Seleccionar contenedor…</option>'+state.shipments.map(shipment=>`<option value="${esc(shipment.id)}">${esc(shipment.container_number||'Sin referencia')} · ${esc(shipment.operational_status||'Activo')}</option>`).join('');
}

async function refresh(){
  setFeedback('pageMsg');
  const data=await api('/api/loads?bootstrap=1');
  Object.assign(state,data);
  $('newLoad').hidden=state.write_access!==true;
  $('loadModuleMode').textContent=state.write_access===true?'Planificación y despacho':'Consulta operativa';
  $('loadLastUpdated').textContent=`Actualizado ${new Date().toLocaleTimeString('es-US',{hour:'2-digit',minute:'2-digit'})}`;
  renderMetrics();
  renderRows();
  fillSelects();
  return true;
}

function flow(status){
  if(status==='cancelled')return '<div class="load-cancelled-state">Este cargue fue cancelado. No mantiene una salida física activa.</div>';
  const stages=['draft','reserved','loading','loaded','dispatched'];
  const current=stages.indexOf(status);
  return `<div class="status-flow" aria-label="Progreso del cargue">${stages.map((stage,index)=>`<span class="status-step ${index<current?'done':index===current?'current':''}">${esc(labels[stage])}</span>`).join('')}</div>`;
}

function wrLink(receiptNumber){
  const receipt=String(receiptNumber||'').trim();
  return receipt?`<button class="context-link" type="button" data-open-wr="${esc(receipt)}">Ver WR en Inventario</button>`:'';
}

function actionButtons(load){
  const actions=[];
  if(can(load,'assign_container')||can(load,'create_container'))actions.push(['container','Asignar contenedor','']);
  if(can(load,'unassign_container'))actions.push(['unassign_container','Quitar contenedor','']);
  if(can(load,'release'))actions.push(['release','Liberar reserva','']);
  if(can(load,'edit'))actions.push(['edit','Editar plan','']);
  if(can(load,'cancel'))actions.push(['cancel','Cancelar','danger']);
  if(can(load,'view_tracking'))actions.push(['tracking','Ver Tracking','']);
  return actions;
}

function nextStageMarkup(load){
  const step=nextStage(load);
  if(!step){
    const copy=canonicalStatus(load)==='cancelled'
      ?'Este cargue fue cancelado y no tiene más pasos operativos.'
      :'El cargue completó su flujo de salida. Puedes consultar su trazabilidad.';
    return `<div class="load-next-step complete"><div><span>Flujo completado</span><strong>${esc(statusLabel(canonicalStatus(load)))}</strong><p>${esc(copy)}</p></div></div>`;
  }
  const allowed=canAdvance(load,step.action);
  const detail=allowed?step.copy:actionReason(load,step.action);
  return `<div class="load-next-step ${allowed?'ready':'blocked'}"><div><span>Siguiente paso</span><strong>${esc(step.target)}</strong><p>${esc(detail)}</p></div><button class="${allowed?(step.action==='dispatch'?'orange':'primary'):'alt'}" type="button" data-action="${esc(step.action)}" ${allowed?'':'disabled'}>${esc(step.label)}</button></div>`;
}

function renderLoadDetail(load){
  const traceability=load.traceability||[];
  const itemHtml=(load.items||[]).map(item=>`<article class="product-group">
    <header class="product-head"><div><strong>${esc(item.product?.name||item.product_id||'Producto')}</strong><span class="quantity-sub">Total del producto en este cargue</span></div><div class="qty">${quantityText(item.planned_quantity,item.unit,item.planned_pallets)}</div></header>
    <div class="product-body">${(item.allocations||[]).map(allocation=>{
      const receipt=allocation.receipt_item?.receipt?.receipt_number||'WR';
      return `<div class="allocation-row"><div><strong>${esc(receipt)}</strong>${allocation.receipt_item?.lot_number?`<span class="quantity-sub">Lote ${esc(allocation.receipt_item.lot_number)}</span>`:''}${wrLink(receipt)}</div><div class="allocation-value"><b>Asignado: ${quantityText(allocation.allocated_quantity,item.unit,allocation.allocated_pallets)}</b><small>Origen de esta mercancía</small></div></div>`;
    }).join('')}</div>
  </article>`).join('');
  const trace=traceability.length?`<div class="trace-table"><div class="trace-head"><span>Origen (WR)</span><span>Producto</span><span>Cantidad asignada</span><span>Movimientos</span></div>${traceability.map(row=>`<div class="trace-row"><span><strong>${esc(row.receipt_number||'Sin WR')}</strong><br>${wrLink(row.receipt_number)}</span><span>${esc(row.product_name||'Producto')}</span><span>${quantityText(row.allocated_quantity,row.product_unit||'unidades',row.allocated_pallets)}</span><span class="movement">${movementText(row.reserved_quantity_net,row.product_unit||'unidades','Reservado')}${movementText(row.dispatched_quantity,row.product_unit||'unidades','Despachado')}</span></div>`).join('')}</div>`:'<div class="loads-context-empty">La trazabilidad se mostrará cuando el cargue tenga mercancía asignada.</div>';
  const actions=actionButtons(load);
  const pending=load.capabilities?.container_pending===true?'<div class="pending-note">Contenedor pendiente de asignar. El despacho se habilitará únicamente cuando el backend confirme un contenedor elegible.</div>':'';
  const notes=String(load.notes||'').trim()||'Sin notas operativas.';
  return `<section class="load-detail-hero"><div><span>Operación</span><strong>${esc(load.load_number||'Cargue')}</strong></div><span class="pill ${esc(statusKey(load.status))}">${esc(statusLabel(load.status))}</span></section>
    <section class="load-detail-section"><header class="load-detail-section-head"><h3>Estado y acciones disponibles</h3><span class="loads-result-count">Control por etapas</span></header><div class="load-detail-section-body">${flow(load.status)}${nextStageMarkup(load)}<div class="actions load-detail-actions">${actions.length?actions.map(action=>`<button class="${esc(action[2]||'alt')}" type="button" data-action="${esc(action[0])}">${esc(action[1])}</button>`).join(''):'<span class="loads-context-empty">No hay acciones adicionales habilitadas.</span>'}</div>${pending}<div id="actionMsg" class="load-action-feedback" role="status" aria-live="polite"></div></div></section>
    <section class="load-detail-section"><header class="load-detail-section-head"><h3>Resumen operativo</h3></header><div class="load-detail-section-body"><div class="load-summary-grid"><div><small>Almacén</small><strong>${esc(warehouseLabel(load))}</strong></div><div><small>Contenedor</small><strong>${esc(containerLabel(load))}</strong></div><div><small>Programado</small><strong>${esc(date(load.scheduled_at))}</strong></div><div><small>Booking</small><strong>${esc(load.shipment?.booking_number||'—')}</strong></div><div><small>B/L</small><strong>${esc(load.shipment?.bol_number||'—')}</strong></div><div><small>Notas</small><strong>${esc(notes)}</strong></div></div></div></section>
    <section class="load-detail-section"><header class="load-detail-section-head"><h3>Mercancía por WR</h3><span class="loads-result-count">${(load.items||[]).length} línea${(load.items||[]).length===1?'':'s'}</span></header><div class="load-detail-section-body">${itemHtml||'<div class="loads-context-empty">Este cargue todavía no tiene mercancía planificada.</div>'}</div></section>
    <section class="load-detail-section"><header class="load-detail-section-head"><h3>Trazabilidad física</h3></header><div class="load-detail-section-body">${trace}</div></section>
    <section class="load-detail-section" id="loadOperationalContextSection"><header class="load-detail-section-head"><h3>Relaciones operativas</h3></header><div class="load-detail-section-body" id="loadOperationalContext"><div class="loads-context-loading">Consultando Venta, WR y Tracking relacionados…</div></div></section>`;
}

function parentNavigation(){
  try{return window.parent!==window?window.parent.OperationalNavigation||null:null;}
  catch{return null;}
}

function parentCan(permission){
  try{return window.parent!==window&&window.parent.ExportMcaAccessControl?.can?.(permission)===true;}
  catch{return false;}
}

function receiptNumbers(load){
  const values=[];
  (load.traceability||[]).forEach(row=>values.push(row.receipt_number));
  (load.items||[]).forEach(item=>(item.allocations||[]).forEach(allocation=>values.push(allocation.receipt_item?.receipt?.receipt_number)));
  return [...new Set(values.filter(Boolean).map(value=>String(value).trim()).filter(Boolean))];
}

function contextCard(title,copy,items=[]){
  return `<article class="loads-context-card"><h4>${esc(title)}</h4><p>${esc(copy)}</p>${items.length?`<div class="loads-context-actions">${items.map(item=>`<button class="loads-context-action" type="button" data-context-kind="${esc(item.kind)}" data-context-id="${esc(item.id)}">${esc(item.label)}</button>`).join('')}</div>`:'<div class="loads-context-empty">Sin relaciones visibles.</div>'}</article>`;
}

async function renderOperationalContext(load){
  const host=$('loadOperationalContext');
  const section=$('loadOperationalContextSection');
  const navigation=parentNavigation();
  const requestId=++contextRequest;
  if(!host||!section)return;
  if(!navigation){
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  host.innerHTML='<div class="loads-context-loading">Consultando Venta, WR y Tracking relacionados…</div>';
  try{
    const sales=parentCan('sales.read')?await navigation.salesOrdersForLoad(load.id):[];
    if(requestId!==contextRequest||$('drawerModal').classList.contains('hidden'))return;
    const saleItems=(sales||[]).map(order=>({kind:'sale',id:order.sales_order_id,label:`${order.so_number||'Venta'} · ${salesStatusLabel(order.so_status||order.status)}`}));
    const sourceItems=parentCan('warehouse.read')?receiptNumbers(load).map(receipt=>({kind:'wr',id:receipt,label:receipt})):[];
    const trackingItems=load.shipment_id&&parentCan('logistics.read')?[{kind:'tracking',id:load.shipment_id,label:`Contenedor ${load.shipment?.container_number||'asignado'}`}]:[];
    host.innerHTML=`<div class="loads-context-grid">${parentCan('sales.read')?contextCard('Venta relacionada','Origen comercial del cargue.',saleItems):''}${contextCard('WR de origen',parentCan('warehouse.read')?'Recepciones que aportan la mercancía.':'Tu rol no incluye la consulta de WR.',sourceItems)}${contextCard('Contenedor y Tracking','Continuidad de la salida después del cargue.',trackingItems)}</div>`;
  }catch(error){
    if(requestId!==contextRequest)return;
    const message=safeLoadMessage(error,'No se pudieron consultar las relaciones operativas de este cargue.','operational_context');
    host.innerHTML=contextCard('Relaciones no disponibles',message,[]);
  }
}

function showModal(id,trigger=document.activeElement){
  const modal=$(id);
  if(!modal)return;
  modalTriggers.set(id,trigger);
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
}

function hideModal(id,{restoreFocus=true}={}){
  const modal=$(id);
  if(!modal)return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden','true');
  if(id==='drawerModal')contextRequest+=1;
  const trigger=modalTriggers.get(id);
  modalTriggers.delete(id);
  if(restoreFocus&&trigger?.focus)trigger.focus();
}

function updateStatsFromLoads(){
  state.stats={
    ...state.stats,
    total:state.loads.length,
    draft:state.loads.filter(load=>load.status==='draft').length,
    reserved:state.loads.filter(load=>load.status==='reserved').length,
    loading:state.loads.filter(load=>load.status==='loading').length,
    loaded:state.loads.filter(load=>load.status==='loaded').length,
    dispatched:state.loads.filter(load=>load.status==='dispatched').length,
    cancelled:state.loads.filter(load=>load.status==='cancelled').length
  };
}

function reconcileLoad(load){
  if(!load?.id)return;
  const index=state.loads.findIndex(current=>String(current.id)===String(load.id));
  if(index>=0)state.loads[index]={...state.loads[index],...load};
  else state.loads.unshift(load);
  updateStatsFromLoads();
  renderMetrics();
  renderRows();
}

function presentLoad(load){
  state.selected=load;
  $('drawerTitle').textContent=load.load_number||'Cargue';
  $('drawerSub').textContent=`${statusLabel(load.status)} · ${load.warehouse?.name||'Sin almacén'}`;
  $('drawerBody').innerHTML=renderLoadDetail(load);
  if($('drawerModal').classList.contains('hidden'))showModal('drawerModal');
  renderOperationalContext(load);
}

async function openLoad(id){
  const loadId=String(id||'').trim();
  if(!loadId)return false;
  if(!token){pendingLoadId=loadId;return false;}
  pendingLoadId='';
  const data=await api('/api/loads?id='+encodeURIComponent(loadId));
  presentLoad(data.load);
  return true;
}

function showActionMessage(message='',tone='bad'){
  const element=$('actionMsg');
  if(!element)return;
  element.textContent=message;
  element.className=`load-action-feedback${message?` ${tone}`:''}`;
}

function requestDecision(action){
  const copy=action==='dispatch'
    ?{title:'Confirmar despacho',text:'Esta acción confirma la salida física del almacén y afecta el libro de inventario.',button:'Despachar'}
    :{title:'Cancelar cargue',text:'Esta acción cancela el cargue. Si existe una reserva activa, el backend la liberará de forma transaccional.',button:'Cancelar cargue'};
  $('decisionTitle').textContent=copy.title;
  $('decisionText').textContent=copy.text;
  $('decisionAccept').textContent=copy.button;
  showModal('decisionModal');
  $('decisionAccept').focus();
  return new Promise(resolve=>{decisionResolver=resolve;});
}

function closeDecision(accepted){
  hideModal('decisionModal');
  const resolve=decisionResolver;
  decisionResolver=null;
  if(resolve)resolve(accepted===true);
}

async function handleAction(action,load=state.selected,reopen=true){
  if(!load)return;
  if(action==='tracking'){
    if(!can(load,'view_tracking'))return;
    try{parentNavigation()?.openTracking?.({shipmentId:load.shipment_id,containerNumber:load.shipment?.container_number});}
    catch{}
    return;
  }
  if(action==='container'){
    if(!(can(load,'assign_container')||can(load,'create_container')))return;
    openContainer(load);
    return;
  }
  if(action==='edit'){
    if(!can(load,'edit'))return;
    openPlan(load);
    return;
  }
  if(!can(load,action))return;
  if(['dispatch','cancel'].includes(action)){
    const accepted=await requestDecision(action);
    if(!accepted)return;
  }
  try{
    bsy(true);
    if(reopen)showActionMessage();
    else setFeedback('pageMsg');
    const result=await api('/api/loads',{method:'POST',body:JSON.stringify({action,load_id:load.id})});
    reconcileLoad(result.load);
    try{await refresh();}
    catch(refreshError){console.error('LOADS_REFRESH_AFTER_MUTATION_FAILED',{action,load_id:load.id,error:refreshError});}
    const updated=result.load||load;
    const success=`${updated.load_number||'El cargue'} ahora está ${statusLabel(updated.status)}.`;
    if(reopen){presentLoad(updated);showActionMessage(success,'ok');}
    else setFeedback('pageMsg',success,'ok');
  }catch(error){
    const message=reportLoadError(`action:${action}`,error);
    if(reopen)showActionMessage(message);
    else setFeedback('pageMsg',message);
  }finally{
    bsy(false);
  }
}

function bsy(on){
  document.querySelectorAll('button').forEach(button=>{
    if(on){
      if(!Object.prototype.hasOwnProperty.call(button.dataset,'loadBusyDisabled'))button.dataset.loadBusyDisabled=button.disabled?'1':'0';
      button.disabled=true;
      return;
    }
    if(!Object.prototype.hasOwnProperty.call(button.dataset,'loadBusyDisabled'))return;
    button.disabled=button.dataset.loadBusyDisabled==='1';
    delete button.dataset.loadBusyDisabled;
  });
}

function openPlan(load=null){
  if(load&&!can(load,'edit'))return;
  if(!load&&state.write_access!==true)return;
  state.editing=load;
  $('planTitle').textContent=load?`Editar ${load.load_number}`:'Nuevo cargue';
  $('planWarehouse').disabled=Boolean(load);
  $('planWarehouse').value=load?.warehouse_id||'';
  $('planScheduled').value=load?.scheduled_at?new Date(new Date(load.scheduled_at).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):'';
  $('planNotes').value=load?.notes||'';
  setFeedback('planMsg');
  renderSources(load);
  showModal('planModal');
}

function renderSources(load){
  const warehouseId=$('planWarehouse').value;
  const sources=state.sources.filter(source=>!warehouseId||source.warehouse_id===warehouseId);
  const existing=new Map();
  (load?.items||[]).forEach(item=>(item.allocations||[]).forEach(allocation=>existing.set(allocation.receipt_item_id,{q:allocation.allocated_quantity,p:allocation.allocated_pallets})));
  const groups={};
  sources.forEach(source=>(groups[source.product_id]??=[]).push(source));
  $('sourceGroups').innerHTML=Object.values(groups).map(group=>`<article class="product-group">
    <header class="product-head"><strong>${esc(group[0].product_name||'Producto')}</strong><span class="muted">${esc(unitLabel(group[0].product_unit||group[0].receipt_unit||'unidades'))}</span></header>
    <div class="product-body">${group.map(source=>{
      const current=existing.get(source.receipt_item_id)||{};
      return `<div class="source" data-source="${esc(source.receipt_item_id)}" data-product="${esc(source.product_id)}" data-unit="${esc(unitLabel(source.product_unit||source.receipt_unit||'unidades'))}" data-receipt="${esc(source.receipt_number||'WR')}"><div class="source-top"><span><strong>${esc(source.receipt_number||'WR')}</strong>${source.lot_number?` · Lote ${esc(source.lot_number)}`:''}</span><small>Disponible: ${quantityText(source.available_quantity,source.product_unit||source.receipt_unit,source.available_pallets)}</small></div><div class="alloc-grid"><input type="number" step="0.001" min="0" max="${esc(source.available_quantity)}" data-q value="${esc(current.q||'')}" aria-label="Cantidad de ${esc(source.receipt_number||'WR')}" placeholder="Cantidad"><input type="number" step="0.001" min="0" max="${esc(source.available_pallets)}" data-p value="${esc(current.p||'')}" aria-label="Pallets de ${esc(source.receipt_number||'WR')}" placeholder="Pallets"></div></div>`;
    }).join('')}</div>
  </article>`).join('')||`<div class="loads-empty">${emptyState('Sin mercancía disponible','Selecciona un almacén que tenga inventario disponible por WR.')}</div>`;
}

function planPayload(){
  const byProduct={};
  document.querySelectorAll('#sourceGroups [data-source]').forEach(row=>{
    const quantityInput=row.querySelector('[data-q]');
    const palletInput=row.querySelector('[data-p]');
    const quantity=Number(quantityInput.value||0);
    const pallets=Number(palletInput.value||0);
    const maxQuantity=Number(quantityInput.max||0);
    const maxPallets=Number(palletInput.max||0);
    const receipt=row.dataset.receipt||'WR';
    if(!Number.isFinite(quantity)||!Number.isFinite(pallets)||quantity<0||pallets<0)throw new Error(`La cantidad indicada para ${receipt} no es válida.`);
    if(quantity>maxQuantity+1e-9)throw new Error(`La cantidad indicada para ${receipt} supera el saldo disponible de ${fmt(maxQuantity)}.`);
    if(pallets>maxPallets+1e-9)throw new Error(`La cantidad de pallets indicada para ${receipt} supera el saldo disponible de ${fmt(maxPallets)}.`);
    if(quantity<=0&&pallets<=0)return;
    const productId=row.dataset.product;
    byProduct[productId]??={product_id:productId,unit:row.dataset.unit,planned_quantity:0,planned_pallets:0,allocations:[]};
    byProduct[productId].planned_quantity+=quantity;
    byProduct[productId].planned_pallets+=pallets;
    byProduct[productId].allocations.push({receipt_item_id:row.dataset.source,allocated_quantity:quantity,allocated_pallets:pallets});
  });
  return Object.values(byProduct);
}

async function savePlan(){
  if(state.editing&&!can(state.editing,'edit'))return setFeedback('planMsg','El cargue ya no admite edición.');
  if(!state.editing&&state.write_access!==true)return setFeedback('planMsg','No tienes permiso para crear cargues.');
  try{
    bsy(true);
    setFeedback('planMsg');
    if(!$('planWarehouse').value)throw new Error('Selecciona un almacén.');
    const lines=planPayload();
    if(!lines.length)throw new Error('Selecciona al menos una cantidad de un WR.');
    const scheduled=$('planScheduled').value?new Date($('planScheduled').value):null;
    if(scheduled&&Number.isNaN(scheduled.getTime()))throw new Error('La fecha programada no es válida.');
    const body={
      action:state.editing?'replace_plan':'create_plan',
      load_id:state.editing?.id,
      warehouse_id:$('planWarehouse').value,
      scheduled_at:scheduled?.toISOString()||null,
      notes:$('planNotes').value,
      lines
    };
    const data=await api('/api/loads',{method:'POST',body:JSON.stringify(body)});
    hideModal('planModal',{restoreFocus:false});
    reconcileLoad(data.load);
    try{await refresh();}
    catch(refreshError){console.error('LOADS_REFRESH_AFTER_MUTATION_FAILED',{action:body.action,load_id:data.load?.id||null,error:refreshError});}
    presentLoad(data.load);
    showActionMessage(`${data.load.load_number||'El cargue'} se guardó y ya está actualizado en el ERP.`,'ok');
  }catch(error){
    setFeedback('planMsg',reportLoadError('save_plan',error));
  }finally{
    bsy(false);
  }
}

function openContainer(load){
  if(!(can(load,'assign_container')||can(load,'create_container')))return;
  $('containerLoadLabel').textContent=load.load_number||'Cargue';
  $('containerNumber').value='';
  $('containerCarrier').value='';
  $('containerBooking').value='';
  $('containerBol').value='';
  $('containerClient').value='';
  $('containerImporter').value='';
  $('existingContainer').value='';
  setFeedback('containerMsg');
  $('createContainer').hidden=!can(load,'create_container');
  $('assignExisting').hidden=!can(load,'assign_container');
  showModal('containerModal');
}

async function createContainer(){
  if(!can(state.selected,'create_container'))return;
  try{
    bsy(true);
    setFeedback('containerMsg');
    const data=await api('/api/loads',{method:'POST',body:JSON.stringify({
      action:'create_container',
      load_id:state.selected.id,
      container_number:$('containerNumber').value,
      carrier:$('containerCarrier').value,
      booking_number:$('containerBooking').value,
      bol_number:$('containerBol').value,
      client_id:$('containerClient').value||null,
      importer_id:$('containerImporter').value||null
    })});
    hideModal('containerModal',{restoreFocus:false});
    reconcileLoad(data.load);
    try{await refresh();}
    catch(refreshError){console.error('LOADS_REFRESH_AFTER_MUTATION_FAILED',{action:'create_container',load_id:data.load?.id||null,error:refreshError});}
    presentLoad(data.load);
    showActionMessage('Contenedor creado y vinculado. El cargue ya refleja el cambio.','ok');
  }catch(error){
    setFeedback('containerMsg',reportLoadError('create_container',error));
  }finally{
    bsy(false);
  }
}

async function assignExisting(){
  if(!can(state.selected,'assign_container'))return;
  if(!$('existingContainer').value)return setFeedback('containerMsg','Selecciona un contenedor.');
  try{
    bsy(true);
    setFeedback('containerMsg');
    const data=await api('/api/loads',{method:'POST',body:JSON.stringify({action:'assign_existing_container',load_id:state.selected.id,shipment_id:$('existingContainer').value})});
    hideModal('containerModal',{restoreFocus:false});
    reconcileLoad(data.load);
    try{await refresh();}
    catch(refreshError){console.error('LOADS_REFRESH_AFTER_MUTATION_FAILED',{action:'assign_existing_container',load_id:data.load?.id||null,error:refreshError});}
    presentLoad(data.load);
    showActionMessage('Contenedor vinculado. El cargue ya refleja el cambio.','ok');
  }catch(error){
    setFeedback('containerMsg',reportLoadError('assign_container',error));
  }finally{
    bsy(false);
  }
}

function openLoadFromTarget(target){
  const id=target?.closest?.('[data-open-load]')?.dataset.openLoad;
  if(!id)return;
  openLoad(id).catch(error=>showPageError('detail',error,'No se pudo abrir el Cargue. Intenta nuevamente.'));
}

function handleLoadListClick(event){
  const quick=event.target.closest('[data-quick-action]');
  if(quick){
    event.stopPropagation();
    const load=state.loads.find(item=>String(item.id)===String(quick.dataset.quickLoad));
    if(load)handleAction(quick.dataset.quickAction,load,false);
    return;
  }
  openLoadFromTarget(event.target);
}

function handleDrawerClick(event){
  const action=event.target.closest('[data-action]');
  if(action){handleAction(action.dataset.action);return;}
  const receipt=event.target.closest('[data-open-wr]');
  if(receipt){
    event.stopPropagation();
    try{parentNavigation()?.openInventoryReceipt?.(receipt.dataset.openWr);}
    catch{}
    return;
  }
  const context=event.target.closest('[data-context-kind]');
  if(!context)return;
  const navigation=parentNavigation();
  if(!navigation)return;
  try{
    if(context.dataset.contextKind==='sale')navigation.openSales?.({salesOrderId:context.dataset.contextId});
    if(context.dataset.contextKind==='wr')navigation.openInventoryReceipt?.(context.dataset.contextId);
    if(context.dataset.contextKind==='tracking')navigation.openTracking?.({shipmentId:context.dataset.contextId});
  }catch(error){
    showActionMessage(safeLoadMessage(error,'No se pudo abrir el registro relacionado.','context_navigation'));
  }
}

function bindEvents(){
  $('newLoad').addEventListener('click',()=>openPlan());
  $('refresh').addEventListener('click',()=>refresh().catch(error=>showPageError('refresh',error)));
  $('clearFilters').addEventListener('click',()=>{
    $('search').value='';
    $('statusFilter').value='';
    renderRows();
    $('search').focus();
  });
  $('search').addEventListener('input',renderRows);
  $('statusFilter').addEventListener('change',renderRows);
  $('loadRows').addEventListener('click',handleLoadListClick);
  $('loadRows').addEventListener('keydown',event=>{
    if(event.target.closest?.('button'))return;
    if(!['Enter',' '].includes(event.key))return;
    event.preventDefault();
    openLoadFromTarget(event.target);
  });
  $('loadCards').addEventListener('click',handleLoadListClick);
  $('planWarehouse').addEventListener('change',()=>renderSources(state.editing));
  $('savePlan').addEventListener('click',savePlan);
  $('createContainer').addEventListener('click',createContainer);
  $('assignExisting').addEventListener('click',assignExisting);
  $('decisionAccept').addEventListener('click',()=>closeDecision(true));
  $('decisionReject').addEventListener('click',()=>closeDecision(false));
  $('drawerBody').addEventListener('click',handleDrawerClick);
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>hideModal(button.closest('.modal').id)));
  document.querySelectorAll('.modal').forEach(modal=>modal.addEventListener('click',event=>{
    if(event.target!==modal)return;
    if(modal.id==='decisionModal')closeDecision(false);
    else hideModal(modal.id);
  }));
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if(!$('decisionModal').classList.contains('hidden'))return closeDecision(false);
    const open=['containerModal','planModal','drawerModal'].find(id=>!$(id).classList.contains('hidden'));
    if(open)hideModal(open);
  });
}

function showLoadFailure(error){
  const message=safeLoadMessage(error,'No se pudieron cargar los Cargues. Intenta nuevamente.','load');
  setFeedback('pageMsg',message);
  $('loadCount').textContent='No disponible';
  $('loadRows').innerHTML='';
  $('loadCards').innerHTML='';
  $('empty').classList.remove('hidden');
  $('empty').innerHTML=`${emptyState('Cargues no disponible',message)}<button class="alt" id="loadsRetry" type="button">Reintentar</button>`;
  $('loadsRetry').addEventListener('click',()=>refresh().catch(showLoadFailure));
}

function startLoads(sessionToken=token){
  if(moduleStarted)return true;
  token=String(sessionToken||'');
  if(!token)return false;
  moduleStarted=true;
  bindEvents();
  const requestedLoad=pendingLoadId;
  refresh().then(()=>requestedLoad?openLoad(requestedLoad):true).catch(showLoadFailure);
  return true;
}

function handleStoredSession(event){
  if(event.key!=='export_mca_token'||!event.newValue)return;
  window.removeEventListener('storage',handleStoredSession);
  startLoads(event.newValue);
}

window.load=refresh;
window.openLoad=openLoad;
window.openOperationalLoad=openLoad;
window.LoadsModule=Object.freeze({
  owner:'loads.js',
  embedded:embeddedMode,
  safeLoadMessage,
  refresh,
  openLoad
});

if(!startLoads()){
  if(embeddedMode)window.addEventListener('storage',handleStoredSession);
  else redirectToAdminLogin();
}
