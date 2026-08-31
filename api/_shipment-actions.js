import { loadAdminAccessContext, supabase } from './_lib.js';

const clone=value=>value&&typeof value==='object'?JSON.parse(JSON.stringify(value)):{actions:{}};
const READ_ACTIONS=new Set(['view_info','view_documents','view_history']);

async function effectivePermissions(admin){
  if(admin?.role==='master_admin')return new Set(['logistics.read','logistics.write']);
  const access=await loadAdminAccessContext(admin?.admin_id);
  return new Set(access?.permissions||[]);
}

export function maskShipmentActionCapabilities(raw,permissions){
  const state=clone(raw);
  const actions=state.actions&&typeof state.actions==='object'?state.actions:{};
  for(const [key,entry] of Object.entries(actions)){
    if(!entry||typeof entry!=='object')continue;
    const required=READ_ACTIONS.has(key)?'logistics.read':'logistics.write';
    entry.business_allowed=entry.allowed===true;
    entry.required_permission=required;
    if(entry.allowed===true&&!permissions.has(required)){
      entry.allowed=false;
      entry.reason='PERMISSION_REQUIRED';
    }
  }
  state.actions=actions;
  state.write_access=permissions.has('logistics.write');
  return state;
}

export async function loadShipmentActionCapabilityMap(admin){
  const permissions=await effectivePermissions(admin);
  const rows=await supabase('shipment_action_capabilities',{query:'?select=shipment_id,capabilities&limit=5000'});
  return {
    map:new Map((rows||[]).map(row=>[String(row.shipment_id),maskShipmentActionCapabilities(row.capabilities,permissions)])),
    write_access:permissions.has('logistics.write')
  };
}

export async function loadShipmentActionCapabilities(admin,shipmentId){
  const permissions=await effectivePermissions(admin);
  const rows=await supabase('shipment_action_capabilities',{query:`?select=shipment_id,capabilities&shipment_id=eq.${encodeURIComponent(shipmentId)}&limit=1`});
  const row=rows?.[0];
  return row?maskShipmentActionCapabilities(row.capabilities,permissions):{actions:{},write_access:permissions.has('logistics.write')};
}

export async function assertShipmentBusinessAction(shipmentId,action){
  await supabase('rpc/assert_shipment_action',{method:'POST',body:{p_shipment_id:shipmentId,p_action:action}});
}
