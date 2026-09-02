import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';
import { loadInvoiceFinanceCapabilityMaps } from './_invoice-actions.js';

const text=(value,max=2000)=>String(value??'').trim().slice(0,max);
const rpcRow=value=>Array.isArray(value)?(value[0]||null):(value||null);

function translatedError(raw){
  const messages=[
    ['JSON_INVALID','La solicitud no tiene un formato válido.'],
    ['INVOICE_SO_NOT_FOUND','Sales Order no encontrada.'],
    ['INVOICE_SO_NOT_BILLABLE','La Sales Order debe estar confirmada o cerrada para facturar.'],
    ['INVOICE_HAS_NO_ITEMS','Agrega al menos una línea a la factura.'],
    ['INVOICE_SO_ITEM_REQUIRED','Falta una línea de la Sales Order.'],
    ['INVOICE_SO_ITEM_NOT_FOUND','Una línea de la Sales Order ya no existe.'],
    ['INVOICE_SO_ITEM_MISMATCH','Una línea no pertenece a la Sales Order seleccionada.'],
    ['INVOICE_QUANTITY_INVALID','La cantidad a facturar debe ser mayor que cero.'],
    ['INVOICE_QUANTITY_EXCEEDS_SALES_ORDER','La cantidad supera lo disponible para facturar en la Sales Order.'],
    ['INVOICE_ITEM_INVALID','Una línea de la factura no es válida.'],
    ['INVOICE_TOO_MANY_ITEMS','La factura contiene demasiadas líneas.'],
    ['INVOICE_PRODUCT_NOT_FOUND','Uno de los productos ya no existe.'],
    ['INVOICE_OPERATION_NOT_FOUND','La operación vinculada no existe.'],
    ['INVOICE_OPERATION_CLIENT_MISMATCH','La operación vinculada debe pertenecer al mismo cliente de la Sales Order.'],
    ['INVOICE_OPERATION_REQUIRED','Vincula una operación antes de emitir la factura.'],
    ['INVOICE_NOT_FOUND','Factura no encontrada.'],
    ['INVOICE_NOT_DRAFT','Solo una factura en borrador puede editarse o emitirse.'],
    ['INVOICE_ITEMS_LOCKED','Las líneas de una factura emitida no pueden modificarse.'],
    ['INVOICE_STRUCTURE_LOCKED','La factura emitida ya no puede modificarse.'],
    ['INVOICE_HAS_POSTED_PAYMENTS','Revierte primero los cobros registrados antes de anular la factura.'],
    ['INVOICE_HAS_POSTED_ADVANCE_APPLICATIONS','Revierte primero los anticipos aplicados antes de anular la factura.'],
    ['INVOICE_CANNOT_VOID','La factura no puede anularse en su estado actual.'],
    ['INVOICE_STATUS_FINAL','La factura ya no admite cambios.'],
    ['INVOICE_STATUS_TRANSITION_INVALID','La factura no admite esa transición en su estado actual.'],
    ['INVOICE_ACTION_NOT_ALLOWED','La factura no admite esta acción en su estado actual.'],
    ['INVOICE_ACTION_INVALID','Acción de factura inválida.'],
    ['PERMISSION_REQUIRED','No tienes permiso para realizar esta acción.']
  ];
  const matched=messages.find(([key])=>raw.includes(key));
  if(matched)return {code:matched[0],message:matched[1]};
  if(/^(?:Agrega al menos una línea a la factura|Falta la línea \d+ de la Sales Order|Indica una cantidad válida en la línea \d+|Selecciona una Sales Order|Falta la factura(?: o la Sales Order)?)$/.test(raw))return {code:'INVOICE_INPUT_INVALID',message:raw};
  return null;
}

function cleanLines(lines){
  if(!Array.isArray(lines)||!lines.length)throw new Error('Agrega al menos una línea a la factura');
  return lines.map((line,index)=>{
    const salesOrderItemId=text(line.sales_order_item_id,80);
    const quantity=text(line.quantity,80);
    if(!salesOrderItemId)throw new Error(`Falta la línea ${index+1} de la Sales Order`);
    if(!quantity||Number(quantity)<=0)throw new Error(`Indica una cantidad válida en la línea ${index+1}`);
    return {sales_order_item_id:salesOrderItemId,quantity,notes:text(line.notes,1000)||null};
  });
}

async function loadInvoices(admin){
  const [invoices,items,financial,payments,capabilityBundle]=await Promise.all([
    supabase('invoices',{query:'?select=id,invoice_number,sales_order_id,operation_id,client_id,issue_date,due_date,currency,status,notes,created_at,updated_at,client:clients(id,name,company,mipyme_name),sales_order:sales_orders(id,so_number,status,customer_reference)&order=created_at.desc&limit=1000'}),
    supabase('invoice_items',{query:'?select=id,invoice_id,sales_order_item_id,product_id,description,quantity,unit,unit_price,line_total,notes,created_at,product:products(id,sku,name,brand)&order=created_at.asc&limit=5000'}),
    supabase('invoice_financial_progress',{query:'?select=*&order=issue_date.desc&limit=1000'}),
    supabase('payments',{query:'?select=id,invoice_id,amount,currency,payment_date,method,reference_number,status,notes,created_at&order=payment_date.desc,created_at.desc&limit=5000'}),
    loadInvoiceFinanceCapabilityMaps(admin)
  ]);
  const itemsByInvoice=new Map();
  for(const item of items||[]){if(!itemsByInvoice.has(item.invoice_id))itemsByInvoice.set(item.invoice_id,[]);itemsByInvoice.get(item.invoice_id).push(item);}
  const financialByInvoice=new Map((financial||[]).map(row=>[row.invoice_id,row]));
  const paymentsByInvoice=new Map();
  for(const payment of payments||[]){
    const normalized={...payment,capabilities:capabilityBundle.payment_capabilities.get(payment.id)||{actions:{}}};
    if(!paymentsByInvoice.has(payment.invoice_id))paymentsByInvoice.set(payment.invoice_id,[]);
    paymentsByInvoice.get(payment.invoice_id).push(normalized);
  }
  return {
    write_access:capabilityBundle.write_access,
    invoices:(invoices||[]).map(invoice=>({
      ...invoice,
      items:itemsByInvoice.get(invoice.id)||[],
      financial:financialByInvoice.get(invoice.id)||null,
      payments:paymentsByInvoice.get(invoice.id)||[],
      capabilities:capabilityBundle.invoice_capabilities.get(invoice.id)||{actions:{}}
    }))
  };
}

async function loadSalesOrders(){
  const [orders,items,progress]=await Promise.all([
    supabase('sales_orders',{query:'?select=id,so_number,client_id,status,currency,customer_reference,order_date,client:clients(id,name,company,mipyme_name)&status=in.(confirmed,closed)&order=created_at.desc&limit=1000'}),
    supabase('sales_order_items',{query:'?select=id,sales_order_id,product_id,ordered_quantity,unit,unit_price,product:products(id,sku,name,brand)&order=created_at.asc&limit=5000'}),
    supabase('sales_order_item_invoice_progress',{query:'?select=*&limit=5000'})
  ]);
  const progressByItem=new Map((progress||[]).map(row=>[row.sales_order_item_id,row]));
  const itemsByOrder=new Map();
  for(const item of items||[]){const normalized={...item,invoice_progress:progressByItem.get(item.id)||null};if(!itemsByOrder.has(item.sales_order_id))itemsByOrder.set(item.sales_order_id,[]);itemsByOrder.get(item.sales_order_id).push(normalized);}
  return (orders||[]).map(order=>({...order,items:itemsByOrder.get(order.id)||[]}));
}

function buildMetrics(invoices){
  const active=invoices.filter(invoice=>invoice.status!=='void');
  const issued=active.filter(invoice=>invoice.status==='issued');
  const receivableByCurrency=new Map();
  for(const invoice of issued){
    const balance=Number(invoice.financial?.balance_due||0);
    if(!Number.isFinite(balance)||balance===0)continue;
    const currency=text(invoice.currency||invoice.financial?.currency||'',3).toUpperCase();
    if(!currency)continue;
    receivableByCurrency.set(currency,(receivableByCurrency.get(currency)||0)+balance);
  }
  return {
    invoice_count:active.length,
    draft_count:active.filter(invoice=>invoice.status==='draft').length,
    paid_count:issued.filter(invoice=>invoice.financial?.payment_status==='paid').length,
    overdue_count:issued.filter(invoice=>invoice.financial?.payment_status==='overdue').length,
    receivable_by_currency:[...receivableByCurrency.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([currency,amount])=>({currency,amount}))
  };
}

async function bootstrap(admin){
  const [invoiceData,salesOrders]=await Promise.all([loadInvoices(admin),loadSalesOrders()]);
  return {invoices:invoiceData.invoices,sales_orders:salesOrders,metrics:buildMetrics(invoiceData.invoices),write_access:invoiceData.write_access};
}

async function refreshedInvoice(admin,id){
  const data=await loadInvoices(admin);
  return data.invoices.find(row=>row.id===id)||null;
}

export default async function handler(req,res){
  const admin=await authorizeAdmin(req,res,req.method==='GET'?'finance.read':'finance.write');
  if(!admin)return;
  try{
    if(req.method==='GET'){
      const data=await bootstrap(admin),id=text(req.query?.id,80);
      if(!id)return ok(res,data);
      const invoice=data.invoices.find(row=>String(row.id)===id);
      if(!invoice)return fail(res,404,'Factura no encontrada');
      return ok(res,{invoice,sales_orders:data.sales_orders,metrics:data.metrics,write_access:data.write_access});
    }
    if(req.method!=='POST')return fail(res,405,'Método no permitido');
    const body=await readJson(req),action=text(body.action,60).toLowerCase();

    if(action==='create_plan'){
      const salesOrderId=text(body.sales_order_id,80);if(!salesOrderId)throw new Error('Selecciona una Sales Order');
      const result=await supabase('rpc/create_invoice_plan',{method:'POST',body:{p_sales_order_id:salesOrderId,p_lines:cleanLines(body.lines),p_issue_date:text(body.issue_date,40)||null,p_due_date:text(body.due_date,40)||null,p_operation_id:text(body.operation_id,80)||null,p_notes:text(body.notes,2000)||null}});
      const invoice=rpcRow(result);if(!invoice?.id)throw new Error('No se pudo crear la factura');
      await writeAudit(admin,'invoice_created','invoice',invoice.id,{invoice_number:invoice.invoice_number,sales_order_id:salesOrderId});
      return ok(res,{invoice:await refreshedInvoice(admin,invoice.id)||invoice});
    }

    if(action==='replace_plan'){
      const invoiceId=text(body.invoice_id,80),salesOrderId=text(body.sales_order_id,80);if(!invoiceId||!salesOrderId)throw new Error('Falta la factura o la Sales Order');
      const result=await supabase('rpc/replace_invoice_plan',{method:'POST',body:{p_invoice_id:invoiceId,p_sales_order_id:salesOrderId,p_lines:cleanLines(body.lines),p_issue_date:text(body.issue_date,40)||null,p_due_date:text(body.due_date,40)||null,p_operation_id:text(body.operation_id,80)||null,p_notes:text(body.notes,2000)||null}});
      const invoice=rpcRow(result);await writeAudit(admin,'invoice_updated','invoice',invoiceId,{invoice_number:invoice?.invoice_number||null});
      return ok(res,{invoice:await refreshedInvoice(admin,invoiceId)||invoice});
    }

    if(action==='issue'||action==='void'){
      const invoiceId=text(body.invoice_id,80);if(!invoiceId)throw new Error('Falta la factura');
      const result=await supabase('rpc/transition_invoice',{method:'POST',body:{p_invoice_id:invoiceId,p_action:action}}),invoice=rpcRow(result);
      await writeAudit(admin,`invoice_${action}`,'invoice',invoiceId,{invoice_number:invoice?.invoice_number||null});
      return ok(res,{invoice:await refreshedInvoice(admin,invoiceId)||invoice});
    }

    return fail(res,400,'Acción de Facturación no válida');
  }catch(error){
    const raw=String(error?.message||error||'');
    console.error('[invoices]',error);
    const translated=translatedError(raw);
    if(translated)return fail(res,400,translated.message,{code:translated.code});
    return fail(res,500,'No se pudo procesar Facturación. Intenta nuevamente.',{code:'INVOICE_UNEXPECTED_ERROR'});
  }
}
