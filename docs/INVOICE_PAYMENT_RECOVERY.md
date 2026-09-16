# Recuperación de cobros sin repetir dinero

## Defecto reproducido
En Chromium escritorio, una sola pulsación y el corte de la respuesta HTTP
después del commit dejaron dos cobros de USD 50. La pantalla mostró USD 95
pendientes en lugar de USD 145, con ambas referencias QA-LOST-CONFIRMATION.
Evidencia aislada: Actions 35140765936, artefacto browser-operators-chromium-desktop;
inspección de su estado renderizado en 35141515602. No incidente ni QA en producción.

## Corrección y dueño
- El formulario de Facturación y el de Ventas conservan un UUID por intención
  abierta. El mismo POST, automático o manual, devuelve el registro existente.
- El RPC register_invoice_payment conserva payments como único libro de cobros.
  Bloquea por solicitud, compara datos y actor y rechaza reutilizaciones distintas.
  La primera entrega sigue los guards de factura, moneda, saldo y crédito existentes.
- Un cobro liquidado o revertido se puede confirmar sin registrarlo otra vez.
  Dos cobros legítimos iguales con UUID distintos siguen permitidos.
- Cobro y auditoría de alta son atómicos. La reversión mantiene su dueño anterior.
- No se oculta un fallo de actualización como si el cobro confirmado no existiera.
  Un resultado sin comprobante válido se trata como confirmación desconocida.
- Historial previo intacto; llamadas antiguas sin UUID compatibles, pero no tienen
  garantía de idempotencia. La clave dura mientras el formulario conserva esa
  intención: cerrar y crear otra o recargar inicia una intención nueva. Ante
  incertidumbre, conservar el formulario y reintentar; revisar historial antes
  de iniciar un cobro nuevo. No se deduplica por importe o referencia comercial.
- No nuevo ledger, watcher, recarga completa ni credenciales en navegador.

## Validación
La PR registra resultados finales. Casos añadidos a los dueños de prueba existentes:
API-12..18 (reintento, liquidada, conflicto/datos/actor, reversión, permisos,
rollback de auditoría e identidad inmutable); HTTP-11 (entregas concurrentes reales);
UI-11..14 (confirmación perdida, reintento explícito, permiso retirado con formulario
abierto, desconexión antes del envío); COM-11 cubre también el formulario de Ventas.
Todos los datos comerciales de prueba son desechables.

Migración generada por Supabase CLI 2.117.0:
20260916192901_invoice_payment_retry_integrity.sql. DDL/publicación pendientes
hasta completar CI y preflight; no registrar cobros de QA en producción.
