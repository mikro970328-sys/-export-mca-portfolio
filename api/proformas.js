import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text=(value,max=2000)=>String(value??'').trim().slice(0,max);
const uuid=(value,label='ID')=>{const id=text(value,80);if(!UUID_RE.test(id))throw new Error(`${label}_INVALID`);return id;};
const rpcRow=value=>Array.isArray(value)?value[0]||null:value||null;

function friendly(error){
  const raw=String(error?.message||error||'');
  const map=[
    ['SALES_ORDER_ID_INVALID','Venta inválida.'],['PROFORMA_ID_INVALID','Proforma inválida.'],['PROFORMA_SO_NOT_FOUND','Venta no encontrada.'],['PROFORMA_SO_NOT_CONFIRMED','La venta debe estar confirmada antes de crear o emitir una Proforma.'],['PROFORMA_SO_HAS_NO_ITEMS','La venta no tiene mercancía.'],['PROFORMA_NOT_FOUND','Proforma no encontrada.'],['PROFORMA_NOT_DRAFT','Solo una Proforma en borrador puede emitirse.'],['PROFORMA_HAS_NO_ITEMS','La Proforma no tiene mercancía.'],['PROFORMA_CANNOT_VOID','La Proforma no puede anularse en su estado actual.'],['PROFORMA_VOID_REASON_REQUIRED','Indica el motivo de anulación.'],['PROFORMA_ACTION_INVALID','Acción de Proforma inválida.']
  ];
  return map.find(([key])=>raw.includes(key))?.[1]||'No se pudo actualizar la Proforma.';
}

async function loadProformas(salesOrderId){
  const [rows,totals]=await Promise.all([
    supabase('proformas',{query:`?select=id,proforma_number,sales_order_id,client_id,importer_id,issue_date,valid_until,currency,customer_reference,status,notes,created_at,issued_at,voided_at,void_reason,client:clients(id,name,company,mipyme_name,email,phone),importer:importers(id,name,legal_name,address,country,email,phone)&sales_order_id=eq.${encodeURIComponent(salesOrderId)}&order=created_at.desc&limit=1000`}),
    supabase('proforma_financial_totals',{query:`?select=*&sales_order_id=eq.${encodeURIComponent(salesOrderId)}&order=issue_date.desc&limit=1000`})
  ]);
  const ids=(rows||[]).map(row=>row.id);
  const items=ids.length?await supabase('proforma_items',{query:`?select=id,proforma_id,sales_order_item_id,product_id,sku,description,quantity,unit,unit_price,line_total,notes,created_at&proforma_id=in.(${ids.join(',')})&order=created_at.asc&limit=5000`}):[];
  const totalById=new Map((totals||[]).map(row=>[row.proforma_id,row]));
  const itemsById=new Map();
  for(const item of items||[]){if(!itemsById.has(item.proforma_id))itemsById.set(item.proforma_id,[]);itemsById.get(item.proforma_id).push(item);}
  return (rows||[]).map(row=>({...row,financial:totalById.get(row.id)||null,items:itemsById.get(row.id)||[]}));
}

export default async function handler(req,res){
  const admin=requireAdmin(req,res);if(!admin)return;
  try{
    if(req.method==='GET'){
      const salesOrderId=uuid(req.query?.sales_order_id||req.query?.id,'SALES_ORDER_ID');
      return ok(res,{proformas:await loadProformas(salesOrderId)});
    }
    if(req.method!=='POST')return fail(res,405,'Método no permitido');
    const body=await readJson(req),action=text(body.action,60).toLowerCase();
    if(action==='create'){
      const salesOrderId=uuid(body.sales_order_id,'SALES_ORDER_ID');
      const row=rpcRow(await supabase('rpc/create_proforma',{method:'POST',body:{p_sales_order_id:salesOrderId,p_issue_date:text(body.issue_date,20)||null,p_valid_until:text(body.valid_until,20)||null,p_notes:text(body.notes,2000)||null,p_actor:admin.admin_id||null}}));
      await writeAudit(admin,'proforma_created','proforma',row.id,{proforma_number:row.proforma_number,sales_order_id:salesOrderId});
      return ok(res,{proforma:row,proformas:await loadProformas(salesOrderId)});
    }
    if(action==='issue'||action==='void'){
      const proformaId=uuid(body.proforma_id,'PROFORMA_ID');
      const before=(await supabase('proformas',{query:`?select=id,sales_order_id,proforma_number&limit=1&id=eq.${proformaId}`}))?.[0];
      if(!before)throw new Error('PROFORMA_NOT_FOUND');
      const row=rpcRow(await supabase('rpc/transition_proforma',{method:'POST',body:{p_proforma_id:proformaId,p_action:action,p_reason:text(body.reason,1000)||null,p_actor:admin.admin_id||null}}));
      await writeAudit(admin,`proforma_${action}`,'proforma',proformaId,{proforma_number:before.proforma_number,reason:text(body.reason,1000)||null});
      return ok(res,{proforma:row,proformas:await loadProformas(before.sales_order_id)});
    }
    return fail(res,400,'Acción de Proforma no válida.');
  }catch(error){console.error('[proformas]',error);return fail(res,400,friendly(error));}
}
