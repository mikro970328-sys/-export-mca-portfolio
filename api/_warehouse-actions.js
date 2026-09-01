import { loadAdminAccessContext, supabase } from './_lib.js';

const clone=value=>value&&typeof value==='object'?JSON.parse(JSON.stringify(value)):{actions:{}};

async function effectivePermissions(admin){
  if(admin?.role==='master_admin')return new Set(['warehouse.read','warehouse.write','procurement.write']);
  const access=await loadAdminAccessContext(admin?.admin_id);
  return new Set(access?.permissions||[]);
}

export function maskWarehouseReceiptActionCapabilities(raw,permissions){
  const state=clone(raw);
  const actions=state.actions&&typeof state.actions==='object'?state.actions:{};
  for(const entry of Object.values(actions)){
    if(!entry||typeof entry!=='object')continue;
    entry.business_allowed=entry.allowed===true;
    entry.required_permission='warehouse.write';
    if(entry.allowed===true&&!permissions.has('warehouse.write')){
      entry.allowed=false;
      entry.reason='PERMISSION_REQUIRED';
    }
  }
  state.actions=actions;
  state.write_access=permissions.has('warehouse.write');
  return state;
}

export async function loadWarehouseReceiptActionCapabilityMap(admin){
  const permissions=await effectivePermissions(admin);
  const rows=await supabase('warehouse_receipt_action_capabilities',{query:'?select=receipt_id,capabilities&limit=5000'});
  return {
    map:new Map((rows||[]).map(row=>[String(row.receipt_id),maskWarehouseReceiptActionCapabilities(row.capabilities,permissions)])),
    write_access:permissions.has('warehouse.write'),
    product_write_access:permissions.has('procurement.write')
  };
}

export async function loadWarehouseReceiptActionCapabilities(admin,receiptId){
  const permissions=await effectivePermissions(admin);
  const rows=await supabase('warehouse_receipt_action_capabilities',{query:`?select=receipt_id,capabilities&receipt_id=eq.${encodeURIComponent(receiptId)}&limit=1`});
  return rows?.[0]?maskWarehouseReceiptActionCapabilities(rows[0].capabilities,permissions):{actions:{},write_access:permissions.has('warehouse.write')};
}
