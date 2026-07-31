# Current State — Export MCA ERP

Última actualización: 2026-07-30 23:22 ET

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
