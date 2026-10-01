(() => {
  if(window.__salesSupplyWorkspaceInstalled)return;
  window.__salesSupplyWorkspaceInstalled=true;

  const byId=id=>document.getElementById(id);
  const token=()=>localStorage.getItem('export_mca_token')||'';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>value===null||value===undefined||value===''?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(Number(value));
  const dateTime=value=>value?new Date(value).toLocaleString('es-US'):'—';
  const localDateTime=()=>{const now=new Date(),offset=now.getTimezoneOffset()*60000;return new Date(now.getTime()-offset).toISOString().slice(0,16);};
  function localDispatchInstant(value){
    const raw=String(value??'').trim(),date=new Date(raw);
    if(!raw||Number.isNaN(date.getTime())){
      const error=new Error('Indica una fecha y hora válida de despacho.');
      error.code='DIRECT_DISPATCH_LOCAL_TIME_INVALID';
      throw error;
    }
    return date.toISOString();
  }
  const state={salesOrderId:null,data:null,busy:false};
  const nativeWorkspace=window.SalesWorkspace||null;
  const publicErrorEndpoints=new Set(['/api/sales-supply','/api/direct-shipment-dispatch','/api/sales-direct-operation']);

  async function request(path,options={}){
    const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(token()?{Authorization:`Bearer ${token()}`}:{}) ,...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(response.status===401){localStorage.removeItem('export_mca_token');location.href='/admin/';throw new Error('Sesión vencida');}
    if(!response.ok){const error=new Error(data.error||'No se pudo procesar la operación.');error.status=response.status;error.code=data.details?.code||data.code||data.reason_code||null;error.endpoint=String(path).split('?')[0];throw error;}
    return data;
  }

  function safeSupplyMessage(error,fallback='No se pudo completar la operación. Intenta nuevamente.'){
    const message=String(error?.message||'').trim();
    const status=Number(error?.status||0);
    if(error?.code==='DIRECT_DISPATCH_LOCAL_TIME_INVALID')return 'Indica una fecha y hora válida de despacho.';
    if(error?.code==='DIRECT_OPERATION_LOCAL_INPUT')return message;
    if(message==='Sesión vencida'||status===401)return 'Tu sesión terminó. Inicia sesión nuevamente para continuar.';
    if(status===403)return 'No tienes permiso para completar esta acción.';
    if(publicErrorEndpoints.has(error?.endpoint)&&[400,404,409,422].includes(status)&&message)return message;
    console.error('SALES_SUPPLY_WORKSPACE_FAILED',{status:status||null,code:error?.code||null,endpoint:error?.endpoint||null,error});
    return fallback;
  }

  function nav(){try{return window.parent!==window?window.parent.OperationalNavigation:null;}catch{return null;}}
  function methodLabel(method){return ({inventory:'Stock existente',purchase_warehouse:'Compra para almacén',purchase_direct:'Direct Ship'})[method]||method||'—';}
  function methodClass(method){return method==='purchase_direct'?'direct':method==='purchase_warehouse'?'purchase':'';}
  function orderStatus(value){return ({draft:'Borrador',issued:'Emitida',confirmed:'Confirmada',closed:'Cerrada',cancelled:'Cancelada'})[value]||value||'—';}
  function warehouseName(id){const row=(state.data?.warehouses||[]).find(item=>item.id===id);return row?`${row.code?row.code+' · ':''}${row.name}`:'—';}
  function productTitle(item){return `${item.product?.sku?item.product.sku+' · ':''}${item.product?.name||'Producto'}`;}
  const purchaseRemaining=row=>Number(row?.remaining_quantity??row?.ordered_quantity??0);
  const purchaseAvailable=row=>purchaseRemaining(row)>0;
  const purchaseAssignmentText=row=>(row?.assignments||[]).map(assignment=>`${assignment.so_number||'Venta'} · ${assignment.client_name||'Cliente'}`).join(', ');
  const purchaseOptionText=row=>`${row.purchase_order?.po_number||'PO'} · ${row.purchase_order?.supplier?.name||row.purchase_order?.supplier?.legal_name||'Proveedor'} · Saldo ${fmt(purchaseRemaining(row))} ${row.unit||''}${purchaseAssignmentText(row)?` · Parte asignada a ${purchaseAssignmentText(row)}`:''}`;
  function purchaseUsageNotice(rows){
    const used=(rows||[]).filter(row=>(row.assignments||[]).length);
    if(!used.length)return '';
    return `<div class="full sales-supply-helper"><b>Compras ya utilizadas:</b><br>${used.map(row=>`${esc(row.purchase_order?.po_number||'PO')} · ${purchaseAvailable(row)?`Saldo ${fmt(purchaseRemaining(row))} ${esc(row.unit||'')}`:'Sin saldo'} · Asignada a ${esc(purchaseAssignmentText(row))}`).join('<br>')}</div>`;
  }
  function showMessage(value,ok=false){const node=byId('salesSupplyMsg');if(!node)return;node.textContent=value||'';node.className='msg '+(ok?'ok':'bad');}
  function setBusy(value){state.busy=Boolean(value);document.querySelectorAll('[data-supply-busy]').forEach(button=>button.disabled=state.busy);}

  function ensureModals(){
    if(!byId('salesSupplyModal')){
      const modal=document.createElement('div');
      modal.id='salesSupplyModal';modal.className='modal hidden sales-supply-modal';
      modal.innerHTML=`<div class="dialog"><div class="dialog-head"><div><h2 id="salesSupplyTitle">Abastecimiento</h2><div id="salesSupplySubtitle" class="muted"></div></div><button type="button" class="btn" data-supply-close="main">Cerrar</button></div><div id="salesSupplyBody" class="sales-supply-body"></div><div id="salesSupplyMsg" class="msg sales-supply-main-message"></div></div>`;
      document.body.appendChild(modal);
      modal.querySelector('[data-supply-close="main"]').onclick=()=>modal.classList.add('hidden');
      modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.add('hidden');});
    }
    if(!byId('salesSupplyFormModal')){
      const modal=document.createElement('div');
      modal.id='salesSupplyFormModal';modal.className='modal hidden sales-supply-modal';
      modal.innerHTML=`<div class="dialog sales-supply-form-dialog"><div class="dialog-head"><div><h2 id="salesSupplyFormTitle"></h2><div id="salesSupplyFormSubtitle" class="muted"></div></div><button type="button" class="btn" data-supply-form-close>Cerrar</button></div><div class="sales-supply-body"><div id="salesSupplyFormBody"></div><div class="sales-supply-form-actions"><button type="button" class="btn" data-supply-form-close>Cancelar</button><button type="button" id="salesSupplyFormSave" class="btn orange" data-supply-busy>Guardar</button></div><div id="salesSupplyFormMsg" class="msg"></div></div></div>`;
      document.body.appendChild(modal);
      modal.querySelectorAll('[data-supply-form-close]').forEach(button=>button.onclick=()=>modal.classList.add('hidden'));
      modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.add('hidden');});
    }
    if(!byId('salesSupplyDecisionModal')){
      const modal=document.createElement('div');
      modal.id='salesSupplyDecisionModal';modal.className='modal hidden sales-supply-modal';
      modal.innerHTML=`<div class="dialog sales-supply-decision-dialog"><div class="dialog-head"><div><h2 id="salesSupplyDecisionTitle">Confirmar acción</h2></div><button type="button" class="btn" data-supply-decision-close>Cerrar</button></div><div class="sales-supply-body"><div id="salesSupplyDecisionCopy" class="sales-supply-confirm-copy"></div><div class="sales-supply-form-actions"><button type="button" class="btn" data-supply-decision-close>Cancelar</button><button type="button" id="salesSupplyDecisionAccept" class="btn orange" data-supply-busy>Continuar</button></div><div id="salesSupplyDecisionMsg" class="msg"></div></div></div>`;
      document.body.appendChild(modal);
      modal.querySelectorAll('[data-supply-decision-close]').forEach(button=>button.onclick=()=>modal.classList.add('hidden'));
      modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.add('hidden');});
    }
  }

  function openForm({title,subtitle='',html,onOpen,onSave,saveLabel='Guardar',canSave=true}){
    ensureModals();
    byId('salesSupplyFormTitle').textContent=title;
    byId('salesSupplyFormSubtitle').textContent=subtitle;
    byId('salesSupplyFormBody').innerHTML=html;
    byId('salesSupplyFormMsg').textContent='';
    const saveButton=byId('salesSupplyFormSave');saveButton.textContent=saveLabel;saveButton.classList.toggle('hidden',!canSave);saveButton.disabled=!canSave;
    saveButton.onclick=canSave?async()=>{
      if(state.busy)return;setBusy(true);byId('salesSupplyFormMsg').textContent='';
      try{await onSave();byId('salesSupplyFormModal').classList.add('hidden');await refreshAll();}
      catch(error){byId('salesSupplyFormMsg').textContent=safeSupplyMessage(error,'No se pudieron guardar los cambios. Intenta nuevamente.');}
      finally{setBusy(false);}
    }:null;
    byId('salesSupplyFormModal').classList.remove('hidden');
    onOpen?.();
  }

  function askAction({title,message,acceptLabel='Continuar',onAccept}){
    ensureModals();
    byId('salesSupplyDecisionTitle').textContent=title;
    byId('salesSupplyDecisionCopy').textContent=message;
    byId('salesSupplyDecisionMsg').textContent='';
    byId('salesSupplyDecisionAccept').textContent=acceptLabel;
    byId('salesSupplyDecisionAccept').onclick=async()=>{
      if(state.busy)return;setBusy(true);byId('salesSupplyDecisionMsg').textContent='';
      try{await onAccept();byId('salesSupplyDecisionModal').classList.add('hidden');await refreshAll();}
      catch(error){byId('salesSupplyDecisionMsg').textContent=safeSupplyMessage(error,'No se pudo completar la acción. Intenta nuevamente.');}
      finally{setBusy(false);}
    };
    byId('salesSupplyDecisionModal').classList.remove('hidden');
  }

  function overlayDirectEffectiveRows(data,rows){
    const byDirect=new Map((rows||[]).map(row=>[String(row.direct_shipment_allocation_id),row]));
    for(const item of data?.items||[])for(const plan of item.supply_plans||[])for(const allocation of plan.procurement_allocations||[])for(const direct of allocation.direct_shipments||[]){
      const effective=byDirect.get(String(direct.id));
      if(!effective)continue;
      Object.assign(direct,{
        allocated_sales_quantity:effective.allocated_sales_quantity,
        allocated_sales_pallets:effective.allocated_sales_pallets,
        allocated_purchase_quantity:effective.allocated_purchase_quantity,
        allocated_purchase_pallets:effective.allocated_purchase_pallets,
        planned_sales_quantity:effective.planned_sales_quantity,
        planned_sales_pallets:effective.planned_sales_pallets,
        planned_purchase_quantity:effective.planned_purchase_quantity,
        planned_purchase_pallets:effective.planned_purchase_pallets,
        has_quantity_correction:effective.has_quantity_correction,
        latest_correction_reason:effective.latest_correction_reason,
        latest_correction_at:effective.latest_correction_at
      });
    }
    return data;
  }

  async function fetchSupply(){
    if(!state.salesOrderId)return null;
    const salesOrderId=state.salesOrderId;
    const [data,direct]=await Promise.all([
      request(`/api/sales-supply?sales_order_id=${encodeURIComponent(salesOrderId)}`),
      request(`/api/direct-shipment-dispatch?sales_order_id=${encodeURIComponent(salesOrderId)}`)
    ]);
    if(state.salesOrderId!==salesOrderId)return null;
    state.data=overlayDirectEffectiveRows(data,direct.rows||[]);
    return state.data;
  }

  async function refreshAll(){
    await fetchSupply();
    if(nativeWorkspace?.reload)await nativeWorkspace.reload({keepTab:true});
    render();
    await augmentNativeTab(selectedNativeTab(),{refresh:false});
  }

  async function open(salesOrderId=state.salesOrderId){
    if(!salesOrderId)throw new Error('No hay una venta seleccionada.');
    state.salesOrderId=String(salesOrderId);ensureModals();
    byId('salesSupplyTitle').textContent='Compra y contenedor';
    byId('salesSupplySubtitle').textContent='Cargando opciones…';
    byId('salesSupplyBody').innerHTML='<div class="sales-ws-loading">Cargando opciones…</div>';
    byId('salesSupplyMsg').textContent='';
    byId('salesSupplyModal').classList.remove('hidden');
    try{await fetchSupply();render();}catch(error){byId('salesSupplyBody').innerHTML=`<div class="sales-ws-callout">${esc(safeSupplyMessage(error,'No se pudo cargar el abastecimiento. Intenta nuevamente.'))}</div>`;}
  }

  function render(){
    if(!state.data)return;
    const order=state.data.order,items=state.data.items||[];
    byId('salesSupplyTitle').textContent=`${order.so_number} · Compra y contenedor`;
    byId('salesSupplySubtitle').textContent='Compra, contenedor y despacho de este pedido. Cantidades y pallets vienen de la venta.';
    const step=directOperationStep();
    byId('salesSupplyBody').innerHTML=`<div class="sales-supply-intro"><div><strong>${esc(step.title)}</strong><div>${esc(step.text)}</div>${step.action?`<div class="sales-supply-actions"><button type="button" class="btn orange" data-supply-action="direct-operation">${esc(step.action)}</button></div>`:''}</div><span class="sales-supply-status ${order.status==='confirmed'?'ok':'warn'}">${esc(orderStatus(order.status))}</span></div><div class="sales-supply-items">${items.map(renderItem).join('')}</div>`;
    bindMainActions();
  }

  function renderItem(item){
    const p=item.supply_progress||{},plans=item.supply_plans||[];
    const metrics=[['Vendido',p.ordered_quantity,item.unit],['Stock',p.planned_inventory_quantity,item.unit],['Compra almacén',p.planned_purchase_warehouse_quantity,item.unit],['Direct Ship',p.planned_purchase_direct_quantity,item.unit],['Sin planificar',p.unplanned_quantity,item.unit]];
    const hasUnplanned=Number(p.unplanned_quantity||0)>0;
    const emptyMessage=hasUnplanned?'Elige Direct Ship, stock existente o compra para almacén.':'Toda la mercancía ya tiene una ruta asignada.';
    return `<section class="sales-supply-item"><div class="sales-supply-item-head"><div><div class="sales-supply-item-title">${esc(productTitle(item))}</div><div class="sales-supply-item-sub">${fmt(item.ordered_quantity)} ${esc(item.unit)}${Number(item.ordered_pallets||0)>0?` · ${fmt(item.ordered_pallets)} pallets`:''}</div></div>${hasUnplanned?`<details><summary>Usar mercancía de almacén</summary><button type="button" class="btn" data-supply-action="new-plan" data-item-id="${esc(item.id)}">Elegir stock o compra para almacén</button></details>`:''}</div><div class="sales-supply-plan-list">${plans.length?plans.map(plan=>renderPlan(item,plan)).join(''):`<div class="sales-supply-empty">${emptyMessage}</div>`}</div></section>`;
  }

  function renderPlan(item,plan){
    const allocations=plan.procurement_allocations||[],needsPurchase=plan.supply_method!=='inventory';
    const allocated=allocations.filter(row=>row.purchase_order?.status!=='cancelled').reduce((sum,row)=>sum+Number(row.allocated_sales_quantity||0),0),purchaseComplete=needsPurchase&&allocated>=Number(plan.planned_quantity||0);
    return `<div class="sales-supply-plan"><div class="sales-supply-plan-head"><div><span class="sales-supply-route ${methodClass(plan.supply_method)}">${esc(methodLabel(plan.supply_method))}</span><div class="sales-supply-detail">Plan: ${fmt(plan.planned_quantity)} ${esc(item.unit)}${Number(plan.planned_pallets||0)>0?` · ${fmt(plan.planned_pallets)} pallets`:''}${plan.warehouse_id?` · ${esc(warehouseName(plan.warehouse_id))}`:''}</div>${plan.notes?`<div class="sales-supply-detail">${esc(plan.notes)}</div>`:''}</div><div class="sales-supply-actions"><details><summary>Ruta y ajustes</summary><button type="button" class="btn" data-supply-action="edit-plan" data-plan-id="${esc(plan.id)}" data-item-id="${esc(item.id)}">Editar</button><button type="button" class="btn" data-supply-action="delete-plan" data-plan-id="${esc(plan.id)}">Eliminar</button>${plan.supply_method==='inventory'?`<button type="button" class="btn orange" data-supply-action="prepare-load">Crear cargue</button>`:''}${needsPurchase&&!purchaseComplete?`<button type="button" class="btn orange" data-supply-action="link-purchase" data-plan-id="${esc(plan.id)}" data-item-id="${esc(item.id)}">Elegir compra</button>`:''}${purchaseComplete?'<span class="sales-supply-status ok">Compra asignada</span>':''}</details></div></div>${needsPurchase?`<div class="sales-supply-proc-list">${allocations.length?allocations.map(allocation=>renderProcurement(item,plan,allocation)).join(''):'<div class="sales-supply-empty">Falta registrar la compra del proveedor para esta venta.</div>'}</div>`:''}</div>`;
  }

  function renderProcurement(item,plan,allocation){
    const po=allocation.purchase_order||{},poi=allocation.purchase_order_item||{},supplier=po.supplier||{},direct=allocation.direct_shipments||[];
    const hasDirectRemaining=po.status!=='cancelled'&&procurementContainerPending(allocation);
    const containerActions=plan.supply_method==='purchase_direct'&&hasDirectRemaining?`<button type="button" class="btn orange" data-supply-action="new-direct" data-proc-id="${esc(allocation.id)}" data-item-id="${esc(item.id)}">Poner número de contenedor</button>`:'';
    const order=state.data?.order||{},client=order.client||{},saleAssignment=`Asignada a ${order.so_number||'esta venta'} · ${client.name||client.company||client.mipyme_name||'Cliente'}`;
    const quantityDetail=plan.supply_method==='purchase_direct'
      ?`${esc(saleAssignment)}: ${fmt(allocation.allocated_sales_quantity)} ${esc(item.unit)} · ${esc(orderStatus(po.status))}`
      :`Venta: ${fmt(allocation.allocated_sales_quantity)} ${esc(item.unit)} · Compra: ${fmt(allocation.allocated_purchase_quantity)} ${esc(poi.unit||'unidad de compra')} · ${esc(orderStatus(po.status))}`;
    const editAction=plan.supply_method==='purchase_direct'?'':`<button type="button" class="btn" data-supply-action="edit-purchase" data-proc-id="${esc(allocation.id)}" data-plan-id="${esc(plan.id)}" data-item-id="${esc(item.id)}">Cambiar cantidades</button>`;
    return `<div class="sales-supply-proc"><div class="sales-supply-proc-head"><div><div class="sales-supply-proc-title">${esc(po.po_number||'PO')} · ${esc(supplier.name||supplier.legal_name||'Proveedor')}</div><div class="sales-supply-detail">${quantityDetail}${po.supplier_reference?` · PO almacén/proveedor: ${esc(po.supplier_reference)}`:''}</div></div><div class="sales-supply-actions">${containerActions}<details><summary>Más opciones</summary><button type="button" class="btn" data-supply-action="open-po" data-po-id="${esc(po.id||poi.purchase_order_id||'')}">Abrir compra</button>${editAction}<button type="button" class="btn" data-supply-action="unlink-purchase" data-proc-id="${esc(allocation.id)}">Quitar compra</button></details></div></div>${plan.supply_method==='purchase_direct'?`<div class="sales-supply-direct-list">${direct.length?direct.map(row=>renderDirect(item,allocation,row)).join(''):'<div class="sales-supply-empty">Compra lista · falta el número de contenedor.</div>'}</div>`:''}</div>`;
  }

  function renderDirect(item,allocation,row){
    const shipment=row.shipment||{},dispatch=row.dispatch||null;
    const plannedSales=Number(row.planned_sales_quantity ?? row.allocated_sales_quantity ?? 0),actualSales=Number(row.allocated_sales_quantity||0);
    const plannedPurchase=Number(row.planned_purchase_quantity ?? row.allocated_purchase_quantity ?? 0),actualPurchase=Number(row.allocated_purchase_quantity||0);
    const corrected=row.has_quantity_correction===true;
    const quantities=corrected
      ?`<div class="sales-supply-detail"><b>Enviado real:</b> ${fmt(actualSales)} ${esc(item.unit)} · <b>Proveedor:</b> ${fmt(actualPurchase)} ${esc(allocation.purchase_order_item?.unit||'unidad de compra')}</div><div class="sales-supply-detail">Plan original: ${fmt(plannedSales)} ${esc(item.unit)} · Diferencia: ${fmt(Math.max(0,plannedSales-actualSales))} ${esc(item.unit)}</div><div class="sales-supply-detail">Corrección: ${esc(row.latest_correction_reason||'Sin motivo')} · ${esc(dateTime(row.latest_correction_at))}</div>`
      :`<div class="sales-supply-detail">Venta: ${fmt(actualSales)} ${esc(item.unit)} · Compra: ${fmt(actualPurchase)} ${esc(allocation.purchase_order_item?.unit||'unidad de compra')}</div>`;
    return `<div class="sales-supply-direct"><div class="sales-supply-direct-head"><div><div class="sales-supply-proc-title">${esc(shipment.container_number||'Contenedor')}</div>${quantities}</div><span class="sales-supply-status ${dispatch?'ok':'warn'}">${dispatch?'Despachado':'Planificado'}</span></div>${dispatch?`<div class="sales-supply-detail">Despachado: ${esc(dateTime(dispatch.dispatched_at))}</div>`:''}<div class="sales-supply-actions"><button type="button" class="btn" data-supply-action="open-tracking" data-shipment-id="${esc(shipment.id||row.shipment_id)}">Abrir contenedor</button>${dispatch?`<button type="button" class="btn" data-supply-action="correct-direct" data-direct-id="${esc(row.id)}">Corregir cantidades</button>`:`<button type="button" class="btn orange" data-supply-action="dispatch-direct" data-shipment-id="${esc(shipment.id||row.shipment_id)}">Marcar despachado</button><button type="button" class="btn" data-supply-action="unlink-direct" data-direct-id="${esc(row.id)}">Desvincular</button>`}</div></div>`;
  }

  function findItem(id){return (state.data?.items||[]).find(row=>row.id===id)||null;}
  function findPlan(id){for(const item of state.data?.items||[]){const plan=(item.supply_plans||[]).find(row=>row.id===id);if(plan)return {item,plan};}return null;}
  function findProcurement(id){for(const item of state.data?.items||[])for(const plan of item.supply_plans||[]){const allocation=(plan.procurement_allocations||[]).find(row=>row.id===id);if(allocation)return {item,plan,allocation};}return null;}
  function findDirect(id){for(const item of state.data?.items||[])for(const plan of item.supply_plans||[])for(const allocation of plan.procurement_allocations||[]){const direct=(allocation.direct_shipments||[]).find(row=>String(row.id)===String(id));if(direct)return {item,plan,allocation,direct};}return null;}

  function remainingDirectPurchase(item){
    const plans=item.supply_plans||[],warehouse=plans.filter(plan=>plan.supply_method!=='purchase_direct').reduce((sum,plan)=>sum+Number(plan.planned_quantity||0),0);
    const bought=plans.filter(plan=>plan.supply_method==='purchase_direct').flatMap(plan=>plan.procurement_allocations||[]).filter(row=>row.purchase_order?.status!=='cancelled').reduce((sum,row)=>sum+Number(row.allocated_sales_quantity||0),0);
    return Math.max(0,Number(item.ordered_quantity||0)-warehouse-bought);
  }

  function directProcurements(){
    return (state.data?.items||[]).flatMap(item=>(item.supply_plans||[]).filter(plan=>plan.supply_method==='purchase_direct').flatMap(plan=>plan.procurement_allocations||[])).filter(row=>row.purchase_order?.status!=='cancelled');
  }

  function procurementContainerPending(allocation){
    const direct=allocation.direct_shipments||[];
    // A physical correction records what actually shipped. It does not reopen
    // the original allocation for an additional container.
    const salesAssigned=direct.reduce((sum,row)=>sum+Number(row.planned_sales_quantity??row.allocated_sales_quantity??0),0);
    const purchaseAssigned=direct.reduce((sum,row)=>sum+Number(row.planned_purchase_quantity??row.allocated_purchase_quantity??0),0);
    return Number(allocation.allocated_sales_quantity||0)-salesAssigned>1e-8&&Number(allocation.allocated_purchase_quantity||0)-purchaseAssigned>1e-8;
  }

  function directOperationStep(){
    if(['cancelled','closed'].includes(state.data?.order?.status))return {title:`Venta ${state.data.order.status==='cancelled'?'cancelada':'cerrada'}`,text:'Consulta las compras, contenedores y despachos registrados de este pedido.'};
    if((state.data?.items||[]).some(item=>remainingDirectPurchase(item)>1e-8))return {title:'Falta registrar la compra',text:'Para conocer el costo y la deuda al proveedor, registra la compra desde aquí. El PO del almacén es una referencia; no sustituye la compra.',action:'Registrar compra y contenedor'};
    const linked=directProcurements();
    if(!linked.length)return {title:'Ruta de almacén',text:'La mercancía de almacén se prepara y despacha desde Cargues.'};
    if(linked.some(procurementContainerPending))return {title:'Compra registrada · falta contenedor',text:'Escribe el número de contenedor para la mercancía que queda por asignar.',action:'Poner número de contenedor'};
    const rows=linked.flatMap(row=>row.direct_shipments||[]);
    if(rows.some(row=>!row.shipment||row.shipment.active===false))return {title:'Revisar contenedor',text:'Hay un contenedor inactivo o no disponible. Revisa su estado desde «Abrir contenedor».'};
    if(rows.some(row=>!row.dispatch))return {title:'Compra y contenedor listos · falta despacho',text:'Revisa las cantidades de abajo. Cuando salga la mercancía, pulsa «Marcar despachado» en su contenedor.'};
    const shortfall=rows.some(row=>Number(row.allocated_sales_quantity||0)<Number(row.planned_sales_quantity??row.allocated_sales_quantity??0));
    return {title:shortfall?'Despacho registrado · hay diferencias':'Despacho registrado',text:shortfall?'Revisa el enviado real y la diferencia con el plan original de abajo. La factura y el pago al proveedor se revisan en Cuentas por pagar.':'La mercancía tiene su despacho registrado. La factura y el pago al proveedor se revisan en Cuentas por pagar.'};
  }

  async function openOperation(preselectedPurchaseId=null,salesOrderId=state.salesOrderId){
    if(!salesOrderId)return;
    state.salesOrderId=String(salesOrderId);
    const [access]=await Promise.all([request('/api/sales-direct-operation'),fetchSupply()]);
    if(!directOperationStep().action){
      ensureModals();render();byId('salesSupplyFormModal').classList.add('hidden');byId('salesSupplyModal').classList.remove('hidden');return;
    }
    const items=state.data.items||[],pending=items.filter(item=>remainingDirectPurchase(item)>0),order=state.data.order;
    const linked=items.flatMap(item=>(item.supply_plans||[]).filter(plan=>plan.supply_method==='purchase_direct').flatMap(plan=>plan.procurement_allocations||[]));
    const options=new Map();
    for(const row of state.data.purchase_options||[])if(row.purchase_order?.status==='confirmed'&&row.compatible_methods?.includes('purchase_direct')&&purchaseAvailable(row))options.set(row.purchase_order.id,row.purchase_order);
    for(const row of linked)if(row.purchase_order?.id)options.set(row.purchase_order.id,row.purchase_order);
    const selected=preselectedPurchaseId||(!pending.length&&options.size===1?[...options.keys()][0]:null);
    const poOptions=[...options.values()].map(po=>`<option value="${esc(po.id)}">${esc(po.po_number)} · ${esc(po.supplier?.name||po.supplier?.legal_name||'Proveedor')}${po.supplier_reference?` · ${esc(po.supplier_reference)}`:''}</option>`).join('');
    const noteReference=items.flatMap(item=>item.supply_plans||[]).map(plan=>String(plan.notes||'').trim()).find(note=>/^PO[\s#-]*[A-Z0-9-]+$/i.test(note))||'';
    let requestId=crypto.randomUUID(),attemptedPayload=null;
    openForm({title:`${order.so_number} · Direct Ship`,subtitle:'Compra, PO del proveedor y contenedor en un solo formulario.',saveLabel:'Guardar compra y contenedor',canSave:access.write_access===true,
      html:`<div class="sales-supply-form">
      <div class="full"><label for="directPurchaseMode">Compra de mercancía</label><select id="directPurchaseMode"><option value="new" ${pending.length?'':'disabled'}>Registrar compra desde esta venta</option><option value="existing" ${options.size?'':'disabled'}>Usar una compra ya registrada</option></select></div>
      <div id="directNewPurchase" class="full"><div class="sales-supply-form"><div><label for="directSupplier">Proveedor *</label><select id="directSupplier"><option value="">Seleccionar proveedor</option>${(access.suppliers||[]).map(s=>`<option value="${esc(s.id)}">${esc(s.legal_name||s.name)}</option>`).join('')}</select></div><div><label for="directSupplierReference">PO del proveedor / almacén</label><input id="directSupplierReference" maxlength="250" value="${esc(noteReference)}" placeholder="Ej.: PO12567"></div><div class="full"><h3>Mercancía a comprar · ${esc(order.currency)}</h3>${pending.map(item=>`<div class="sales-ws-row"><b>${esc(productTitle(item))}</b><div class="sales-supply-detail">${fmt(remainingDirectPurchase(item))} ${esc(item.unit)} · ${fmt(Number(item.ordered_quantity)>0?Number(item.ordered_pallets||0)*remainingDirectPurchase(item)/Number(item.ordered_quantity):0)} pallets · tomados de la venta</div><label for="direct-cost-${esc(item.id)}">Costo total de esta mercancía *</label><input id="direct-cost-${esc(item.id)}" data-direct-cost="${esc(item.id)}" type="number" min="0" step="0.01" placeholder="Monto que cobra el proveedor"></div>`).join('')}</div></div></div>
      <div id="directExistingPurchase" class="full hidden"><label for="directPurchaseOrder">Compra registrada *</label><select id="directPurchaseOrder"><option value="">Seleccionar compra confirmada</option>${poOptions}</select><div class="sales-supply-helper">Se usa la cantidad pendiente y sus pallets. Si la compra ya está vinculada, solo completas el contenedor.</div></div>
      <div class="full"><label for="supplyNewContainer">Número de contenedor</label><input id="supplyNewContainer" maxlength="40" ${access.logistics_write?'':'disabled'} placeholder="Ej.: ABCD1234567"><div class="sales-supply-helper">Puedes dejarlo pendiente si aún no lo tienes. El número queda vinculado a esta venta en Tracking.</div></div>
      <details class="full"><summary>Más datos del envío</summary><div class="sales-supply-form"><div><label for="supplyNewCarrier">Naviera</label><input id="supplyNewCarrier"></div><div><label for="supplyNewBooking">Booking</label><input id="supplyNewBooking"></div><div><label for="supplyNewBol">B/L</label><input id="supplyNewBol"></div><div><label for="supplyNewDeparture">Fecha de salida planificada</label><input id="supplyNewDeparture" type="date"></div></div></details>
      ${access.finance_write?'<details class="full"><summary>Factura del proveedor, si ya la tienes</summary><label for="directSupplierInvoice">Número de factura del proveedor</label><input id="directSupplierInvoice" maxlength="200"><div class="sales-supply-helper">Crea la deuda en Cuentas por pagar por el importe de la compra. Queda pendiente de pago. Si aún no tienes la factura, la compra aparecerá como «Por facturar».</div></details>':''}
      <div class="full sales-supply-helper">${order.status==='draft'?'Al guardar se confirma la venta y se registra la compra. ':''}El cobro al cliente y el pago al proveedor se registran por separado. Los gastos se añaden en «Gastos y ganancia» de este pedido.</div></div>`,
      onOpen:()=>{byId('directPurchaseMode').value=selected||!pending.length?'existing':'new';byId('directPurchaseOrder').value=selected||'';const sync=()=>{const isNew=byId('directPurchaseMode').value==='new';byId('directNewPurchase').classList.toggle('hidden',!isNew);byId('directExistingPurchase').classList.toggle('hidden',isNew);byId('salesSupplyFormSave').textContent=isNew?'Guardar compra y contenedor':'Guardar operación';};byId('directPurchaseMode').onchange=sync;sync();},
      onSave:async()=>{
        const isNew=byId('directPurchaseMode').value==='new',purchaseId=isNew?null:byId('directPurchaseOrder').value;
        const localError=message=>{const e=new Error(message);e.code='DIRECT_OPERATION_LOCAL_INPUT';throw e;};
        if(isNew&&!byId('directSupplier').value)localError('Selecciona el proveedor de la mercancía.');
        if(!isNew&&!purchaseId)localError('Selecciona una compra confirmada.');
        const lines=isNew?[...document.querySelectorAll('[data-direct-cost]')].map(input=>({sales_order_item_id:input.dataset.directCost,total:input.value})):[];
        if(lines.some(line=>!/^\d+(?:\.\d{1,2})?$/.test(line.total)))localError('Indica el costo total de cada producto pendiente de comprar.');
        const payload={sales_order_id:state.salesOrderId,purchase_order_id:purchaseId,supplier_id:isNew?byId('directSupplier').value:null,supplier_reference:isNew?byId('directSupplierReference').value:'',lines,container_number:byId('supplyNewContainer').value,carrier:byId('supplyNewCarrier').value,booking_number:byId('supplyNewBooking').value,bol_number:byId('supplyNewBol').value,departure_date:byId('supplyNewDeparture').value||null,supplier_invoice_number:byId('directSupplierInvoice')?.value||''};
        const serialized=JSON.stringify(payload);
        if(attemptedPayload&&attemptedPayload!==serialized)localError('No se confirmó el intento anterior. Reintenta con los mismos datos o actualiza la venta antes de cambiarlos.');
        attemptedPayload=serialized;
        try{const result=await request('/api/sales-direct-operation',{method:'POST',body:JSON.stringify({...payload,request_id:requestId})});if(!result.operation?.purchase_order_id)throw new Error('DIRECT_OPERATION_CONFIRMATION_MISSING');}
        catch(error){if([400,403,404,409,422].includes(error.status)){attemptedPayload=null;requestId=crypto.randomUUID();}throw error;}
      }
    });
  }

  function bindMainActions(){
    byId('salesSupplyBody')?.querySelectorAll('[data-supply-action]').forEach(button=>button.onclick=()=>runAction(button.dataset));
  }

  function runAction(data){
    const action=data.supplyAction;
    try{
      if(action==='direct-operation')return openOperation().catch(error=>showMessage(safeSupplyMessage(error)));
      if(action==='new-plan')return editPlan(data.itemId,null);
      if(action==='plan-direct')return editPlan(data.itemId,null,'purchase_direct');
      if(action==='quick-direct')return quickDirect(data.itemId);
      if(action==='edit-plan'){const found=findPlan(data.planId);return editPlan(data.itemId,found?.plan||null);}
      if(action==='delete-plan')return removePlan(data.planId);
      if(action==='prepare-load')return prepareLoad();
      if(action==='link-purchase'){const found=findPlan(data.planId);return found?.plan?.supply_method==='purchase_direct'?openOperation().catch(error=>showMessage(safeSupplyMessage(error))):editPurchase(found?.item,found?.plan,null);}
      if(action==='edit-purchase'){const found=findProcurement(data.procId);return editPurchase(found?.item,found?.plan,found?.allocation);}
      if(action==='unlink-purchase')return unlinkPurchase(data.procId);
      if(action==='open-po')return nav()?.openPurchase?.({purchaseOrderId:data.poId});
      if(action==='new-direct'){const found=findProcurement(data.procId);return openOperation(found?.allocation?.purchase_order_item?.purchase_order_id||found?.allocation?.purchase_order?.id).catch(error=>showMessage(safeSupplyMessage(error)));}
      if(action==='open-tracking')return nav()?.openTracking?.({shipmentId:data.shipmentId});
      if(action==='dispatch-direct')return dispatchDirect(data.shipmentId);
      if(action==='unlink-direct')return unlinkDirect(data.directId);
      if(action==='correct-direct'){const found=findDirect(data.directId);return correctDirect(found?.item,found?.allocation,found?.direct);}
    }catch(error){showMessage(safeSupplyMessage(error),false);}
  }

  function editPlan(itemId,plan,preferredMethod='inventory'){
    const item=findItem(itemId);if(!item)return;
    const isEdit=Boolean(plan),progress=item.supply_progress||{};
    const defaultQty=isEdit?plan.planned_quantity:progress.unplanned_quantity;
    const otherPlans=(item.supply_plans||[]).filter(row=>row.id!==plan?.id);
    const remainingPallets=Math.max(0,Number(item.ordered_pallets||0)-otherPlans.reduce((sum,row)=>sum+Number(row.planned_pallets||0),0));
    const suggestedPallets=quantity=>{
      const orderedQty=Number(item.ordered_quantity||0),orderedPallets=Number(item.ordered_pallets||0);
      const ratio=orderedQty>0&&orderedPallets>0?orderedPallets/orderedQty:Number(item.units_per_pallet)>0?1/Number(item.units_per_pallet):0;
      return String(Number(Math.min(remainingPallets,Math.max(0,Number(quantity||0)*ratio)).toFixed(8)));
    };
    const defaultPallets=isEdit&&Number(plan.planned_pallets)>0?plan.planned_pallets:suggestedPallets(defaultQty);
    const warehouseOptions=(state.data.warehouses||[]).map(row=>`<option value="${esc(row.id)}">${esc(row.code?row.code+' · ':'')}${esc(row.name)}</option>`).join('');
    openForm({title:isEdit?'Editar ruta':'Agregar ruta',subtitle:productTitle(item),html:`<div class="sales-supply-form"><div><label>Ruta *</label><select id="supplyMethod"><option value="inventory">Stock existente</option><option value="purchase_warehouse">Compra para almacén</option><option value="purchase_direct">Direct Ship</option></select></div><div id="supplyWarehouseWrap"><label>Almacén *</label><select id="supplyWarehouse"><option value="">Seleccionar</option>${warehouseOptions}</select></div><div><label>Cantidad de venta *</label><input id="supplyPlannedQty" type="number" min="0" step="any" value="${esc(defaultQty??'')}"></div><div><label>Pallets</label><input id="supplyPlannedPallets" type="number" min="0" step="any" value="${esc(defaultPallets)}"></div><div class="full"><label>Nota</label><textarea id="supplyPlanNotes">${esc(plan?.notes||'')}</textarea><div class="sales-supply-helper">Direct Ship no crea WR ni inventario. Stock y compra para almacén sí requieren un almacén real.</div></div></div>`,onOpen:()=>{let palletsEdited=false;byId('supplyPlannedPallets').addEventListener('input',()=>{palletsEdited=byId('supplyPlannedPallets').value!=='';});byId('supplyPlannedQty').addEventListener('input',()=>{if(!palletsEdited)byId('supplyPlannedPallets').value=suggestedPallets(byId('supplyPlannedQty').value);});byId('supplyMethod').value=plan?.supply_method||preferredMethod;byId('supplyWarehouse').value=plan?.warehouse_id||'';const toggle=()=>byId('supplyWarehouseWrap').classList.toggle('sales-supply-field-hidden',byId('supplyMethod').value==='purchase_direct');byId('supplyMethod').onchange=toggle;toggle();},onSave:async()=>{const method=byId('supplyMethod').value,payload={action:isEdit?'update_plan':'create_plan',planned_quantity:byId('supplyPlannedQty').value,planned_pallets:byId('supplyPlannedPallets').value||0,notes:byId('supplyPlanNotes').value,supply_method:method,warehouse_id:method==='purchase_direct'?null:byId('supplyWarehouse').value};if(isEdit)payload.plan_id=plan.id;else payload.sales_order_item_id=item.id;await request('/api/sales-supply',{method:'POST',body:JSON.stringify(payload)});}});
  }

  function removePlan(planId){askAction({title:'Eliminar ruta',message:'Se eliminará esta ruta de abastecimiento. Si tiene una compra vinculada, primero debes desvincularla.',acceptLabel:'Eliminar',onAccept:()=>request('/api/sales-supply',{method:'POST',body:JSON.stringify({action:'delete_plan',plan_id:planId})})});}

  function quickDirect(itemId){
    const item=findItem(itemId);if(!item)return;
    const progress=item.supply_progress||{},matching=(state.data.purchase_options||[]).filter(row=>row.product_id===item.product_id&&row.purchase_order?.status==='confirmed'&&row.compatible_methods?.includes('purchase_direct')),available=matching.filter(purchaseAvailable);
    const options=available.map(row=>`<option value="${esc(row.id)}">${esc(purchaseOptionText(row))}</option>`).join('');
    openForm({title:'Asignar Direct Ship',subtitle:`${productTitle(item)} · Pendiente ${fmt(progress.unplanned_quantity||0)} ${esc(item.unit)}`,saveLabel:'Asignar mercancía',canSave:available.length>0,html:`<div class="sales-supply-form"><div class="full"><label>Compra que enviará el proveedor *</label><select id="quickDirectPo" ${available.length?'':'disabled'}><option value="">${available.length?'Seleccionar compra':'No hay compras con saldo disponible'}</option>${options}</select></div><div id="quickDirectSummary" class="full sales-supply-helper">${available.length?'Elige una compra confirmada. El ERP asignará automáticamente el saldo disponible y sus pallets.':'Todas las compras compatibles ya están asignadas a otras ventas.'}</div>${purchaseUsageNotice(matching)}<div class="full sales-supply-helper">Completa el número de contenedor en Compra y contenedor.</div></div>`,onOpen:()=>{const select=byId('quickDirectPo'),sync=()=>{const selected=available.find(row=>row.id===select.value);byId('quickDirectSummary').textContent=selected?`${selected.purchase_order?.po_number||'Compra'} · Saldo ${fmt(purchaseRemaining(selected))} ${selected.unit}. Se usará automáticamente el saldo compatible con la venta.`:'Elige una compra confirmada. El ERP asignará automáticamente el saldo disponible y sus pallets.';};select.onchange=sync;sync();},onSave:()=>request('/api/sales-supply',{method:'POST',body:JSON.stringify({action:'quick_direct',sales_order_item_id:item.id,purchase_order_item_id:byId('quickDirectPo').value})})});
  }

  function editPurchase(item,plan,allocation){
    if(!item||!plan)return;
    const isEdit=Boolean(allocation),matching=(state.data.purchase_options||[]).filter(row=>row.product_id===item.product_id&&row.compatible_methods?.includes(plan.supply_method)&&!(plan.supply_method==='purchase_warehouse'&&row.purchase_order?.warehouse_id&&row.purchase_order.warehouse_id!==plan.warehouse_id));
    const options=matching.filter(row=>purchaseAvailable(row)||row.id===allocation?.purchase_order_item_id);
    const optionsHtml=options.map(row=>`<option value="${esc(row.id)}">${esc(purchaseOptionText(row))} · ${esc(orderStatus(row.purchase_order?.status))}</option>`).join('');
    if(plan.supply_method==='purchase_direct'){
      if(isEdit)return;
      const confirmedOptions=options.filter(row=>row.purchase_order?.status==='confirmed'&&purchaseAvailable(row));
      const confirmedHtml=confirmedOptions.map(row=>`<option value="${esc(row.id)}">${esc(purchaseOptionText(row))}</option>`).join('');
      openForm({title:'Elegir compra Direct Ship',subtitle:productTitle(item),saveLabel:'Vincular compra',canSave:confirmedOptions.length>0,html:`<div class="sales-supply-form"><div class="full"><label>Compra que enviará el proveedor *</label><select id="supplyPoItem" ${confirmedOptions.length?'':'disabled'}><option value="">${confirmedOptions.length?'Seleccionar compra confirmada':'No hay compras con saldo disponible'}</option>${confirmedHtml}</select></div><div id="supplyDirectPurchaseSummary" class="full sales-supply-helper">${confirmedOptions.length?'El ERP usará automáticamente la mercancía pendiente de esta venta y el saldo disponible de la compra. No tienes que escribir cantidades.':'Todas las compras compatibles ya están asignadas. Revisa abajo a qué venta y cliente pertenecen.'}</div>${purchaseUsageNotice(matching)}</div>`,onOpen:()=>{const select=byId('supplyPoItem'),sync=()=>{const selected=confirmedOptions.find(row=>row.id===select.value);byId('supplyDirectPurchaseSummary').textContent=selected?`${selected.purchase_order?.po_number||'Compra'} · Saldo ${fmt(purchaseRemaining(selected))} ${selected.unit}. Se asignará automáticamente el saldo compatible.`:'El ERP usará automáticamente la mercancía pendiente de esta venta y el saldo disponible de la compra. No tienes que escribir cantidades.';};select.onchange=sync;sync();},onSave:()=>request('/api/sales-supply',{method:'POST',body:JSON.stringify({action:'quick_link_direct_purchase',supply_plan_line_id:plan.id,purchase_order_item_id:byId('supplyPoItem').value})})});
      return;
    }
    openForm({title:isEdit?'Editar vínculo de compra':'Vincular Purchase Order',subtitle:`${productTitle(item)} · ${methodLabel(plan.supply_method)}`,html:`<div class="sales-supply-form"><div class="full"><label>Línea de PO *</label><select id="supplyPoItem" ${isEdit?'disabled':''}><option value="">Seleccionar PO</option>${optionsHtml}</select></div><div><label>Cantidad aplicada a la venta *</label><input id="supplySalesQty" type="number" min="0" step="any" value="${esc(allocation?.allocated_sales_quantity||'')}"><div class="sales-supply-helper">Unidad de venta: ${esc(item.unit)}</div></div><div><label>Pallets de venta</label><input id="supplySalesPallets" type="number" min="0" step="any" value="${esc(allocation?.allocated_sales_pallets||'0')}"></div><div><label>Cantidad aplicada de la compra *</label><input id="supplyPurchaseQty" type="number" min="0" step="any" value="${esc(allocation?.allocated_purchase_quantity||'')}"><div id="supplyPurchaseUnit" class="sales-supply-helper">La cantidad de compra es explícita; no se aplica conversión automática.</div></div><div><label>Pallets de compra</label><input id="supplyPurchasePallets" type="number" min="0" step="any" value="${esc(allocation?.allocated_purchase_pallets||'0')}"></div><div class="full"><label>Nota</label><textarea id="supplyPurchaseNotes">${esc(allocation?.notes||'')}</textarea></div></div>`,onOpen:()=>{if(isEdit)byId('supplyPoItem').value=allocation.purchase_order_item_id;const updateUnit=()=>{const selected=options.find(row=>row.id===byId('supplyPoItem').value);byId('supplyPurchaseUnit').textContent=selected?`Unidad de compra: ${selected.unit}. No se aplica conversión automática.`:'La cantidad de compra es explícita; no se aplica conversión automática.';};byId('supplyPoItem').onchange=updateUnit;updateUnit();},onSave:async()=>{const payload={action:isEdit?'update_purchase_link':'link_purchase',allocated_sales_quantity:byId('supplySalesQty').value,allocated_sales_pallets:byId('supplySalesPallets').value||0,allocated_purchase_quantity:byId('supplyPurchaseQty').value,allocated_purchase_pallets:byId('supplyPurchasePallets').value||0,notes:byId('supplyPurchaseNotes').value};if(isEdit)payload.procurement_allocation_id=allocation.id;else{payload.supply_plan_line_id=plan.id;payload.purchase_order_item_id=byId('supplyPoItem').value;}await request('/api/sales-supply',{method:'POST',body:JSON.stringify(payload)});}});
  }

  function unlinkPurchase(procurementId){askAction({title:'Desvincular Purchase Order',message:'Se quitará la relación entre esta venta y la línea de compra. Un contenedor Direct Ship vinculado debe retirarse primero.',acceptLabel:'Desvincular',onAccept:()=>request('/api/sales-supply',{method:'POST',body:JSON.stringify({action:'unlink_purchase',procurement_allocation_id:procurementId})})});}

  function dispatchDirect(shipmentId){
    openForm({title:'Marcar Direct Ship como despachado',subtitle:'Este evento cuenta como despacho físico para cumplimiento de la venta.',saveLabel:'Registrar despacho',html:`<div class="sales-supply-form"><div><label>Fecha y hora real *</label><input id="supplyDispatchAt" type="datetime-local" value="${esc(localDateTime())}"></div><div class="full"><label>Nota</label><textarea id="supplyDispatchNotes"></textarea><div class="sales-supply-helper">Después del despacho la asignación original queda protegida. Si descubres una diferencia física, usa Corregir cantidades para conservar el historial.</div></div></div>`,onSave:()=>request('/api/direct-shipment-dispatch',{method:'POST',body:JSON.stringify({action:'dispatch',shipment_id:shipmentId,dispatched_at:localDispatchInstant(byId('supplyDispatchAt').value),notes:byId('supplyDispatchNotes').value})})});
  }

  function correctDirect(item,allocation,row){
    if(!item||!allocation||!row?.dispatch)return;
    const plannedSales=row.planned_sales_quantity??row.allocated_sales_quantity;
    const plannedSalesPallets=row.planned_sales_pallets??row.allocated_sales_pallets;
    const plannedPurchase=row.planned_purchase_quantity??row.allocated_purchase_quantity;
    const plannedPurchasePallets=row.planned_purchase_pallets??row.allocated_purchase_pallets;
    openForm({
      title:'Corregir cantidades físicas',
      subtitle:'El plan original y el despacho permanecen en el historial. Esta corrección cambia únicamente la cantidad física efectiva.',
      saveLabel:'Guardar corrección',
      html:`<div class="sales-supply-form"><div><label>Unidades enviadas al cliente *</label><input id="directCorrectSalesQty" type="number" min="0" max="${esc(plannedSales)}" step="any" value="${esc(row.allocated_sales_quantity)}"><div class="sales-supply-helper">Plan original: ${fmt(plannedSales)} ${esc(item.unit)}</div></div><div><label>Pallets enviados</label><input id="directCorrectSalesPallets" type="number" min="0" max="${esc(plannedSalesPallets)}" step="any" value="${esc(row.allocated_sales_pallets||0)}"></div><div><label>Unidades físicas del proveedor *</label><input id="directCorrectPurchaseQty" type="number" min="0" max="${esc(plannedPurchase)}" step="any" value="${esc(row.allocated_purchase_quantity)}"><div class="sales-supply-helper">Compra/plan vinculado: ${fmt(plannedPurchase)} ${esc(allocation.purchase_order_item?.unit||'unidades')}</div></div><div><label>Pallets físicos del proveedor</label><input id="directCorrectPurchasePallets" type="number" min="0" max="${esc(plannedPurchasePallets)}" step="any" value="${esc(row.allocated_purchase_pallets||0)}"></div><div class="full"><label>Motivo de la corrección *</label><textarea id="directCorrectReason" required placeholder="Ej.: El proveedor redujo 30 unidades por límite de peso."></textarea><div class="sales-supply-helper">La PO no se reescribe. El ERP conservará cuánto se ordenó, cuánto se había planificado y cuánto salió físicamente.</div></div></div>`,
      onSave:()=>request('/api/direct-shipment-dispatch',{method:'POST',body:JSON.stringify({
        action:'correct_quantity',
        direct_shipment_allocation_id:row.id,
        sales_quantity:byId('directCorrectSalesQty').value,
        sales_pallets:byId('directCorrectSalesPallets').value||0,
        purchase_quantity:byId('directCorrectPurchaseQty').value,
        purchase_pallets:byId('directCorrectPurchasePallets').value||0,
        reason:byId('directCorrectReason').value
      })})
    });
  }

  function unlinkDirect(directId){askAction({title:'Desvincular contenedor',message:'Se quitará esta mercancía del contenedor Direct Ship. Esta acción solo está permitida antes del despacho real.',acceptLabel:'Desvincular',onAccept:()=>request('/api/sales-supply',{method:'POST',body:JSON.stringify({action:'unlink_direct_shipment',direct_shipment_allocation_id:directId})})});}

  function prepareLoad(){
    byId('salesSupplyModal')?.classList.add('hidden');
    const controller=window.SalesOrderController;if(!controller?.createLoad){showMessage('No está disponible Cargues desde Ventas.',false);return;}
    byId('detailModal')?.classList.add('hidden');controller.createLoad(state.salesOrderId);
  }

  function directShipments(){
    const map=new Map();
    for(const item of state.data?.items||[])for(const plan of item.supply_plans||[])for(const allocation of plan.procurement_allocations||[])for(const direct of allocation.direct_shipments||[]){const shipment=direct.shipment;if(!shipment?.id)continue;if(!map.has(shipment.id))map.set(shipment.id,{shipment,dispatch:direct.dispatch||null,lines:[]});map.get(shipment.id).lines.push({item,allocation,direct});}
    return [...map.values()];
  }

  function selectedNativeTab(){return byId('detailBody')?.querySelector('[data-ws-tab][aria-selected="true"]')?.dataset.wsTab;}

  async function augmentNativeTab(tab,{refresh=true}={}){
    const salesOrderId=state.salesOrderId;
    if(!salesOrderId||!['logistics','documents'].includes(tab))return;
    if(refresh)try{await fetchSupply();}catch(error){safeSupplyMessage(error,'No se pudo actualizar Abastecimiento. Intenta nuevamente.');return;}
    if(state.salesOrderId!==salesOrderId||selectedNativeTab()!==tab)return;
    const shipments=directShipments();if(!shipments.length)return;
    const content=byId('detailBody')?.querySelector('.sales-workspace-content');if(!content)return;
    content.querySelector('[data-direct-supply-augment]')?.remove();
    const host=document.createElement('div');host.dataset.directSupplyAugment='true';host.className='sales-supply-direct-augment';
    if(tab==='logistics'){
      host.innerHTML=`<h3>Direct Ship</h3><div class="sales-ws-list">${shipments.map(row=>`<div class="sales-ws-row"><div class="sales-ws-row-head"><div><div class="sales-ws-row-title">${esc(row.shipment.container_number)}</div><div class="sales-ws-meta">Sin Cargue / sin WR · ${esc(row.shipment.carrier||'Naviera pendiente')} · ${row.lines.length} línea${row.lines.length===1?'':'s'}</div></div><span class="sales-supply-status ${row.dispatch?'ok':'warn'}">${row.dispatch?'Despachado':'Planificado'}</span></div><div class="sales-ws-actions"><button type="button" class="btn" data-supply-track="${esc(row.shipment.id)}">Ver Tracking</button><button type="button" class="btn" data-supply-open-main>Abastecimiento</button></div></div>`).join('')}</div>`;
    }else if(tab==='documents'){
      const readiness=await request('/api/shipment-document-readiness');const rows=Array.isArray(readiness.readiness)?readiness.readiness:[];
      host.innerHTML=`<h3>Contenedores Direct Ship</h3><div class="sales-ws-list">${shipments.map(row=>{const r=rows.find(item=>item.shipment_id===row.shipment.id);return `<div class="sales-ws-row"><div class="sales-ws-row-head"><div><div class="sales-ws-row-title">${esc(row.shipment.container_number)}</div><div class="sales-ws-meta">Documentación Cuba controlada directamente por contenedor.</div></div><span class="sales-supply-status ${r?.document_status==='ready'?'ok':r?.documentation_required?'warn':''}">${esc(r?.document_status==='ready'?'READY':r?.documentation_required?'Pendiente':'Aún no requerido')}</span></div><div class="sales-ws-actions"><button type="button" class="btn" data-supply-track="${esc(row.shipment.id)}">Abrir contenedor / documentos</button></div></div>`;}).join('')}</div>`;
    }
    if(state.salesOrderId===salesOrderId&&selectedNativeTab()===tab&&byId('detailBody')?.querySelector('.sales-workspace-content')===content)content.appendChild(host);
  }

  function updateHeaderButton(){const button=byId('openSupplyWorkspace');if(!button)return;button.classList.add('hidden');button.onclick=()=>open(state.salesOrderId);}

  if(nativeWorkspace){
    window.SalesWorkspace=Object.freeze({...nativeWorkspace,
      open:async salesOrderId=>{state.salesOrderId=String(salesOrderId||'')||null;const result=await nativeWorkspace.open(salesOrderId);updateHeaderButton();return result;},
      reload:async options=>{const result=await nativeWorkspace.reload(options);updateHeaderButton();await augmentNativeTab(selectedNativeTab());return result;},
      openSupply:open,
      owner:'sales-supply-workspace.js'
    });
  }

  document.addEventListener('click',event=>{
    const track=event.target.closest('[data-supply-track]');if(track){nav()?.openTracking?.({shipmentId:track.dataset.supplyTrack});return;}
    if(event.target.closest('[data-supply-open-main]')){open(state.salesOrderId);return;}
    const tab=event.target.closest('#detailBody [data-ws-tab]');if(tab&&['logistics','documents'].includes(tab.dataset.wsTab)){queueMicrotask(()=>augmentNativeTab(tab.dataset.wsTab).catch(error=>{safeSupplyMessage(error,'No se pudo actualizar Abastecimiento. Intenta nuevamente.');}));}
  },true);

  updateHeaderButton();
  window.SalesSupplyWorkspace=Object.freeze({open,openOperation,refresh:refreshAll,owner:'sales-supply-workspace.js'});
})();
