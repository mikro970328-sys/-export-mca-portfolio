import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(root+p,'utf8');
const font=readFileSync(root+'admin/fonts/InterVariable.woff2').toString('base64');

// Canonical owners, fictional data, allowlisted memory API, no external requests.
export function homeCommunicationsFixture({module='dashboard',writable=true,failRead=false,restricted=false}={}){
  if(!['dashboard','alerts','inbox'].includes(module))throw Error('Unsupported workspace');
  const section=module==='alerts'?'notificationsSection':'dashboardSection';
  const dom=new JSDOM(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="${writable?'':'access-notifications-readonly'}"><header class="topbar"><div class="topbar-heading"><span class="topbar-eyebrow">Export MCA</span><b>Inicio</b></div><div class="topbar-actions"></div></header><section id="${section}" class="app-section"></section></body></html>`),doc=dom.window.document;
  for(const name of ['platform-theme','navigation-shell','native-workspace-foundation','access-control','dashboard-executive','operational-alert-center','notification-inbox','push-notifications']){
    const style=doc.createElement('style');style.textContent=read('admin/'+name+'.css').replaceAll('/admin/fonts/InterVariable.woff2',`data:font/woff2;base64,${font}`);doc.head.append(style);
  }
  const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:";doc.head.prepend(csp);
  const dashboard={generated_at:'2026-09-26T09:30:00Z',stats:{clients:48,products:126,suppliers:18,active:12,in_transit:8},warehouse_receipts:{received:24,total:87},loads:{active:6,dispatched:19},inventory:{products_with_stock:32,available_quantity:1840,available_pallets:76,reserved_pallets:12},work_attention:{tasks:{open:7,blocked:1,overdue:2,routing:0},alerts:{active:3,critical:1}},recent_activity:[{id:'shipment-0',container_number:'MCA-DEMO-018',client_name:'Comercial de ejemplo',operational_status:'En tránsito',updated_at:'2026-09-26T09:30:00Z'},{id:'shipment-1',container_number:'MCA-DEMO-019',client_name:'Distribuidora de ejemplo',operational_status:'Recibido',updated_at:'2026-09-25T15:00:00Z'}],filter_options:{currencies:['USD','EUR'],clients:[{id:'client-0',name:'Comercial de ejemplo'}],suppliers:[{id:'supplier-0',name:'Proveedor de ejemplo'}],products:[{id:'product-0',name:'Producto de ejemplo',sku:'MCA-001'}],capabilities:{clients:!restricted,suppliers:!restricted,products:!restricted}},executive:{period:{},exceptions:{overdue_ar_count:3,overdue_ap_count:1},activity_by_currency:[{currency:'USD',issued_sales:48250,issued_invoice_count:12,net_cash_flow:8200,booked_sales_order_value:56100,so_confirmed_count:15,po_committed_value:32100,po_committed_count:8,cash_collected:26700,customer_payment_count:9,customer_advance_count:2,cash_paid:18500,supplier_payment_count:6,customer_advance_refund_count:1,invoice_credit_refund_count:1,margin_eligible_invoice_count:8,recognized_cogs:28300,gross_margin:9100,gross_margin_pct:24.33,contribution_eligible_order_count:6,contribution_margin:7400,contribution_margin_pct:18.5,contribution_direct_cost:1700},{currency:'EUR',issued_sales:12500,issued_invoice_count:4,net_cash_flow:-600,margin_incomplete_invoice_count:4,contribution_incomplete_order_count:4}],balances_by_currency:[{currency:'USD',ar_balance:14600,open_ar_invoice_count:5,overdue_ar_count:3,ap_balance:9800,open_ap_bill_count:4,overdue_ap_count:1},{currency:'EUR',ar_balance:3200,open_ar_invoice_count:2,ap_balance:1600,open_ap_bill_count:1}]}};
  const alerts=[
    {id:'alert-0',notification_scope:'operational',severity:'critical',alert_status:'pending',title:'Documentación pendiente',message:'Revisa los documentos antes del despacho.',entity_type:'operational_task',entity_id:'task-0',event_type:'task_overdue',payload:{task_title:'Revisar documentos'},condition_active:true,created_at:'2026-09-26T09:30:00Z'},
    {id:'alert-1',notification_scope:'operational',severity:'warning',alert_status:'snoozed',title:'Tracking sin actualización',message:'Confirma el estado del contenedor.',entity_type:'shipment',entity_id:'shipment-0',shipments:{container_number:'MCA-DEMO-018'},read_at:'2026-09-25T09:30:00Z',condition_active:true,created_at:'2026-09-25T09:30:00Z'},
    {id:'alert-2',notification_scope:'operational',severity:'warning',alert_status:'resolved',title:'Entrega revisada',message:'La incidencia se revisó manualmente.',entity_type:'client',entity_id:'client-0',clients:{name:'Comercial de ejemplo'},condition_active:true,read_at:'2026-09-25T09:30:00Z',created_at:'2026-09-24T09:30:00Z'}
  ];
  const messages=[
    {id:'message-0',notification_scope:'message',status:'failed',notification_type:'tracking',clients:{name:'Comercial de ejemplo'},recipient:'+530000000000',shipments:{container_number:'MCA-DEMO-018'},error_message:'PRIVATE_PROVIDER_DIAGNOSTIC',created_at:'2026-09-26T09:30:00Z'},
    {id:'message-1',notification_scope:'message',status:'delivered',notification_type:'release',clients:{name:'Distribuidora de ejemplo'},recipient:'+530000000001',shipments:{container_number:'MCA-DEMO-019'},created_at:'2026-09-25T09:30:00Z'}
  ];
  const items=[
    {id:'inbox-0',title:'Revisar documentación',message:'La tarea vence pronto. Revisa el trabajo pendiente.',source_type:'task',source_status:'pending',is_unread:true,severity:'warning',entity_type:'operational_task',entity_id:'task-0',action_payload:{task_id:'task-0'},created_at:'2026-09-26T09:30:00Z'},
    {id:'inbox-1',title:'Tracking necesita revisión',message:'Consulta el estado actual del contenedor.',source_type:'alert',source_status:'pending',is_unread:true,severity:'critical',entity_type:'shipment',entity_id:'shipment-0',created_at:'2026-09-25T09:30:00Z'},
    {id:'inbox-2',title:'Entrega revisada',message:'Puedes consultar el registro de excepciones.',source_type:'alert',source_status:'resolved',source_active:false,is_unread:false,severity:'info',action_key:'open_alerts',created_at:'2026-09-24T09:30:00Z'}
  ];
  const preferences=Object.fromEntries(['in_app_enabled','task_assignments_enabled','operational_alerts_enabled','escalations_enabled','tracking_updates_enabled','document_updates_enabled','integration_failures_enabled'].map(k=>[k,true]));preferences.push_enabled=false;
  const harness=`
    localStorage.setItem('export_mca_token','fixture-token');localStorage.setItem('export_mca_user',JSON.stringify({id:'operator-0',full_name:'Ana Pérez'}));
    window.ExportMcaAccessControl={can:key=>key.endsWith('.read')||${writable}};
    window.__fixtureCalls=[];window.__fixtureNavigation=[];window.__fixtureReadError=${failRead};window.__fixtureRejectWrites=false;window.__fixtureWriteDelay=0;
    window.__fixtureDashboard=${JSON.stringify(dashboard)};window.__fixtureAlerts=${JSON.stringify(alerts)};window.__fixtureMessages=${JSON.stringify(messages)};window.__fixtureItems=${JSON.stringify(items)};window.__fixturePreferences=${JSON.stringify(preferences)};
    window.showSection=id=>window.__fixtureNavigation.push({section:id});
    window.NavigationShell=Object.fromEntries(['Products','Suppliers','Warehouse','Loads','Inventory','Sales','Purchases','Invoices','Payables','Costs'].map(name=>['open'+name,()=>window.__fixtureNavigation.push({module:name})]));
    window.TasksWorkspace={open:async id=>window.__fixtureNavigation.push({task:id})};window.OperationalNavigation={openEntity:async value=>{window.__fixtureNavigation.push(value);return !window.__fixtureMissingDestination;}};
    const response=data=>({ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(data))});
    const failure=()=>({ok:false,status:503,json:async()=>({error:'PRIVATE_FIXTURE_ERROR'})});
    window.fetch=async(path,options={})=>{
      const url=new URL(path,'https://erp-visual.invalid'),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
      if(!['/api/dashboard','/api/history','/api/notification-inbox','/api/push-subscriptions'].includes(url.pathname))throw Error('Fixture blocks network');
      window.__fixtureCalls.push({path:url.pathname,query:url.search,method,body});
      if(method==='GET'){
        if(window.__fixtureReadError)return failure();
        if(url.pathname==='/api/dashboard'){const d=JSON.parse(JSON.stringify(window.__fixtureDashboard));d.executive.period=Object.fromEntries(url.searchParams);if(url.searchParams.get('currency')){d.executive.activity_by_currency=d.executive.activity_by_currency.filter(r=>r.currency===url.searchParams.get('currency'));d.executive.balances_by_currency=d.executive.balances_by_currency.filter(r=>r.currency===url.searchParams.get('currency'));}return response(d);}
        if(url.pathname==='/api/history')return response({notifications:url.searchParams.get('scope')==='operational'?window.__fixtureAlerts:url.searchParams.get('scope')==='message'?window.__fixtureMessages:[...window.__fixtureAlerts,...window.__fixtureMessages]});
        if(url.pathname==='/api/push-subscriptions')return response({config:{ready:false,public_key:null},devices:[]});
        const a=window.__fixtureItems;return response({items:a,counts:{total:a.length,unread:a.filter(x=>x.is_unread).length,task:a.filter(x=>x.source_type==='task').length,alert:a.filter(x=>x.source_type==='alert').length},preferences:window.__fixturePreferences});
      }
      if(method!=='PATCH'||url.pathname==='/api/push-subscriptions')throw Error('Fixture blocks unsupported mutation and device activation');
      if(window.__fixtureWriteDelay)await new Promise(r=>setTimeout(r,window.__fixtureWriteDelay));
      if(window.__fixtureRejectWrites)return failure();
      if(url.pathname==='/api/history'){
        if(!${writable}&&body.action!=='mark_read')throw Error('Read-only fixture blocks management');
        if(body.action==='retry'){const row=window.__fixtureMessages.find(r=>r.id===body.id);row.status='queued';row.error_message=null;return response({status:'queued'});}
        const row=window.__fixtureAlerts.find(r=>r.id===body.id);
        if(body.action==='mark_read')row.read_at='2026-09-26T10:00:00Z';
        else if(['resolve','snooze','reopen'].includes(body.action)){row.alert_status={resolve:'resolved',snooze:'snoozed',reopen:'pending'}[body.action];}
        else throw Error('Unsupported alert action');
        return response({ok:true});
      }
      if(body.action==='preferences'){Object.assign(window.__fixturePreferences,body);return response({preferences:window.__fixturePreferences});}
      if(body.action==='mark_all_read')window.__fixtureItems.forEach(row=>row.is_unread=false);
      else if(body.action==='dismiss')window.__fixtureItems=window.__fixtureItems.filter(row=>row.id!==body.id);
      else if(['mark_read','mark_unread'].includes(body.action))window.__fixtureItems.find(row=>row.id===body.id).is_unread=body.action==='mark_unread';
      else throw Error('Unsupported inbox action');
      return response({ok:true});
    };`;
  const owner=module==='dashboard'?'dashboard-operational-state':module==='alerts'?'operational-alert-center':'notification-inbox';
  const boot=module==='dashboard'?"document.addEventListener('DOMContentLoaded',()=>{window.__fixtureSettled=window.ExecutiveDashboard.refresh();});":module==='alerts'?"":"document.addEventListener('DOMContentLoaded',()=>{window.__fixtureSettled=window.NotificationInbox.open();});";
  for(const code of [harness,read('admin/admin-shell-runtime.js'),"window.showSection=id=>window.__fixtureNavigation.push({section:id});",read('admin/ui-icon-system.js'),read('admin/'+owner+'.js'),boot]){const script=doc.createElement('script');script.textContent=code.replaceAll('</script','<\\/script');doc.body.append(script);}
  const html=dom.serialize();dom.window.close();return html;
}
