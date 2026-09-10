# Aceptación Direct Ship en navegador — PR #296

Base publicada: `f97c8744ce2e4c4d7ca9d5139cb1fdd65fe314b8` (PR #295).
Rama: `test/direct-ship-browser-acceptance`. Estado: EN VALIDACIÓN.

## Frontera

Una compra de 100 cajas/10 pallets por USD 250, sin almacén; una venta de esas
100 cajas por USD 400; una PO vinculada; un contenedor creado, desvinculado y
reutilizado; despacho y protección de las cantidades. Todas las mutaciones de
negocio nacen de clics/formularios originales. Solo catálogos y usuarios QA son
preparados. PostgreSQL/PostgREST desechables por combinación historia/motor.

## Matriz previa al cambio funcional

| Caso | Resultado exigido |
|---|---|
| DS-01 | Crear PO Direct Ship con warehouse_id null, sin acción de recepción |
| DS-02 | Emitir/confirmar la PO sin WR |
| DS-03 | Crear y confirmar la venta de USD 400 |
| DS-04 | Elegir PO confirmada y conservar vínculo de 100 cajas |
| DS-05 | Crear/vincular contenedor desde el formulario; una sola operación |
| DS-06 | Cancelar diálogo de desvinculación no altera el vínculo |
| DS-07 | Desvincular y reutilizar el mismo contenedor antes de despacho |
| DS-08 | Cerrar formulario de despacho no registra una salida |
| DS-09 | Despachar cumple venta y conserva instante local 10:15 NY = 14:15 UTC |
| DS-10 | Después: sin acciones de desvincular/despachar y rechazo visible de reducción a 99 |

En CADA checkpoint: cero WR, Cargues, movimientos y existencias de almacén.
API 404/5xx, errores JavaScript, caídas y accesos externos hacen fallar la suite.
Capturas y diagnóstico JSON se guardan también ante fallo, sin credenciales.

## Diagnóstico del primer run

`34425521352`, head `d002932`: los cuatro jobs operators/commercial aprobaron;
ambos Direct Ship terminaron antes de ejecutar un solo caso: `No tests found`.
El archivo estaba omitido en `testMatch`. Se corrige el registro explícito,
se conecta el handler original `direct-shipment-dispatch` al servidor QA,
y se corrigen la espera tardía de la segunda respuesta y el cierre del Pool
(`end`, no `close`). Ninguna de esas correcciones altera el ERP productivo.
La matriz de diez casos aún debe aprobar; implementación no es certificación.

## Límites

Chromium y WebKit móvil emulado, no Safari/iPhone real ni PWA standalone.
No escrituras QA en producción/Preview, no envío de mensajes, no migraciones
productivas. BrowserStack no se reintenta manualmente. La cadena no certifica
facturación/cobros Direct Ship, pagos de proveedor ni cancelación de contenedor
con sus variantes financieras. No sustituye auditoría integral.
