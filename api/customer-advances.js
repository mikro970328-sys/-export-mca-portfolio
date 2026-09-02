import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';
import { loadCustomerFinanceCapabilityMaps } from './_customer-finance-actions.js';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text=(value,max=2000)=>String(value??'').trim().slice(0,max);
const uuid=(value,label='ID')=>{const id=text(value,80);if(!UUID_RE.test(id))throw new Error(`${label}_INVALID`);return id;};
const amount=value=>{const n=Number(value);if(!Number.isFinite(n)||n<=0)throw new Error('AMOUNT_INVALID');return n;};
const rpcRow=value=>Array.isArray(value)?value[0]||null:value||null;

function translatedError(error){
  const raw=String(error?.message||error||'');
  const map=[
    ['JSON_INVALID','La solicitud no tiene un formato válido.'],['SALES_ORDER_ID_INVALID','Venta inválida.'],['CUSTOMER_ADVANCE_ID_INVALID','Anticipo inválido.'],['INVOICE_ID_INVALID','Factura inválida.'],['APPLICATION_ID_INVALID','Aplicación inválida.'],['REFUND_ID_INVALID','Reembolso inválido.'],['AMOUNT_INVALID','El monto debe ser mayor que cero.'],
    ['CUSTOMER_ADVANCE_SO_NOT_FOUND','Venta no encontrada.'],['CUSTOMER_ADVANCE_SO_NOT_CONFIRMED','La venta debe estar confirmada antes de registrar un anticipo.'],['CUSTOMER_ADVANCE_NOT_FOUND','Anticipo no encontrado.'],['CUSTOMER_ADVANCE_NOT_POSTED','El anticipo ya no está activo.'],
    ['CUSTOMER_ADVANCE_NO_AVAILABLE_BALANCE','El anticipo no tiene saldo disponible.'],['CUSTOMER_ADVANCE_NO_APPLICABLE_INVOICE','No hay una factura emitida con saldo pendiente compatible con este anticipo.'],['CUSTOMER_ADVANCE_STATUS_FINAL','El anticipo ya no admite esta acción.'],
    ['CUSTOMER_ADVANCE_APPLICATION_CONTEXT_MISMATCH','El anticipo y la factura deben pertenecer a la misma venta, cliente y moneda.'],['CUSTOMER_ADVANCE_INVOICE_NOT_ISSUED','La factura debe estar emitida antes de aplicar el anticipo.'],['CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_AVAILABLE','El monto supera el saldo disponible del anticipo.'],['CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_INVOICE','El monto supera el saldo pendiente de la factura.'],
    ['CUSTOMER_ADVANCE_REFUND_EXCEEDS_AVAILABLE','El reembolso supera el saldo disponible del anticipo.'],['CUSTOMER_ADVANCE_HAS_ACTIVE_APPLICATIONS','Revierte primero las aplicaciones activas del anticipo.'],['CUSTOMER_ADVANCE_HAS_ACTIVE_REFUNDS','Revierte primero los reembolsos activos del anticipo.'],
    ['CUSTOMER_ADVANCE_ALREADY_REVERSED','El anticipo ya está revertido.'],['CUSTOMER_ADVANCE_APPLICATION_ALREADY_REVERSED','La aplicación ya está revertida.'],['CUSTOMER_ADVANCE_REFUND_ALREADY_REVERSED','El reembolso ya está revertido.'],
    ['CUSTOMER_ADVANCE_REVERSAL_REASON_REQUIRED','Indica el motivo del reverso.'],['CUSTOMER_ADVANCE_APPLICATION_REVERSAL_REASON_REQUIRED','Indica el motivo del reverso.'],['CUSTOMER_ADVANCE_REFUND_REVERSAL_REASON_REQUIRED','Indica el motivo del reverso.'],
    ['PERMISSION_REQUIRED','No tienes permiso para realizar esta acción.']
  ];
  const matched=map.find(([key])=>raw.includes(key));
  return matched?{code:matched[0],message:matched[1]}:null;
}

async function loadSalesOrderFinance(admin,salesOrderId){
  const [progressRows,advances,invoices,capabilityBundle]=await Promise.all([
    supabase('sales_order_customer_financial_progress',{query:`?select=*&sales_order_id=eq.${encodeURIComponent(salesOrderId)}&limit=1`}),
    supabase('customer_advance_progress',{query:`?select=*&sales_order_id=eq.${encodeURIComponent(salesOrderId)}&order=received_date.desc,created_at.desc&limit=1000`}),
    supabase('invoice_financial_progress',{query:`?select=*&sales_order_id=eq.${encodeURIComponent(salesOrderId)}&order=issue_date.desc&limit=1000`}),
    loadCustomerFinanceCapabilityMaps(admin)
  ]);
  const advanceIds=(advances||[]).map(row=>row.customer_advance_id).filter(Boolean);
  const invoiceIds=(invoices||[]).map(row=>row.invoice_id).filter(Boolean);
  const inFilter=values=>`in.(${values.join(',')})`;
  const [applications,refunds]=await Promise.all([
    advanceIds.length?supabase('customer_advance_applications',{query:`?select=id,customer_advance_id,invoice_id,amount,status,notes,created_at,reversed_at,reversal_reason&customer_advance_id=${inFilter(advanceIds)}&order=created_at.desc&limit=5000`}):[],
    advanceIds.length?supabase('customer_advance_refunds',{query:`?select=id,refund_number,customer_advance_id,amount,refund_date,method,reference,status,notes,created_at,reversed_at,reversal_reason&customer_advance_id=${inFilter(advanceIds)}&order=refund_date.desc,created_at.desc&limit=5000`}):[]
  ]);
  const invoiceById=new Map((invoices||[]).map(row=>[row.invoice_id,row]));
  const appsByAdvance=new Map();
  for(const row of applications||[]){
    const normalized={...row,invoice:invoiceById.get(row.invoice_id)||null,capabilities:capabilityBundle.application_capabilities.get(row.id)||{actions:{}}};
    if(!appsByAdvance.has(row.customer_advance_id))appsByAdvance.set(row.customer_advance_id,[]);
    appsByAdvance.get(row.customer_advance_id).push(normalized);
  }
  const refundsByAdvance=new Map();
  for(const row of refunds||[]){
    const normalized={...row,capabilities:capabilityBundle.refund_capabilities.get(row.id)||{actions:{}}};
    if(!refundsByAdvance.has(row.customer_advance_id))refundsByAdvance.set(row.customer_advance_id,[]);
    refundsByAdvance.get(row.customer_advance_id).push(normalized);
  }
  return {
    progress:progressRows?.[0]||null,
    sales_order_capabilities:capabilityBundle.sales_order_capabilities.get(salesOrderId)||{actions:{}},
    write_access:capabilityBundle.finance_write_access,
    advances:(advances||[]).map(row=>({...row,capabilities:capabilityBundle.advance_capabilities.get(row.customer_advance_id)||{actions:{}},applications:appsByAdvance.get(row.customer_advance_id)||[],refunds:refundsByAdvance.get(row.customer_advance_id)||[]})),
    invoices:(invoices||[]).filter(row=>row.invoice_status==='issued'),
    invoice_ids:invoiceIds
  };
}

export default async function handler(req,res){
  const admin=await authorizeAdmin(req,res,req.method==='GET'?'finance.read':'finance.write');if(!admin)return;
  try{
    if(req.method==='GET'){
      const salesOrderId=uuid(req.query?.sales_order_id||req.query?.id,'SALES_ORDER_ID');
      return ok(res,await loadSalesOrderFinance(admin,salesOrderId));
    }
    if(req.method!=='POST')return fail(res,405,'Método no permitido');
    const body=await readJson(req),action=text(body.action,80).toLowerCase();
    if(action==='register'){
      const salesOrderId=uuid(body.sales_order_id,'SALES_ORDER_ID');
      const row=rpcRow(await supabase('rpc/register_customer_advance',{method:'POST',body:{p_sales_order_id:salesOrderId,p_amount:amount(body.amount),p_received_date:text(body.received_date,20)||null,p_method:text(body.method,120)||null,p_reference:text(body.reference,200)||null,p_notes:text(body.notes,2000)||null,p_actor:admin.admin_id||null}}));
      await writeAudit(admin,'customer_advance_registered','customer_advance',row.id,{sales_order_id:salesOrderId,advance_number:row.advance_number,amount:row.amount,currency:row.currency});
      return ok(res,{advance:row,finance:await loadSalesOrderFinance(admin,salesOrderId)});
    }
    if(action==='apply'){
      const advanceId=uuid(body.customer_advance_id,'CUSTOMER_ADVANCE_ID'),invoiceId=uuid(body.invoice_id,'INVOICE_ID');
      const row=rpcRow(await supabase('rpc/apply_customer_advance',{method:'POST',body:{p_customer_advance_id:advanceId,p_invoice_id:invoiceId,p_amount:amount(body.amount),p_notes:text(body.notes,2000)||null,p_actor:admin.admin_id||null}}));
      const advance=(await supabase('customer_advances',{query:`?select=sales_order_id&limit=1&id=eq.${advanceId}`}))?.[0];
      await writeAudit(admin,'customer_advance_applied','customer_advance_application',row.id,{customer_advance_id:advanceId,invoice_id:invoiceId,amount:row.amount});
      return ok(res,{application:row,finance:advance?.sales_order_id?await loadSalesOrderFinance(admin,advance.sales_order_id):null});
    }
    if(action==='refund'){
      const advanceId=uuid(body.customer_advance_id,'CUSTOMER_ADVANCE_ID');
      const row=rpcRow(await supabase('rpc/refund_customer_advance',{method:'POST',body:{p_customer_advance_id:advanceId,p_amount:amount(body.amount),p_refund_date:text(body.refund_date,20)||null,p_method:text(body.method,120)||null,p_reference:text(body.reference,200)||null,p_notes:text(body.notes,2000)||null,p_actor:admin.admin_id||null}}));
      const advance=(await supabase('customer_advances',{query:`?select=sales_order_id&limit=1&id=eq.${advanceId}`}))?.[0];
      await writeAudit(admin,'customer_advance_refunded','customer_advance_refund',row.id,{customer_advance_id:advanceId,refund_number:row.refund_number,amount:row.amount});
      return ok(res,{refund:row,finance:advance?.sales_order_id?await loadSalesOrderFinance(admin,advance.sales_order_id):null});
    }
    if(action==='reverse'){
      const advanceId=uuid(body.customer_advance_id,'CUSTOMER_ADVANCE_ID');
      const row=rpcRow(await supabase('rpc/reverse_customer_advance',{method:'POST',body:{p_customer_advance_id:advanceId,p_reason:text(body.reason,1000),p_actor:admin.admin_id||null}}));
      await writeAudit(admin,'customer_advance_reversed','customer_advance',advanceId,{reason:text(body.reason,1000)});
      return ok(res,{advance:row,finance:await loadSalesOrderFinance(admin,row.sales_order_id)});
    }
    if(action==='reverse_application'){
      const applicationId=uuid(body.application_id,'APPLICATION_ID');
      const before=(await supabase('customer_advance_applications',{query:`?select=customer_advance_id&limit=1&id=eq.${applicationId}`}))?.[0];
      const row=rpcRow(await supabase('rpc/reverse_customer_advance_application',{method:'POST',body:{p_application_id:applicationId,p_reason:text(body.reason,1000),p_actor:admin.admin_id||null}}));
      const advance=before?.customer_advance_id?(await supabase('customer_advances',{query:`?select=sales_order_id&limit=1&id=eq.${before.customer_advance_id}`}))?.[0]:null;
      await writeAudit(admin,'customer_advance_application_reversed','customer_advance_application',applicationId,{reason:text(body.reason,1000)});
      return ok(res,{application:row,finance:advance?.sales_order_id?await loadSalesOrderFinance(admin,advance.sales_order_id):null});
    }
    if(action==='reverse_refund'){
      const refundId=uuid(body.refund_id,'REFUND_ID');
      const before=(await supabase('customer_advance_refunds',{query:`?select=customer_advance_id&limit=1&id=eq.${refundId}`}))?.[0];
      const row=rpcRow(await supabase('rpc/reverse_customer_advance_refund',{method:'POST',body:{p_refund_id:refundId,p_reason:text(body.reason,1000),p_actor:admin.admin_id||null}}));
      const advance=before?.customer_advance_id?(await supabase('customer_advances',{query:`?select=sales_order_id&limit=1&id=eq.${before.customer_advance_id}`}))?.[0]:null;
      await writeAudit(admin,'customer_advance_refund_reversed','customer_advance_refund',refundId,{reason:text(body.reason,1000)});
      return ok(res,{refund:row,finance:advance?.sales_order_id?await loadSalesOrderFinance(admin,advance.sales_order_id):null});
    }
    return fail(res,400,'Acción de anticipo no válida.');
  }catch(error){
    console.error('[customer-advances]',error);
    const translated=translatedError(error);
    if(translated)return fail(res,400,translated.message,{code:translated.code});
    return fail(res,500,'No se pudieron procesar los anticipos. Intenta nuevamente.',{code:'CUSTOMER_ADVANCE_UNEXPECTED_ERROR'});
  }
}
