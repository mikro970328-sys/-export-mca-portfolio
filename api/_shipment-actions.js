import { supabase } from './_lib.js';
import { readShipmentListPages } from './_shipment-list-pages.js';

const requiredPermission=action=>action==='view_documents'?'documents.read':(['view_info','view_history'].includes(action)?'logistics.read':'logistics.write');

async function effectivePermissions(admin){
  if(admin?.role==='master_admin')return new Set(['logistics.read','logistics.write','documents.read']);
  const id=String(admin?.admin_id||'');
  if(!id)return new Set();
  // Action buttons only need these permissions. Teams and role descriptions
  // belong to the account screen and must not add reads to every list/save.
  const rows=await supabase('admin_effective_permissions',{query:`?select=permission_key&admin_user_id=eq.${encodeURIComponent(id)}&permission_key=in.(logistics.read,logistics.write,documents.read)`});
  return new Set((rows||[]).map(row=>row.permission_key));
}

async function readCapabilitySnapshot(){
  try{
    const rows=await supabase('rpc/shipment_action_capability_snapshot',{
      method:'POST',body:{p_max_rows:50000},readOnly:true
    });
    if(!Array.isArray(rows)||rows.some(row=>!row?.shipment_id||!row.capabilities||typeof row.capabilities!=='object'))throw Error('SHIPMENT_LIST_RESPONSE_INVALID');
    if(rows.length>50000)throw Error('SHIPMENT_LIST_VOLUME_LIMIT');
    return rows;
  }catch(error){
    // Compatibility while the additive migration/schema cache rolls out.
    // Permission, transport and malformed response errors must still fail.
    if(error?.status!==404||error?.code!=='PGRST202')throw error;
    return readShipmentListPages('shipment_action_capabilities','?select=shipment_id,capabilities&order=shipment_id.asc');
  }
}

export function maskShipmentActionCapabilities(raw,permissions){
  const state=raw&&typeof raw==='object'?{...raw}:{actions:{}};
  const actions=state.actions&&typeof state.actions==='object'?{...state.actions}:{};
  for(const [key,entry] of Object.entries(actions)){
    if(!entry||typeof entry!=='object')continue;
    const masked={...entry};
    actions[key]=masked;
    const required=requiredPermission(key);
    masked.business_allowed=entry.allowed===true;
    masked.required_permission=required;
    if(entry.allowed===true&&!permissions.has(required)){
      masked.allowed=false;
      masked.reason='PERMISSION_REQUIRED';
    }
  }
  state.actions=actions;
  state.write_access=permissions.has('logistics.write');
  return state;
}

export async function loadShipmentActionCapabilityMap(admin){
  const [permissions,rows]=await Promise.all([
    effectivePermissions(admin),
    readCapabilitySnapshot()
  ]);
  return {
    map:new Map((rows||[]).map(row=>[String(row.shipment_id),maskShipmentActionCapabilities(row.capabilities,permissions)])),
    write_access:permissions.has('logistics.write')
  };
}

export async function loadShipmentActionCapabilities(admin,shipmentId){
  const [permissions,rows]=await Promise.all([
    effectivePermissions(admin),
    supabase('shipment_action_capabilities',{query:`?select=shipment_id,capabilities&shipment_id=eq.${encodeURIComponent(shipmentId)}&limit=1`})
  ]);
  const row=rows?.[0];
  return row?maskShipmentActionCapabilities(row.capabilities,permissions):{actions:{},write_access:permissions.has('logistics.write')};
}

export async function assertShipmentBusinessAction(shipmentId,action){
  await supabase('rpc/assert_shipment_action',{method:'POST',body:{p_shipment_id:shipmentId,p_action:action}});
}
