# P5 · Evidencia de bootstrap vigente

Fecha: 2026-08-30

El bootstrap real se ejecutó mediante `reconcile_current_workflow_tasks()` después de validar el mismo escenario con `ROLLBACK`.

Resultado actual:
- 7 tareas workflow activas.
- 7 `dedupe_key` distintos.
- 3 `purchase_receipt`: PO-0005, PO-0006, PO-0008.
- 3 `shipment_cuba_documents`: ABCD1234567, SEFU4212106, SEGU4100060.
- 1 `sales_invoice`: SO-0005.
- 0 tareas AP porque las supplier bills vigentes ya están pagadas.
- 0 tareas de shipments históricos inactivos/entregados.
- 0 tareas de abastecimiento falsas para SO-0005 histórica, porque el fulfillment ya está despachado.
- Sin equipo/responsable asignado porque todavía no existen equipos configurados para routing.

Una segunda ejecución de `reconcile_current_workflow_tasks()` mantuvo total=7 y distinct_dedupe=7, confirmando idempotencia real.

Este archivo documenta evidencia; no contiene fixtures ni modifica lógica productiva.
