# Notas de crédito por cantidad

Una factura emitida no se reescribe al corregir la entrega. La nueva acción
Nota de crédito en Facturación descuenta cantidades al precio original y exige
un motivo. Muestra el importe, saldo pendiente y saldo a favor antes de emitir;
el detalle conserva las líneas originales, notas numeradas, motivos, cantidades
y cobros. Reportes incorpora total original, notas de crédito y saldo a favor.

La migración 20260916110740 añade notas/líneas inmutables y el RPC backend-only
create_invoice_quantity_credit. Cada solicitud tiene UUID único y copia de su
contenido; reintentar la misma intención devuelve la misma nota. El bloqueo de
factura serializa notas y cobros, y la cantidad previamente acreditada evita que
una pantalla desactualizada aplique el mismo descuento. La API exige finance.write.
Las cantidades acreditadas se leen del agregado decimal SQL, no de sumas JS.

invoice_net_items alimenta los owners existentes de deuda, límite de cobros y
anticipos, progreso de facturación, COGS, rentabilidad y reportes. El crédito se
calcula por diferencia de importes redondeados para conservar centavos al hacer
varios ajustes. Notas con cantidad cero, excesiva, no finita, línea de otra
factura o repetida se rechazan atómicamente. Una factura con notas no se anula.
La actualización de invoices.updated_at usa el canal de refresco existente.

Caso 840 × 4 = 3360, cobrado 1000 y entrega 810: nota 30 × 4 = 120,
total neto 3240, saldo 2240, COGS 2025 y margen de factura 1215. Si los cobros
superan el neto, la diferencia queda como saldo a favor, sin crear devolución ni
movimiento de caja. La nota no cambia la venta original, PO, proveedor, despacho
físico, inventario ni asignaciones logísticas; libera capacidad de facturación.
No implementa cambio de precio, reverso de notas, documento fiscal local ni
envío automático al cliente. La continuación de devolución/aplicación del saldo
se documenta en INVOICE_CREDIT_SETTLEMENT.md.

Validación local: 16 escenarios SQL/API de notas (840→810, reintentos/conflictos,
estados, permisos, invariantes, centavos, cantidades fraccionarias, límites,
anticipos, saldo a favor, COGS y privilegios), más suites financieras existentes.
Browser Direct Ship añade DS-16/17 desde UI y DS-18 con API real para reintentos y
carrera entre dos escritores. Otro usuario consulta Reportes sin recarga manual.
Todo se ejecuta en bases desechables; sin QA comercial en producción o Preview.
CI final, evidencia de navegador, versión remota de migración y despliegue exacto
se registran en la PR antes de dar esta entrega por publicada.
