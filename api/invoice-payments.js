import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';

const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const rpcRow = value => Array.isArray(value) ? (value[0] || null) : (value || null);

function translatedError(raw) {
  const messages = [
    ['PAYMENT_AMOUNT_INVALID','El monto del cobro debe ser mayor que cero.'],
    ['PAYMENT_INVOICE_NOT_FOUND','Factura no encontrada.'],
    ['PAYMENT_INVOICE_NOT_ISSUED','Solo se pueden registrar cobros contra facturas emitidas.'],
    ['PAYMENT_INVOICE_HAS_NO_TOTAL','La factura no tiene un total válido para cobrar.'],
    ['PAYMENT_EXCEEDS_BALANCE','El monto supera el saldo pendiente de la factura.'],
    ['PAYMENT_NOT_FOUND','Cobro no encontrado.'],
    ['PAYMENT_ALREADY_REVERSED','Ese cobro ya fue revertido.'],
    ['PAYMENT_STATUS_FINAL','Ese cobro ya está finalizado.'],
    ['PAYMENT_STATUS_TRANSITION_INVALID','Transición de estado de cobro inválida.']
  ];
  return messages.find(([key]) => raw.includes(key))?.[1] || raw;
}

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, 'finance.write');
  if (!admin) return;
  if (req.method !== 'POST') return fail(res,405,'Método no permitido');

  try {
    const body = await readJson(req);
    const action = text(body.action,60).toLowerCase();

    if (action === 'register') {
      const invoiceId = text(body.invoice_id,80);
      if (!invoiceId) throw new Error('Falta la factura');
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto del cobro debe ser mayor que cero.');

      const result = await supabase('rpc/register_invoice_payment', { method:'POST', body:{
        p_invoice_id:invoiceId,
        p_amount:String(amount),
        p_payment_date:text(body.payment_date,40) || null,
        p_method:text(body.method,120) || null,
        p_reference_number:text(body.reference_number,250) || null,
        p_notes:text(body.notes,2000) || null
      }});
      const payment = rpcRow(result);
      if (!payment?.id) throw new Error('No se pudo registrar el cobro');
      await writeAudit(admin,'invoice_payment_registered','payment',payment.id,{
        invoice_id:invoiceId,
        amount:payment.amount,
        currency:payment.currency,
        reference_number:payment.reference_number || null
      });
      return ok(res,{ payment });
    }

    if (action === 'reverse') {
      const paymentId = text(body.payment_id,80);
      if (!paymentId) throw new Error('Falta el cobro');
      const result = await supabase('rpc/reverse_invoice_payment', { method:'POST', body:{
        p_payment_id:paymentId,
        p_reason:text(body.reason,2000) || null
      }});
      const payment = rpcRow(result);
      if (!payment?.id) throw new Error('No se pudo revertir el cobro');
      await writeAudit(admin,'invoice_payment_reversed','payment',payment.id,{
        invoice_id:payment.invoice_id,
        amount:payment.amount,
        currency:payment.currency
      });
      return ok(res,{ payment });
    }

    return fail(res,400,'Acción de Cobros no válida');
  } catch (error) {
    const raw = String(error.message || 'No se pudo procesar el cobro');
    console.error('[invoice-payments]',error);
    return fail(res,400,translatedError(raw));
  }
}
