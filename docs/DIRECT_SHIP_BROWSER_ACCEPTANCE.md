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
| DS-01 | Crear PO Direct Ship con warehouse_id null |
| DS-02 | Emitir/confirmar la PO sin acción de recepción |
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
Los 403 de módulos ajenos al rol son esperados; no se sustituyen respuestas.
Capturas y diagnóstico JSON se guardan también ante fallo, sin credenciales.

## Diagnóstico y evidencia previa a la corrección

- `34425521352`, head `d002932`: los cuatro jobs operators/commercial aprobaron;
  ambos Direct Ship terminaron sin ejecutar casos: `No tests found`. Faltaba el
  archivo en `testMatch`. Se registra explícitamente, se conecta el handler
  original `direct-shipment-dispatch` al servidor QA y se corrigen la espera
  tardía de la segunda respuesta y el cierre del Pool (`end`, no `close`).
- `34426178171`, head `17b6942`: Chromium completó DS-01 a DS-04. La inserción
  del contenedor fue rechazada por falta del grant legacy de `shipments` en QA.
  Se contrastó en producción mediante `has_table_privilege`: service_role sí
  tiene INSERT. Se completa SOLO la base QA; no se cambia ningún permiso real.
  Los listeners pendientes se resuelven de forma segura para que el rechazo
  de una petición no oculte el primer error; el JSON se persiste como archivo.
- `34426597258`, head `6ca729b`: Chromium completó DS-01 a DS-08 y reprodujo un
  error real en DS-09: 10:15 de Nueva York se guardó como 10:15 UTC, no 14:15 UTC.
  Se guardaron ocho checkpoints y cero errores JavaScript/caídas/red externa.
  En esa ejecución la matriz comercial WebKit se detuvo al abrir el menú al
  iniciar; no hubo checkpoints comerciales. Se conserva ese diagnóstico y no
  se cambia ni salta esa matriz. Su revalidación sigue siendo obligatoria.

## Corrección funcional en validación

El owner `admin/sales-supply-workspace.js` convierte el `datetime-local` a ISO
CON zona en el navegador antes de enviar el despacho. No añade cuatro horas
fijas: respeta la zona y fecha del dispositivo. Rechaza vacío/fecha no válida
con un mensaje seguro y no envía el despacho. Asset `20260909-directtime1`.
No cambia el contrato SQL, no reescribe fechas históricas ni afecta cantidades.

Regresión `e2e/isolated/dispatch-time-check.mjs`: ejecuta la función original en
procesos con TZ independiente (NY verano/invierno, Los Ángeles, Kolkata, UTC)
y entradas inválidas. Se exige además el payload real conectado al helper.
El recorrido autenticado DS-09 sigue exigiendo el instante correcto en SQL;
una prueba unitaria no reemplaza esa comprobación.

## Límites

Chromium y WebKit móvil emulado, no Safari/iPhone real ni PWA standalone.
No escrituras QA en producción/Preview, no envío de mensajes, no migraciones
productivas. BrowserStack no se reintenta manualmente. La cadena no certifica
facturación/cobros Direct Ship, pagos de proveedor ni cancelación de contenedor
con sus variantes financieras. No sustituye auditoría integral.
La matriz de diez casos debe aprobar; implementación no es certificación.
