import { loadAdminAccessContext, supabase } from './_lib.js';

const clone=value=>value&&typeof value==='object'?JSON.parse(JSON.stringify(value)):{actions:{}};

async function effectivePermissions(admin){
  if(admin?.role==='master_admin')return new Set(['logistics.read','logistics.write']);
  const access=await loadAdminAccessContext(admin?.admin_id);
  return new Set(access?.permissions||[]);
}

export function maskLoadActionCapabilities(raw,permissions){
  const state=clone(raw);
  const actions=state.actions&&typeof state.actions==='object'?state.actions:{};
  for(const [key,entry] of Object.entries(actions)){
    if(!entry||typeof entry!=='object')continue;
    const required=key==='view_tracking'?'logistics.read':'logistics.write';
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

export async function loadLoadActionCapabilityMap(admin){
  const permissions=await effectivePermissions(admin);
  const rows=await supabase('load_action_capabilities',{query:'?select=load_id,capabilities&limit=5000'});
  return {
    map:new Map((rows||[]).map(row=>[String(row.load_id),maskLoadActionCapabilities(row.capabilities,permissions)])),
    write_access:permissions.has('logistics.write')
  };
}

export async function loadLoadActionCapabilities(admin,loadId){
  const permissions=await effectivePermissions(admin);
  const rows=await supabase('load_action_capabilities',{query:`?select=load_id,capabilities&load_id=eq.${encodeURIComponent(loadId)}&limit=1`});
  const row=rows?.[0];
  return row?maskLoadActionCapabilities(row.capabilities,permissions):{actions:{},write_access:permissions.has('logistics.write')};
}
