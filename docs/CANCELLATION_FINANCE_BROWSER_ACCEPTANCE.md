# Aceptación de cancelaciones financieras en navegador

Base: `af17d6b9bf1cb917fd437b58cbd4c82e31677a1e` (PR #296 publicada).
Rama: `test/cancellation-finance-browser-acceptance`.
Estado: EN VALIDACIÓN.

## Objetivo

Cerrar variantes que la aceptación Direct Ship no cubrió: cancelaciones y
reversos cuando una venta o compra ya tiene dinero asociado. Las mutaciones de
negocio deben partir de la UI original y ejecutarse solo contra PostgreSQL /
PostgREST desechables. Preview comparte producción y no se usa para escrituras.

## Primera historia ejecutable

`e2e/isolated/cancellation-finance.spec.mjs` ya está registrada en Playwright y
en Browser Operator Acceptance para Chromium escritorio y WebKit móvil. Crea y
confirma una venta desde la UI y ejecuta desde el workspace financiero:

1. CF-01: registrar anticipo USD 100; disponible y caja neta = 100.
2. CF-02: reembolsar USD 20; disponible = 80 y caja neta = 80, una sola salida.
3. CF-03: reversar el reembolso; conserva fila `reversed`, disponible/caja = 100.
4. CF-04: reversar el anticipo; conserva historial y saldo/caja activos = 0.

Las comprobaciones consultan `customer_advance_progress`,
`sales_order_customer_financial_progress` y `executive_cash_movement_source`.
Errores JavaScript, crashes, tráfico externo y API 404/5xx inesperados fallan la
historia. Las operaciones nacen de botones/formularios originales; SQL solo
verifica el resultado posterior.

El workflow ejecuta ahora ocho combinaciones: operators, commercial,
direct-ship y cancellation-finance en ambos motores. Primer run de esta historia:
`34468464113`, head `d7fe807557df17371ceca6e9a1ec551f80fc3739`. En este corte los jobs estaban
inicializando dependencias/containers; no se registra todavía como aprobado ni
fallido.

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

## Matriz completa pendiente

| Caso | Recorrido y resultado exigido |
|---|---|
| CF-01 | Venta confirmada + anticipo: registro y conciliación de caja |
| CF-02 | Reembolso parcial reduce saldo disponible y caja una sola vez |
| CF-03 | Reverso de reembolso restaura saldo/caja sin borrar historial |
| CF-04 | Reverso de anticipo conserva historial y elimina saldo/caja activos |
| CF-05 | Venta con anticipo activo: Cancelar debe rechazarse sin mutación |
| CF-06 | Anticipo aplicado a factura: reverso bloqueado hasta revertir aplicación |
| CF-07 | Revertir aplicación restaura saldo de anticipo y factura sin nueva caja |
| CF-08 | PO + factura proveedor posted + pago: anular factura debe rechazarse |
| CF-09 | Revertir pago proveedor: factura recupera saldo, pago queda reversed |
| CF-10 | Anular factura y luego cancelar PO conservando historial |
| CF-11 | Operador sin finance.write consulta pero no ejecuta reversos/anulaciones |
| CF-12 | Otra sesión refleja cada transición sin recarga manual |

## Invariantes

1. Los saldos se comprueban en vistas financieras canónicas, no con fórmulas
   duplicadas del frontend.
2. Aplicar un anticipo no crea un nuevo movimiento de caja.
3. Un rechazo no altera estados, saldos, aplicaciones, caja ni auditoría como si
   la operación hubiera ocurrido.
4. Reversos conservan filas históricas y motivo; no DELETE de libros.
5. Cliente/proveedor/moneda permanecen aislados de un segundo conjunto control.
6. Las mismas expectativas se ejecutan en Chromium y WebKit móvil.

## Siguiente acción exacta

Tomar el resultado real de la primera historia y corregir solo fallos
reproducidos. Después ampliar el mismo spec con CF-05..CF-07 (cancelación con
anticipo y aplicación a factura) y CF-08..CF-10 (factura/pago de proveedor),
terminando con permisos y refresco entre operadores. No fusionar esta PR hasta
que la matriz completa y las regresiones anteriores estén verdes.
