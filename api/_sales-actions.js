import { loadAdminAccessContext, supabase } from './_lib.js';

function clone(value){return value&&typeof value==='object'?JSON.parse(JSON.stringify(value)):{actions:{}};}

export async function loadSalesWriteAccess(admin){
  if(admin?.role==='master_admin')return true;
  const access=await loadAdminAccessContext(admin?.admin_id);
  return new Set(access?.permissions||[]).has('sales.write');
}

export function maskSalesActionCapabilities(raw,writable){
  const state=clone(raw),actions=state.actions&&typeof state.actions==='object'?state.actions:{};
  for(const entry of Object.values(actions)){
    if(!entry||typeof entry!=='object')continue;
    entry.business_allowed=entry.allowed===true;
    entry.required_permission='sales.write';
    if(entry.allowed===true&&!writable){entry.allowed=false;entry.reason='PERMISSION_REQUIRED';}
  }
  state.actions=actions;
  state.write_access=writable===true;
  return state;
}

export async function loadSalesActionCapabilityMap(admin,writableOverride=null){
  const writable=writableOverride===null?await loadSalesWriteAccess(admin):writableOverride===true;
  const rows=await supabase('sales_order_action_capabilities',{query:'?select=sales_order_id,capabilities&limit=2000'});
  return new Map((rows||[]).map(row=>[String(row.sales_order_id),maskSalesActionCapabilities(row.capabilities,writable)]));
}

export async function loadSalesActionCapabilities(admin,salesOrderId,writableOverride=null){
  const map=await loadSalesActionCapabilityMap(admin,writableOverride);
  return map.get(String(salesOrderId))||{actions:{},write_access:false};
}
