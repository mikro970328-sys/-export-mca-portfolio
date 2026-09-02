import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';
import { loadSupplierApCapabilityMaps, loadSupplierPaymentCapabilities } from './_supplier-ap-actions.js';

const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const rpcRow = value => Array.isArray(value) ? (value[0] || null) : (value || null);
const num = value => Number(value || 0);

function translatedError(raw) {
  const messages = [
    ['PERMISSION_REQUIRED','No tienes permiso para ejecutar esta acción financiera.'],
    ['SUPPLIER_PAYMENT_PO_NOT_FOUND','Purchase Order no encontrada.'],
    ['SUPPLIER_PAYMENT_PO_NOT_PAYABLE','La Purchase Order debe estar emitida, confirmada o cerrada para registrar pagos.'],
    ['SUPPLIER_PAYMENT_AMOUNT_INVALID','El monto del pago debe ser mayor que cero.'],
    ['SUPPLIER_PAYMENT_NOT_FOUND','Pago de proveedor no encontrado.'],
    ['SUPPLIER_PAYMENT_ALREADY_REVERSED','El pago ya fue revertido.'],
    ['SUPPLIER_PAYMENT_REVERSAL_REASON_REQUIRED','Indica el motivo del reverso.'],
    ['SUPPLIER_PAYMENT_NOT_POSTED','Solo un pago registrado puede distribuirse.'],
    ['SUPPLIER_PAYMENT_ACTION_INVALID','Acción de pago de proveedor inválida.'],
    ['SUPPLIER_PAYMENT_ACTION_NOT_ALLOWED','La acción ya no está disponible para este pago.'],
    ['SUPPLIER_PAYMENT_APPLICATIONS_INVALID','La distribución del pago no es válida.'],
    ['SUPPLIER_PAYMENT_BILL_REQUIRED','Selecciona una factura de proveedor.'],
    ['SUPPLIER_PAYMENT_APPLICATION_AMOUNT_INVALID','El monto aplicado debe ser mayor que cero.'],
    ['SUPPLIER_PAYMENT_APPLICATION_EXCEEDS_PAYMENT','La distribución supera el monto disponible del pago.'],
    ['SUPPLIER_PAYMENT_APPLICATION_EXCEEDS_BILL','El pago supera el saldo pendiente de la factura.'],
    ['SUPPLIER_PAYMENT_APPLICATION_CONTEXT_MISMATCH','El pago y la factura deben pertenecer a la misma Purchase Order, proveedor y moneda.'],
    ['SUPPLIER_BILL_ALREADY_PAID','Esta factura ya está completamente pagada.'],
    ['SUPPLIER_BILL_NOT_FOUND','Factura de proveedor no encontrada.'],
    ['SUPPLIER_BILL_NOT_POSTED','Solo se puede pagar una factura contabilizada.']
  ];
  const translated = messages.find(([key]) => raw.includes(key))?.[1];
  if (translated) return translated;
  const safeInput = [
    /^Selecciona una (factura de proveedor|Purchase Order)$/,
    /^El monto del pago debe ser mayor que cero$/,
    /^Falta el pago de proveedor$/,
    /^Indica el motivo del reverso$/,
    /^La distribución del pago no es válida$/,
    /^Falta la factura en la distribución \d+$/,
    /^Indica un monto válido en la distribución \d+$/
  ];
  return safeInput.some(pattern => pattern.test(raw)) ? raw : null;
}

function cleanApplications(applications) {
  if (!Array.isArray(applications)) throw new Error('La distribución del pago no es válida');
  return applications.map((row, index) => {
    const billId = text(row.supplier_bill_id,80);
    const amount = text(row.amount,80);
    if (!billId) throw new Error(`Falta la factura en la distribución ${index + 1}`);
    if (!amount || Number(amount) <= 0) throw new Error(`Indica un monto válido en la distribución ${index + 1}`);
    return { supplier_bill_id:billId, amount };
  });
}

async function loadPayments(capabilityMap = new Map()) {
  const [payments, progress, applications] = await Promise.all([
    supabase('supplier_payments', { query:'?select=id,payment_number,purchase_order_id,supplier_id,amount,currency,payment_date,method,reference,status,notes,reversed_at,reversal_reason,created_at,supplier:suppliers(id,name,legal_name),purchase_order:purchase_orders(id,po_number,status,supplier_reference)&order=payment_date.desc,created_at.desc&limit=2000' }),
    supabase('supplier_payment_progress', { query:'?select=*&order=payment_date.desc&limit=2000' }),
    supabase('supplier_payment_applications', { query:'?select=id,supplier_payment_id,supplier_bill_id,amount,created_at&order=created_at.asc&limit=5000' })
  ]);
  const progressByPayment = new Map((progress || []).map(row => [row.supplier_payment_id,row]));
  const appsByPayment = new Map();
  for (const app of applications || []) {
    if (!appsByPayment.has(app.supplier_payment_id)) appsByPayment.set(app.supplier_payment_id, []);
    appsByPayment.get(app.supplier_payment_id).push(app);
  }
  return (payments || []).map(payment => ({
    ...payment,
    progress:progressByPayment.get(payment.id) || null,
    applications:appsByPayment.get(payment.id) || [],
    capabilities:capabilityMap.get(String(payment.id)) || { actions:{} }
  }));
}

async function loadBills(capabilityMap = new Map()) {
  const [bills, financial] = await Promise.all([
    supabase('supplier_bills', { query:'?select=id,bill_number,purchase_order_id,supplier_id,supplier_invoice_number,currency,status,supplier:suppliers(id,name,legal_name)&status=eq.posted&order=bill_date.desc&limit=1000' }),
    supabase('supplier_bill_financial_progress', { query:'?select=*&status=eq.posted&limit=1000' })
  ]);
  const progress = new Map((financial || []).map(row => [row.supplier_bill_id,row]));
  return (bills || []).map(bill => ({ ...bill, financial:progress.get(bill.id) || null, capabilities:capabilityMap.get(String(bill.id)) || {actions:{}} }));
}

async function loadPurchaseOrders() {
  return supabase('purchase_orders', { query:'?select=id,po_number,supplier_id,status,currency,supplier_reference,supplier:suppliers(id,name,legal_name)&status=in.(issued,confirmed,closed)&order=created_at.desc&limit=1000' });
}

async function bootstrap(admin) {
  const capabilities = await loadSupplierApCapabilityMaps(admin);
  const [payments, bills, allPurchaseOrders] = await Promise.all([
    loadPayments(capabilities.payment_capabilities),
    loadBills(capabilities.bill_capabilities),
    loadPurchaseOrders()
  ]);
  const balances = new Map();
  for (const bill of bills) {
    const balance = num(bill?.financial?.balance_due);
    if (!(balance > 0) || !bill.purchase_order_id) continue;
    balances.set(bill.purchase_order_id, (balances.get(bill.purchase_order_id) || 0) + balance);
  }
  const purchase_orders = (allPurchaseOrders || []).filter(po => num(balances.get(po.id)) > 0).map(po => ({ ...po, open_balance:num(balances.get(po.id)) }));
  const advance_purchase_orders = (allPurchaseOrders || []).filter(po => ['issued','confirmed'].includes(po.status));
  return { payments, bills, purchase_orders, advance_purchase_orders, write_access:capabilities.write_access };
}

async function paymentWithCapabilities(admin,payment){
  if(!payment?.id)return payment;
  const capability=await loadSupplierPaymentCapabilities(admin,payment.id);
  return (await loadPayments(new Map([[String(payment.id),capability]]))).find(row=>row.id===payment.id)||{...payment,capabilities:capability};
}

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, req.method === 'GET' ? 'finance.read' : 'finance.write');
  if (!admin) return;
  try {
    if (req.method === 'GET') return ok(res,await bootstrap(admin));
    if (req.method !== 'POST') return fail(res,405,'Método no permitido');

    const body = await readJson(req);
    const action = text(body.action,60).toLowerCase();

    if (action === 'pay_bill') {
      const billId = text(body.supplier_bill_id,80);
      if (!billId) throw new Error('Selecciona una factura de proveedor');
      const amount = Number(body.amount || 0);
      if (!(amount > 0)) throw new Error('El monto del pago debe ser mayor que cero');
      const result = await supabase('rpc/pay_supplier_bill_canonical', { method:'POST', body:{
        p_supplier_bill_id:billId,p_amount:amount,p_payment_date:text(body.payment_date,40) || null,p_method:text(body.method,100) || null,
        p_reference:text(body.reference,300) || null,p_notes:text(body.notes,2000) || null,p_actor:admin.admin_id || null
      }});
      const payment = rpcRow(result);
      if (!payment?.id) throw new Error('No se pudo registrar el pago de la factura');
      await writeAudit(admin,'supplier_bill_paid','supplier_payment',payment.id,{ payment_number:payment.payment_number, supplier_bill_id:billId, purchase_order_id:payment.purchase_order_id, amount });
      return ok(res,{ payment:await paymentWithCapabilities(admin,payment) });
    }

    if (action === 'register') {
      const poId = text(body.purchase_order_id,80);
      if (!poId) throw new Error('Selecciona una Purchase Order');
      const amount = Number(body.amount || 0);
      if (!(amount > 0)) throw new Error('El monto del pago debe ser mayor que cero');
      const result = await supabase('rpc/register_supplier_payment', { method:'POST', body:{
        p_purchase_order_id:poId,p_amount:amount,p_payment_date:text(body.payment_date,40) || null,p_method:text(body.method,100) || null,
        p_reference:text(body.reference,300) || null,p_notes:text(body.notes,2000) || null,p_actor:admin.admin_id || null
      }});
      const payment = rpcRow(result);
      if (!payment?.id) throw new Error('No se pudo registrar el pago');
      await writeAudit(admin,'supplier_payment_registered','supplier_payment',payment.id,{ payment_number:payment.payment_number, purchase_order_id:poId, amount });
      return ok(res,{ payment:await paymentWithCapabilities(admin,payment) });
    }

    if (action === 'reverse') {
      const paymentId = text(body.supplier_payment_id,80);
      const reason = text(body.reason,1000);
      if (!paymentId) throw new Error('Falta el pago de proveedor');
      if (!reason) throw new Error('Indica el motivo del reverso');
      const result = await supabase('rpc/reverse_supplier_payment_canonical', { method:'POST', body:{ p_supplier_payment_id:paymentId, p_reason:reason, p_actor:admin.admin_id || null } });
      const payment = rpcRow(result);
      await writeAudit(admin,'supplier_payment_reversed','supplier_payment',paymentId,{ payment_number:payment?.payment_number || null, reason });
      return ok(res,{ payment:await paymentWithCapabilities(admin,payment) });
    }

    if (action === 'replace_applications') {
      const paymentId = text(body.supplier_payment_id,80);
      if (!paymentId) throw new Error('Falta el pago de proveedor');
      const applications = cleanApplications(body.applications || []);
      const result = await supabase('rpc/replace_supplier_payment_applications_canonical', { method:'POST', body:{ p_supplier_payment_id:paymentId, p_applications:applications, p_actor:admin.admin_id || null } });
      const payment = rpcRow(result);
      await writeAudit(admin,'supplier_payment_allocated','supplier_payment',paymentId,{ application_count:applications.length });
      return ok(res,{ payment:await paymentWithCapabilities(admin,payment) });
    }

    return fail(res,400,'Acción de pago de proveedor no válida');
  } catch (error) {
    const raw = String(error?.message || '');
    const translated = translatedError(raw);
    if (translated) return fail(res,400,translated);
    console.error('[supplier-payments]',error);
    return fail(res,500,'No se pudo procesar el pago del proveedor');
  }
}
