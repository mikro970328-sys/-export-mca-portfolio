(() => {
  if (window.__containersModuleInstalled) return;
  window.__containersModuleInstalled = true;

  const byId=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
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

  let activeFilter='active';
  let menuShipmentId=null;
  let menuTrigger=null;
  let importerState={importers:[],client_importers:[],shipment_importers:[]};
  let readinessByShipment=new Map();

  async function request(path,options={}){
    const token=localStorage.getItem('export_mca_token')||'';
    const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||data.details||'Error');
    return data;
  }

  function installStyles(){
    if(byId('containersModuleStyles'))return;
    const style=document.createElement('style');
    style.id='containersModuleStyles';
    style.textContent=`
      .container-actions-cell{width:1%;white-space:nowrap;text-align:right}.container-actions-trigger{width:40px!important;height:38px!important;padding:0!important;border:1px solid #cfd7e3!important;border-radius:10px!important;background:#fff!important;color:#06204a!important;font-size:23px!important;display:inline-grid!important;place-items:center!important}.container-actions-popover{position:fixed;z-index:5100;width:min(300px,calc(100vw - 24px));background:#fff;border:1px solid #dfe5ee;border-radius:14px;box-shadow:0 18px 48px rgba(6,32,74,.22);padding:8px}.container-actions-popover.hidden{display:none!important}.container-actions-popover button{width:100%;display:flex;align-items:center;gap:11px;padding:12px 13px;border:0;border-radius:9px;background:#fff;color:#152238;text-align:left;font-size:14px;font-weight:700}.container-actions-popover button:hover{background:#f4f7fb}.container-actions-popover button.danger{color:#b42318}.container-actions-popover button.orange{color:#d66a00}.container-actions-popover button.success{color:#117a37}.container-actions-separator{height:1px;background:#e8edf4;margin:6px 4px}
      .container-mode{display:block;margin-top:5px;font-size:11px;color:#667085}.container-unassigned-row{background:#fffaf0}.container-client-unassigned{display:inline-block;padding:5px 9px;border-radius:999px;background:#fff0c7;color:#8a5700;font-size:11px;font-weight:900}.container-sale-note{display:block;margin-top:4px;color:#9a6700;font-size:10px;font-weight:700}.container-importer-pill{display:inline-flex;padding:5px 8px;border-radius:999px;background:#fff3e8;color:#9b4a00;font-size:11px;font-weight:800}.container-importer-help{font-size:11px;color:var(--muted);margin-top:5px;line-height:1.45}.container-list-footer{display:flex;justify-content:flex-end;padding:12px 4px 2px;color:#667085;font-size:12px;font-weight:800}
      .container-doc-state{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:11px;font-weight:900;white-space:nowrap}.container-doc-state.ready{background:#edf9f0;color:#117a37}.container-doc-state.pending{background:#fff4df;color:#9a6700}.container-doc-state.idle,.container-doc-state.restricted{background:#f2f4f7;color:#667085}.container-details-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}.container-detail-row{padding:11px 0;border-bottom:1px solid #e6ebf2}.container-detail-label{font-size:11px;font-weight:800;text-transform:uppercase;color:#667085;margin-bottom:4px}.container-detail-value{font-size:15px;color:#152238;word-break:break-word}.container-origin{grid-column:1/-1;margin-top:18px;padding:13px 14px;border:1px solid #b8c9e4;border-radius:12px;background:#f3f7fd;display:flex;align-items:center;justify-content:space-between;gap:14px}.container-origin-label{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;color:#667085}.container-origin-title{margin-top:3px;font-size:14px;font-weight:900;color:#06204a}.container-origin-meta{margin-top:3px;font-size:11px;color:#667085}
      .container-customs{grid-column:1/-1;margin-top:20px;padding-top:16px;border-top:1px solid #dfe5ee}.container-customs-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}.container-customs-head h3{margin:0;color:#06204a}.container-customs-summary{margin-top:5px;color:#667085;font-size:12px}.container-customs-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.container-customs-card{border:1px solid #dfe5ee;border-radius:12px;padding:14px;background:#fff}.container-customs-card.complete{border-color:#a8d7b3;background:#f7fcf8}.container-customs-card.pending{border-color:#f0cf8a;background:#fffaf1}.container-customs-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.container-customs-title b{color:#06204a}.container-customs-meta{margin-top:7px;font-size:11px;color:#667085}.container-customs-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.container-customs-note{grid-column:1/-1;padding:11px 12px;border-radius:10px;background:#f4f7fb;color:#475467;font-size:12px;line-height:1.45}.container-customs-feedback{grid-column:1/-1;min-height:18px;font-size:12px;font-weight:700}.container-customs-feedback.ok{color:#117a37}.container-customs-feedback.bad{color:#b42318}.container-customs-versions{margin-top:12px;padding-top:10px;border-top:1px solid #e6ebf2}.container-customs-versions-title{font-size:10px;font-weight:900;text-transform:uppercase;color:#667085;margin-bottom:7px}.container-customs-version-list{display:grid;gap:6px}.container-customs-version{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px;border:1px solid #e6ebf2;border-radius:8px;background:#fff}.container-customs-version-main{min-width:0}.container-customs-version-main b{font-size:11px;color:#344054}.container-customs-version-main small{display:block;margin-top:2px;color:#667085;font-size:10px;white-space:normal;word-break:break-word}.container-customs-version-state{display:inline-flex;padding:3px 6px;border-radius:999px;font-size:9px;font-weight:900;text-transform:uppercase;white-space:nowrap;background:#f2f4f7;color:#667085}.container-customs-version-state.deleted{background:#fef3f2;color:#b42318}.container-customs-noaccess{grid-column:1/-1;padding:12px;border:1px solid #dfe5ee;border-radius:10px;background:#f8fafc;color:#667085;font-size:12px}
      .container-overlay{position:fixed;inset:0;z-index:5700;background:rgba(16,24,40,.50);display:flex;align-items:center;justify-content:center;padding:18px}.container-dialog{width:min(620px,100%);max-height:92vh;overflow:auto;background:#fff;border:1px solid #dfe5ee;border-radius:14px;box-shadow:0 24px 70px rgba(16,24,40,.22);padding:18px}.container-dialog h3{margin:0 0 8px;color:#06204a}.container-dialog p{color:#475467;line-height:1.45}.container-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.container-dialog input[type=text]{width:100%;padding:10px;border:1px solid #cfd7e3;border-radius:9px;margin-top:8px}.container-toast{position:fixed;z-index:5900;right:18px;bottom:18px;max-width:min(430px,calc(100vw - 36px));padding:12px 14px;border:1px solid #dfe5ee;border-radius:11px;background:#fff;box-shadow:0 16px 40px rgba(16,24,40,.20);font-size:13px;font-weight:700;color:#344054}.container-toast.ok{border-color:#a8d7b3;color:#117a37}.container-toast.bad{border-color:#efb5af;color:#b42318}
      .manual-track-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:18px}.manual-track-head h3{margin:0;color:#06204a}.manual-track-current-box{padding:13px;border:1px solid #b8c9e4;background:#f3f7fd;border-radius:12px;margin-bottom:16px}.manual-track-list{display:grid;gap:9px;margin:14px 0 18px}.manual-track-step{position:relative;display:grid;grid-template-columns:30px 1fr;gap:10px;align-items:center;padding:11px;border:1px solid #dfe5ee;border-radius:12px;background:#fff;cursor:pointer}.manual-track-step.current{background:#f1f8f3;border-color:#b8dfc1}.manual-track-step.selected{border:2px solid #f58220;background:#fff8f2}.manual-track-step-index{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:#edf3ff;color:#06204a;font-size:12px;font-weight:900}.manual-track-step-title{font-weight:800}.manual-track-step-note{font-size:11px;color:#667085;margin-top:2px}.manual-track-field label{display:block;margin:12px 0 6px;font-size:13px;font-weight:800}.manual-track-field input{width:100%;padding:10px;border:1px solid #cfd7e3;border-radius:9px}.manual-track-notice{margin-top:16px;padding:13px;border:1px solid #dfe5ee;border-radius:12px;background:#f8fafc;font-size:12px;color:#475467}.manual-track-notice.whatsapp{border-color:#a8d7b3;background:#f7fcf8;color:#117a37}.manual-track-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.manual-track-confirm{background:#f58220!important;padding:13px!important}
      @media(max-width:760px){.container-details-grid,.container-customs-grid{grid-template-columns:1fr}.container-origin{align-items:flex-start;flex-direction:column}.container-origin button{width:100%}.container-customs-head{flex-direction:column}.container-actions-popover{left:12px!important;right:12px!important;bottom:12px!important;top:auto!important;width:auto!important}.container-overlay{align-items:flex-end;padding:0}.container-dialog{border-radius:22px 22px 0 0;padding:22px 18px calc(22px + env(safe-area-inset-bottom))}.container-actions-cell{position:sticky;right:0;background:#fff;z-index:2}}
    `;
    document.head.appendChild(style);
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
      if(String(error.message||'').toLowerCase().includes('permiso'))readinessByShipment=new Map();
      else console.error('[container readiness]',error);
    }
  }
  async function loadImporterState(){
    try{const result=await request('/api/importers');importerState={importers:result.importers||[],client_importers:result.client_importers||[],shipment_importers:result.shipment_importers||[]};window.importerState=importerState;}
    catch(error){console.error('[containers importers]',error);}
  }
  function importerById(id){return importerState.importers.find(item=>String(item.id)===String(id||''))||null;}
  function importerIdForShipment(id){return importerState.shipment_importers.find(item=>String(item.shipment_id)===String(id||''))?.importer_id||null;}
  function importerForShipment(shipment){return importerById(importerIdForShipment(shipment?.id));}
  function importerSuggestions(){return importerState.importers.filter(x=>x.active!==false).map(x=>`<option value="${esc(x.name)}"></option>`).join('');}
  function ensureRegistrationImporterField(){
    if(byId('shipmentImporter'))return;
    const wrapper=byId('shipmentClient')?.closest('div');if(!wrapper)return;
    const node=document.createElement('div');node.id='shipmentImporterField';node.innerHTML='<label for="shipmentImporter">Importadora cubana</label><input id="shipmentImporter" list="shipmentImporterOptions" placeholder="Ej. Cítricos Caribe, Quimimport"><datalist id="shipmentImporterOptions"></datalist><div class="container-importer-help">Escribe la importadora concreta de este contenedor.</div>';
    wrapper.insertAdjacentElement('afterend',node);
  }
  function clientOptions(selected=''){return `<option value="">Sin cliente / Disponible para venta</option>${clientRows().map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(selected)?'selected':''}>${esc(c.name)}${c.company?' · '+esc(c.company):''}</option>`).join('')}`;}
  function syncClientSelect(){const select=byId('shipmentClient');if(!select)return;const value=select.value;select.innerHTML=clientOptions(value);if([...select.options].some(x=>x.value===value))select.value=value;}
  function syncImporterInput(){const list=byId('shipmentImporterOptions');if(list)list.innerHTML=importerSuggestions();}
  async function assignImporterToShipment(shipmentId,importerName){const result=await request('/api/importers',{method:'PATCH',body:JSON.stringify({action:'assign_shipment',shipment_id:shipmentId,importer_name:String(importerName||'').trim()})});if(result.state){importerState=result.state;window.importerState=importerState;}else await loadImporterState();}

  function note(message,ok=false){const target=byId('shipmentMsg');if(!target)return;target.textContent=message;target.className=`msg ${ok?'ok':'bad'}`;}
  function showToast(message,ok=false){
    document.querySelector('.container-toast')?.remove();
    const node=document.createElement('div');node.className=`container-toast ${ok?'ok':'bad'}`;node.textContent=message;document.body.appendChild(node);setTimeout(()=>node.remove(),5000);
  }
  function decision({title,text,button='Confirmar',danger=false,typed=null}){
    return new Promise(resolve=>{
      document.querySelector('.container-overlay[data-decision]')?.remove();
      const overlay=document.createElement('div');overlay.className='container-overlay';overlay.dataset.decision='1';
      overlay.innerHTML=`<div class="container-dialog" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><p>${esc(text)}</p>${typed?`<label style="font-size:12px;font-weight:800">Escribe ${esc(typed)} para continuar</label><input type="text" data-decision-text autocomplete="off">`:''}<div class="container-dialog-actions"><button type="button" class="alt" data-decision-no>Volver</button><button type="button" class="${danger?'danger':'orange'}" data-decision-yes>${esc(button)}</button></div></div>`;
      document.body.appendChild(overlay);
      const finish=value=>{overlay.remove();resolve(value);};
      overlay.querySelector('[data-decision-no]').onclick=()=>finish(false);
      overlay.querySelector('[data-decision-yes]').onclick=()=>{if(typed&&String(overlay.querySelector('[data-decision-text]')?.value||'').trim()!==typed)return;finish(true);};
      overlay.onclick=event=>{if(event.target===overlay)finish(false);};
      overlay.querySelector('[data-decision-text]')?.focus();
    });
  }

  function formatDate(value){if(!value)return '—';const d=new Date(`${value}T00:00:00`);return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString('es-US',{day:'2-digit',month:'short',year:'numeric'});}
  function formatDateTime(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString('es-US');}
  function formatQuantity(shipment){if(shipment.quantity===null||shipment.quantity===undefined||shipment.quantity==='')return '—';const n=Number(shipment.quantity);const value=Number.isFinite(n)?new Intl.NumberFormat('es-US',{maximumFractionDigits:3}).format(n):shipment.quantity;return `${value}${shipment.quantity_unit?' '+shipment.quantity_unit:''}`;}
  function docPill(readiness){if(!readiness||readiness.document_status==='not_required')return '<span class="container-doc-state idle">Aún no requerido</span>';if(readiness.document_status==='ready')return '<span class="container-doc-state ready">READY</span>';const count=Array.isArray(readiness.missing_documents)?readiness.missing_documents.length:2;return `<span class="container-doc-state pending">Faltan ${count}</span>`;}
  function searchable(shipment){return [shipment.container_number,shipment.booking_number,shipment.bol_number,shipment.carrier,shipment.product,shipment.quantity,shipment.quantity_unit,shipment.departure_date,shipment.operational_status,shipment.last_status,shipment.clients?.name,shipment.clients?.company,importerForShipment(shipment)?.name].filter(Boolean).join(' ').toLowerCase();}
  function filteredRows(){const query=String(byId('shipmentSearch')?.value||'').trim().toLowerCase();let list=activeFilter==='active'?rows().filter(x=>x.active!==false):activeFilter==='delivered'?rows().filter(x=>x.active===false):[...rows()];if(query)list=list.filter(x=>searchable(x).includes(query));return list;}

  function render(){
    const target=byId('shipments');if(!target)return;closeActionMenu();
    const register=byId('registerContainerSection');if(register)register.hidden=!shipmentWriteAccess();
    const list=filteredRows();
    if(!list.length){target.innerHTML='<div class="empty-state">No hay resultados.</div><div class="container-list-footer">0 contenedores</div>';return;}
    target.innerHTML=`<table><thead><tr><th>Contenedor</th><th>Cliente</th><th>Importadora</th><th>Producto</th><th>Cantidad</th><th>Fecha salida</th><th>Booking / B/L</th><th>Docs Cuba</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${list.map(shipment=>{const unassigned=!shipment.client_id,importer=importerForShipment(shipment),client=unassigned?'<span class="container-client-unassigned">SIN CLIENTE</span><span class="container-sale-note">Disponible para venta</span>':esc(shipment.clients?.name||'Cliente no disponible');return `<tr class="${unassigned?'container-unassigned-row':''}" data-shipment-row="${esc(shipment.id)}"><td><b>${esc(shipment.container_number)}</b><br><span class="muted">${esc(shipment.carrier||'')}</span></td><td>${client}</td><td>${importer?`<span class="container-importer-pill">${esc(importer.name)}</span>`:'<span class="muted">Sin definir</span>'}</td><td>${esc(shipment.product||'—')}</td><td>${esc(formatQuantity(shipment))}</td><td>${esc(formatDate(shipment.departure_date))}</td><td>${esc(shipment.booking_number||'—')}<br><span class="muted">${esc(shipment.bol_number||'—')}</span></td><td>${actionAllowed(shipment,'view_documents')?docPill(readinessFor(shipment.id)):'<span class="container-doc-state restricted">Sin acceso</span>'}</td><td><span class="pill ${shipment.active===false?'done':''}">${esc(shipment.operational_status||shipment.last_status||'Registrado')}</span><span class="container-mode">Seguimiento ERP</span></td><td class="container-actions-cell"><button type="button" class="container-actions-trigger" data-container-menu="${esc(shipment.id)}" aria-label="Acciones">⋯</button></td></tr>`;}).join('')}</tbody></table><div class="container-list-footer">${list.length} contenedor${list.length===1?'':'es'}${list.length!==rows().length?` visibles · ${rows().length} registrados`:''}</div>`;
  }

  async function saveShipmentRecord(){
    if(!shipmentWriteAccess())return note('No tienes permiso para registrar contenedores.');
    const button=byId('saveShipment');if(!button||button.disabled)return;
    const containerNumber=norm(byId('shipmentContainer')?.value||'');
    if(!/^[A-Z]{4}\d{7}$/.test(containerNumber))return note('El contenedor debe tener 4 letras y 7 números.');
    const quantityText=String(byId('shipmentQuantity')?.value||'').trim();if(quantityText&&(!Number.isFinite(Number(quantityText))||Number(quantityText)<0))return note('La cantidad no es válida.');
    const clientId=byId('shipmentClient')?.value||null,importerName=String(byId('shipmentImporter')?.value||'').trim(),original=button.textContent;button.disabled=true;button.textContent='Guardando...';let rollbackId=null;
    try{
      const result=await request('/api/shipments',{method:'POST',body:JSON.stringify({client_id:clientId,container_number:containerNumber,booking_number:byId('shipmentBooking')?.value||'',bol_number:byId('shipmentBol')?.value||'',carrier:byId('shipmentCarrier')?.value||'',product:byId('shipmentProduct')?.value||'',quantity:quantityText||null,quantity_unit:byId('shipmentQuantityUnit')?.value||'',departure_date:byId('shipmentDepartureDate')?.value||null})});
      rollbackId=result.shipment?.id||null;
      if(rollbackId&&importerName){try{await assignImporterToShipment(rollbackId,importerName);}catch(error){try{await request('/api/shipments?id='+encodeURIComponent(rollbackId),{method:'DELETE'});}catch{}rollbackId=null;throw error;}}
      rollbackId=null;note(result.shipment?.client_id?'Contenedor registrado correctamente.':'Contenedor registrado sin cliente y disponible para venta.',true);
      ['shipmentContainer','shipmentBooking','shipmentBol','shipmentCarrier','shipmentProduct','shipmentQuantity','shipmentQuantityUnit','shipmentDepartureDate'].forEach(id=>{if(byId(id))byId(id).value='';});if(byId('shipmentClient'))byId('shipmentClient').value='';if(byId('shipmentImporter'))byId('shipmentImporter').value='';
      await window.loadAll?.();await loadImporterState();await loadReadiness();syncImporterInput();render();
    }catch(error){note(error.message);}finally{button.disabled=false;button.textContent=original;}
  }

  function findShipment(id){return rows().find(x=>String(x.id)===String(id));}
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
  function ensureMenu(){let menu=byId('containerActionsPopover');if(menu)return menu;menu=document.createElement('div');menu.id='containerActionsPopover';menu.className='container-actions-popover hidden';document.body.appendChild(menu);document.addEventListener('click',event=>{if(!menu.classList.contains('hidden')&&!menu.contains(event.target)&&!menuTrigger?.contains(event.target))closeActionMenu();});window.addEventListener('resize',closeActionMenu);window.addEventListener('scroll',closeActionMenu,true);return menu;}
  function closeActionMenu(){const menu=byId('containerActionsPopover');menu?.classList.add('hidden');if(menu)menu.innerHTML='';menuShipmentId=null;menuTrigger=null;}
  function positionMenu(menu,trigger){if(window.matchMedia('(max-width:760px)').matches)return;const rect=trigger.getBoundingClientRect(),width=Math.min(300,window.innerWidth-24),left=Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12));menu.style.left=`${left}px`;menu.style.right='auto';menu.style.bottom='auto';menu.style.top='0px';menu.classList.remove('hidden');const h=menu.offsetHeight;let top=rect.bottom+8;if(top+h>window.innerHeight-12)top=Math.max(12,rect.top-h-8);menu.style.top=`${top}px`;}
  function openActionMenu(shipment,trigger){const menu=ensureMenu();if(menuShipmentId===shipment.id&&!menu.classList.contains('hidden'))return closeActionMenu();closeActionMenu();menuShipmentId=shipment.id;menuTrigger=trigger;const actions=actionList(shipment);menu.innerHTML=actions.map(([key,label,cls],index)=>`${key==='delete'&&index?'<div class="container-actions-separator"></div>':''}<button type="button" class="${cls}" data-container-action="${key}">${esc(label)}</button>`).join('')||'<div class="muted" style="padding:12px">Sin acciones disponibles.</div>';menu.querySelectorAll('[data-container-action]').forEach(button=>button.onclick=async event=>{event.stopPropagation();const action=button.dataset.containerAction;closeActionMenu();try{await executeAction(shipment,action);}catch(error){showToast(error.message,false);}});menu.classList.remove('hidden');positionMenu(menu,trigger);}

  function detailRow(label,value){return `<div class="container-detail-row"><div class="container-detail-label">${esc(label)}</div><div class="container-detail-value">${esc(value||'No disponible')}</div></div>`;}
  function latestDocument(documents,type){return documents.find(item=>item.document_type===type&&item.is_current)||null;}
  function versionsForType(documents,type){return documents.filter(item=>item.document_type===type).sort((a,b)=>Number(b.version||0)-Number(a.version||0));}
  function versionStateLabel(item){if(item.state==='deleted')return 'Eliminada';if(item.state==='superseded')return 'Sustituida';return 'Vigente';}
  function documentStatusText(readiness){if(!readiness||readiness.document_status==='not_required')return 'Todavía no es obligatorio. Puedes adelantar los documentos antes de la salida.';if(readiness.document_status==='ready')return 'READY · El contenedor tiene los dos documentos oficiales vigentes de Cuba.';const missing=(readiness.missing_documents||[]).map(x=>x==='Commercial Invoice Cuba'?'Factura comercial Cuba':x);return `Pendiente · Falta ${missing.join(' y ')}.`;}
  function versionHistoryHtml(items){const historical=items.filter(item=>!item.is_current);if(!historical.length)return '';return `<div class="container-customs-versions"><div class="container-customs-versions-title">Versiones anteriores</div><div class="container-customs-version-list">${historical.map(item=>`<div class="container-customs-version"><div class="container-customs-version-main"><b>v${esc(item.version||1)} · ${esc(item.file_name)}</b><small>${esc(formatDateTime(item.created_at))}${item.uploaded_by_username?` · ${esc(item.uploaded_by_username)}`:''}</small></div><div style="display:flex;gap:6px;align-items:center"><span class="container-customs-version-state ${esc(item.state||'superseded')}">${esc(versionStateLabel(item))}</span>${item.signed_url?`<button class="alt" type="button" data-customs-open="${esc(item.id)}">Ver</button>`:''}</div></div>`).join('')}</div></div>`;}
  function customsHtml(shipment,payload,error=''){
    if(!actionAllowed(shipment,'view_documents'))return '<section class="container-customs"><div class="container-customs-head"><div><h3>Documentos Cuba</h3><div class="container-customs-summary">No tienes permiso para consultar documentos del contenedor.</div></div></div><div class="container-customs-noaccess">Solicita acceso a Documentos para consultar readiness, archivos y versiones.</div></section>';
    if(error)return `<section class="container-customs"><div class="container-customs-head"><div><h3>Documentos Cuba</h3><div class="container-customs-summary">${esc(error)}</div></div></div></section>`;
    const readiness=payload?.readiness||readinessFor(shipment.id),documents=payload?.documents||[],writable=window.ExportMcaAccessControl?.can?.('documents.write')===true;
    return `<section class="container-customs"><div class="container-customs-head"><div><h3>Documentos Cuba</h3><div class="container-customs-summary">${esc(documentStatusText(readiness))}</div></div>${docPill(readiness)}</div><div class="container-customs-grid"><div id="containerCustomsFeedback" class="container-customs-feedback"></div>${CUSTOMS_TYPES.map(def=>{const versions=versionsForType(documents,def.type),item=latestDocument(documents,def.type);return `<div class="container-customs-card ${item?'complete':'pending'}"><div class="container-customs-title"><b>${esc(def.label)}</b>${item?'<span class="container-doc-state ready">VIGENTE</span>':'<span class="container-doc-state pending">PENDIENTE</span>'}</div>${item?`<div class="container-customs-meta">v${esc(item.version||1)} · ${esc(item.file_name)} · ${esc(formatDateTime(item.created_at))}${item.uploaded_by_username?` · ${esc(item.uploaded_by_username)}`:''}</div>`:'<div class="container-customs-meta">Debe ser el documento oficial preparado para Cuba, no el packing list del almacén.</div>'}<div class="container-customs-actions">${item?.signed_url?`<button class="alt" type="button" data-customs-open="${esc(item.id)}">Ver vigente</button>`:''}${writable?`<button class="orange" type="button" data-customs-upload="${esc(def.key)}">${item?'Subir nueva versión':'Subir archivo'}</button>`:''}${writable&&item?`<button class="danger" type="button" data-customs-delete="${esc(item.id)}">Eliminar vigente</button>`:''}</div>${versionHistoryHtml(versions)}</div>`;}).join('')}<div class="container-customs-note">READY se calcula automáticamente usando únicamente la <b>versión vigente</b> de <b>Packing List Cuba</b> + <b>Factura comercial Cuba</b> cargadas manualmente.</div></div></section>`;
  }
  async function loadShipmentDocuments(shipment){if(!actionAllowed(shipment,'view_documents'))return null;return request('/api/shipment-documents?shipment_id='+encodeURIComponent(shipment.id));}
  function setCustomsFeedback(message,ok=false){const node=byId('containerCustomsFeedback');if(!node)return;node.textContent=message||'';node.className=`container-customs-feedback ${message?(ok?'ok':'bad'):''}`;}
  function broadcastCustomsChange(shipmentId){const detail={shipment_id:String(shipmentId)};window.dispatchEvent(new CustomEvent('export-mca:shipment-documents-changed',{detail}));document.querySelectorAll('iframe').forEach(frame=>{try{frame.contentWindow?.SalesWorkspace?.reload?.({keepTab:true});frame.contentWindow?.dispatchEvent?.(new CustomEvent('export-mca:shipment-documents-changed',{detail}));}catch{}});}
  async function refreshAfterCustomsChange(shipment,payload=null){if(payload?.readiness)readinessByShipment.set(String(shipment.id),payload.readiness);else await loadReadiness();await window.TasksWorkspace?.load?.();broadcastCustomsChange(shipment.id);await openDetails(findShipment(shipment.id)||shipment);}
  async function uploadCustomsDocument(shipment,key){
    if(window.ExportMcaAccessControl?.can?.('documents.write')!==true)return setCustomsFeedback('No tienes permiso para subir documentos.',false);
    const def=CUSTOMS_TYPES.find(x=>x.key===key);if(!def)return;const input=document.createElement('input');input.type='file';input.accept='.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp';input.style.display='none';document.body.appendChild(input);
    input.onchange=async()=>{const file=input.files?.[0];input.remove();if(!file)return;let prepared=null;setCustomsFeedback('Preparando carga...',true);try{const result=await request('/api/shipment-documents',{method:'POST',body:JSON.stringify({action:'prepare_upload',shipment_id:shipment.id,document_type:def.key,file_name:file.name,mime_type:file.type,file_size_bytes:file.size})});prepared=result.upload;const form=new FormData();form.append('cacheControl','3600');form.append('',file);const storageResponse=await fetch(prepared.signed_url,{method:'PUT',headers:{'x-upsert':'false'},body:form});if(!storageResponse.ok){const detail=await storageResponse.text().catch(()=>'');await request('/api/shipment-documents',{method:'POST',body:JSON.stringify({action:'discard_upload',shipment_id:shipment.id,storage_path:prepared.storage_path})}).catch(()=>{});throw new Error(`No se pudo subir el archivo${detail?' · '+detail.slice(0,160):''}`);}const finalized=await request('/api/shipment-documents',{method:'POST',body:JSON.stringify({action:'finalize_upload',shipment_id:shipment.id,document_type:prepared.document_type,file_name:prepared.file_name,mime_type:prepared.mime_type,file_size_bytes:prepared.file_size_bytes,storage_path:prepared.storage_path})});await refreshAfterCustomsChange(shipment,finalized);setCustomsFeedback(`${def.label} actualizado correctamente.`,true);}catch(error){setCustomsFeedback(error.message||'No se pudo subir el documento.',false);}};
    input.click();
  }
  async function deleteCustomsDocument(shipment,item){
    if(window.ExportMcaAccessControl?.can?.('documents.write')!==true)return setCustomsFeedback('No tienes permiso para eliminar documentos.',false);
    if(!item?.is_current)return setCustomsFeedback('Solo puede retirarse la versión vigente.',false);
    const accepted=await decision({title:'Eliminar versión vigente',text:`Se retirará ${item.file_name} del contenedor ${shipment.container_number}. La versión quedará registrada en el historial.`,button:'Eliminar vigente',danger:true});if(!accepted)return;
    setCustomsFeedback('Eliminando versión vigente...',true);
    try{const result=await request('/api/shipment-documents',{method:'DELETE',body:JSON.stringify({document_id:item.id})});await refreshAfterCustomsChange(shipment,result);if(result.storage_cleanup_pending)setCustomsFeedback('Documento retirado del ERP. La limpieza física quedó pendiente para reintento.',false);else setCustomsFeedback('Versión vigente eliminada. El readiness fue recalculado.',true);}catch(error){setCustomsFeedback(error.message||'No se pudo eliminar el documento.',false);}
  }

  async function openDetails(shipment){
    if(!(actionAllowed(shipment,'view_info')||actionAllowed(shipment,'view_documents')))return;
    const client=shipment.clients||{},importer=importerForShipment(shipment);let payload=null,error='',loadLink=null;
    if(actionAllowed(shipment,'view_documents')){try{payload=await loadShipmentDocuments(shipment);if(payload?.readiness)readinessByShipment.set(String(shipment.id),payload.readiness);}catch(e){error='No se pudieron cargar los documentos Cuba.';console.error('[tracking customs docs]',e);}}
    try{loadLink=await window.OperationalNavigation?.loadForShipment?.(shipment.id)||null;}catch{}
    const loadHtml=loadLink?`<section class="container-origin"><div><div class="container-origin-label">Origen de almacén</div><div class="container-origin-title">${esc(loadLink.load_number||'Cargue')}</div><div class="container-origin-meta">${esc(loadLink.load_status||'Estado no disponible')} · vinculado desde Cargues.</div></div><button id="containerOpenLoad" class="alt" type="button">Ver cargue</button></section>`:'';
    window.openModal?.(`Detalles · ${shipment.container_number}`,`<div class="container-details-grid"><section><h3 style="margin:0 0 8px;color:#06204a">Cliente</h3>${detailRow('Nombre',shipment.client_id?client.name:'SIN CLIENTE · Disponible para venta')}${detailRow('Empresa',client.company)}${detailRow('WhatsApp',client.phone)}${detailRow('Importadora',importer?.name)}</section><section><h3 style="margin:0 0 8px;color:#06204a">Contenedor</h3>${detailRow('Número',shipment.container_number)}${detailRow('Producto',shipment.product)}${detailRow('Cantidad',formatQuantity(shipment))}${detailRow('Fecha salida',formatDate(shipment.departure_date))}${detailRow('Booking',shipment.booking_number)}${detailRow('B/L',shipment.bol_number)}${detailRow('Naviera',shipment.carrier)}${detailRow('Estado operativo',shipment.operational_status||shipment.last_status)}${detailRow('Ubicación',shipment.last_location)}${detailRow('Tracking','Seguimiento ERP')}</section>${loadHtml}${customsHtml(shipment,payload,error)}</div>`);
    const map=new Map((payload?.documents||[]).map(x=>[String(x.id),x]));
    document.querySelectorAll('[data-customs-open]').forEach(button=>button.onclick=()=>{const item=map.get(String(button.dataset.customsOpen));if(item?.signed_url)window.open(item.signed_url,'_blank','noopener');});
    document.querySelectorAll('[data-customs-upload]').forEach(button=>button.onclick=()=>uploadCustomsDocument(shipment,button.dataset.customsUpload));
    document.querySelectorAll('[data-customs-delete]').forEach(button=>button.onclick=()=>{const item=map.get(String(button.dataset.customsDelete));if(item)deleteCustomsDocument(shipment,item);});
    if(loadLink)byId('containerOpenLoad')?.addEventListener('click',()=>window.OperationalNavigation?.openLoad?.({loadId:loadLink.load_id}),{once:true});
    render();
  }
  async function openHistory(shipment){if(!actionAllowed(shipment,'view_history'))return;const result=await request('/api/history?shipment_id='+encodeURIComponent(shipment.id));const events=[...(result.events||[]),...(result.notifications||[]).map(item=>({title:'Notificación · '+(item.event_type||item.event_status||''),details:item.error_message||item.message||item.status||'',created_at:item.created_at})),...(result.audit_events||[]).map(item=>({title:item.title||item.action||'Cambio administrativo',details:typeof item.details==='string'?item.details:JSON.stringify(item.details||{}),created_at:item.created_at}))].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));window.openModal?.(`Historial · ${shipment.container_number}`,events.length?`<div class="timeline">${events.map(item=>`<div class="event"><b>${esc(item.title||'Evento')}</b><div>${esc(item.details||'')}</div><div class="muted">${item.created_at?new Date(item.created_at).toLocaleString('es-US'):'—'}</div></div>`).join('')}</div>`:'<div class="empty-state">No hay historial disponible.</div>');}

  function currentEventIndex(shipment){const status=String(shipment.last_status||shipment.operational_status||'').trim().toLowerCase();return EVENTS.findIndex(x=>x.label.toLowerCase()===status);}
  function closeManualWorkflow(){document.querySelector('.container-overlay[data-manual-track]')?.remove();}
  function manualResultMessage(result){const correction=result.correction_type==='rollback'?'Corrección guardada. ':'';if(result.notification_status==='failed')return `${correction}Estado actualizado, pero falló WhatsApp: ${result.notification_error||'Error desconocido'}`;if(['queued','sent','delivered','read'].includes(String(result.notification_status||'').toLowerCase()))return `${correction}Estado actualizado y WhatsApp procesado.`;if(result.notification_status==='unavailable_recipient'||result.notification_status==='pending_template')return `${correction}Estado actualizado. La notificación quedó pendiente o no disponible.`;return `${correction}Estado actualizado.`;}
  function openManualWorkflow(shipment){
    if(!actionAllowed(shipment,'manual_tracking'))return;
    closeManualWorkflow();const currentIndex=currentEventIndex(shipment),currentLabel=currentIndex>=0?EVENTS[currentIndex].label:(shipment.last_status||shipment.operational_status||'Registrado'),defaultIndex=currentIndex>=0?currentIndex:0,hasRecipient=Boolean(shipment.client_id&&shipment.clients?.active&&shipment.clients?.phone);
    const overlay=document.createElement('div');overlay.className='container-overlay';overlay.dataset.manualTrack='1';overlay.innerHTML=`<div class="container-dialog" role="dialog" aria-modal="true"><div class="manual-track-head"><div><h3>Actualizar / corregir tracking</h3><div class="muted">${esc(shipment.container_number)}</div></div><button type="button" class="manual-track-close">Cerrar</button></div><div class="manual-track-current-box"><small>Estado actual</small><br><b>${esc(currentLabel)}</b></div><div class="manual-track-list">${EVENTS.map((event,index)=>`<label class="manual-track-step ${index===currentIndex?'current selected':''}" data-index="${index}"><div class="manual-track-step-index">${index===currentIndex?'●':index+1}</div><div><div class="manual-track-step-title">${esc(event.label)}</div><div class="manual-track-step-note">${index===currentIndex?'Estado actual':event.whatsapp?'WhatsApp automático':'Sin WhatsApp'}</div></div><input style="position:absolute;opacity:0" type="radio" name="manualTrackingEvent" value="${event.key}" ${index===defaultIndex?'checked':''}></label>`).join('')}</div><div class="manual-track-field"><label>Puerto o ubicación</label><input id="manualTrackingLocation" value="${esc(shipment.last_location||'')}"></div><div id="manualTrackingNotice" class="manual-track-notice"></div><div class="manual-track-actions"><button type="button" class="manual-track-confirm">Guardar estado</button><button type="button" class="manual-track-cancel">Cancelar</button></div></div>`;
    document.body.appendChild(overlay);
    const notice=overlay.querySelector('#manualTrackingNotice');
    const syncNotice=()=>{const key=overlay.querySelector('input[name="manualTrackingEvent"]:checked')?.value,selected=EVENTS.find(x=>x.key===key);if(!selected)return;if(selected.whatsapp){notice.className='manual-track-notice whatsapp';notice.textContent=hasRecipient?'Este hito enviará WhatsApp automáticamente al cliente.':'Este hito requiere WhatsApp, pero el contenedor no tiene un cliente activo con teléfono.';}else{notice.className='manual-track-notice';notice.textContent='Este hito actualiza el ERP y no envía WhatsApp.';}};
    overlay.querySelector('.manual-track-close').onclick=closeManualWorkflow;overlay.querySelector('.manual-track-cancel').onclick=closeManualWorkflow;overlay.onclick=e=>{if(e.target===overlay)closeManualWorkflow();};overlay.querySelectorAll('.manual-track-step').forEach(step=>step.onclick=()=>{step.querySelector('input').checked=true;overlay.querySelectorAll('.manual-track-step').forEach(x=>x.classList.toggle('selected',x===step));syncNotice();});syncNotice();
    const button=overlay.querySelector('.manual-track-confirm');button.onclick=async()=>{const key=overlay.querySelector('input[name="manualTrackingEvent"]:checked')?.value,selected=EVENTS.find(x=>x.key===key);if(!selected)return;try{button.disabled=true;button.textContent='Guardando...';const result=await request('/api/manual-tracking-event',{method:'PATCH',body:JSON.stringify({id:shipment.id,event:selected.key,location:String(overlay.querySelector('#manualTrackingLocation')?.value||'').trim()})});closeManualWorkflow();showToast(manualResultMessage(result),result.notification_status!=='failed');await window.loadAll?.();await window.loadNotifications?.();}catch(error){notice.className='manual-track-notice';notice.textContent=error.message;button.disabled=false;button.textContent='Guardar estado';}};
  }

  function openEditor(shipment,focus=null){const cap=focus==='client'?'assign_client':'edit';if(!actionAllowed(shipment,cap))return;if(!window.ShipmentEditor?.open)throw new Error('El editor de contenedores no está disponible.');window.ShipmentEditor.open(shipment.id,{focus});}
  async function deleteShipmentRecord(shipment){if(!actionAllowed(shipment,'delete'))return;const accepted=await decision({title:'Eliminar contenedor',text:`Esta acción elimina definitivamente ${shipment.container_number} del ERP.`,button:'Eliminar definitivamente',danger:true,typed:'ELIMINAR'});if(!accepted)return;await request('/api/shipments?id='+encodeURIComponent(shipment.id),{method:'DELETE'});showToast('Contenedor eliminado.',true);await window.loadAll?.();await loadReadiness();await window.loadNotifications?.();}
  async function executeAction(shipment,action){
    if(action==='info'||action==='documents')return openDetails(shipment);
    if(action==='history')return openHistory(shipment);
    if(action==='edit')return openEditor(shipment);
    if(action==='assign_client')return openEditor(shipment,'client');
    if(action==='manual_update')return openManualWorkflow(shipment);
    const capAction=action;
    if(['release','deliver','reactivate'].includes(action)){
      if(!actionAllowed(shipment,capAction))return;
      const copy={release:['Liberar contenedor','La liberación procesará WhatsApp automáticamente cuando exista un destinatario elegible.','Liberar'],deliver:['Marcar entregado','El contenedor pasará al estado entregado.','Marcar entregado'],reactivate:['Reactivar contenedor','El contenedor volverá a estar activo para operación.','Reactivar']}[action];
      if(!await decision({title:copy[0],text:copy[1],button:copy[2],danger:false}))return;
      await request('/api/shipments',{method:'PATCH',body:JSON.stringify({id:shipment.id,action})});showToast('Acción aplicada correctamente.',true);await window.loadAll?.();await loadReadiness();await request('/api/tracking-alerts?action=check').catch(()=>{});await window.loadNotifications?.();return;
    }
    if(action==='delete')return deleteShipmentRecord(shipment);
  }

  function bind(){byId('saveShipment')?.addEventListener('click',saveShipmentRecord);byId('shipmentSearch')?.addEventListener('input',render);document.querySelectorAll('[data-container-filter]').forEach(button=>button.addEventListener('click',()=>{activeFilter=button.dataset.containerFilter;document.querySelectorAll('[data-container-filter]').forEach(x=>x.classList.toggle('active',x===button));render();}));byId('shipments')?.addEventListener('click',event=>{const trigger=event.target.closest('[data-container-menu]');if(trigger){event.stopPropagation();const shipment=findShipment(trigger.dataset.containerMenu);if(shipment)openActionMenu(shipment,trigger);return;}const row=event.target.closest('[data-shipment-row]');if(!row||event.target.closest('button,a,input,select,textarea'))return;const shipment=findShipment(row.dataset.shipmentRow);if(shipment&&actionAllowed(shipment,'view_info'))openDetails(shipment);});}
  async function syncData(){syncClientSelect();syncImporterInput();await loadReadiness();render();}
  async function refreshImporters(){await loadImporterState();syncImporterInput();render();}
  async function mount(){if(!byId('registerContainerSection')||!byId('containersSection')||!byId('shipments')||!byId('saveShipment')){console.error('CONTAINERS_STATIC_STRUCTURE_MISSING');return;}installStyles();ensureRegistrationImporterField();await Promise.all([loadImporterState(),loadReadiness()]);bind();syncClientSelect();syncImporterInput();render();window.addEventListener('export-mca:data-loaded',syncData);window.addEventListener('export-mca:clients-changed',syncClientSelect);window.addEventListener('export-mca:importers-changed',refreshImporters);window.ContainersModule=Object.freeze({render,syncClients:syncClientSelect,syncImporters:refreshImporters,openManualWorkflow,openDetails,owner:'containers-module.js',trackingOwner:'erp'});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
