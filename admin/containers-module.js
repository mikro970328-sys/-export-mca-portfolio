(() => {
  if (window.__containersModuleInstalled) return;
  window.__containersModuleInstalled = true;

  const byId=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const EVENTS=[
    {key:'load',label:'Cargado en el buque',whatsapp:false},
    {key:'departed',label:'Salió del puerto',whatsapp:true},
    {key:'arrived',label:'Llegó al puerto',whatsapp:false},
    {key:'discharged',label:'Descargado del buque',whatsapp:false},
    {key:'released',label:'Liberado',whatsapp:true},
    {key:'delivered',label:'Entregado',whatsapp:false}
  ];
  const CUSTOMS_TYPES=[
    {key:'packing_list_cuba',type:'Packing List Cuba',label:'Packing List Cuba'},
    {key:'commercial_invoice_cuba',type:'Commercial Invoice Cuba',label:'Factura comercial Cuba'}
  ];
  const SAFE_CONTAINER_ERROR_PATTERNS=[
    /^No tienes permiso/i,
    /^No autorizado$/i,
    /^El contenedor debe/i,
    /^Ya existe/i,
    /^Selecciona/i,
    /^Indica/i,
    /^Solo puede/i,
    /^Esta acción ya no/i
  ];

  let activeFilter='active';
  let menuShipmentId=null;
  let menuTrigger=null;
  let importerState={importers:[],client_importers:[],shipment_importers:[]};
  let readinessByShipment=new Map();
  let manualCleanup=null;

  async function request(path,options={}){
    const token=localStorage.getItem('export_mca_token')||'';
    const response=await fetch(path,{
      ...options,
      headers:{
        'Content-Type':'application/json',
        ...(token?{Authorization:`Bearer ${token}`} : {}),
        ...(options.headers||{})
      }
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||data.details||'Error');
    return data;
  }

  function rows(){return Array.isArray(window.shipments)?window.shipments:[];}
  function clientRows(){return Array.isArray(window.clients)?window.clients:[];}
  function capability(shipment,key){return shipment?.capabilities?.actions?.[key]||null;}
  function actionAllowed(shipment,key){return capability(shipment,key)?.allowed===true;}
  function readinessFor(id){return readinessByShipment.get(String(id))||null;}
  function shipmentWriteAccess(){return window.shipmentWriteAccess===true;}

  async function loadReadiness(){
    try{
      const result=await request('/api/shipment-document-readiness');
      readinessByShipment=new Map((Array.isArray(result.readiness)?result.readiness:[]).map(row=>[String(row.shipment_id),row]));
    }catch(error){
      if(String(error?.message||'').toLowerCase().includes('permiso'))readinessByShipment=new Map();
      else console.error('[container readiness]',error);
    }
  }

  async function loadImporterState(){
    try{
      const result=await request('/api/importers');
      importerState={
        importers:result.importers||[],
        client_importers:result.client_importers||[],
        shipment_importers:result.shipment_importers||[]
      };
      window.importerState=importerState;
    }catch(error){
      console.error('[containers importers]',error);
    }
  }

  function importerById(id){return importerState.importers.find(item=>String(item.id)===String(id||''))||null;}
  function importerIdForShipment(id){return importerState.shipment_importers.find(item=>String(item.shipment_id)===String(id||''))?.importer_id||null;}
  function importerForShipment(shipment){return importerById(importerIdForShipment(shipment?.id));}
  function importerSuggestions(){return importerState.importers.filter(item=>item.active!==false).map(item=>`<option value="${esc(item.name)}"></option>`).join('');}

  function clientOptions(selected=''){
    return `<option value="">Sin cliente / Disponible para venta</option>${clientRows().map(client=>`<option value="${esc(client.id)}" ${String(client.id)===String(selected)?'selected':''}>${esc(client.name)}${client.company?' · '+esc(client.company):''}</option>`).join('')}`;
  }

  function syncClientSelect(){
    const select=byId('shipmentClient');
    if(!select)return;
    const value=select.value;
    select.innerHTML=clientOptions(value);
    if([...select.options].some(option=>option.value===value))select.value=value;
  }

  function syncImporterInput(){
    const list=byId('shipmentImporterOptions');
    if(list)list.innerHTML=importerSuggestions();
  }

  async function assignImporterToShipment(shipmentId,importerName){
    const result=await request('/api/importers',{
      method:'PATCH',
      body:JSON.stringify({action:'assign_shipment',shipment_id:shipmentId,importer_name:String(importerName||'').trim()})
    });
    if(result.state){
      importerState=result.state;
      window.importerState=importerState;
    }else{
      await loadImporterState();
    }
  }

  function note(message,ok=false){
    const target=byId('shipmentMsg');
    if(!target)return;
    target.textContent=message;
    target.className=`tracking-feedback ${ok?'ok':'bad'}`;
  }

  function safeContainerMessage(error,fallback='No se pudo completar la acción. Intenta nuevamente.'){
    const message=String(error?.message||'').trim();
    return SAFE_CONTAINER_ERROR_PATTERNS.some(pattern=>pattern.test(message))?message:fallback;
  }

  function showToast(message,ok=false){
    document.querySelector('.container-toast')?.remove();
    const node=document.createElement('div');
    node.className=`container-toast ${ok?'ok':'bad'}`;
    node.textContent=message;
    node.setAttribute('role','status');
    node.setAttribute('aria-live','polite');
    document.body.appendChild(node);
    setTimeout(()=>node.remove(),5000);
  }

  function decision({title,text,button='Confirmar',danger=false,typed=null}){
    return new Promise(resolve=>{
      document.querySelector('.container-overlay[data-decision]')?.remove();
      const previousFocus=document.activeElement;
      const overlay=document.createElement('div');
      overlay.className='container-overlay';
      overlay.dataset.decision='1';
      overlay.innerHTML=`<div class="container-dialog" role="alertdialog" aria-modal="true" aria-labelledby="containerDecisionTitle" aria-describedby="containerDecisionText"><h3 id="containerDecisionTitle">${esc(title)}</h3><p id="containerDecisionText">${esc(text)}</p>${typed?`<label class="container-dialog-label" for="containerDecisionInput">Escribe ${esc(typed)} para continuar</label><input id="containerDecisionInput" type="text" data-decision-text autocomplete="off">`:''}<div class="container-dialog-actions"><button type="button" class="alt" data-decision-no>Volver</button><button type="button" class="${danger?'danger':'orange'}" data-decision-yes>${esc(button)}</button></div></div>`;
      document.body.appendChild(overlay);

      const onKeydown=event=>{
        if(event.key==='Escape')finish(false);
      };
      const finish=value=>{
        document.removeEventListener('keydown',onKeydown);
        overlay.remove();
        previousFocus?.focus?.();
        resolve(value);
      };
      overlay.querySelector('[data-decision-no]').addEventListener('click',()=>finish(false));
      overlay.querySelector('[data-decision-yes]').addEventListener('click',()=>{
        const input=overlay.querySelector('[data-decision-text]');
        if(typed&&String(input?.value||'').trim()!==typed){
          input?.setAttribute('aria-invalid','true');
          input?.focus();
          return;
        }
        finish(true);
      });
      overlay.addEventListener('click',event=>{if(event.target===overlay)finish(false);});
      document.addEventListener('keydown',onKeydown);
      (overlay.querySelector('[data-decision-text]')||overlay.querySelector('[data-decision-no]'))?.focus();
    });
  }

  function formatDate(value){
    if(!value)return '—';
    const date=new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())?String(value):date.toLocaleDateString('es-US',{day:'2-digit',month:'short',year:'numeric'});
  }

  function formatDateTime(value){
    if(!value)return '—';
    const date=new Date(value);
    return Number.isNaN(date.getTime())?String(value):date.toLocaleString('es-US');
  }

  function formatQuantity(shipment){
    if(shipment.quantity===null||shipment.quantity===undefined||shipment.quantity==='')return '—';
    const number=Number(shipment.quantity);
    const value=Number.isFinite(number)?new Intl.NumberFormat('es-US',{maximumFractionDigits:3}).format(number):shipment.quantity;
    return `${value}${shipment.quantity_unit?' '+shipment.quantity_unit:''}`;
  }

  function statusText(shipment){return shipment.operational_status||shipment.last_status||'Registrado';}
  function statusClass(shipment){return shipment.active===false?'done':'';}

  function docPill(readiness){
    if(!readiness||readiness.document_status==='not_required')return '<span class="container-doc-state idle">Aún no requerido</span>';
    if(readiness.document_status==='ready')return '<span class="container-doc-state ready">READY</span>';
    const count=Array.isArray(readiness.missing_documents)?readiness.missing_documents.length:2;
    return `<span class="container-doc-state pending">Faltan ${count}</span>`;
  }

  function searchable(shipment){
    return [
      shipment.container_number,
      shipment.booking_number,
      shipment.bol_number,
      shipment.carrier,
      shipment.product,
      shipment.quantity,
      shipment.quantity_unit,
      shipment.departure_date,
      shipment.operational_status,
      shipment.last_status,
      shipment.clients?.name,
      shipment.clients?.company,
      importerForShipment(shipment)?.name
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function filteredRows(){
    const query=String(byId('shipmentSearch')?.value||'').trim().toLowerCase();
    let list=activeFilter==='active'
      ?rows().filter(shipment=>shipment.active!==false)
      :activeFilter==='delivered'
        ?rows().filter(shipment=>shipment.active===false)
        :[...rows()];
    if(query)list=list.filter(shipment=>searchable(shipment).includes(query));
    return list;
  }

  function emptyListMessage(){
    if(String(byId('shipmentSearch')?.value||'').trim())return 'No hay contenedores que coincidan con la búsqueda.';
    if(activeFilter==='delivered')return 'Todavía no hay contenedores entregados.';
    if(activeFilter==='active')return 'No hay contenedores activos en este momento.';
    return 'No hay contenedores registrados.';
  }

  function renderMetrics(){
    const all=rows();
    const visibleDocuments=all.filter(shipment=>actionAllowed(shipment,'view_documents'));
    const values={
      trackingTotalCount:all.length,
      trackingActiveCount:all.filter(shipment=>shipment.active!==false).length,
      trackingDeliveredCount:all.filter(shipment=>shipment.active===false).length,
      trackingUnassignedCount:all.filter(shipment=>!shipment.client_id).length,
      trackingDocumentsReadyCount:visibleDocuments.filter(shipment=>readinessFor(shipment.id)?.document_status==='ready').length
    };
    Object.entries(values).forEach(([id,value])=>{if(byId(id))byId(id).textContent=String(value);});
    const updated=byId('trackingLastUpdated');
    if(updated)updated.textContent=`Actualizado ${new Date().toLocaleTimeString('es-US',{hour:'numeric',minute:'2-digit'})}`;
  }

  function clientHtml(shipment){
    if(!shipment.client_id)return '<span class="container-client-unassigned">SIN CLIENTE</span><span class="container-sale-note">Disponible para venta</span>';
    return esc(shipment.clients?.name||'Cliente no disponible');
  }

  function importerHtml(shipment){
    const importer=importerForShipment(shipment);
    return importer?`<span class="container-importer-pill">${esc(importer.name)}</span>`:'<span class="muted">Sin definir</span>';
  }

  function documentsHtml(shipment){
    return actionAllowed(shipment,'view_documents')?docPill(readinessFor(shipment.id)):'<span class="container-doc-state restricted">Sin acceso</span>';
  }

  function actionButton(shipment){
    return `<button type="button" class="container-actions-trigger" data-container-menu="${esc(shipment.id)}" aria-label="Acciones de ${esc(shipment.container_number)}" aria-haspopup="dialog" aria-expanded="false">⋯</button>`;
  }

  function tableRow(shipment){
    const canOpen=actionAllowed(shipment,'view_info')||actionAllowed(shipment,'view_documents');
    return `<tr class="${!shipment.client_id?'container-unassigned-row':''}" data-shipment-row="${esc(shipment.id)}" ${canOpen?'tabindex="0"':''}><td><span class="container-reference">${esc(shipment.container_number)}</span><span class="container-reference-meta">${esc(shipment.carrier||'Naviera sin definir')}</span></td><td>${clientHtml(shipment)}</td><td>${importerHtml(shipment)}</td><td>${esc(shipment.product||'—')}</td><td>${esc(formatQuantity(shipment))}</td><td>${esc(formatDate(shipment.departure_date))}</td><td>${esc(shipment.booking_number||'—')}<span class="container-reference-meta">B/L ${esc(shipment.bol_number||'—')}</span></td><td>${documentsHtml(shipment)}</td><td><span class="container-status ${statusClass(shipment)}">${esc(statusText(shipment))}</span><span class="container-mode">Seguimiento ERP</span></td><td class="container-actions-cell">${actionButton(shipment)}</td></tr>`;
  }

  function mobileCard(shipment){
    const canOpen=actionAllowed(shipment,'view_info')||actionAllowed(shipment,'view_documents');
    return `<article class="tracking-card ${!shipment.client_id?'unassigned':''}" data-shipment-row="${esc(shipment.id)}" ${canOpen?'tabindex="0" role="button"':''}><header class="tracking-card-head"><div><span class="container-reference">${esc(shipment.container_number)}</span><span class="container-reference-meta">${esc(shipment.carrier||'Naviera sin definir')}</span></div>${actionButton(shipment)}</header><div class="tracking-card-status"><span class="container-status ${statusClass(shipment)}">${esc(statusText(shipment))}</span>${documentsHtml(shipment)}</div><div class="tracking-card-grid"><div class="tracking-card-field"><span>Cliente</span><strong>${clientHtml(shipment)}</strong></div><div class="tracking-card-field"><span>Importadora</span><strong>${importerHtml(shipment)}</strong></div><div class="tracking-card-field"><span>Producto</span><strong>${esc(shipment.product||'—')}</strong></div><div class="tracking-card-field"><span>Cantidad</span><strong>${esc(formatQuantity(shipment))}</strong></div><div class="tracking-card-field"><span>Salida</span><strong>${esc(formatDate(shipment.departure_date))}</strong></div><div class="tracking-card-field"><span>Booking / B/L</span><strong>${esc(shipment.booking_number||'—')} · ${esc(shipment.bol_number||'—')}</strong></div></div><footer class="tracking-card-footer"><span class="container-mode">Seguimiento ERP</span><span class="container-reference-meta">Abrir información</span></footer></article>`;
  }

  function render(){
    const target=byId('shipments');
    if(!target)return;
    closeActionMenu(false);
    const register=byId('registerContainerSection');
    if(register)register.hidden=!shipmentWriteAccess();
    const shortcut=byId('trackingRegisterShortcut');
    if(shortcut)shortcut.hidden=!shipmentWriteAccess();
    renderMetrics();

    const list=filteredRows();
    const resultCount=byId('trackingResultCount');
    if(resultCount)resultCount.textContent=`${list.length} contenedor${list.length===1?'':'es'}`;
    if(!list.length){
      target.innerHTML=`<div class="tracking-empty">${esc(emptyListMessage())}</div><div class="container-list-footer">0 contenedores</div>`;
      return;
    }

    target.innerHTML=`<div class="tracking-table-wrap"><table class="tracking-table"><thead><tr><th>Contenedor</th><th>Cliente</th><th>Importadora</th><th>Producto</th><th>Cantidad</th><th>Fecha salida</th><th>Booking / B/L</th><th>Docs Cuba</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${list.map(tableRow).join('')}</tbody></table></div><div class="tracking-mobile-list">${list.map(mobileCard).join('')}</div><div class="container-list-footer">${list.length} contenedor${list.length===1?'':'es'}${list.length!==rows().length?` visibles · ${rows().length} registrados`:''}</div>`;
  }

  function syncContainerGuidance(){
    const input=byId('shipmentContainer');
    const help=byId('registrationContainerHelp');
    const readiness=byId('registrationReadiness');
    if(!input||!help||!readiness)return;

    const value=norm(input.value).slice(0,11);
    if(input.value!==value)input.value=value;
    const valid=/^[A-Z]{4}\d{7}$/.test(value);
    const empty=!value;
    help.className=`registration-container-help${empty?'':valid?' valid':' invalid'}`;
    help.textContent=empty
      ?'Formato requerido: 4 letras + 7 números. Ejemplo: ABCD1234567.'
      :valid
        ?'Número de contenedor con formato correcto.'
        :'Completa 4 letras seguidas de 7 números.';
    readiness.classList.toggle('ready',valid);
    readiness.classList.toggle('invalid',!empty&&!valid);
    const text=readiness.querySelector('span:last-child');
    if(text)text.textContent=valid?'Datos mínimos listos para guardar':'Completa el número de contenedor para continuar';
  }

  function resetRegistrationForm(clearMessage=true){
    const form=byId('shipmentRegistrationForm');
    form?.reset?.();
    if(clearMessage){
      const target=byId('shipmentMsg');
      if(target){target.textContent='';target.className='tracking-feedback';}
    }
    syncContainerGuidance();
    syncClientSelect();
    syncImporterInput();
    byId('shipmentContainer')?.focus?.();
  }

  async function saveShipmentRecord(){
    if(!shipmentWriteAccess())return note('No tienes permiso para registrar contenedores.');
    const button=byId('saveShipment');
    if(!button||button.disabled)return;
    const containerNumber=norm(byId('shipmentContainer')?.value||'');
    if(!/^[A-Z]{4}\d{7}$/.test(containerNumber))return note('El contenedor debe tener 4 letras y 7 números.');
    const quantityText=String(byId('shipmentQuantity')?.value||'').trim();
    if(quantityText&&(!Number.isFinite(Number(quantityText))||Number(quantityText)<0))return note('La cantidad no es válida.');

    const clientId=byId('shipmentClient')?.value||null;
    const importerName=String(byId('shipmentImporter')?.value||'').trim();
    const original=button.textContent;
    button.disabled=true;
    button.textContent='Guardando...';
    let rollbackId=null;
    try{
      const result=await request('/api/shipments',{
        method:'POST',
        body:JSON.stringify({
          client_id:clientId,
          container_number:containerNumber,
          booking_number:byId('shipmentBooking')?.value||'',
          bol_number:byId('shipmentBol')?.value||'',
          carrier:byId('shipmentCarrier')?.value||'',
          product:byId('shipmentProduct')?.value||'',
          quantity:quantityText||null,
          quantity_unit:byId('shipmentQuantityUnit')?.value||'',
          departure_date:byId('shipmentDepartureDate')?.value||null
        })
      });
      rollbackId=result.shipment?.id||null;
      if(rollbackId&&importerName){
        try{
          await assignImporterToShipment(rollbackId,importerName);
        }catch(error){
          try{await request('/api/shipments?id='+encodeURIComponent(rollbackId),{method:'DELETE'});}catch{}
          rollbackId=null;
          throw error;
        }
      }
      rollbackId=null;
      const success=result.shipment?.client_id
        ?'Contenedor registrado correctamente.'
        :'Contenedor registrado sin cliente y disponible para venta.';
      resetRegistrationForm(false);
      note(success,true);
      await window.loadAll?.();
      await loadImporterState();
      await loadReadiness();
      syncImporterInput();
      render();
    }catch(error){
      console.error('CONTAINER_CREATE_FAILED',error);
      note(safeContainerMessage(error,'No se pudo registrar el contenedor. Revisa los datos e intenta nuevamente.'));
    }finally{
      button.disabled=false;
      button.textContent=original;
    }
  }

  function findShipment(id){return rows().find(shipment=>String(shipment.id)===String(id));}

  function actionList(shipment){
    const defs=[
      ['view_info','info','Información',''],
      ['view_documents','documents','Documentos Cuba',''],
      ['edit','edit','Editar',''],
      ['view_history','history','Historial',''],
      ['assign_client','assign_client','Asignar cliente','orange'],
      ['manual_tracking','manual_update','Actualizar / corregir estado',''],
      ['release','release','Liberar','orange'],
      ['deliver','deliver','Entregado','success'],
      ['reactivate','reactivate','Reactivar','success'],
      ['delete','delete','Eliminar','danger']
    ];
    return defs.filter(([cap])=>actionAllowed(shipment,cap)).map(([,key,label,cls])=>[key,label,cls]);
  }

  function ensureMenu(){
    let menu=byId('containerActionsPopover');
    if(menu)return menu;
    menu=document.createElement('div');
    menu.id='containerActionsPopover';
    menu.className='container-actions-popover hidden';
    menu.setAttribute('role','dialog');
    menu.setAttribute('aria-modal','false');
    menu.setAttribute('aria-hidden','true');
    document.body.appendChild(menu);
    document.addEventListener('click',event=>{
      if(!menu.classList.contains('hidden')&&!menu.contains(event.target)&&!menuTrigger?.contains(event.target))closeActionMenu();
    });
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!menu.classList.contains('hidden'))closeActionMenu();
    });
    return menu;
  }

  function closeActionMenu(restoreFocus=true){
    const menu=byId('containerActionsPopover');
    menu?.classList.add('hidden');
    menu?.setAttribute('aria-hidden','true');
    if(menu)menu.innerHTML='';
    if(menuTrigger){
      menuTrigger.setAttribute('aria-expanded','false');
      if(restoreFocus)menuTrigger.focus?.();
    }
    menuShipmentId=null;
    menuTrigger=null;
  }

  function openActionMenu(shipment,trigger){
    const menu=ensureMenu();
    if(menuShipmentId===shipment.id&&!menu.classList.contains('hidden'))return closeActionMenu();
    closeActionMenu(false);
    menuShipmentId=shipment.id;
    menuTrigger=trigger;
    const actions=actionList(shipment);
    const actionMarkup=actions.length
      ?actions.map(([key,label,cls],index)=>`${key==='delete'&&index?'<div class="container-actions-separator"></div>':''}<button type="button" class="${cls}" data-container-action="${key}">${esc(label)}</button>`).join('')
      :'<div class="container-actions-empty">Sin acciones disponibles.</div>';
    menu.innerHTML=`<header class="container-actions-head"><div><strong>${esc(shipment.container_number)}</strong><small>Acciones autorizadas</small></div><button class="container-actions-close" type="button" aria-label="Cerrar acciones">×</button></header><div class="container-actions-list" role="menu">${actionMarkup}</div>`;
    menu.classList.remove('hidden');
    menu.setAttribute('aria-hidden','false');
    trigger.setAttribute('aria-expanded','true');
    menu.querySelector('.container-actions-close')?.addEventListener('click',()=>closeActionMenu());
    menu.querySelectorAll('[data-container-action]').forEach(button=>button.addEventListener('click',async event=>{
      event.stopPropagation();
      const action=button.dataset.containerAction;
      closeActionMenu(false);
      try{
        await executeAction(shipment,action);
      }catch(error){
        console.error('CONTAINER_ACTION_FAILED',{action,shipment_id:shipment.id,error});
        showToast(safeContainerMessage(error),false);
      }
    }));
    (menu.querySelector('[data-container-action]')||menu.querySelector('.container-actions-close'))?.focus();
  }

  function detailRow(label,value){
    return `<div class="container-detail-row"><div class="container-detail-label">${esc(label)}</div><div class="container-detail-value">${esc(value||'No disponible')}</div></div>`;
  }

  function latestDocument(documents,type){return documents.find(item=>item.document_type===type&&item.is_current)||null;}
  function versionsForType(documents,type){return documents.filter(item=>item.document_type===type).sort((a,b)=>Number(b.version||0)-Number(a.version||0));}
  function versionStateLabel(item){if(item.state==='deleted')return 'Eliminada';if(item.state==='superseded')return 'Sustituida';return 'Vigente';}

  function documentStatusText(readiness){
    if(!readiness||readiness.document_status==='not_required')return 'Todavía no es obligatorio. Puedes adelantar los documentos antes de la salida.';
    if(readiness.document_status==='ready')return 'READY · El contenedor tiene los dos documentos oficiales vigentes de Cuba.';
    const missing=(readiness.missing_documents||[]).map(item=>item==='Commercial Invoice Cuba'?'Factura comercial Cuba':item);
    return `Pendiente · Falta ${missing.join(' y ')}.`;
  }

  function versionHistoryHtml(items){
    const historical=items.filter(item=>!item.is_current);
    if(!historical.length)return '';
    return `<div class="container-customs-versions"><div class="container-customs-versions-title">Versiones anteriores</div><div class="container-customs-version-list">${historical.map(item=>`<div class="container-customs-version"><div class="container-customs-version-main"><b>v${esc(item.version||1)} · ${esc(item.file_name)}</b><small>${esc(formatDateTime(item.created_at))}${item.uploaded_by_username?` · ${esc(item.uploaded_by_username)}`:''}</small></div><div class="container-customs-version-actions"><span class="container-customs-version-state ${esc(item.state||'superseded')}">${esc(versionStateLabel(item))}</span>${item.signed_url?`<button class="alt" type="button" data-customs-open="${esc(item.id)}">Ver</button>`:''}</div></div>`).join('')}</div></div>`;
  }

  function customsHtml(shipment,payload,error=''){
    if(!actionAllowed(shipment,'view_documents'))return '<section class="container-customs"><div class="container-customs-head"><div><h3>Documentos Cuba</h3><div class="container-customs-summary">No tienes permiso para consultar documentos del contenedor.</div></div></div><div class="container-customs-noaccess">Solicita acceso a Documentos para consultar readiness, archivos y versiones.</div></section>';
    if(error)return `<section class="container-customs"><div class="container-customs-head"><div><h3>Documentos Cuba</h3><div class="container-customs-summary">${esc(error)}</div></div></div></section>`;
    const readiness=payload?.readiness||readinessFor(shipment.id);
    const documents=payload?.documents||[];
    const writable=window.ExportMcaAccessControl?.can?.('documents.write')===true;
    return `<section class="container-customs"><div class="container-customs-head"><div><h3>Documentos Cuba</h3><div class="container-customs-summary">${esc(documentStatusText(readiness))}</div></div>${docPill(readiness)}</div><div class="container-customs-grid"><div id="containerCustomsFeedback" class="container-customs-feedback" role="status" aria-live="polite"></div>${CUSTOMS_TYPES.map(def=>{
      const versions=versionsForType(documents,def.type);
      const item=latestDocument(documents,def.type);
      return `<div class="container-customs-card ${item?'complete':'pending'}"><div class="container-customs-title"><b>${esc(def.label)}</b>${item?'<span class="container-doc-state ready">VIGENTE</span>':'<span class="container-doc-state pending">PENDIENTE</span>'}</div>${item?`<div class="container-customs-meta">v${esc(item.version||1)} · ${esc(item.file_name)} · ${esc(formatDateTime(item.created_at))}${item.uploaded_by_username?` · ${esc(item.uploaded_by_username)}`:''}</div>`:'<div class="container-customs-meta">Debe ser el documento oficial preparado para Cuba, no el packing list del almacén.</div>'}<div class="container-customs-actions">${item?.signed_url?`<button class="alt" type="button" data-customs-open="${esc(item.id)}">Ver vigente</button>`:''}${writable?`<button class="orange" type="button" data-customs-upload="${esc(def.key)}">${item?'Subir nueva versión':'Subir archivo'}</button>`:''}${writable&&item?`<button class="danger" type="button" data-customs-delete="${esc(item.id)}">Eliminar vigente</button>`:''}</div>${versionHistoryHtml(versions)}</div>`;
    }).join('')}<div class="container-customs-note">READY se calcula automáticamente usando únicamente la <b>versión vigente</b> de <b>Packing List Cuba</b> + <b>Factura comercial Cuba</b> cargadas manualmente.</div></div></section>`;
  }

  async function loadShipmentDocuments(shipment){
    if(!actionAllowed(shipment,'view_documents'))return null;
    return request('/api/shipment-documents?shipment_id='+encodeURIComponent(shipment.id));
  }

  function setCustomsFeedback(message,ok=false){
    const node=byId('containerCustomsFeedback');
    if(!node)return;
    node.textContent=message||'';
    node.className=`container-customs-feedback ${message?(ok?'ok':'bad'):''}`;
  }

  function broadcastCustomsChange(shipmentId){
    const detail={shipment_id:String(shipmentId)};
    window.dispatchEvent(new CustomEvent('export-mca:shipment-documents-changed',{detail}));
    document.querySelectorAll('iframe').forEach(frame=>{
      try{
        frame.contentWindow?.SalesWorkspace?.reload?.({keepTab:true});
        frame.contentWindow?.dispatchEvent?.(new CustomEvent('export-mca:shipment-documents-changed',{detail}));
      }catch{}
    });
  }

  async function refreshAfterCustomsChange(shipment,payload=null){
    if(payload?.readiness)readinessByShipment.set(String(shipment.id),payload.readiness);
    else await loadReadiness();
    await window.TasksWorkspace?.load?.();
    broadcastCustomsChange(shipment.id);
    await openDetails(findShipment(shipment.id)||shipment);
  }

  async function uploadCustomsDocument(shipment,key){
    if(window.ExportMcaAccessControl?.can?.('documents.write')!==true)return setCustomsFeedback('No tienes permiso para subir documentos.',false);
    const def=CUSTOMS_TYPES.find(item=>item.key===key);
    if(!def)return;
    const input=document.createElement('input');
    input.type='file';
    input.accept='.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp';
    input.className='tracking-visually-hidden';
    document.body.appendChild(input);
    input.addEventListener('change',async()=>{
      const file=input.files?.[0];
      input.remove();
      if(!file)return;
      let prepared=null;
      setCustomsFeedback('Preparando carga...',true);
      try{
        const result=await request('/api/shipment-documents',{
          method:'POST',
          body:JSON.stringify({action:'prepare_upload',shipment_id:shipment.id,document_type:def.key,file_name:file.name,mime_type:file.type,file_size_bytes:file.size})
        });
        prepared=result.upload;
        const form=new FormData();
        form.append('cacheControl','3600');
        form.append('',file);
        const storageResponse=await fetch(prepared.signed_url,{method:'PUT',headers:{'x-upsert':'false'},body:form});
        if(!storageResponse.ok){
          await request('/api/shipment-documents',{
            method:'POST',
            body:JSON.stringify({action:'discard_upload',shipment_id:shipment.id,storage_path:prepared.storage_path})
          }).catch(()=>{});
          throw new Error('DOCUMENT_STORAGE_UPLOAD_FAILED');
        }
        const finalized=await request('/api/shipment-documents',{
          method:'POST',
          body:JSON.stringify({action:'finalize_upload',shipment_id:shipment.id,document_type:prepared.document_type,file_name:prepared.file_name,mime_type:prepared.mime_type,file_size_bytes:prepared.file_size_bytes,storage_path:prepared.storage_path})
        });
        await refreshAfterCustomsChange(shipment,finalized);
        setCustomsFeedback(`${def.label} actualizado correctamente.`,true);
      }catch(error){
        console.error('CONTAINER_DOCUMENT_UPLOAD_FAILED',{shipment_id:shipment.id,document_type:def.key,error});
        setCustomsFeedback(safeContainerMessage(error,'No se pudo subir el documento. Intenta nuevamente.'),false);
      }
    },{once:true});
    input.click();
  }

  async function deleteCustomsDocument(shipment,item){
    if(window.ExportMcaAccessControl?.can?.('documents.write')!==true)return setCustomsFeedback('No tienes permiso para eliminar documentos.',false);
    if(!item?.is_current)return setCustomsFeedback('Solo puede retirarse la versión vigente.',false);
    const accepted=await decision({
      title:'Eliminar versión vigente',
      text:`Se retirará ${item.file_name} del contenedor ${shipment.container_number}. La versión quedará registrada en el historial.`,
      button:'Eliminar vigente',
      danger:true
    });
    if(!accepted)return;
    setCustomsFeedback('Eliminando versión vigente...',true);
    try{
      const result=await request('/api/shipment-documents',{method:'DELETE',body:JSON.stringify({document_id:item.id})});
      await refreshAfterCustomsChange(shipment,result);
      if(result.storage_cleanup_pending)setCustomsFeedback('Documento retirado del ERP. La limpieza física quedó pendiente para reintento.',false);
      else setCustomsFeedback('Versión vigente eliminada. El readiness fue recalculado.',true);
    }catch(error){
      console.error('CONTAINER_DOCUMENT_DELETE_FAILED',{shipment_id:shipment.id,document_id:item.id,error});
      setCustomsFeedback(safeContainerMessage(error,'No se pudo eliminar el documento. Intenta nuevamente.'),false);
    }
  }

  function progressHtml(shipment){
    const currentIndex=currentEventIndex(shipment);
    return `<div class="tracking-progress" aria-label="Progreso del contenedor">${EVENTS.map((event,index)=>`<div class="tracking-progress-step ${currentIndex>=0&&index<=currentIndex?'reached':''} ${index===currentIndex?'current':''}">${esc(event.label)}</div>`).join('')}</div>`;
  }

  async function openDetails(shipment){
    if(!(actionAllowed(shipment,'view_info')||actionAllowed(shipment,'view_documents')))return;
    const client=shipment.clients||{};
    const importer=importerForShipment(shipment);
    let payload=null;
    let error='';
    let loadLink=null;
    if(actionAllowed(shipment,'view_documents')){
      try{
        payload=await loadShipmentDocuments(shipment);
        if(payload?.readiness)readinessByShipment.set(String(shipment.id),payload.readiness);
      }catch(loadError){
        error='No se pudieron cargar los documentos Cuba.';
        console.error('[tracking customs docs]',loadError);
      }
    }
    try{loadLink=await window.OperationalNavigation?.loadForShipment?.(shipment.id)||null;}catch{}
    const loadHtml=loadLink?`<section class="container-origin"><div><div class="container-origin-label">Origen de almacén</div><div class="container-origin-title">${esc(loadLink.load_number||'Cargue')}</div><div class="container-origin-meta">${esc(loadLink.load_status||'Estado no disponible')} · vinculado desde Cargues.</div></div><button id="containerOpenLoad" class="alt" type="button">Ver cargue</button></section>`:'';
    const content=`<div class="tracking-dialog-root"><div class="tracking-detail-summary"><div><strong>${esc(shipment.container_number)}</strong><span>Seguimiento administrado dentro de Export MCA ERP</span></div><span class="container-status ${statusClass(shipment)}">${esc(statusText(shipment))}</span></div>${progressHtml(shipment)}<div class="container-details-grid"><section class="container-detail-section"><h3>Cliente y destino</h3>${detailRow('Nombre',shipment.client_id?client.name:'SIN CLIENTE · Disponible para venta')}${detailRow('Empresa',client.company)}${detailRow('WhatsApp',client.phone)}${detailRow('Importadora',importer?.name)}</section><section class="container-detail-section"><h3>Operación marítima</h3>${detailRow('Número',shipment.container_number)}${detailRow('Producto',shipment.product)}${detailRow('Cantidad',formatQuantity(shipment))}${detailRow('Fecha salida',formatDate(shipment.departure_date))}${detailRow('Booking',shipment.booking_number)}${detailRow('B/L',shipment.bol_number)}${detailRow('Naviera',shipment.carrier)}${detailRow('Estado operativo',statusText(shipment))}${detailRow('Ubicación',shipment.last_location)}${detailRow('Tracking','Seguimiento ERP')}</section>${loadHtml}${customsHtml(shipment,payload,error)}</div></div>`;
    window.openModal?.(`Detalles · ${shipment.container_number}`,content);

    const documents=new Map((payload?.documents||[]).map(item=>[String(item.id),item]));
    document.querySelectorAll('[data-customs-open]').forEach(button=>button.addEventListener('click',()=>{
      const item=documents.get(String(button.dataset.customsOpen));
      if(item?.signed_url)window.open(item.signed_url,'_blank','noopener');
    }));
    document.querySelectorAll('[data-customs-upload]').forEach(button=>button.addEventListener('click',()=>uploadCustomsDocument(shipment,button.dataset.customsUpload)));
    document.querySelectorAll('[data-customs-delete]').forEach(button=>button.addEventListener('click',()=>{
      const item=documents.get(String(button.dataset.customsDelete));
      if(item)deleteCustomsDocument(shipment,item);
    }));
    if(loadLink)byId('containerOpenLoad')?.addEventListener('click',()=>window.OperationalNavigation?.openLoad?.({loadId:loadLink.load_id}),{once:true});
    render();
  }

  function notificationHistoryDetail(item){
    const status=String(item.delivery_status||item.status||'').toLowerCase();
    if(['sent','delivered','read'].includes(status))return 'Mensaje entregado correctamente.';
    if(['pending','queued','accepted'].includes(status))return 'Mensaje pendiente de entrega.';
    if(['failed','undelivered'].includes(status)||item.error_message)return 'No se pudo entregar el mensaje. Revisa el Centro de alertas.';
    return 'Actualización de comunicación registrada.';
  }

  function notificationHistoryTitle(item){
    const type=String(item.event_type||item.event_status||'').toLowerCase();
    const label=({welcome:'Bienvenida',registered:'Contenedor registrado',release:'Liberación',delivered:'Entrega',tracking:'Actualización de tracking'})[type]||'Actualización al cliente';
    return 'Notificación · '+label;
  }

  function auditHistoryDetail(item){
    const details=item?.details;
    if(typeof details==='string'&&details.trim()&&!/^[A-Z0-9_:-]{4,}$/.test(details.trim()))return details.trim();
    if(details&&typeof details==='object'){
      const value=details.reason||details.notes||details.status||details.message;
      if(value)return String(value);
    }
    return 'Cambio administrativo registrado.';
  }

  function auditHistoryTitle(item){
    if(item?.title)return String(item.title);
    return ({shipment_created:'Contenedor registrado',shipment_updated:'Contenedor actualizado',shipment_released:'Contenedor liberado',shipment_delivered:'Contenedor entregado',shipment_reactivated:'Contenedor reactivado',shipment_deleted:'Contenedor eliminado'})[String(item?.action||'')]||'Cambio administrativo';
  }

  async function openHistory(shipment){
    if(!actionAllowed(shipment,'view_history'))return;
    const result=await request('/api/history?shipment_id='+encodeURIComponent(shipment.id));
    const events=[
      ...(result.events||[]),
      ...(result.notifications||[]).map(item=>({title:notificationHistoryTitle(item),details:notificationHistoryDetail(item),created_at:item.created_at})),
      ...(result.audit_events||[]).map(item=>({title:auditHistoryTitle(item),details:auditHistoryDetail(item),created_at:item.created_at}))
    ].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    const html=events.length
      ?`<div class="tracking-dialog-root tracking-history">${events.map(item=>`<article class="tracking-history-event"><strong>${esc(item.title||'Evento')}</strong><p>${esc(item.details||'Actualización registrada.')}</p><time>${esc(formatDateTime(item.created_at))}</time></article>`).join('')}</div>`
      :'<div class="tracking-dialog-root tracking-empty">No hay historial disponible.</div>';
    window.openModal?.(`Historial · ${shipment.container_number}`,html);
  }

  function currentEventIndex(shipment){
    const status=String(shipment.last_status||shipment.operational_status||'').trim().toLowerCase();
    return EVENTS.findIndex(event=>event.label.toLowerCase()===status);
  }

  function closeManualWorkflow(restoreFocus=true){
    const cleanup=manualCleanup;
    manualCleanup=null;
    cleanup?.(restoreFocus);
  }

  function manualResultMessage(result){
    const correction=result.correction_type==='rollback'?'Corrección guardada. ':'';
    if(result.notification_status==='failed'){
      if(result.notification_error)console.error('CONTAINER_TRACKING_NOTIFICATION_FAILED',{notification_error:result.notification_error});
      return `${correction}Estado actualizado, pero no se pudo enviar WhatsApp. Revisa el Centro de alertas.`;
    }
    if(['queued','sent','delivered','read'].includes(String(result.notification_status||'').toLowerCase()))return `${correction}Estado actualizado y WhatsApp procesado.`;
    if(result.notification_status==='unavailable_recipient'||result.notification_status==='pending_template')return `${correction}Estado actualizado. La notificación quedó pendiente o no disponible.`;
    return `${correction}Estado actualizado.`;
  }

  function openManualWorkflow(shipment){
    if(!actionAllowed(shipment,'manual_tracking'))return;
    closeManualWorkflow(false);
    const previousFocus=document.activeElement;
    const currentIndex=currentEventIndex(shipment);
    const currentLabel=currentIndex>=0?EVENTS[currentIndex].label:(shipment.last_status||shipment.operational_status||'Registrado');
    const defaultIndex=currentIndex>=0?currentIndex:0;
    const hasRecipient=Boolean(shipment.client_id&&shipment.clients?.active&&shipment.clients?.phone);
    const overlay=document.createElement('div');
    overlay.className='container-overlay';
    overlay.dataset.manualTrack='1';
    overlay.innerHTML=`<div class="container-dialog" role="dialog" aria-modal="true" aria-labelledby="manualTrackingTitle"><div class="manual-track-head"><div><h3 id="manualTrackingTitle">Actualizar / corregir tracking</h3><div class="muted">${esc(shipment.container_number)}</div></div><button type="button" class="alt manual-track-close">Cerrar</button></div><div class="manual-track-current-box"><small>Estado actual</small><br><b>${esc(currentLabel)}</b></div><div class="manual-track-list">${EVENTS.map((event,index)=>`<label class="manual-track-step ${index===currentIndex?'current selected':''}" data-index="${index}"><div class="manual-track-step-index">${index===currentIndex?'●':index+1}</div><div><div class="manual-track-step-title">${esc(event.label)}</div><div class="manual-track-step-note">${index===currentIndex?'Estado actual':event.whatsapp?'WhatsApp automático':'Sin WhatsApp'}</div></div><input class="manual-track-radio" type="radio" name="manualTrackingEvent" value="${event.key}" ${index===defaultIndex?'checked':''}></label>`).join('')}</div><div class="manual-track-field"><label for="manualTrackingLocation">Puerto o ubicación</label><input id="manualTrackingLocation" value="${esc(shipment.last_location||'')}" autocomplete="off"></div><div id="manualTrackingNotice" class="manual-track-notice" role="status" aria-live="polite"></div><div class="manual-track-actions"><button type="button" class="tracking-primary manual-track-confirm">Guardar estado</button><button type="button" class="alt manual-track-cancel">Cancelar</button></div></div>`;
    document.body.appendChild(overlay);

    const onKeydown=event=>{if(event.key==='Escape')closeManualWorkflow();};
    manualCleanup=restoreFocus=>{
      document.removeEventListener('keydown',onKeydown);
      overlay.remove();
      if(restoreFocus)previousFocus?.focus?.();
    };
    document.addEventListener('keydown',onKeydown);
    const notice=overlay.querySelector('#manualTrackingNotice');
    const syncNotice=()=>{
      const key=overlay.querySelector('input[name="manualTrackingEvent"]:checked')?.value;
      const selected=EVENTS.find(event=>event.key===key);
      if(!selected)return;
      if(selected.whatsapp){
        notice.className='manual-track-notice whatsapp';
        notice.textContent=hasRecipient
          ?'Este hito enviará WhatsApp automáticamente al cliente.'
          :'Este hito requiere WhatsApp, pero el contenedor no tiene un cliente activo con teléfono.';
      }else{
        notice.className='manual-track-notice';
        notice.textContent='Este hito actualiza el ERP y no envía WhatsApp.';
      }
    };

    overlay.querySelector('.manual-track-close').addEventListener('click',()=>closeManualWorkflow());
    overlay.querySelector('.manual-track-cancel').addEventListener('click',()=>closeManualWorkflow());
    overlay.addEventListener('click',event=>{if(event.target===overlay)closeManualWorkflow();});
    overlay.querySelectorAll('.manual-track-step').forEach(step=>step.addEventListener('click',()=>{
      const input=step.querySelector('input');
      if(input)input.checked=true;
      overlay.querySelectorAll('.manual-track-step').forEach(item=>item.classList.toggle('selected',item===step));
      syncNotice();
    }));
    syncNotice();
    overlay.querySelector('.manual-track-close')?.focus();

    const button=overlay.querySelector('.manual-track-confirm');
    button.addEventListener('click',async()=>{
      const key=overlay.querySelector('input[name="manualTrackingEvent"]:checked')?.value;
      const selected=EVENTS.find(event=>event.key===key);
      if(!selected)return;
      try{
        button.disabled=true;
        button.textContent='Guardando...';
        const result=await request('/api/manual-tracking-event',{
          method:'PATCH',
          body:JSON.stringify({id:shipment.id,event:selected.key,location:String(overlay.querySelector('#manualTrackingLocation')?.value||'').trim()})
        });
        closeManualWorkflow(false);
        showToast(manualResultMessage(result),result.notification_status!=='failed');
        await window.loadAll?.();
        await window.loadNotifications?.();
      }catch(error){
        console.error('CONTAINER_MANUAL_TRACKING_FAILED',{shipment_id:shipment.id,event:key,error});
        notice.className='manual-track-notice';
        notice.textContent=safeContainerMessage(error,'No se pudo actualizar el tracking. Intenta nuevamente.');
        button.disabled=false;
        button.textContent='Guardar estado';
      }
    });
  }

  function openEditor(shipment,focus=null){
    const cap=focus==='client'?'assign_client':'edit';
    if(!actionAllowed(shipment,cap))return;
    if(!window.ShipmentEditor?.open)throw new Error('El editor de contenedores no está disponible.');
    window.ShipmentEditor.open(shipment.id,{focus});
  }

  async function deleteShipmentRecord(shipment){
    if(!actionAllowed(shipment,'delete'))return;
    const accepted=await decision({
      title:'Eliminar contenedor',
      text:`Esta acción elimina definitivamente ${shipment.container_number} del ERP.`,
      button:'Eliminar definitivamente',
      danger:true,
      typed:'ELIMINAR'
    });
    if(!accepted)return;
    await request('/api/shipments?id='+encodeURIComponent(shipment.id),{method:'DELETE'});
    showToast('Contenedor eliminado.',true);
    await window.loadAll?.();
    await loadReadiness();
    await window.loadNotifications?.();
  }

  async function executeAction(shipment,action){
    if(action==='info'||action==='documents')return openDetails(shipment);
    if(action==='history')return openHistory(shipment);
    if(action==='edit')return openEditor(shipment);
    if(action==='assign_client')return openEditor(shipment,'client');
    if(action==='manual_update')return openManualWorkflow(shipment);
    const capAction=action;
    if(['release','deliver','reactivate'].includes(action)){
      if(!actionAllowed(shipment,capAction))return;
      const copy={
        release:['Liberar contenedor','La liberación procesará WhatsApp automáticamente cuando exista un destinatario elegible.','Liberar'],
        deliver:['Marcar entregado','El contenedor pasará al estado entregado.','Marcar entregado'],
        reactivate:['Reactivar contenedor','El contenedor volverá a estar activo para operación.','Reactivar']
      }[action];
      if(!await decision({title:copy[0],text:copy[1],button:copy[2],danger:false}))return;
      await request('/api/shipments',{method:'PATCH',body:JSON.stringify({id:shipment.id,action})});
      showToast('Acción aplicada correctamente.',true);
      await window.loadAll?.();
      await loadReadiness();
      await request('/api/tracking-alerts?action=check').catch(()=>{});
      await window.loadNotifications?.();
      return;
    }
    if(action==='delete')return deleteShipmentRecord(shipment);
  }

  function activateFilter(filter){
    activeFilter=filter;
    document.querySelectorAll('[data-container-filter]').forEach(button=>{
      const active=button.dataset.containerFilter===filter;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
    });
    render();
  }

  function openRowFromEvent(event){
    const row=event.target.closest('[data-shipment-row]');
    if(!row||event.target.closest('button,a,input,select,textarea'))return;
    const shipment=findShipment(row.dataset.shipmentRow);
    if(shipment&&(actionAllowed(shipment,'view_info')||actionAllowed(shipment,'view_documents')))openDetails(shipment);
  }

  function bind(){
    byId('shipmentRegistrationForm')?.addEventListener('submit',event=>{
      event.preventDefault();
      saveShipmentRecord();
    });
    byId('resetShipmentForm')?.addEventListener('click',()=>resetRegistrationForm());
    byId('shipmentContainer')?.addEventListener('input',syncContainerGuidance);
    byId('shipmentSearch')?.addEventListener('input',render);
    byId('trackingClearFilters')?.addEventListener('click',()=>{
      if(byId('shipmentSearch'))byId('shipmentSearch').value='';
      activateFilter('active');
      byId('shipmentSearch')?.focus?.();
    });
    byId('trackingRegisterShortcut')?.addEventListener('click',()=>window.showSection?.('registerContainerSection'));
    document.querySelectorAll('[data-container-filter]').forEach(button=>button.addEventListener('click',()=>activateFilter(button.dataset.containerFilter)));
    byId('shipments')?.addEventListener('click',event=>{
      const trigger=event.target.closest('[data-container-menu]');
      if(trigger){
        event.stopPropagation();
        const shipment=findShipment(trigger.dataset.containerMenu);
        if(shipment)openActionMenu(shipment,trigger);
        return;
      }
      openRowFromEvent(event);
    });
    byId('shipments')?.addEventListener('keydown',event=>{
      if(!['Enter',' '].includes(event.key))return;
      if(event.target.closest('button,a,input,select,textarea'))return;
      event.preventDefault();
      openRowFromEvent(event);
    });
  }

  async function syncData(){
    syncClientSelect();
    syncImporterInput();
    await loadReadiness();
    render();
  }

  async function refreshImporters(){
    await loadImporterState();
    syncImporterInput();
    render();
  }

  async function mount(){
    if(!byId('registerContainerSection')||!byId('containersSection')||!byId('shipments')||!byId('saveShipment')){
      console.error('CONTAINERS_STATIC_STRUCTURE_MISSING');
      return;
    }
    await Promise.all([loadImporterState(),loadReadiness()]);
    bind();
    syncClientSelect();
    syncImporterInput();
    syncContainerGuidance();
    render();
    window.addEventListener('export-mca:data-loaded',syncData);
    window.addEventListener('export-mca:clients-changed',syncClientSelect);
    window.addEventListener('export-mca:importers-changed',refreshImporters);
    window.ContainersModule=Object.freeze({
      render,
      syncClients:syncClientSelect,
      syncImporters:refreshImporters,
      openManualWorkflow,
      openDetails,
      owner:'containers-module.js',
      trackingOwner:'containers-module.js',
      registrationOwner:'containers-module.js'
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
