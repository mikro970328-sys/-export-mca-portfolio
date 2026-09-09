# Aceptación comercial en navegador

Fecha: 2026-09-09. Base: `5e2620bd6afe151807b3a17d6ebab394e5eee16b`.
Rama: `test/commercial-browser-acceptance`. PR #295. Estado: validación en curso;
no confundir la implementación de la prueba con un resultado aprobado.

## Historia y frontera

Dos operadores entran por `/admin/pwa.html`. A registra una compra de 100 cajas
por USD 250; recibe 40 y después 60; vende las mismas 100 por USD 400; prepara
un cargue con los dos WR, reserva, carga y despacha; factura y cobra la venta;
registra USD 50 de gasto directo y concilia los reportes. B consulta Existencias
en su sesión de solo lectura y debe recibir cada cambio sin recargar el shell
ni su iframe. Los números y las relaciones provienen de la misma cadena,
no de documentos independientes insertados para cada pantalla.

## Matriz definida antes de cambios funcionales

| Caso | Resultado exigido |
|---|---|
| COM-01 | Login real de ambas cuentas; PO 100 cajas/10 pallets, USD 250; stock cero |
| COM-02 | Emitir y confirmar esa misma PO desde sus acciones visibles |
| COM-03 | WR parcial 40/4; PO parcial y B muestra 40 físicos/disponibles sin recarga |
| COM-04 | Intentar recibir 80 adicionales requiere confirmación; cancelar deja un WR y stock 40 |
| COM-05 | WR final 60/6; PO recibida, dos lotes vinculados y B muestra stock 100 |
| COM-06 | Venta del producto recibido por USD 400, cliente/importadora seleccionados; confirmar no consume stock |
| COM-07 | Rechazar 41 sobre WR de 40; crear el cargue con 40+60 conservando ambos orígenes |
| COM-08 | Reservar, liberar y reservar; físico 100, disponible 0 → 100 → 0 |
| COM-09 | Cargar; despacho bloqueado sin contenedor; crear/vincular y despachar; B muestra stock cero |
| COM-10 | Crear y emitir factura de esa venta por USD 400 |
| COM-11 | Cobrar 150 y 250; exactamente dos cobros, total 400, saldo cero |
| COM-12 | Gasto directo 50; reportes de venta, AR, caja e inventario coinciden; COGS 250 y contribución 100 |

## Entorno y evidencia

- Suite `e2e/isolated/commercial.spec.mjs`, handlers originales servidos por
  `e2e/isolated/server.mjs`, PostgreSQL 17.6 y PostgREST 12.2.3 desechables.
- Una base vacía por combinación de historia y motor. Se conserva la matriz
  anterior de operadores como jobs separados; ninguna historia reutiliza una
  base ya inicializada por otra.
- Se reutilizan las 91 migraciones del bloque de operadores y se añade la
  migración real de capacidades de contenedores `20260831235500`, sin modificar.
  La fixture local completa campos legacy de Clientes, Proveedores y Productos,
  el acceso de servicio a `shipment_history` y tres secuencias de numeración.
  Tipos/defaults y privilegios se contrastaron en modo lectura con producción;
  no es un volcado íntegro de producción.
- Se insertan solo catálogos y cuentas QA aleatorias como preparación. Los roles
  se asignan mediante la API autenticada del master QA. Todas las mutaciones
  de compra, recepción, venta, cargue, contenedor, factura, cobro y coste se
  inician mediante clics y formularios del frontend real.
- Consultas SQL y reportes por HTTP verifican las relaciones e importes. Se
  guardan checkpoints, rutas/métodos/estados HTTP, conciliación y capturas.
  No se guardan cuerpos de login, tokens, contraseñas, cookies ni grabaciones
  de los pasos de autenticación.
- Los errores JavaScript, caídas, red externa, API 404 y 5xx hacen fallar la
  aceptación. El 409 de sobre-recepción es esperado y se verifica explícitamente.
  Los módulos sin permiso pueden devolver 403; no se sustituyen sus respuestas.

## Reproducción

El workflow `Browser Operator Acceptance` crea los servicios, instala las
dependencias fijadas y ejecuta una sola historia/motor por base vacía:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix e2e/isolated --ignore-scripts --no-audit --no-fund
npm test --prefix e2e/isolated -- commercial.spec.mjs --project=chromium-desktop
```

Requiere las variables `ERP_TEST_DATABASE_URL`, `ERP_TEST_POSTGREST_URL` y
`ERP_TEST_POSTGREST_SECRET` del entorno QA local, documentadas en el workflow.
El inicializador rechaza bases remotas, nombres no QA o bases no vacías.
Para WebKit se usa `--project=webkit-mobile` con otra base nueva. Los artefactos
del workflow se conservan 14 días.

## Límites y siguiente bloque

Primera ejecución `34404900511`, head `540dc78`: detectó columnas legacy omitidas
en la base QA y permisos de numeración ausentes, antes de crear la compra. Se
completó únicamente la fixture aislada, tras contrastarla con producción. El
helper de navegación móvil debe abrir el botón visible del encabezado, no
suponer que `mobileMenuBtn` es el control mostrado por el tema vigente.

Chromium completo y WebKit móvil emulado no equivalen a Safari en hardware
iPhone, PWA instalada ni push del dispositivo. BrowserStack permanece separado,
sin reintentos manuales ni cambios en sus controles de cuota.

Esta cadena de almacén no certifica todavía el ciclo Direct Ship de navegador,
anulación de WR con historia, facturas/pagos de proveedor, anticipos, todas las
variantes monetarias, seguimiento externo, subida/descarga documental o entrega
de mensajes. Los ensayos SQL/API anteriores de esos módulos siguen vigentes.
No se envían WhatsApp/correos, no se escriben operaciones QA en Supabase y no
se aplican migraciones productivas. La Preview comparte producción y solo se
usa para comprobar entrada/publicación.

Tras cerrar las variantes funcionales pendientes siguen las mejoras y la
auditoría integral solicitadas; esta matriz no sustituye esa auditoría.
