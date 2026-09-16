# Aplicación y devolución del saldo a favor

Una nota de crédito puede dejar cobros por encima del total neto de una factura.
Facturación permite aplicar ese saldo a otra factura emitida del mismo cliente
y moneda, o registrar una devolución que ya se realizó al cliente. Ambas
acciones requieren importe, fecha y motivo; la devolución incluye medio y
referencia. El historial conserva número, actor, fecha, motivo y destino.

La aplicación no crea otro ingreso de caja. La devolución genera una salida
invoice_credit_refund y reduce el efectivo neto de la venta de origen. El ERP
registra el movimiento, no ejecuta una transferencia bancaria. Un reverso
añade otro registro con motivo y restaura los saldos, sin borrar la operación.
Las facturas, líneas, cobros, anticipos y notas de crédito originales permanecen.

## Fuente de verdad y protección

La migración 20260916141741 añade invoice_credit_movements, sus vistas de
movimientos activos/totales/historial y el RPC manage_invoice_credit. Solo el
backend puede leerlos o ejecutar el RPC; las escrituras directas se revocan,
RLS permanece activo y un trigger impide modificar o borrar el historial.
La API exige finance.write y el actor debe estar activo. Las capacidades de
interfaz también respetan el permiso y las dependencias calculadas en SQL.

El RPC bloquea origen y destino en orden estable, verifica el saldo esperado,
el límite disponible y la deuda de destino. Evita consumo doble concurrente,
créditos entre clientes/monedas, autofactura, importes inválidos y fechas futuras.
Un UUID de solicitud más su contenido normalizado devuelve el mismo movimiento
en reintentos; reutilizarlo para otra intención se rechaza. Cada movimiento
admite un solo reverso. Revertir crédito recibido que ya se gastó exige revertir
primero sus aplicaciones/devoluciones posteriores. La misma regla protege los
reversos de cobros y anticipos que financiaron el saldo; sus locks son los de
la factura. Una factura receptora con transferencia activa no se puede anular.

invoice_financial_progress conserva los totales originales de efectivo y
anticipos por separado. paid_amount y settlement_amount representan aplicado
neto: efectivo + anticipos + crédito recibido − crédito transferido − devuelto.
La deuda y el saldo a favor se calculan contra el total neto de la factura. Así
la suma de importes aplicados no duplica el dinero al transferir saldo. El
detalle de factura usa la etiqueta Aplicado neto y muestra el desglose completo.
Reportes, CSV, caja, Dashboard y finanzas de la venta usan esas vistas; no se
añade un owner paralelo de cálculo ni un mecanismo nuevo de refresco.

## Evidencia y límites

Quince escenarios SQL/API aislados cubren aplicaciones, devoluciones, reversos,
reintentos, estados, cliente/moneda, deuda/disponible, contenido conflictivo,
fechas/importes, actor/permisos, inmutabilidad, privilegios, dependencias de
cobros/anticipos/transferencias, caja, Dashboard, CSV y filtros de reportes.
Las suites existentes de notas y finanzas siguen siendo gates.

DS-19/22 amplían Direct Ship en Chromium escritorio y WebKit emulado: aplicación
40 desde un saldo 44, devolución 4, reverso de ambos y carrera entre dos usos
de 30 con saldo esperado 44. Solo uno gana, el saldo queda 14, los reintentos
no duplican y un lector recibe 403. Otro usuario ve Reportes sin recargar ni
navegar de nuevo. Capturas y JSON conservan saldos, historial, caja y errores.
Las pruebas comerciales usan bases desechables, nunca producción/Preview.

Resultados remotos, versión de migración y deployment exacto se registran en
la PR. El reverso de notas por cantidad se documenta en INVOICE_CREDIT_REVERSALS.md.
No incluye cambios de precio,
documento fiscal local, conciliación bancaria, notificación automática ni
certificación de iPhone físico. No modifica inventario, logística o proveedor.
