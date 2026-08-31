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
    if(entry.allowed===true&&!writeAccess){entry.allowed=false;entry.reason='PERMISSION_REQUIRED';}
  }
  state.actions=actions;
  state.write_access=writeAccess;
  return state;
}

export async function loadSupplierApCapabilityMaps(admin){
  const [writeAccess,billRows,paymentRows]=await Promise.all([
    loadFinanceWriteAccess(admin),
    supabase('supplier_bill_action_capabilities',{query:'?select=supplier_bill_id,capabilities&limit=2000'}),
    supabase('supplier_payment_action_capabilities',{query:'?select=supplier_payment_id,purchase_order_id,capabilities&limit=5000'})
  ]);
  return {
    write_access:writeAccess,
    bill_capabilities:new Map((billRows||[]).map(row=>[String(row.supplier_bill_id),permissionAwareCapabilities(row.capabilities,writeAccess)])),
    payment_capabilities:new Map((paymentRows||[]).map(row=>[String(row.supplier_payment_id),permissionAwareCapabilities(row.capabilities,writeAccess)]))
  };
}

export async function loadSupplierBillCapabilities(admin,billId){
  const writeAccess=await loadFinanceWriteAccess(admin);
  const rows=await supabase('supplier_bill_action_capabilities',{query:`?select=supplier_bill_id,capabilities&supplier_bill_id=eq.${encodeURIComponent(billId)}&limit=1`});
  return rows?.[0]?permissionAwareCapabilities(rows[0].capabilities,writeAccess):{actions:{},write_access:writeAccess};
}

export async function loadSupplierPaymentCapabilities(admin,paymentId){
  const writeAccess=await loadFinanceWriteAccess(admin);
  const rows=await supabase('supplier_payment_action_capabilities',{query:`?select=supplier_payment_id,capabilities&supplier_payment_id=eq.${encodeURIComponent(paymentId)}&limit=1`});
  return rows?.[0]?permissionAwareCapabilities(rows[0].capabilities,writeAccess):{actions:{},write_access:writeAccess};
}
