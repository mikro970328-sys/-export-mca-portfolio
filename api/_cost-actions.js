import { supabase } from './_lib.js';
import { loadFinanceWriteAccess } from './_invoice-actions.js';

const clone=value=>value&&typeof value==='object'?JSON.parse(JSON.stringify(value)):{actions:{}};

function permissionAwareCapabilities(raw,writeAccess){
  const state=clone(raw);
  const actions=state.actions&&typeof state.actions==='object'?state.actions:{};
  for(const entry of Object.values(actions)){
    if(!entry||typeof entry!=='object')continue;
    entry.business_allowed=entry.allowed===true;
    entry.required_permission='finance.write';
    if(entry.allowed===true&&!writeAccess){
      entry.allowed=false;
      entry.reason='PERMISSION_REQUIRED';
    }
  }
  state.actions=actions;
  state.write_access=writeAccess;
  return state;
}

export async function loadCostChargeCapabilityMap(admin){
  const [writeAccess,rows]=await Promise.all([
    loadFinanceWriteAccess(admin),
    supabase('cost_charge_action_capabilities',{query:'?select=cost_charge_id,capabilities&limit=2000'})
  ]);
  return {
    write_access:writeAccess,
    map:new Map((rows||[]).map(row=>[
      String(row.cost_charge_id),
      permissionAwareCapabilities(row.capabilities,writeAccess)
    ]))
  };
}
