# Aceptación de cancelaciones financieras en navegador

Base: `af17d6b9bf1cb917fd437b58cbd4c82e31677a1e` (PR #296 publicada).
Rama: `test/cancellation-finance-browser-acceptance`.
Estado: MATRIZ DEFINIDA, implementación de pruebas pendiente.

## Objetivo

Cerrar variantes que la aceptación Direct Ship no cubrió: cancelaciones y
reversos cuando una venta o compra ya tiene dinero asociado. Las mutaciones de
negocio deben partir de la UI original y ejecutarse solo contra PostgreSQL /
PostgREST desechables. Preview comparte producción y no se usa para escrituras.

## Contratos ya existentes que deben demostrarse, no reinventarse

- Una Sales Order con anticipo activo no se puede cancelar
  (`SO_HAS_ACTIVE_CUSTOMER_ADVANCE`).
- Un anticipo con aplicaciones o reembolsos activos no se puede revertir hasta
  revertir primero esas operaciones.
- Una factura de proveedor contabilizada con pagos aplicados no se puede anular
  hasta revertir/desasignar esos pagos (`SUPPLIER_BILL_HAS_ACTIVE_PAYMENTS`).
- Un pago de proveedor puede revertirse con motivo y sus capacidades cambian.
- La cancelación de una Purchase Order se bloquea mientras tenga AP activo o
  abastecimiento de ventas activo; no se deben borrar libros para conseguirla.

## Matriz previa a cualquier corrección funcional

| Caso | Recorrido y resultado exigido |
|---|---|
| CF-01 | Venta confirmada + anticipo: Cancelar debe rechazarse y conservar venta/anticipo/caja |
| CF-02 | Anticipo aplicado a factura: reverso del anticipo debe rechazarse mientras la aplicación siga activa |
| CF-03 | Revertir aplicación desde UI: restaura saldo de anticipo y saldo de factura sin crear caja |
| CF-04 | Reembolsar parte del anticipo: caja registra salida una sola vez y reduce saldo disponible |
| CF-05 | Reverso del reembolso: restaura saldo y caja sin duplicar movimientos |
| CF-06 | Con aplicaciones/reembolsos ya revertidos, revertir anticipo; después la venta puede cancelar si no tiene otro bloqueo |
| CF-07 | PO + factura proveedor posted + pago aplicado: anular factura debe rechazarse y conservar AP/pago |
| CF-08 | Revertir pago proveedor desde UI: factura recupera saldo, pago queda reversed y caja se reconcilia |
| CF-09 | Anular factura después del reverso: AP activo desaparece sin borrar historial financiero |
| CF-10 | Cancelar PO después de resolver AP; debe conservar factura/pago históricos y no afectar otra PO/venta |
| CF-11 | Operador sin finance.write ve capacidades de lectura pero no puede ejecutar reversos/anulaciones financieras |
| CF-12 | Refresco sin recarga: Ventas, Anticipos, Facturas/Pagos Proveedores y Reportes reflejan cada transición |

## Invariantes en cada checkpoint

1. Los saldos se comprueban directamente en las vistas financieras canónicas,
   no mediante cálculos duplicados del test.
2. Caja debe conciliar exactamente con sus libros; aplicar un anticipo no crea
   movimiento de caja adicional.
3. Un rechazo no puede alterar status, saldos, aplicaciones, caja ni auditoría
   como si la operación hubiera ocurrido.
4. Reversos conservan filas históricas y motivo; no DELETE de libros.
5. Venta/PO/cliente/proveedor/moneda permanecen aislados de un segundo conjunto
   control usado para detectar contaminación cruzada.
6. Errores JavaScript, crashes, API 404/5xx inesperados o tráfico externo hacen
   fallar la historia. Los 400 de reglas de negocio esperadas se validan por
   mensaje y por ausencia de mutación.
7. Chromium escritorio y WebKit móvil ejecutan la misma matriz. WebKit emulado
   no se presentará como Safari/iPhone real.

## Seguridad y alcance

No se modifican todavía RPC, tablas, UI ni migraciones. Primero se instrumenta
esta matriz contra handlers y componentes originales. Si reproduce un defecto,
la corrección se hará en el owner canónico y se volverá a ejecutar toda la
matriz previa, además de las regresiones de finanzas, Direct Ship, commercial y
multioperador afectadas.

No se envían mensajes, no se crean registros QA en producción/Preview y no se
usan credenciales reales en artefactos. Las capturas no incluyen login/tokens.

## Siguiente acción exacta

Construir la fixture aislada con dos ventas, dos PO, anticipos, factura cliente,
factura proveedor y pago; conectar handlers `customer-advances`, `payables`,
`supplier-payments`, `sales` y los módulos UI financieros al servidor QA. Luego
ejecutar CF-01..CF-12 sin cambiar expectativas para descubrir el comportamiento
real antes de cualquier fix.
