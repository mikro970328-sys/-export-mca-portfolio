# Ventas canceladas y facturación — 2026-09-15

## Hallazgo y propietarios

La presentación del workspace usaba únicamente importe disponible y finance.write
para ofrecer Crear factura. Se reprodujo en el owner real mediante VM antes de
corregir: una venta no facturable ofrecía new_invoice. El RPC canónico ya exige
confirmed/closed; no se cambia. Owners: api/sales-workspace.js (capability),
admin/sales-workspace.js (botones, acción y confirmación), sales.html (asset).

Se conserva la conducta existente: cancelar una venta no anula sus facturas,
no elimina cobros, no borra historial y no realiza reembolsos. El diálogo lo
explica y el siguiente paso de una venta cancelada remite a Facturación.
Nueva capability billing.capabilities.create_invoice, denegada sin permiso,
con venta draft/cancelled o sin valor disponible. La UI falla cerrada si falta.
No dependencias, esquemas, permisos productivos ni escrituras de datos reales.

## Verificación

- Gate existente del workspace: reproducción roja antes del cambio; verde después.
  Matriz de cuatro estados, permiso sí/no y valor cero/positivo, controles de
  creación, denegación del handler, confirmación/declinación y errores seguros.
- Suite financiera local: 25/25 SQL sobre 85 migraciones, 11/11 API; contratos
  del owner, rentabilidad, documentación, anticipos y detector público aprobados.
- CF-13 usa formularios/login/HTTP reales sobre PostgreSQL/PostgREST desechables.
  Crea tres ventas y factura 50 de 100 unidades: borrador, emitida sin cobro,
  emitida con cobro 60 sobre total 200. Declinar conserva confirmed; confirmar
  cancela la venta y mantiene encabezado/líneas/cobros/progreso financiero exactos.
  Saldo visible por segundo operador: 200/200/140; caja final 60; documentos EUR
  independientes y cero almacén/WR/cargues. API rechaza nueva factura sin mutación.
- Se conserva CF-06: anticipo revertido, factura anulada, venta cancelada; ahora
  también se exige que no ofrezca nueva factura cuando libera el importe facturable.
- Los doce jobs existentes de Chromium/WebKit emulado deben pasar en el commit
  final. Resultados finales de CI, Preview, merge y despliegue se registran en PR.

## Límites

Preview comparte producción: no QA comercial allí. Pruebas físicas aplazadas
por Daniel para priorizar escritorio; no se requiere pago BrowserStack.
Esta entrega no cierra variantes financieras Direct Ship, toda sincronización de
Reportes, tracking/documentos/tareas/notificaciones ni la auditoría integral.
Rollback: revertir la PR; sin migración ni reverso de datos.
