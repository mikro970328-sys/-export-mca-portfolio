# Aceptación de ventas, cargues, despacho y documentos

Fecha: 2026-09-09. Base: `eae1cf2439d841608e1234a11e8d5209935c6e13`.
Rama: `test/sales-logistics-acceptance`.

## Resultado del corte

39 escenarios aprobados localmente: 29 SQL y 10 de API. También aprobaron nueve
contratos relacionados. La publicación y la aplicación de la migración están
pendientes al preparar esta PR; se registrará la evidencia de entrega al finalizar.

Este bloque continúa la aceptación de compras/inventario de la PR #281. Valida
operaciones y respuestas con datos aislados; no declara terminado el ERP completo.

## Método

- PGlite 0.5.8 con pgcrypto, sin red, credenciales ni datos comerciales reales.
- 74 archivos de migración reales ejecutados completos y sin modificar: la base
  de compras y las dependencias de ventas, inventario, cargues, facturación,
  costes, anticipos y documentos. Se incluyen las tres migraciones históricas
  de agosto que residen en `migrations/`.
- Las fixtures `purchase_acceptance_legacy.sql` y
  `sales_logistics_acceptance_legacy.sql` aportan únicamente la forma mínima de
  las tablas legacy externas. No reemplazan las reglas de negocio probadas.
  Nunca deben aplicarse a Supabase.
- Antes de modificar código, 16 funciones del entorno aislado coincidieron con
  `pg_get_functiondef` de producción, ignorando espacios. Se inspeccionaron además
  los wrappers canónicos, los guards de ítems/asignaciones y la sincronización
  de mercancía. Esto no equivale a comparar todo el esquema productivo.
- Cada escenario se revierte. Los rechazos SQL comparan las filas de 20 tablas
  antes y después; al finalizar no quedan compras, ventas, cargues, documentos
  ni movimientos comerciales de las fixtures.
- Las API ejecutan los handlers y sus helpers reales de permisos y disponibilidad.
  El adaptador sustituye solo autenticación, transporte Supabase y entrega de
  auditoría. Los RPC ejecutan SQL real con savepoint por petición; las lecturas
  usan tablas, vistas y joins reales de esta base.

## Defectos reproducidos y corrección

| Hallazgo | Antes | Corrección y evidencia |
| --- | --- | --- |
| Editar un cargue independiente en borrador | El borrado en cascada quitaba el ítem antes de que el guard de su asignación pudiera consultar el estado; la API devolvía `LOAD_NOT_DRAFT`. | `replace_load_plan` elimina primero las asignaciones manteniendo visible su padre, después reconstruye las líneas. LD-10 y API-06 prueban 100 → 40 y rollback de una segunda línea inválida. |
| Mercancía del contenedor | Asignar un contenedor existente conservaba `Old description`, 7 unidades, aunque el cargue tenía 100 cajas. | Asignación y edición llaman al sincronizador existente dentro del mismo RPC; producto, cantidad y unidad quedan derivados del cargue. CT-03 y API-06/07. |
| Importe exacto por `/api/sales` | Descartaba `line_total`: 840 × 1.190476 guardaba 999.99984 en lugar de 1000. El editor actual `/api/sales-order-ux` ya conservaba el importe. | La ruta de compatibilidad conserva el total y valida valores finitos/no negativos. API-02/03 prueban ambas rutas, edición, precio unitario y rechazo de valores inválidos. |
| Sobreasignar una venta | El SQL rechazaba correctamente la operación, pero `SO_ALLOCATION_CONFLICTS_WITH_DIRECT_SUPPLY` se convertía en 500 genérico. | `/api/sales-loads` devuelve 400 con explicación del saldo y Direct Ship; mantiene el primer cargue y el saldo pendiente. API-08. |
| Edición de cargue vinculado a venta | La acción aparecía permitida pese a que las FK ya impedían reemplazar los ítems comerciales. | `load_action_state` expone esa protección existente; el RPC y la API explican `LOAD_HAS_SALES_ALLOCATIONS`. No se eliminan vínculos comerciales. LD-11 y API-10. |
| Contenedor de contexto incompatible | El guard existente impedía vincularlo, pero faltaba traducción en la API. | `/api/loads` devuelve 400 explicando el cliente/importadora. CT-03 y API-10 mantienen intactos los vínculos. |

Archivos funcionales: `api/sales.js`, `api/sales-loads.js`, `api/loads.js` y
`supabase/migrations/20260909175528_load_plan_container_consistency.sql`.

La migración reemplaza tres funciones existentes. Conserva las comprobaciones
de estado, cliente/importadora, integridad referencial y acceso exclusivo del
backend. No desactiva triggers, no crea tablas de negocio, no cambia saldos ni
reescribe datos históricos. La consulta productiva previa no encontró cargues
vinculados a contenedores; no hay reparación histórica aplicada en este corte.

## Matriz SQL

| Casos | Cantidad | Resultado comprobado |
| --- | ---: | --- |
| SO-01…05 | 5 | Total exacto; alta/edición atómica; cliente activo; confirmación; vincular cargue existente; cancelación protegida por anticipo y reversión. |
| LD-01…11 | 11 | Origen WR y contexto comercial; producto/almacén correctos; límites de venta; reserva/liberación/cancelación; competencia secuencial por stock; carga sin contenedor; despacho único; despacho parcial; fixture UX5; edición atómica; protección de vínculos de venta. |
| CT-01…03 | 3 | Normalización ISO; contexto comercial; bloqueo de entrega prematura y edición manual de mercancía; contenedor inactivo; asignación con mercancía derivada. |
| DS-01…04 | 4 | Despacho Direct Ship sin WR ni inventario propio; cumplimiento comercial; historial; repetición y modificación bloqueadas; sobreasignación cruzada con almacén; contenedor sin mercancía rechazado. |
| DOC-01…05 | 5 | Documentos oficiales vigentes; alias de factura; sustitución y versiones; borrado lógico; historial no reactivado; documentos genéricos/generados no satisfacen Cuba; expediente sin duplicados; reemplazo fallido conserva versión anterior. |
| DB-01 | 1 | Migración repetible y privilegios de las tres funciones: sin ejecución para `anon`/`authenticated`, ejecución para `service_role`. |

## Matriz API

| Caso | Resultado comprobado |
| --- | --- |
| API-01 | Peticiones sin sesión y escrituras de lector rechazadas antes de consultar SQL. |
| API-02 | Editor actual conserva importes exactos en alta, edición y consulta de precios. |
| API-03 | Ruta de compatibilidad conserva total o precio unitario y rechaza totales inválidos. |
| API-04 | Venta → cargue → reserva → carga → contenedor → despacho devuelve el estado actualizado; no duplica la salida. |
| API-05 | Permisos de lector ocultan mutaciones, conservan tracking y distinguen permiso de regla de negocio. |
| API-06 | Edición de cargue independiente devuelve y persiste la cantidad actual del contenedor. |
| API-07 | Asignar contenedor existente deriva mercancía y una edición inválida conserva los datos anteriores. |
| API-08 | Sobreasignación devuelve 400 y conserva el cargue y saldo existentes. |
| API-09 | Consulta documental valida ID, 404 y aislamiento entre contenedores. |
| API-10 | Cargue vinculado a venta expone su bloqueo estructural y explica conflictos de contexto. |

## Reproducción y CI

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/check-sales-logistics-acceptance.mjs
node scripts/check-sales-logistics-api.mjs
```

El workflow `Sales and Logistics Acceptance` ejecuta ambos scripts y los contratos
de acciones UX5 de ventas/cargues, owner explícito de ventas, cantidades/unidades,
Direct Ship, documentación Cuba, abastecimiento, anticipos y presentación de cargues.
No requiere secretos ni escribe en Supabase.

## Límites y siguiente bloque

- PGlite usa una sola conexión. Se comprueba competencia secuencial y rollback,
  no dos transacciones PostgreSQL independientes ni carreras concurrentes reales.
- No se certifican JWT, RLS completa del ERP, PostgREST, notificaciones automáticas,
  workflows operativos, envío de auditoría ni integraciones de tracking.
- Los documentos se prueban como metadatos. No hay subida/descarga de archivos
  reales, revisión del PDF ni certificación de su contenido aduanero.
- Las API usan transporte simulado; no equivalen a un recorrido autenticado
  completo en navegador, dos operadores ni la app instalada en iPhone/PWA.
  Las Previews actuales usan la base real: no se crean ventas/cargues QA allí.
- La generación/creación completa de Direct Ship por API no se certifica aquí:
  sí se ejecuta su despacho real en SQL y el bloqueo de permisos del handler.
- El siguiente bloque es facturación, cobros, pagos, anticipos, costes y
  conciliación de reportes. Después quedan las pruebas transversales de navegador,
  operadores y móvil; mejoras y auditoría integral siguen ese cierre funcional.
