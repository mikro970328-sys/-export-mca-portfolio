(() => {
  if(window.__salesSupplyWorkspaceInstalled)return;
  window.__salesSupplyWorkspaceInstalled=true;

  const byId=id=>document.getElementById(id);
  const token=()=>localStorage.getItem('export_mca_token')||'';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>value===null||value===undefined||value===''?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(Number(value));
  const dateTime=value=>value?new Date(value).toLocaleString('es-US'):'—';
  const localDateTime=()=>{const now=new Date(),offset=now.getTimezoneOffset()*60000;return new Date(now.getTime()-offset).toISOString().slice(0,16);};
  const state={salesOrderId:null,data:null,busy:false};
  const nativeWorkspace=window.SalesWorkspace||null;
  const publicErrorEndpoints=new Set(['/api/sales-supply','/api/direct-shipment-dispatch']);

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

  function openForm({title,subtitle='',html,onOpen,onSave,saveLabel='Guardar'}){
    ensureModals();
    byId('salesSupplyFormTitle').textContent=title;
    byId('salesSupplyFormSubtitle').textContent=subtitle;
    byId('salesSupplyFormBody').innerHTML=html;
    byId('salesSupplyFormMsg').textContent='';
    byId('salesSupplyFormSave').textContent=saveLabel;
    byId('salesSupplyFormSave').onclick=async()=>{
      if(state.busy)return;setBusy(true);byId('salesSupplyFormMsg').textContent='';
      try{await onSave();byId('salesSupplyFormModal').classList.add('hidden');await refreshAll();}
      catch(error){byId('salesSupplyFormMsg').textContent=safeSupplyMessage(error,'No se pudieron guardar los cambios. Intenta nuevamente.');}
      finally{setBusy(false);}
    };
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

  async function fetchSupply(){
    if(!state.salesOrderId)return null;
    state.data=await request(`/api/sales-supply?sales_order_id=${encodeURIComponent(state.salesOrderId)}`);
    return state.data;
  }

  async function refreshAll(){
    await fetchSupply();
    if(nativeWorkspace?.reload)await nativeWorkspace.reload({keepTab:true});
    render();
  }

  async function open(salesOrderId=state.salesOrderId){
    if(!salesOrderId)throw new Error('No hay una venta seleccionada.');
    state.salesOrderId=String(salesOrderId);ensureModals();
    byId('salesSupplyTitle').textContent='Asignar mercancía';
    byId('salesSupplySubtitle').textContent='Cargando opciones…';
    byId('salesSupplyBody').innerHTML='<div class="sales-ws-loading">Cargando opciones…</div>';
    byId('salesSupplyMsg').textContent='';
    byId('salesSupplyModal').classList.remove('hidden');
    try{await fetchSupply();render();}catch(error){byId('salesSupplyBody').innerHTML=`<div class="sales-ws-callout">${esc(safeSupplyMessage(error,'No se pudo cargar el abastecimiento. Intenta nuevamente.'))}</div>`;}
  }

  function render(){
    if(!state.data)return;
    const order=state.data.order,items=state.data.items||[];
    byId('salesSupplyTitle').textContent=`${order.so_number} · Asignar mercancía`;
    byId('salesSupplySubtitle').textContent='Elige si la mercancía sale del almacén o va directo del proveedor al cliente.';
    byId('salesSupplyBody').innerHTML=`<div class="sales-supply-intro"><div><strong>Direct Ship tiene solo 2 pasos.</strong><div>Paso 1: eliges la compra. Paso 2: registras un contenedor nuevo o usas uno existente. La mercancía no crea WR ni entra al inventario.</div></div><span class="sales-supply-status ${order.status==='confirmed'?'ok':'warn'}">${esc(orderStatus(order.status))}</span></div><div class="sales-supply-items">${items.map(renderItem).join('')}</div>`;
    bindMainActions();
  }

  function renderItem(item){
    const p=item.supply_progress||{},plans=item.supply_plans||[];
    const metrics=[['Vendido',p.ordered_quantity,item.unit],['Stock',p.planned_inventory_quantity,item.unit],['Compra almacén',p.planned_purchase_warehouse_quantity,item.unit],['Direct Ship',p.planned_purchase_direct_quantity,item.unit],['Sin planificar',p.unplanned_quantity,item.unit]];
    const directOptions=(state.data.purchase_options||[]).filter(row=>row.product_id===item.product_id&&row.purchase_order?.status==='confirmed'&&row.compatible_methods?.includes('purchase_direct'));
    return `<section class="sales-supply-item"><div class="sales-supply-item-head"><div><div class="sales-supply-item-title">${esc(productTitle(item))}</div><div class="sales-supply-item-sub">${fmt(item.ordered_quantity)} ${esc(item.unit)}${Number(item.ordered_pallets||0)>0?` · ${fmt(item.ordered_pallets)} pallets`:''}</div></div><div class="sales-supply-actions">${Number(p.unplanned_quantity||0)>0&&directOptions.length?`<button type="button" class="btn orange" data-supply-action="quick-direct" data-item-id="${esc(item.id)}">Enviar directo desde proveedor</button>`:''}<button type="button" class="btn" data-supply-action="new-plan" data-item-id="${esc(item.id)}">Usar almacén o inventario</button></div></div><div class="sales-supply-metrics">${metrics.map(([label,value,unit],index)=>`<div class="sales-supply-metric ${index===4&&Number(value||0)>0?'pending':''}"><span>${esc(label)}</span><b>${fmt(value)} ${esc(unit||'')}</b></div>`).join('')}</div><div class="sales-supply-plan-list">${plans.length?plans.map(plan=>renderPlan(item,plan)).join(''):'<div class="sales-supply-empty">Para Direct Ship, pulsa <b>Enviar directo desde proveedor</b>. Solo elegirás la compra y luego el contenedor.</div>'}</div></section>`;
  }

  function renderPlan(item,plan){
    const allocations=plan.procurement_allocations||[],needsPurchase=plan.supply_method!=='inventory';
    return `<div class="sales-supply-plan"><div class="sales-supply-plan-head"><div><span class="sales-supply-route ${methodClass(plan.supply_method)}">${esc(methodLabel(plan.supply_method))}</span><div class="sales-supply-detail">Plan: ${fmt(plan.planned_quantity)} ${esc(item.unit)}${Number(plan.planned_pallets||0)>0?` · ${fmt(plan.planned_pallets)} pallets`:''}${plan.warehouse_id?` · ${esc(warehouseName(plan.warehouse_id))}`:''}</div>${plan.notes?`<div class="sales-supply-detail">${esc(plan.notes)}</div>`:''}</div><div class="sales-supply-actions"><button type="button" class="btn" data-supply-action="edit-plan" data-plan-id="${esc(plan.id)}" data-item-id="${esc(item.id)}">Editar</button><button type="button" class="btn" data-supply-action="delete-plan" data-plan-id="${esc(plan.id)}">Eliminar</button>${plan.supply_method==='inventory'?`<button type="button" class="btn orange" data-supply-action="prepare-load">Crear cargue</button>`:''}${needsPurchase?`<button type="button" class="btn orange" data-supply-action="link-purchase" data-plan-id="${esc(plan.id)}" data-item-id="${esc(item.id)}">Elegir compra</button>`:''}</div></div>${needsPurchase?`<div class="sales-supply-proc-list">${allocations.length?allocations.map(allocation=>renderProcurement(item,plan,allocation)).join(''):'<div class="sales-supply-empty">Paso 1 pendiente: elige la compra que abastecerá esta venta.</div>'}</div>`:''}</div>`;
  }

  function renderProcurement(item,plan,allocation){
    const po=allocation.purchase_order||{},poi=allocation.purchase_order_item||{},supplier=po.supplier||{},direct=allocation.direct_shipments||[];
    const salesAssigned=direct.reduce((sum,row)=>sum+Number(row.allocated_sales_quantity||0),0);
    const purchaseAssigned=direct.reduce((sum,row)=>sum+Number(row.allocated_purchase_quantity||0),0);
    const hasDirectRemaining=Number(allocation.allocated_sales_quantity||0)-salesAssigned>0&&Number(allocation.allocated_purchase_quantity||0)-purchaseAssigned>0;
    const containerActions=plan.supply_method==='purchase_direct'&&hasDirectRemaining?`<button type="button" class="btn orange" data-supply-action="new-direct" data-proc-id="${esc(allocation.id)}" data-item-id="${esc(item.id)}">Registrar contenedor nuevo</button><button type="button" class="btn" data-supply-action="link-direct" data-proc-id="${esc(allocation.id)}" data-item-id="${esc(item.id)}">Usar contenedor existente</button>`:'';
    return `<div class="sales-supply-proc"><div class="sales-supply-proc-head"><div><div class="sales-supply-proc-title">${esc(po.po_number||'PO')} · ${esc(supplier.name||supplier.legal_name||'Proveedor')}</div><div class="sales-supply-detail">Venta: ${fmt(allocation.allocated_sales_quantity)} ${esc(item.unit)} · Compra: ${fmt(allocation.allocated_purchase_quantity)} ${esc(poi.unit||'unidad de compra')} · ${esc(orderStatus(po.status))}</div></div><div class="sales-supply-actions"><button type="button" class="btn" data-supply-action="open-po" data-po-id="${esc(po.id||poi.purchase_order_id||'')}">Abrir compra</button><button type="button" class="btn" data-supply-action="edit-purchase" data-proc-id="${esc(allocation.id)}" data-plan-id="${esc(plan.id)}" data-item-id="${esc(item.id)}">Cambiar cantidades</button><button type="button" class="btn" data-supply-action="unlink-purchase" data-proc-id="${esc(allocation.id)}">Quitar compra</button>${containerActions}</div></div>${plan.supply_method==='purchase_direct'?`<div class="sales-supply-direct-list">${direct.length?direct.map(row=>renderDirect(item,allocation,row)).join(''):'<div class="sales-supply-empty"><b>Paso 1 listo.</b> Paso 2: registra un contenedor nuevo o usa uno existente.</div>'}</div>`:''}</div>`;
  }

  function renderDirect(item,allocation,row){
    const shipment=row.shipment||{},dispatch=row.dispatch||null;
    return `<div class="sales-supply-direct"><div class="sales-supply-direct-head"><div><div class="sales-supply-proc-title">${esc(shipment.container_number||'Contenedor')}</div><div class="sales-supply-detail">Venta: ${fmt(row.allocated_sales_quantity)} ${esc(item.unit)} · Compra: ${fmt(row.allocated_purchase_quantity)} ${esc(allocation.purchase_order_item?.unit||'unidad de compra')}</div></div><span class="sales-supply-status ${dispatch?'ok':'warn'}">${dispatch?'Despachado':'Planificado'}</span></div>${dispatch?`<div class="sales-supply-detail">Despachado: ${esc(dateTime(dispatch.dispatched_at))}</div>`:''}<div class="sales-supply-actions"><button type="button" class="btn" data-supply-action="open-tracking" data-shipment-id="${esc(shipment.id||row.shipment_id)}">Abrir contenedor</button>${!dispatch?`<button type="button" class="btn orange" data-supply-action="dispatch-direct" data-shipment-id="${esc(shipment.id||row.shipment_id)}">Marcar despachado</button><button type="button" class="btn" data-supply-action="unlink-direct" data-direct-id="${esc(row.id)}">Desvincular</button>`:''}</div></div>`;
  }

  function findItem(id){return (state.data?.items||[]).find(row=>row.id===id)||null;}
  function findPlan(id){for(const item of state.data?.items||[]){const plan=(item.supply_plans||[]).find(row=>row.id===id);if(plan)return {item,plan};}return null;}
  function findProcurement(id){for(const item of state.data?.items||[])for(const plan of item.supply_plans||[]){const allocation=(plan.procurement_allocations||[]).find(row=>row.id===id);if(allocation)return {item,plan,allocation};}return null;}

  function bindMainActions(){
    byId('salesSupplyBody')?.querySelectorAll('[data-supply-action]').forEach(button=>button.onclick=()=>runAction(button.dataset));
  }

  function runAction(data){
    const action=data.supplyAction;
    try{
      if(action==='new-plan')return editPlan(data.itemId,null);
      if(action==='quick-direct')return quickDirect(data.itemId);
      if(action==='edit-plan'){const found=findPlan(data.planId);return editPlan(data.itemId,found?.plan||null);}
      if(action==='delete-plan')return removePlan(data.planId);
      if(action==='prepare-load')return prepareLoad();
      if(action==='link-purchase'){const found=findPlan(data.planId);return editPurchase(found?.item,found?.plan,null);}
      if(action==='edit-purchase'){const found=findProcurement(data.procId);return editPurchase(found?.item,found?.plan,found?.allocation);}
      if(action==='unlink-purchase')return unlinkPurchase(data.procId);
      if(action==='open-po')return nav()?.openPurchase?.({purchaseOrderId:data.poId});
      if(action==='link-direct'){const found=findProcurement(data.procId);return linkDirect(found?.item,found?.allocation,null);}
      if(action==='new-direct'){const found=findProcurement(data.procId);return createDirect(found?.item,found?.allocation);}
      if(action==='open-tracking')return nav()?.openTracking?.({shipmentId:data.shipmentId});
      if(action==='dispatch-direct')return dispatchDirect(data.shipmentId);
      if(action==='unlink-direct')return unlinkDirect(data.directId);
    }catch(error){showMessage(safeSupplyMessage(error),false);}
  }

  function editPlan(itemId,plan){
    const item=findItem(itemId);if(!item)return;
    const isEdit=Boolean(plan),progress=item.supply_progress||{};
    const defaultQty=isEdit?plan.planned_quantity:progress.unplanned_quantity;
    const warehouseOptions=(state.data.warehouses||[]).map(row=>`<option value="${esc(row.id)}">${esc(row.code?row.code+' · ':'')}${esc(row.name)}</option>`).join('');
    openForm({title:isEdit?'Editar ruta':'Agregar ruta',subtitle:productTitle(item),html:`<div class="sales-supply-form"><div><label>Ruta *</label><select id="supplyMethod"><option value="inventory">Stock existente</option><option value="purchase_warehouse">Compra para almacén</option><option value="purchase_direct">Direct Ship</option></select></div><div id="supplyWarehouseWrap"><label>Almacén *</label><select id="supplyWarehouse"><option value="">Seleccionar</option>${warehouseOptions}</select></div><div><label>Cantidad de venta *</label><input id="supplyPlannedQty" type="number" min="0" step="any" value="${esc(defaultQty??'')}"></div><div><label>Pallets</label><input id="supplyPlannedPallets" type="number" min="0" step="any" value="${esc(isEdit?plan.planned_pallets:'0')}"></div><div class="full"><label>Nota</label><textarea id="supplyPlanNotes">${esc(plan?.notes||'')}</textarea><div class="sales-supply-helper">Direct Ship no crea WR ni inventario. Stock y compra para almacén sí requieren un almacén real.</div></div></div>`,onOpen:()=>{byId('supplyMethod').value=plan?.supply_method||'inventory';byId('supplyWarehouse').value=plan?.warehouse_id||'';const toggle=()=>byId('supplyWarehouseWrap').classList.toggle('sales-supply-field-hidden',byId('supplyMethod').value==='purchase_direct');byId('supplyMethod').onchange=toggle;toggle();},onSave:async()=>{const method=byId('supplyMethod').value,payload={action:isEdit?'update_plan':'create_plan',planned_quantity:byId('supplyPlannedQty').value,planned_pallets:byId('supplyPlannedPallets').value||0,notes:byId('supplyPlanNotes').value,supply_method:method,warehouse_id:method==='purchase_direct'?null:byId('supplyWarehouse').value};if(isEdit)payload.plan_id=plan.id;else payload.sales_order_item_id=item.id;await request('/api/sales-supply',{method:'POST',body:JSON.stringify(payload)});}});
  }

  function removePlan(planId){askAction({title:'Eliminar ruta',message:'Se eliminará esta ruta de abastecimiento. Si tiene una compra vinculada, primero debes desvincularla.',acceptLabel:'Eliminar',onAccept:()=>request('/api/sales-supply',{method:'POST',body:JSON.stringify({action:'delete_plan',plan_id:planId})})});}

  function quickDirect(itemId){
    const item=findItem(itemId);if(!item)return;
    const progress=item.supply_progress||{},available=(state.data.purchase_options||[]).filter(row=>row.product_id===item.product_id&&row.purchase_order?.status==='confirmed'&&row.compatible_methods?.includes('purchase_direct'));
    const options=available.map(row=>`<option value="${esc(row.id)}">${esc(row.purchase_order?.po_number||'PO')} · ${esc(row.purchase_order?.supplier?.name||row.purchase_order?.supplier?.legal_name||'Proveedor')} · ${fmt(row.ordered_quantity)} ${esc(row.unit)}</option>`).join('');
    openForm({title:'Paso 1 de 2 · Elegir compra',subtitle:`${productTitle(item)} · Direct Ship`,saveLabel:'Usar esta compra',html:`<div class="sales-supply-form"><div class="full"><label>Compra que enviará el proveedor *</label><select id="quickDirectPo"><option value="">Seleccionar compra</option>${options}</select></div><div><label>Cantidad de venta *</label><input id="quickDirectSalesQty" type="number" min="0" step="any" value="${esc(progress.unplanned_quantity||'')}"><div class="sales-supply-helper">${esc(item.unit)}</div></div><div><label>Pallets de venta</label><input id="quickDirectSalesPallets" type="number" min="0" step="any" value="${esc(progress.unplanned_pallets||0)}"></div><div><label>Cantidad de compra *</label><input id="quickDirectPurchaseQty" type="number" min="0" step="any" value="${esc(progress.unplanned_quantity||'')}"><div id="quickDirectPurchaseUnit" class="sales-supply-helper">Selecciona la compra.</div></div><div><label>Pallets de compra</label><input id="quickDirectPurchasePallets" type="number" min="0" step="any" value="${esc(progress.unplanned_pallets||0)}"></div><div class="full"><label>Nota</label><textarea id="quickDirectNotes"></textarea><div class="sales-supply-helper">Después verás el paso 2: registrar un contenedor nuevo o usar uno existente.</div></div></div>`,onOpen:()=>{const select=byId('quickDirectPo'),sync=()=>{const selected=available.find(row=>row.id===select.value);byId('quickDirectPurchaseUnit').textContent=selected?`Unidad de compra: ${selected.unit}.`:'Selecciona la compra.';if(selected&&!byId('quickDirectPurchaseQty').value)byId('quickDirectPurchaseQty').value=selected.ordered_quantity||'';};select.onchange=sync;sync();},onSave:()=>request('/api/sales-supply',{method:'POST',body:JSON.stringify({action:'quick_direct',sales_order_item_id:item.id,purchase_order_item_id:byId('quickDirectPo').value,allocated_sales_quantity:byId('quickDirectSalesQty').value,allocated_sales_pallets:byId('quickDirectSalesPallets').value||0,allocated_purchase_quantity:byId('quickDirectPurchaseQty').value,allocated_purchase_pallets:byId('quickDirectPurchasePallets').value||0,notes:byId('quickDirectNotes').value})})});
  }

  function editPurchase(item,plan,allocation){
    if(!item||!plan)return;
    const isEdit=Boolean(allocation),options=(state.data.purchase_options||[]).filter(row=>row.product_id===item.product_id&&row.compatible_methods?.includes(plan.supply_method)&&!(plan.supply_method==='purchase_warehouse'&&row.purchase_order?.warehouse_id&&row.purchase_order.warehouse_id!==plan.warehouse_id));
    const optionsHtml=options.map(row=>`<option value="${esc(row.id)}">${esc(row.purchase_order?.po_number||'PO')} · ${esc(row.purchase_order?.supplier?.name||row.purchase_order?.supplier?.legal_name||'Proveedor')} · ${fmt(row.ordered_quantity)} ${esc(row.unit)} · ${esc(orderStatus(row.purchase_order?.status))}</option>`).join('');
    openForm({title:isEdit?'Editar vínculo de compra':'Vincular Purchase Order',subtitle:`${productTitle(item)} · ${methodLabel(plan.supply_method)}`,html:`<div class="sales-supply-form"><div class="full"><label>Línea de PO *</label><select id="supplyPoItem" ${isEdit?'disabled':''}><option value="">Seleccionar PO</option>${optionsHtml}</select></div><div><label>Cantidad aplicada a la venta *</label><input id="supplySalesQty" type="number" min="0" step="any" value="${esc(allocation?.allocated_sales_quantity||'')}"><div class="sales-supply-helper">Unidad de venta: ${esc(item.unit)}</div></div><div><label>Pallets de venta</label><input id="supplySalesPallets" type="number" min="0" step="any" value="${esc(allocation?.allocated_sales_pallets||'0')}"></div><div><label>Cantidad aplicada de la compra *</label><input id="supplyPurchaseQty" type="number" min="0" step="any" value="${esc(allocation?.allocated_purchase_quantity||'')}"><div id="supplyPurchaseUnit" class="sales-supply-helper">La cantidad de compra es explícita; no se aplica conversión automática.</div></div><div><label>Pallets de compra</label><input id="supplyPurchasePallets" type="number" min="0" step="any" value="${esc(allocation?.allocated_purchase_pallets||'0')}"></div><div class="full"><label>Nota</label><textarea id="supplyPurchaseNotes">${esc(allocation?.notes||'')}</textarea></div></div>`,onOpen:()=>{if(isEdit)byId('supplyPoItem').value=allocation.purchase_order_item_id;const updateUnit=()=>{const selected=options.find(row=>row.id===byId('supplyPoItem').value);byId('supplyPurchaseUnit').textContent=selected?`Unidad de compra: ${selected.unit}. No se aplica conversión automática.`:'La cantidad de compra es explícita; no se aplica conversión automática.';};byId('supplyPoItem').onchange=updateUnit;updateUnit();},onSave:async()=>{const payload={action:isEdit?'update_purchase_link':'link_purchase',allocated_sales_quantity:byId('supplySalesQty').value,allocated_sales_pallets:byId('supplySalesPallets').value||0,allocated_purchase_quantity:byId('supplyPurchaseQty').value,allocated_purchase_pallets:byId('supplyPurchasePallets').value||0,notes:byId('supplyPurchaseNotes').value};if(isEdit)payload.procurement_allocation_id=allocation.id;else{payload.supply_plan_line_id=plan.id;payload.purchase_order_item_id=byId('supplyPoItem').value;}await request('/api/sales-supply',{method:'POST',body:JSON.stringify(payload)});}});
  }

  function unlinkPurchase(procurementId){askAction({title:'Desvincular Purchase Order',message:'Se quitará la relación entre esta venta y la línea de compra. Un contenedor Direct Ship vinculado debe retirarse primero.',acceptLabel:'Desvincular',onAccept:()=>request('/api/sales-supply',{method:'POST',body:JSON.stringify({action:'unlink_purchase',procurement_allocation_id:procurementId})})});}

  function linkDirect(item,allocation,preselectedShipmentId){
    if(!item||!allocation)return;
    const options=(state.data.direct_shipment_options||[]).map(row=>`<option value="${esc(row.id)}">${esc(row.container_number)} · ${esc(row.carrier||'Naviera pendiente')} · ${esc(row.operational_status||'Registrado')}</option>`).join('');
    openForm({title:'Paso 2 de 2 · Usar contenedor existente',subtitle:productTitle(item),saveLabel:'Usar este contenedor',html:`<div class="sales-supply-form"><div class="full"><label>Contenedor *</label><select id="supplyDirectShipment"><option value="">Seleccionar</option>${options}</select></div><div><label>Cantidad de venta *</label><input id="supplyDirectSalesQty" type="number" min="0" step="any"><div class="sales-supply-helper">${esc(item.unit)}</div></div><div><label>Pallets de venta</label><input id="supplyDirectSalesPallets" type="number" min="0" step="any" value="0"></div><div><label>Cantidad de compra *</label><input id="supplyDirectPurchaseQty" type="number" min="0" step="any"><div class="sales-supply-helper">${esc(allocation.purchase_order_item?.unit||'Unidad de compra')}; sin conversión automática.</div></div><div><label>Pallets de compra</label><input id="supplyDirectPurchasePallets" type="number" min="0" step="any" value="0"></div><div class="full"><label>Nota</label><textarea id="supplyDirectNotes"></textarea></div></div>`,onOpen:()=>{if(preselectedShipmentId)byId('supplyDirectShipment').value=preselectedShipmentId;},onSave:()=>request('/api/sales-supply',{method:'POST',body:JSON.stringify({action:'link_direct_shipment',procurement_allocation_id:allocation.id,shipment_id:byId('supplyDirectShipment').value,allocated_sales_quantity:byId('supplyDirectSalesQty').value,allocated_sales_pallets:byId('supplyDirectSalesPallets').value||0,allocated_purchase_quantity:byId('supplyDirectPurchaseQty').value,allocated_purchase_pallets:byId('supplyDirectPurchasePallets').value||0,notes:byId('supplyDirectNotes').value})})});
  }

  function createDirect(item,allocation){
    if(!item||!allocation)return;
    openForm({
      title:'Paso 2 de 2 · Registrar contenedor nuevo',
      subtitle:'Se crea en Tracking y queda vinculado automáticamente a esta compra y venta.',
      saveLabel:'Registrar y usar',
      html:`<div class="sales-supply-form"><div><label>Contenedor / referencia *</label><input id="supplyNewContainer" maxlength="40"></div><div><label>Naviera</label><input id="supplyNewCarrier"></div><div><label>Booking</label><input id="supplyNewBooking"></div><div><label>B/L</label><input id="supplyNewBol"></div><div><label>Fecha de salida planificada</label><input id="supplyNewDeparture" type="date"></div><div class="full sales-supply-helper">Al guardar aparecerá directamente en Tracking. El despacho real seguirá siendo una acción separada.</div></div>`,
      onSave:async()=>{
        const rows=allocation.direct_shipments||[];
        const salesUsed=rows.reduce((sum,row)=>sum+Number(row.allocated_sales_quantity||0),0);
        const salesPalletsUsed=rows.reduce((sum,row)=>sum+Number(row.allocated_sales_pallets||0),0);
        const purchaseUsed=rows.reduce((sum,row)=>sum+Number(row.allocated_purchase_quantity||0),0);
        const purchasePalletsUsed=rows.reduce((sum,row)=>sum+Number(row.allocated_purchase_pallets||0),0);
        const remainingSales=Number(allocation.allocated_sales_quantity||0)-salesUsed;
        const remainingPurchase=Number(allocation.allocated_purchase_quantity||0)-purchaseUsed;
        if(remainingSales<=0||remainingPurchase<=0)throw new Error('No queda mercancía pendiente para asignar a otro contenedor.');
        const result=await request('/api/direct-shipment-dispatch',{method:'POST',body:JSON.stringify({action:'create',sales_order_id:state.salesOrderId,container_number:byId('supplyNewContainer').value,carrier:byId('supplyNewCarrier').value,booking_number:byId('supplyNewBooking').value,bol_number:byId('supplyNewBol').value,departure_date:byId('supplyNewDeparture').value})});
        await request('/api/sales-supply',{method:'POST',body:JSON.stringify({
          action:'link_direct_shipment',procurement_allocation_id:allocation.id,shipment_id:result.shipment?.id,
          allocated_sales_quantity:remainingSales,
          allocated_sales_pallets:Math.max(0,Number(allocation.allocated_sales_pallets||0)-salesPalletsUsed),
          allocated_purchase_quantity:remainingPurchase,
          allocated_purchase_pallets:Math.max(0,Number(allocation.allocated_purchase_pallets||0)-purchasePalletsUsed),
          notes:'Vinculado al registrar el contenedor Direct Ship.'
        })});
      }
    });
  }

  function dispatchDirect(shipmentId){
    openForm({title:'Marcar Direct Ship como despachado',subtitle:'Este evento cuenta como despacho físico para cumplimiento de la venta y bloquea el contenido del contenedor.',saveLabel:'Registrar despacho',html:`<div class="sales-supply-form"><div><label>Fecha y hora real *</label><input id="supplyDispatchAt" type="datetime-local" value="${esc(localDateTime())}"></div><div class="full"><label>Nota</label><textarea id="supplyDispatchNotes"></textarea><div class="sales-supply-helper">No uses esta acción para una fecha estimada. Después del despacho, las cantidades del contenedor quedan inmutables.</div></div></div>`,onSave:()=>request('/api/direct-shipment-dispatch',{method:'POST',body:JSON.stringify({action:'dispatch',shipment_id:shipmentId,dispatched_at:byId('supplyDispatchAt').value,notes:byId('supplyDispatchNotes').value})})});
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

  async function augmentNativeTab(tab){
    if(!state.salesOrderId)return;
    try{await fetchSupply();}catch(error){safeSupplyMessage(error,'No se pudo actualizar Abastecimiento. Intenta nuevamente.');return;}
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
    content.appendChild(host);
  }

  function updateHeaderButton(){const button=byId('openSupplyWorkspace');if(!button)return;button.classList.toggle('hidden',!state.salesOrderId);button.onclick=()=>open(state.salesOrderId);}

  if(nativeWorkspace){
    window.SalesWorkspace=Object.freeze({...nativeWorkspace,
      open:async salesOrderId=>{state.salesOrderId=String(salesOrderId||'')||null;const result=await nativeWorkspace.open(salesOrderId);updateHeaderButton();return result;},
      reload:async options=>{const result=await nativeWorkspace.reload(options);updateHeaderButton();return result;},
      openSupply:open,
      owner:'sales-supply-workspace.js'
    });
  }

  document.addEventListener('click',event=>{
    const track=event.target.closest('[data-supply-track]');if(track){nav()?.openTracking?.({shipmentId:track.dataset.supplyTrack});return;}
    if(event.target.closest('[data-supply-open-main]')){open(state.salesOrderId);return;}
    const tab=event.target.closest('#detailBody [data-ws-tab]');if(tab&&['logistics','documents'].includes(tab.dataset.wsTab)){queueMicrotask(()=>augmentNativeTab(tab.dataset.wsTab).catch(error=>{safeSupplyMessage(error,'No se pudo actualizar Abastecimiento. Intenta nuevamente.');}));}
  });

  updateHeaderButton();
  window.SalesSupplyWorkspace=Object.freeze({open,refresh:refreshAll,owner:'sales-supply-workspace.js'});
})();
