(() => {
  if(window.__operationalNavigationInstalled)return;
  window.__operationalNavigationInstalled=true;

  const normalize=value=>String(value||'').trim().toUpperCase();
  const CONTEXT_SECTIONS=['suppliersSection','purchasesSection','salesSection','warehouseSection','inventorySection','loadsSection','invoicesSection','payablesSection'];
  const BRIDGE_SRC='/admin/operational-context-bridge.js?v=20260830-p6';
  const ENTITY_ACCESS=Object.freeze({
    client:{label:'Clientes',permissions:['clients.read']},
    sales_order:{label:'Ventas',permissions:['sales.read']},
    purchase_order:{label:'Compras',permissions:['procurement.read']},
    warehouse_receipt:{label:'Almacén',permissions:['warehouse.read']},
    load:{label:'Logística',permissions:['logistics.read']},
    shipment:{label:'Logística',permissions:['logistics.read']},
    invoice:{label:'Facturación',permissions:['finance.read']},
    supplier_bill:{label:'Cuentas por pagar',permissions:['finance.read']},
    supplier:{label:'Compras',permissions:['procurement.read']}
  });
  const WORKFLOW_ACCESS=Object.freeze({
    sales_supply_planning:{label:'Abastecimiento de Ventas',permissions:['sales.read','sales.write']},
    sales_procurement_linkage:{label:'Abastecimiento de Ventas',permissions:['sales.read','sales.write']},
    purchase_receipt:{label:'Compras y Almacén',permissions:['procurement.read','warehouse.write']},
    direct_fulfillment:{label:'Direct Ship',permissions:['sales.read','sales.write']},
    prepare_load:{label:'Ventas y Logística',permissions:['sales.read','logistics.write']},
    shipment_cuba_documents:{label:'Documentos Cuba',permissions:['logistics.read','documents.read','documents.write']},
    sales_invoice:{label:'Facturación',permissions:['finance.read','finance.write']},
    invoice_collection:{label:'Cobros',permissions:['finance.read','finance.write']},
    supplier_bill_payment:{label:'Cuentas por pagar',permissions:['finance.read','finance.write']}
  });

  let cache=null,pending=null,restoring=false;
  const section=id=>typeof window.showSection==='function'?window.showSection(id):false;
  const frameFor=id=>document.querySelector(`#${id} iframe`);
  const can=permission=>window.ExportMcaAccessControl?.can?.(permission)===true;
  const missing=permissions=>(permissions||[]).filter(permission=>!can(permission));
  const permissionLabel=permission=>({
    'clients.read':'ver Clientes','sales.read':'ver Ventas','sales.write':'gestionar Ventas',
    'procurement.read':'ver Compras','procurement.write':'gestionar Compras','warehouse.read':'ver Almacén','warehouse.write':'recibir en Almacén',
    'logistics.read':'ver Logística','logistics.write':'gestionar Logística','documents.read':'ver Documentos','documents.write':'gestionar Documentos',
    'finance.read':'ver Finanzas','finance.write':'gestionar Finanzas'
  })[permission]||permission;

  function requireAccess(spec,context='este trabajo'){
    const absent=missing(spec?.permissions||[]);
    if(!absent.length)return true;
    const detail=absent.map(permissionLabel).join(', ');
    const error=new Error(`No tienes acceso para ${context}. Falta permiso para ${detail}.`);
    error.code='WORK_DESTINATION_FORBIDDEN';
    error.missing_permissions=absent;
    error.destination=spec?.label||null;
    throw error;
  }

  async function requestLinks({refresh=false}={}){
    if(!refresh&&cache)return cache;if(pending)return pending;
    const token=localStorage.getItem('export_mca_token')||'';
    pending=fetch('/api/operational-links',{headers:token?{Authorization:`Bearer ${token}`}:{}}).then(async response=>{
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'No se pudieron cargar los enlaces operativos');
      cache={
        links:Array.isArray(data.links)?data.links:[],
        purchases:Array.isArray(data.purchases)?data.purchases:[],
        receipts:Array.isArray(data.receipts)?data.receipts:[],
        sales:Array.isArray(data.sales)?data.sales:[],
        invoices:Array.isArray(data.invoices)?data.invoices:[],
        supplier_bills:Array.isArray(data.supplier_bills)?data.supplier_bills:[]
      };
      return cache;
    }).finally(()=>{pending=null;});
    return pending;
  }

  function invalidateLinks(){cache=null;}
  function writeContext(type,value,{replace=false}={}){
    if(restoring||!type||!value)return;
    const hash=`#${new URLSearchParams({opnav:type,id:String(value).trim()}).toString()}`;
    if(location.hash===hash)return;
    history[replace?'replaceState':'pushState']({...history.state,operationalContext:{type,id:String(value)}},'',hash);
  }
  function readContext(){if(!location.hash)return null;const params=new URLSearchParams(location.hash.slice(1)),type=params.get('opnav'),id=params.get('id');return type&&id?{type,id}:null;}
  function findShipment({shipmentId=null,containerNumber=null}={}){
    const rows=Array.isArray(window.shipments)?window.shipments:[];
    if(shipmentId){const found=rows.find(row=>String(row.id)===String(shipmentId));if(found)return found;}
    const container=normalize(containerNumber);
    return container?rows.find(row=>normalize(row.container_number)===container)||null:null;
  }

  async function loadForShipment(shipmentId){if(!shipmentId)return null;const data=await requestLinks();return data.links.find(row=>String(row.shipment_id)===String(shipmentId))||null;}
  async function loadById(loadId){if(!loadId)return null;const data=await requestLinks();return data.links.find(row=>String(row.load_id)===String(loadId))||null;}
  async function loadsForReceipt(receiptNumber){const receipt=normalize(receiptNumber);if(!receipt)return[];const data=await requestLinks();return data.links.filter(row=>Array.isArray(row.receipt_numbers)&&row.receipt_numbers.some(value=>normalize(value)===receipt));}
  async function purchaseOrdersForSupplier(supplierId){if(!supplierId)return[];const data=await requestLinks();return data.purchases.filter(row=>String(row.supplier_id||'')===String(supplierId));}
  async function receiptsForSupplier(supplierId){if(!supplierId)return[];const data=await requestLinks();return data.receipts.filter(row=>String(row.supplier_id||'')===String(supplierId));}
  async function purchaseOrdersForReceipt(receiptNumber){const receipt=normalize(receiptNumber);if(!receipt)return[];const data=await requestLinks();return data.purchases.filter(row=>Array.isArray(row.receipts)&&row.receipts.some(item=>normalize(item.receipt_number)===receipt));}
  async function receiptsForPurchase(purchaseOrderId){if(!purchaseOrderId)return[];const data=await requestLinks();return data.purchases.find(row=>String(row.purchase_order_id)===String(purchaseOrderId))?.receipts||[];}
  async function purchaseByNumber(poNumber){const po=normalize(poNumber);if(!po)return null;const data=await requestLinks();return data.purchases.find(row=>normalize(row.po_number)===po)||null;}
  async function receiptByNumber(receiptNumber){const receipt=normalize(receiptNumber);if(!receipt)return null;const data=await requestLinks();return data.receipts.find(row=>normalize(row.receipt_number)===receipt)||null;}
  async function salesOrdersForClient(clientId){if(!clientId)return[];const data=await requestLinks();return data.sales.filter(row=>String(row.client_id||'')===String(clientId));}
  async function loadsForSalesOrder(salesOrderId){if(!salesOrderId)return[];const data=await requestLinks();return data.sales.find(row=>String(row.sales_order_id)===String(salesOrderId))?.loads||[];}
  async function directShipmentsForSalesOrder(salesOrderId){if(!salesOrderId)return[];const data=await requestLinks();return data.sales.find(row=>String(row.sales_order_id)===String(salesOrderId))?.direct_shipments||[];}
  async function salesOrdersForLoad(loadId){if(!loadId)return[];const data=await requestLinks();return data.links.find(row=>String(row.load_id)===String(loadId))?.sales_orders||[];}
  async function salesOrdersForReceipt(receiptNumber){const receipt=normalize(receiptNumber);if(!receipt)return[];const data=await requestLinks();return data.sales.filter(order=>Array.isArray(order.loads)&&order.loads.some(load=>Array.isArray(load.receipt_numbers)&&load.receipt_numbers.some(value=>normalize(value)===receipt)));}
  async function salesByNumber(soNumber){const so=normalize(soNumber);if(!so)return null;const data=await requestLinks();return data.sales.find(row=>normalize(row.so_number)===so)||null;}
  async function saleById(salesOrderId){if(!salesOrderId)return null;const data=await requestLinks();return data.sales.find(row=>String(row.sales_order_id)===String(salesOrderId))||null;}
  async function invoicesForSalesOrder(salesOrderId){if(!salesOrderId)return[];const data=await requestLinks();return data.invoices.filter(row=>String(row.sales_order_id||'')===String(salesOrderId));}
  async function invoiceById(invoiceId){if(!invoiceId)return null;const data=await requestLinks();return data.invoices.find(row=>String(row.invoice_id)===String(invoiceId))||null;}
  async function supplierBillById(billId){if(!billId)return null;const data=await requestLinks();return data.supplier_bills.find(row=>String(row.supplier_bill_id)===String(billId))||null;}

  function installBridge(sectionId){
    const frame=frameFor(sectionId);if(!frame)return Promise.resolve(false);
    const inject=()=>new Promise(resolve=>{
      const win=frame.contentWindow,doc=frame.contentDocument;if(!win||!doc)return resolve(false);
      if(win.OperationalContextBridge?.ready)return resolve(true);
      let settled=false,timer=null;
      const finish=value=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);resolve(value);};
      win.addEventListener('export-mca:context-bridge-ready',()=>finish(true),{once:true});
      let script=doc.getElementById('operationalContextBridgeScript');
      if(!script){script=doc.createElement('script');script.id='operationalContextBridgeScript';script.src=BRIDGE_SRC;script.async=false;script.onerror=()=>finish(false);(doc.head||doc.documentElement).appendChild(script);}
      timer=setTimeout(()=>finish(Boolean(win.OperationalContextBridge?.ready)),2500);
    });
    if(frame.contentDocument?.readyState==='complete')return inject();
    return new Promise(resolve=>frame.addEventListener('load',()=>inject().then(resolve),{once:true}));
  }
  function installAllBridges(){CONTEXT_SECTIONS.forEach(id=>installBridge(id).catch(error=>console.error('[operational bridge]',id,error)));}
  function resolveMethod(win,path){
    const parts=String(path||'').split('.').filter(Boolean);if(!win||!parts.length)return null;
    let owner=win;
    for(let i=0;i<parts.length-1;i++){owner=owner?.[parts[i]];if(!owner)return null;}
    const fn=owner?.[parts.at(-1)];return typeof fn==='function'?fn.bind(owner):null;
  }
  function callEmbedded(sectionId,method,args=[]){
    const frame=frameFor(sectionId);if(!frame)return false;
    const invoke=()=>{try{const fn=resolveMethod(frame.contentWindow,method);if(!fn)return false;fn(...args);return true;}catch(error){console.error('[operational navigation embedded]',sectionId,method,error);return false;}};
    if(frame.contentDocument?.readyState==='complete'){requestAnimationFrame(invoke);return true;}
    frame.addEventListener('load',()=>requestAnimationFrame(invoke),{once:true});return true;
  }
  async function callContextEmbedded(sectionId,method,args=[]){const ready=await installBridge(sectionId);if(!ready)return false;const fn=resolveMethod(frameFor(sectionId)?.contentWindow,method);if(!fn)return false;fn(...args);return true;}

  function openTracking(context={},options={}){section('containersSection');const shipment=findShipment(context);if(!shipment)return false;if(options.history!==false)writeContext('tracking',shipment.id,options);requestAnimationFrame(()=>window.ContainersModule?.openDetails?.(shipment));return true;}
  function openLoad({loadId=null}={},options={}){if(!loadId)return false;if(options.history!==false)writeContext('load',loadId,options);window.NavigationShell?.openLoads?.();installBridge('loadsSection').then(ready=>{if(ready&&callEmbedded('loadsSection','openOperationalLoad',[loadId]))return;callEmbedded('loadsSection','openLoad',[loadId]);}).catch(()=>callEmbedded('loadsSection','openLoad',[loadId]));return true;}
  async function openLoadForShipment(shipmentId,options={}){const link=await loadForShipment(shipmentId);return link?openLoad({loadId:link.load_id},options):false;}
  function openInventoryReceipt(receiptNumber,options={}){const receipt=String(receiptNumber||'').trim();if(!receipt)return false;if(options.history!==false)writeContext('wr',receipt,options);window.NavigationShell?.openInventory?.();installBridge('inventorySection').catch(error=>console.error('[inventory bridge]',error));return callEmbedded('inventorySection','traceWR',[receipt]);}
  async function openWarehouseReceipt({receiptNumber=null}={},options={}){const receipt=await receiptByNumber(receiptNumber);if(!receipt?.id)return false;if(options.history!==false)writeContext('receipt',receipt.receipt_number,options);window.NavigationShell?.openWarehouse?.();return callContextEmbedded('warehouseSection','openOperationalReceipt',[receipt.id]);}
  function openWarehouseReceiptById(receiptId,options={}){if(!receiptId)return false;if(options.history!==false)writeContext('receipt_id',receiptId,options);window.NavigationShell?.openWarehouse?.();installBridge('warehouseSection').then(()=>callEmbedded('warehouseSection','openOperationalReceipt',[receiptId]));return true;}
  async function openPurchase({purchaseOrderId=null}={},options={}){if(!purchaseOrderId)return false;if(options.history!==false)writeContext('po',purchaseOrderId,options);window.NavigationShell?.openPurchases?.();return callContextEmbedded('purchasesSection','openOperationalPurchase',[purchaseOrderId]);}
  function openPurchaseReceipt(purchaseOrderId,options={}){if(!purchaseOrderId)return false;if(options.history!==false)writeContext('po_receive',purchaseOrderId,options);window.NavigationShell?.openPurchases?.();installBridge('purchasesSection').then(()=>callEmbedded('purchasesSection','openOperationalPurchaseReceipt',[purchaseOrderId]));return true;}
  function openSales({salesOrderId=null}={},options={}){if(!salesOrderId)return false;if(options.history!==false)writeContext('so',salesOrderId,options);window.NavigationShell?.openSales?.();installBridge('salesSection').then(ready=>{if(ready&&callEmbedded('salesSection','openOperationalSale',[salesOrderId]))return;callEmbedded('salesSection','openDetail',[salesOrderId]);}).catch(()=>callEmbedded('salesSection','openDetail',[salesOrderId]));return true;}
  function openSalesSupply(salesOrderId,options={}){if(!salesOrderId)return false;if(options.history!==false)writeContext('so_supply',salesOrderId,options);window.NavigationShell?.openSales?.();installBridge('salesSection').then(()=>callEmbedded('salesSection','openOperationalSalesSupply',[salesOrderId]));return true;}
  function openInvoice(invoiceId,options={}){if(!invoiceId)return false;if(options.history!==false)writeContext('invoice',invoiceId,options);window.NavigationShell?.openInvoices?.();installBridge('invoicesSection').then(()=>callEmbedded('invoicesSection','openOperationalInvoice',[invoiceId]));return true;}
  function openInvoiceCollection(invoiceId,options={}){if(!invoiceId)return false;if(options.history!==false)writeContext('invoice_collect',invoiceId,options);window.NavigationShell?.openInvoices?.();installBridge('invoicesSection').then(()=>callEmbedded('invoicesSection','openOperationalInvoiceCollection',[invoiceId]));return true;}
  async function openInvoiceForSalesOrder(salesOrderId,options={}){
    if(!salesOrderId)return false;
    const related=await invoicesForSalesOrder(salesOrderId);
    const draft=related.find(row=>row.status==='draft');
    if(draft?.invoice_id)return openInvoice(draft.invoice_id,options);
    if(options.history!==false)writeContext('so_invoice',salesOrderId,options);
    window.NavigationShell?.openInvoices?.();
    installBridge('invoicesSection').then(()=>callEmbedded('invoicesSection','openOperationalInvoiceForSalesOrder',[salesOrderId]));
    return true;
  }
  function openSupplierBill(billId,options={}){if(!billId)return false;if(options.history!==false)writeContext('supplier_bill',billId,options);window.NavigationShell?.openPayables?.();installBridge('payablesSection').then(()=>callEmbedded('payablesSection','openOperationalSupplierBill',[billId]));return true;}
  async function openSupplier({supplierId=null}={},options={}){if(!supplierId)return false;if(options.history!==false)writeContext('supplier',supplierId,options);window.NavigationShell?.openSuppliers?.();return callContextEmbedded('suppliersSection','openOperationalSupplier',[supplierId]);}
  function openClient({clientId=null}={},options={}){if(!clientId)return false;if(options.history!==false)writeContext('client',clientId,options);section('clientsSection');requestAnimationFrame(()=>window.ClientsModule?.openInformation?.(clientId));return true;}

  async function openEntity({type,id}={},options={}){
    const entityType=String(type||'').trim(),entityId=String(id||'').trim();
    if(!entityType||!entityId)throw new Error('La tarea no tiene una entidad válida para abrir.');
    const access=ENTITY_ACCESS[entityType];
    if(!access)throw new Error(`No hay navegación configurada para ${entityType}.`);
    requireAccess(access,`abrir ${access.label}`);
    if(entityType==='client')return openClient({clientId:entityId},options);
    if(entityType==='sales_order')return openSales({salesOrderId:entityId},options);
    if(entityType==='purchase_order')return openPurchase({purchaseOrderId:entityId},options);
    if(entityType==='warehouse_receipt')return openWarehouseReceiptById(entityId,options);
    if(entityType==='load')return openLoad({loadId:entityId},options);
    if(entityType==='shipment')return openTracking({shipmentId:entityId},options);
    if(entityType==='invoice')return openInvoice(entityId,options);
    if(entityType==='supplier_bill')return openSupplierBill(entityId,options);
    if(entityType==='supplier')return openSupplier({supplierId:entityId},options);
    return false;
  }

  async function openWork(task,options={}){
    if(!task?.entity_type||!task?.entity_id)throw new Error('Esta tarea no tiene un trabajo relacionado que se pueda abrir.');
    const workflowKey=String(task.workflow_key||'').trim();
    const workflow=WORKFLOW_ACCESS[workflowKey]||null;
    if(!workflow)return openEntity({type:task.entity_type,id:task.entity_id},options);
    requireAccess(workflow,`trabajar en ${workflow.label}`);
    if(['sales_supply_planning','sales_procurement_linkage','direct_fulfillment'].includes(workflowKey))return openSalesSupply(task.entity_id,options);
    if(workflowKey==='prepare_load')return openSales({salesOrderId:task.entity_id},options);
    if(workflowKey==='purchase_receipt')return openPurchaseReceipt(task.entity_id,options);
    if(workflowKey==='shipment_cuba_documents')return openTracking({shipmentId:task.entity_id},options);
    if(workflowKey==='sales_invoice')return openInvoiceForSalesOrder(task.entity_id,options);
    if(workflowKey==='invoice_collection')return openInvoiceCollection(task.entity_id,options);
    if(workflowKey==='supplier_bill_payment')return openSupplierBill(task.entity_id,options);
    return openEntity({type:task.entity_type,id:task.entity_id},options);
  }

  async function restoreContext(){
    const context=readContext();if(!context||restoring)return false;restoring=true;
    try{
      if(context.type==='tracking')return openTracking({shipmentId:context.id},{history:false});
      if(context.type==='load')return openLoad({loadId:context.id},{history:false});
      if(context.type==='wr')return openInventoryReceipt(context.id,{history:false});
      if(context.type==='receipt')return openWarehouseReceipt({receiptNumber:context.id},{history:false});
      if(context.type==='receipt_id')return openWarehouseReceiptById(context.id,{history:false});
      if(context.type==='po')return openPurchase({purchaseOrderId:context.id},{history:false});
      if(context.type==='po_receive')return openPurchaseReceipt(context.id,{history:false});
      if(context.type==='so')return openSales({salesOrderId:context.id},{history:false});
      if(context.type==='so_supply')return openSalesSupply(context.id,{history:false});
      if(context.type==='invoice')return openInvoice(context.id,{history:false});
      if(context.type==='invoice_collect')return openInvoiceCollection(context.id,{history:false});
      if(context.type==='so_invoice')return openInvoiceForSalesOrder(context.id,{history:false});
      if(context.type==='supplier_bill')return openSupplierBill(context.id,{history:false});
      if(context.type==='supplier')return openSupplier({supplierId:context.id},{history:false});
      if(context.type==='client')return openClient({clientId:context.id},{history:false});
      return false;
    }finally{restoring=false;}
  }

  window.addEventListener('hashchange',()=>restoreContext().catch(error=>console.error('[operational context restore]',error)));
  window.addEventListener('popstate',()=>restoreContext().catch(error=>console.error('[operational context restore]',error)));
  window.addEventListener('export-mca:data-loaded',()=>{invalidateLinks();installAllBridges();restoreContext().catch(error=>console.error('[operational context restore]',error));});
  window.addEventListener('export-mca:section-changed',()=>requestAnimationFrame(installAllBridges));
  window.addEventListener('load',()=>requestAnimationFrame(installAllBridges),{once:true});

  window.OperationalNavigation=Object.freeze({
    openTracking,openLoad,openLoadForShipment,openInventoryReceipt,openWarehouseReceipt,openWarehouseReceiptById,openPurchase,openPurchaseReceipt,
    openSales,openSalesSupply,openInvoice,openInvoiceCollection,openInvoiceForSalesOrder,openSupplierBill,openSupplier,openClient,openEntity,openWork,
    loadForShipment,loadById,loadsForReceipt,purchaseOrdersForSupplier,receiptsForSupplier,purchaseOrdersForReceipt,receiptsForPurchase,purchaseByNumber,receiptByNumber,
    salesOrdersForClient,loadsForSalesOrder,directShipmentsForSalesOrder,salesOrdersForLoad,salesOrdersForReceipt,salesByNumber,saleById,invoicesForSalesOrder,invoiceById,supplierBillById,
    invalidateLinks,restoreContext,refreshLinks:()=>requestLinks({refresh:true}),workflowAccess:WORKFLOW_ACCESS,entityAccess:ENTITY_ACCESS,owner:'operational-navigation.js'
  });
  requestAnimationFrame(installAllBridges);
})();