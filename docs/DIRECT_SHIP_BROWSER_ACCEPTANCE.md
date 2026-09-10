# Aceptación Direct Ship en navegador — PR #296

Base: `f97c8744ce2e4c4d7ca9d5139cb1fdd65fe314b8` (PR #295 publicada).
Rama: `test/direct-ship-browser-acceptance`.
**Aceptación aprobada** en `e5ad0c846ac3dbd8c5077bfed2692a34da34ba50`.
Consultar PR #296 y su deployment para verificar publicación; no se infiere
producción de un archivo de rama.

## Frontera

Una compra de 100 cajas/10 pallets por USD 250, sin almacén; una venta de esas
100 cajas/10 pallets por USD 400; una PO vinculada; un contenedor creado,
desvinculado y reutilizado; despacho y protección de cantidades. Todas las
mutaciones comerciales parten de clics/formularios originales. Solo catálogos
y usuarios QA se preparan. PostgreSQL/PostgREST desechables por historia/motor.

## Matriz

| Caso | Resultado comprobado en ambos motores |
|---|---|
| DS-01 | PO Direct Ship con warehouse_id null |
| DS-02 | Emitir/confirmar la PO sin acción de recepción |
| DS-03 | Crear/confirmar venta USD 400, 100 cajas/10 pallets |
| DS-04 | Elegir PO confirmada, conservando cantidades/pallets |
| DS-05 | Crear/vincular un solo contenedor desde el formulario |
| DS-06 | Cancelar diálogo de desvinculación deja el vínculo intacto |
| DS-07 | Desvincular/reutilizar el mismo contenedor y sus pallets antes del despacho |
| DS-08 | Cancelar despacho y rechazar fecha vacía no registra salida |
| DS-09 | Venta dispatched; 10:15 NY del 09-09 = 14:15 UTC en SQL |
| DS-10 | Sin acciones de desvincular/despachar; reducir a 99 se rechaza y conserva 100 |

En CADA checkpoint: cero WR, Cargues, movimientos y existencias de almacén.
API 404/5xx, errores JavaScript, caídas o accesos externos fallan la suite.
Los 403 de módulos ajenos al rol son esperados, sin sustituir sus respuestas.
Capturas/JSON se guardan también ante fallo, sin credenciales ni pasos de login.

## Evidencia aprobada

Run `34427427673`: seis jobs aprobados (operators/commercial/direct-ship por
Chromium y WebKit móvil). Los 13 workflows del head `e5ad0c8` aprobaron.
Se preservan las matrices anteriores, sin cambiar expectativas ni saltar casos.

Artefacto WebKit inspeccionado `10133217599`, SHA256
`51438b4b9f83fd80e27e082afa200da7171e7d844c3e10d90b589a9648c5960e`:
diez checkpoints; venta 100/10; fulfillment dispatched; instante
`2026-09-09T14:15:00.000Z`; cero errores JavaScript/crashes/red externa y API
404/5xx. Las capturas muestran 10:15 local y el rechazo de reducción.

`dispatch-time-check.mjs` ejecuta la función original en cinco combinaciones
zona/fecha (NY verano/invierno, Los Ángeles, Kolkata, UTC), con quince
comprobaciones de entradas inválidas. Cada job también exige esa regresión.
Preview del head: `dpl_Co7TkPUwxtSuhcpSeqYjHt2gxogN` READY. Su acceso PWA
retornó 302 a SSO; no se presenta como prueba autenticada de Preview.

## Corrección funcional

El owner `admin/sales-supply-workspace.js` convierte datetime-local a ISO con
zona EN el navegador antes del POST. No suma cuatro horas fijas: utiliza la
zona/fecha del dispositivo. Rechaza vacío/fecha no válida antes de enviar y
presenta mensaje seguro. Asset `20260909-directtime1`. No modifica SQL,
cantidades, reglas de cumplimiento ni fechas históricas.

## Diagnóstico previo y ajustes de QA

- `34425521352`, head `d002932`: Direct Ship no ejecutó casos (`No tests found`).
  Se añade a testMatch, se conecta el handler original y se corrigen espera
  de la segunda respuesta y cierre del Pool (end, no close).
- `34426178171`, head `17b6942`: DS-01..04 aprobados; faltaba el grant INSERT de
  shipments en QA. Producción se contrastó en modo lectura y sí lo tiene.
  Solo se completa QA. Se preserva el primer error y se guarda JSON en archivo.
- `34426597258`, head `6ca729b`: DS-01..08 aprobados; 10:15 NY se guardó como
  10:15 UTC, reproduciendo el defecto real. La matriz comercial WebKit tuvo
  además un fallo de apertura inicial del menú, documentado sin desactivar casos.
- `34427160215`, head `21b1a11`: hora ya correcta; el test volvía a vincular
  cero pallets de venta y obtenía correctamente partial. Se corrige la entrada
  QA para conservar los diez pallets y se añaden aserciones de medidas, sin
  alterar el cálculo productivo. Se alinean dos gates con el asset actualizado.

## Límites y continuidad

WebKit emulado no es Safari/iPhone real ni PWA standalone. No escrituras QA en
producción/Preview (comparten base), mensajes ni migraciones productivas.
BrowserStack no se reintenta manualmente. Este corte no certifica facturas,
cobros ni todas las cancelaciones/proveedores dentro de la cadena Direct Ship.

El último run verde no demuestra que desapareció toda intermitencia del menú
inicial observada anteriormente. Mantener ese riesgo en revisión de arranque
y permisos. Las capturas también muestran margen de mejora en densidad de
formularios y posición del feedback móvil; no se mezcló un rediseño con esta
corrección funcional. Después siguen variantes financieras, Tracking/documentos,
tareas/notificaciones; luego mejoras y auditoría integral.
