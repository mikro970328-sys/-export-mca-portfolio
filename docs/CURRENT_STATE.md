# Current State — Export MCA ERP

Última actualización del corte vigente: 2026-09-09

## Corte QA — compras, recepción e inventario

- Base `4081f2d1120816f4179a75697af1ac14b75e8e14`, rama `test/purchase-inventory-acceptance`.
- 27 escenarios aislados aprobados: 19 SQL y 8 de API. Matriz, método, defectos reproducidos y límites en `docs/PURCHASE_INVENTORY_ACCEPTANCE.md`.
- Corrección preparada en `api/purchases.js`: exceso solo con booleano `true`; moneda inválida, almacén omitido y línea inexistente devuelven 400 seguro. Sin cambios de Supabase ni escrituras comerciales productivas.
- Se añade CI que ejecuta operaciones reales en PGlite y se actualiza la fixture UX5 a la revisión protegida vigente. Publicación pendiente de la validación de esta rama.
- Esto cierra estos escenarios de datos, no la aceptación del ERP completo: faltan navegador con backend aislado, dos usuarios, concurrencia real y móvil/PWA, además de los bloques siguientes de ventas/logística y finanzas.

## Corte vigente — cierre funcional y sincronización

- Base de esta entrega: `main` en `5822d2352fb03c485c3676fba84825f2cd65864c`, PR #278 de sincronización multiusuario.
- Corrección publicada mediante [PR #279](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/279), commit funcional `ab53b7440afd6fb6d0017db57c0969d5c33cbfc9`.
- Vercel producción `dpl_2kdPSDZ9FoiStHTWvnsY4hyJFoth`: `READY` para ese commit. HTTP 200 verificado en la entrada administrativa, el acceso PWA y el runtime `20260909-live5` de `admin.exportmca.com`.
- Migración `20260909143701_live_sync_recovery.sql`: aplicada y verificada en Supabase. Es compatible con el frontend anterior; no elimina registros ni cambia contratos de negocio.
- Se mantienen Vercel, las APIs autenticadas y la autenticación administrativa personalizada; no se añade acceso directo del navegador a Supabase.

### Corrección de esta entrega

- Las consultas de sincronización tienen un límite de 12 segundos, incluido el cuerpo JSON. Los fallos se reintentan con espera progresiva hasta 60 segundos, sin superponer consultas.
- Al cerrar o cambiar sesión se cancelan las consultas pendientes y se descartan respuestas de la sesión anterior, incluidos errores 401 tardíos.
- Sin conexión se pausa la consulta; al volver la conexión o restaurar la página se retoma automáticamente, conservando las versiones de la misma sesión.
- Se conserva el refresco selectivo y la espera mientras hay un editor modal abierto. No se fuerza una recarga completa de página.
- La QA autenticada de la primera Preview detectó paneles `role="dialog"` dentro de overlays ocultos que bloqueaban todo refresco. El controlador existente ahora comprueba geometría y visibilidad CSS, y la regresión reproduce ese DOM antes de verificar la corrección.
- Los triggers emiten versiones únicamente cuando las filas realmente cambian. Sentencias vacías, escrituras idénticas e inserciones deduplicadas permanecen silenciosas.
- Se excluye del refresco visual el cursor interno `web_push_runtime_state`, cuyo timestamp cambia en cada conciliación aunque no haya novedades.
- Cobertura productiva: 66 tablas, 198 triggers por evento y los mismos 17 ámbitos. Se preservan los triggers de negocio y auditoría.
- Asset administrativo versionado como `20260909-live5`; las comprobaciones de carga se actualizan conjuntamente.

### Evidencia de validación

- 95/95 scripts `scripts/check-*.mjs` aprobados localmente; incluidos contratos estáticos, APIs y pruebas SQL aisladas.
- 46/46 workflows aprobados para el último commit de la PR, `b4d976c2e00ea79974b6927ff8cbab2f3c11d07c`; Preview `dpl_9wTU2R7vGqHefqVZQFM2hcCakpkG` READY.
- QA real en Chrome, dos pestañas autenticadas de la misma cuenta: señal controlada de actualización de tareas, refresco de B de 09:37 a 09:39 mientras A conserva el editor; al cerrar el formulario vacío, A aplica lo pendiente y muestra 09:40. No se crearon tareas ni se modificaron compras, ventas o saldos.
- Tras asentarse el cambio, los logs de Preview registraron solo el sondeo de versiones durante el intervalo observado, sin cargas de datos en bucle. Las señales de prueba incrementaron exclusivamente `erp_change_state.tasks` (0 → 1 en el ensayo que detectó el defecto; 1 → 2 en la verificación corregida).
- Consulta pospublicación de logs HTTP 5xx: sin resultados en el intervalo observado. Se observaron avisos Node `DEP0169` con respuestas HTTP 200 en Preview; no se presentan como fallos funcionales ni como auditoría de dependencias completada.
- Dos sesiones simuladas del runtime real reciben un mismo cambio sin recarga manual. Se probaron además modales, timeout de fetch y JSON, 503, payload inválido, offline/online, segundo plano, logout y respuestas tardías.
- PostgreSQL aislado: inserción/edición/eliminación múltiples, JSON/null, claves compuestas, UPSERT, deduplicación, rollback, reejecución de la migración y privilegios.
- La prueba B10 ejecuta el reconciliador real de web push y confirma que una segunda conciliación sin cambios no incrementa la versión de notificaciones.
- En Supabase se ejecutaron ambos reconciliadores con el mismo instante en transacciones revertidas, antes de publicar el frontend. La repetición pasó de 15 señales falsas en la base anterior a 0 con la corrección, tanto en el ensayo como tras aplicar la migración.
- `anon` y `authenticated` no pueden leer el estado; `service_role` conserva solo lectura y no puede invocar directamente la función privada ni escribir versiones.

### Límites de esta evidencia

- Hay cobertura simulada de sesiones independientes y QA de dos pestañas reales de una cuenta; no se certifican dos operadores diferentes en producción, una operación comercial completa ni Safari/iPhone/PWA real.
- El acceso de Vercel se resolvió con su enlace temporal oficial y el login del ERP mediante el formulario seguro autorizado. La evidencia final está registrada en la PR #279.
- La certificación externa iOS/BrowserStack de `main` sigue fallando por cuota (`Automate testing time expired`), run `34378335000`; su contrato estático pasó. No se ha eludido ni modificado ese control. Los otros seis workflows de `main` aprobaron.
- Los avisos preexistentes de Supabase (índices duplicados, protección de contraseñas filtradas y observaciones informativas) se revisan separadamente; esta corrección no equivale a la auditoría integral.

### Qué falta para declarar el ERP funcionalmente cerrado

Son criterios de aceptación pendientes de evidencia, no una afirmación de que falten esos módulos:

1. Recorrer compra → recepción/almacén o envío directo → inventario/carga → venta → factura/cobro, incluyendo cancelaciones y errores.
2. Conciliar saldos de clientes/proveedores, anticipos, costes, existencias y totales de reportes con los documentos de cada recorrido.
3. Verificar tracking, expedientes/documentos, tareas, alertas y entregas de notificaciones con casos controlados.
4. Probar permisos por rol, dos usuarios simultáneos y recuperación de sesión/conexión en escritorio y móvil/PWA reales.
5. Resolver los defectos encontrados y dejar una matriz de aceptación con evidencia. Después: mejoras priorizadas y auditoría integral de seguridad, datos, rendimiento y operación.

No iniciar una migración arquitectónica ni crear operaciones comerciales reales como sustituto de un entorno/caso QA controlado.

## Archivo histórico — corte del 2026-07-30

Lo que sigue conserva el contexto de aquella fecha; no describe el estado actual de producción.

Última actualización histórica: 2026-07-30 23:22 ET

## Objetivo actual

Limpiar progresivamente la deuda técnica del ERP sin perder funciones existentes y sin interrumpir producción.

## Producción

- Rama productiva: `main`
- Último commit fusionado en `main`: `5afd5ba14d4eed6ba0186814a566253d206a78d9`
- La consolidación funcional descrita aquí existe solamente en una rama y una Preview.
- No se ha modificado Supabase ni ningún contrato de API.
- La PR de Arquitectura 1.0 continúa separada y no debe ejecutarse en producción durante esta limpieza.

## Documentación disponible en `main`

- `docs/AI_CONTEXT.md`
- `docs/CURRENT_STATE.md`
- `docs/TECH_DEBT_INVENTORY.md`
- `docs/CLEANUP_PLAN.md`
- `docs/CHANGELOG.md`
- `docs/MODULE_CLIENTS_BASELINE.md`
- `docs/CLIENTS_TEST_MATRIX.md`

Cualquier IA, desarrollador o chat nuevo debe leer estos documentos antes de proponer o ejecutar cambios.

## Fase actual

**Fase 1 — Consolidación funcional de Clientes: punto de control previo a QA manual**

### Rama activa

`refactor/clients-consolidation`

### Pull request

- PR: `#15 — Consolidar módulo Clientes sin parches dinámicos`
- Estado: borrador, abierta, no fusionada
- Base: `main`
- Producción: no afectada

## Estado funcional alcanzado en la rama

### Módulo de Clientes consolidado

`admin/clients-module.js` es la implementación única en la rama para:

- estructura final del formulario;
- seis campos actuales;
- creación de clientes;
- edición de clientes;
- listado;
- etiquetas de bienvenida;
- menú de acciones de escritorio y móvil;
- acciones Editar, Bienvenida, Historial y Eliminar.

### Parches legacy inactivos

Los archivos siguientes permanecen guardados para rollback, pero no se cargan:

- `admin/client-extra-fields.js`
- `admin/client-actions-menu.js`

El módulo nuevo no utiliza:

- `MutationObserver`;
- `cloneNode`;
- `replaceWith`;
- `window.clients`;
- peticiones GET adicionales de Clientes durante la edición.

### Selectores unificados

`admin/erp-core.js` ya no construye su propia lista para `erpClient`.

Ahora:

- utiliza `fillClientSelects()` como fuente compartida para `shipmentClient` y `erpClient`;
- eliminó la función local `fillClients`;
- dejó de envolver `window.loadAll`;
- escucha el evento explícito `export-mca:clients-changed` para recargar el listado de Expedientes después de crear o editar un cliente.

`admin/clients-module.js` emite ese evento después de una creación o edición exitosa.

### Datos reutilizados en detalles de tracking

`admin/shipment-row-details.js` ya no solicita nuevamente:

- `/api/clients`
- `/api/shipments`

Ahora utiliza las colecciones `clients` y `shipments` ya cargadas por `loadAll()`.

El `MutationObserver` de filas de tracking permanece temporalmente porque su retirada pertenece a la fase específica de Contenedores y Tracking.

### Comportamiento conservado

- Se mantienen los nombres técnicos `company`, `mipyme_name` e `importer_name`.
- Se mantienen los contratos de `/api/clients`.
- Se mantienen bienvenida, historial y eliminación actuales.
- Se mantiene el listado con Nombre, Empresa, WhatsApp, Bienvenida y Acciones.
- La creación informa correctamente que la bienvenida queda pendiente cuando el POST no la envía.
- Los botones de guardar se deshabilitan mientras la petición está en curso.
- Los selectores muestran la misma convención de nombre y empresa.

## Archivos funcionales modificados o creados

- `admin/clients-module.js`
- `admin/erp.js`
- `admin/erp-core.js`
- `admin/shipment-row-details.js`
- `scripts/check-clients-consolidation.mjs`
- `.github/workflows/clients-consolidation-check.yml`

## Commits funcionales relevantes

- `9cab5ea90621172817df9a5f4cf2cd4496ba47ad` — módulo explícito inicial
- `f8f59a8358624c1866d8f1e49f81d9582000c788` — loader usa el módulo consolidado
- `74c0f8d0b960ef948e6cd14f712bf2593781e42a` — corrección del guardado de edición
- `8e6b088dd5e427549325db75af16e13cd0520c52` — validación estática
- `d36f385545413bee30897a1f531e0475d17d8cb4` — workflow de GitHub Actions
- `99b4220883defa642a3609e7dd6275eb41f4d236` — menú de acciones integrado
- `a77418d6e6f55e25077141d19ee687fe54d3642c` — desactivación del menú legacy
- `20537df4d038a3b0185df4a2a2c7079e62541f22` — validación exige ambos parches inactivos
- `3492b0d6798335cd0cc79ac68b64e1d1708b78f9` — selector compartido en Expedientes
- `f8c8cbf49e381a7e511e2ebfacc2a809466f74c7` — evento explícito después de cambios de cliente
- `71ef50f3d18d59b2fd45fb2ff79903bdc61f2884` — validación de selectores y ausencia de wrapper
- `68065417c37d02e7d23b5987f8f1d39d18d0c489` — workflow ampliado para `erp-core.js`
- `02b1b6d9e73d45818ea8cb40821d6130972fb43f` — reutilización de datos en detalles de tracking
- `2e78a5e080676d69eb455c4ba480dfbfe8d00491` — validación de consultas duplicadas
- `3c1ae4c3a73e075a5a82bfb3a1f86fcd295aad38` — workflow ampliado para detalles de tracking

## Validaciones ejecutadas

### GitHub Actions

Último código validado:

- Workflow: `Clients Consolidation Check`
- Run: `30601356712`
- Job: `validate-clients`
- Commit: `3c1ae4c3a73e075a5a82bfb3a1f86fcd295aad38`
- Resultado: **success**

La validación comprueba:

- sintaxis de Clientes, loader, Expedientes y detalles de tracking;
- presencia de los seis campos;
- menú integrado y acciones estables;
- ausencia de `MutationObserver`, clonación y reemplazo de botones en el módulo nuevo de Clientes;
- ausencia de carga de ambos parches legacy;
- conservación de los archivos legacy para rollback;
- uso de `fillClientSelects()` en Expedientes;
- ausencia de la construcción local de `erpClient`;
- ausencia del wrapper de `window.loadAll` en `erp-core.js`;
- reutilización de `clients` y `shipments` en los detalles del tracking;
- ausencia de consultas duplicadas de Clientes y Shipments en ese detalle.

### Vercel Preview

Último despliegue del código validado:

- Deployment: `dpl_2AeGj7UdhDCNVsFz8ohetFJG5Lsa`
- Commit: `3c1ae4c3a73e075a5a82bfb3a1f86fcd295aad38`
- Estado: **READY**
- Target: Preview, no producción

La Preview está protegida mediante SSO. La herramienta de lectura recibió redirección 302 y no permitió una inspección visual autenticada. Por tanto:

- el build está confirmado;
- la estructura está validada automáticamente;
- la interfaz todavía necesita revisión manual autenticada;
- no se afirma que las pruebas visuales o de escritura estén aprobadas.

## Riesgos y bloqueadores actuales

1. No se ha confirmado que la Preview use una Supabase separada.
2. No se han ejecutado pruebas de creación o edición contra un registro QA autorizado.
3. No se han ejecutado pruebas visuales autenticadas en escritorio, móvil o PWA.
4. La eliminación física de clientes continúa siendo peligrosa y no se probará con datos reales.
5. El `MutationObserver` de `shipment-row-details.js` permanece para la futura fase de Tracking.
6. Otros wrappers y observers ajenos al módulo Clientes permanecen fuera del alcance de esta PR.

## Próxima acción exacta

Ejecutar la matriz manual no destructiva en la Preview autenticada.

Orden recomendado:

1. Abrir la Preview desde Vercel con una sesión autorizada.
2. Comprobar login y restauración de sesión.
3. Verificar que el formulario muestre exactamente seis campos, sin duplicados.
4. Verificar listado y menú en escritorio.
5. Verificar listado y menú en iPhone/PWA.
6. Confirmar que `shipmentClient` y `erpClient` muestran los mismos clientes y etiquetas.
7. Abrir detalles de un contenedor existente y confirmar que no falten datos del cliente.
8. Solo con autorización expresa, crear un registro QA único y ejecutar creación y edición.
9. No probar eliminación física.
10. Registrar cada resultado en `docs/CLIENTS_TEST_MATRIX.md` y actualizar este archivo.

## Condiciones antes de fusionar la PR #15

- pruebas manuales autenticadas en Preview;
- formulario sin duplicados;
- creación y edición con los seis campos usando un registro QA autorizado;
- menús correctos en escritorio y móvil;
- selectores de Contenedores y Expedientes sincronizados;
- bienvenida e historial sin regresiones;
- CSV sin cambios inesperados;
- ninguna prueba destructiva sobre clientes reales;
- aprobación explícita del usuario.

## Regla para cerrar una sesión de trabajo

Antes de terminar cualquier sesión o chat se debe actualizar este archivo con:

- rama activa;
- último commit relevante;
- archivos modificados;
- pruebas ejecutadas y resultados;
- Preview de Vercel, cuando exista;
- riesgos o bloqueadores;
- siguiente acción exacta;
- confirmación de si el cambio llegó o no a producción.

## Estado de producción al cierre

La PR funcional #15 permanece en borrador. Todos los cambios funcionales están aislados en `refactor/clients-consolidation`. Producción conserva el comportamiento anterior.
