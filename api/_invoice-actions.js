import { loadAdminAccessContext, supabase } from './_lib.js';

const clone=value=>value&&typeof value==='object'?JSON.parse(JSON.stringify(value)):{actions:{}};

function permissionAwareCapabilities(raw,writeAccess){
  const state=clone(raw);
  const actions=state.actions&&typeof state.actions==='object'?state.actions:{};
  for(const entry of Object.values(actions)){
    if(!entry||typeof entry!=='object')continue;
    entry.business_allowed=entry.allowed===true;
    entry.required_permission='finance.write';
    if(entry.allowed===true&&!writeAccess){entry.allowed=false;entry.reason='PERMISSION_REQUIRED';}
  }
  state.actions=actions;
  return state;
}

export async function loadFinanceWriteAccess(admin){
  if(admin?.role==='master_admin')return true;
  const context=await loadAdminAccessContext(admin?.admin_id);
  return (context.permissions||[]).includes('finance.write');
}

export async function loadInvoiceFinanceCapabilityMaps(admin){
  const [writeAccess,invoiceRows,paymentRows]=await Promise.all([
    loadFinanceWriteAccess(admin),
    supabase('invoice_action_capabilities',{query:'?select=invoice_id,capabilities&limit=2000'}),
    supabase('payment_action_capabilities',{query:'?select=payment_id,invoice_id,capabilities&limit=5000'})
  ]);
  return {
    write_access:writeAccess,
    invoice_capabilities:new Map((invoiceRows||[]).map(row=>[row.invoice_id,permissionAwareCapabilities(row.capabilities,writeAccess)])),
    payment_capabilities:new Map((paymentRows||[]).map(row=>[row.payment_id,permissionAwareCapabilities(row.capabilities,writeAccess)]))
  };
}

export function requireCapability(capabilities,action){
  const entry=capabilities?.actions?.[action];
  if(entry?.allowed===true)return;
  throw new Error(entry?.reason||'ACTION_NOT_ALLOWED');
}
