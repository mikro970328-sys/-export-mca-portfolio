import { loadAdminAccessContext, supabase } from './_lib.js';

const clone=value=>value&&typeof value==='object'?JSON.parse(JSON.stringify(value)):{actions:{}};

function permissionAwareCapabilities(raw,permissionForAction,permissions){
  const state=clone(raw);
  const actions=state.actions&&typeof state.actions==='object'?state.actions:{};
  for(const [key,entry] of Object.entries(actions)){
    if(!entry||typeof entry!=='object')continue;
    const required=permissionForAction(key);
    const allowedByPermission=permissions.has(required);
    entry.business_allowed=entry.allowed===true;
    entry.required_permission=required;
    if(entry.allowed===true&&!allowedByPermission){entry.allowed=false;entry.reason='PERMISSION_REQUIRED';}
  }
  state.actions=actions;
  return state;
}

export async function loadCustomerFinanceCapabilityMaps(admin){
  const context=admin?.role==='master_admin'?{permissions:['sales.write','finance.write']}:await loadAdminAccessContext(admin?.admin_id);
  const permissions=new Set(context.permissions||[]);
  if(admin?.role==='master_admin'){permissions.add('sales.write');permissions.add('finance.write');}

  const [salesOrderRows,proformaRows,advanceRows,applicationRows,refundRows]=await Promise.all([
    supabase('sales_order_customer_finance_action_capabilities',{query:'?select=sales_order_id,capabilities&limit=2000'}),
    supabase('proforma_action_capabilities',{query:'?select=proforma_id,sales_order_id,capabilities&limit=5000'}),
    supabase('customer_advance_action_capabilities',{query:'?select=customer_advance_id,sales_order_id,capabilities&limit=5000'}),
    supabase('customer_advance_application_action_capabilities',{query:'?select=application_id,customer_advance_id,capabilities&limit=10000'}),
    supabase('customer_advance_refund_action_capabilities',{query:'?select=refund_id,customer_advance_id,capabilities&limit=10000'})
  ]);

  return {
    sales_write_access:permissions.has('sales.write'),
    finance_write_access:permissions.has('finance.write'),
    sales_order_capabilities:new Map((salesOrderRows||[]).map(row=>[row.sales_order_id,permissionAwareCapabilities(row.capabilities,key=>key==='create_proforma'?'sales.write':'finance.write',permissions)])),
    proforma_capabilities:new Map((proformaRows||[]).map(row=>[row.proforma_id,permissionAwareCapabilities(row.capabilities,()=> 'sales.write',permissions)])),
    advance_capabilities:new Map((advanceRows||[]).map(row=>[row.customer_advance_id,permissionAwareCapabilities(row.capabilities,()=> 'finance.write',permissions)])),
    application_capabilities:new Map((applicationRows||[]).map(row=>[row.application_id,permissionAwareCapabilities(row.capabilities,()=> 'finance.write',permissions)])),
    refund_capabilities:new Map((refundRows||[]).map(row=>[row.refund_id,permissionAwareCapabilities(row.capabilities,()=> 'finance.write',permissions)]))
  };
}

export function requireCapability(capabilities,action){
  const entry=capabilities?.actions?.[action];
  if(entry?.allowed===true)return;
  throw new Error(entry?.reason||'ACTION_NOT_ALLOWED');
}
