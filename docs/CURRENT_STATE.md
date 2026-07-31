# Current State — Export MCA ERP

Última actualización: 2026-07-30 23:12 ET

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

**Fase 1 — Consolidación funcional del módulo Clientes**

### Rama activa

`refactor/clients-consolidation`

### Pull request

- PR: `#15 — Consolidar módulo Clientes sin parches de formulario`
- Estado: borrador, abierta, no fusionada
- Base: `main`
- Producción: no afectada

## Estado funcional alcanzado en la rama

### Nuevo módulo explícito

Se creó `admin/clients-module.js` como implementación única de:

- estructura final del formulario;
- seis campos actuales;
- creación de clientes;
- edición de clientes;
- listado;
- etiquetas de bienvenida;
- menú de acciones de escritorio y móvil;
- acciones Editar, Bienvenida, Historial y Eliminar.

### Parches legacy

Los archivos siguientes permanecen guardados en el repositorio para rollback, pero ya no se cargan en la rama:

- `admin/client-extra-fields.js`
- `admin/client-actions-menu.js`

El módulo nuevo no utiliza:

- `MutationObserver`;
- `cloneNode`;
- `replaceWith`;
- `window.clients`;
- peticiones GET adicionales de Clientes durante la edición.

### Comportamiento conservado

- Se mantienen los nombres técnicos `company`, `mipyme_name` e `importer_name`.
- Se mantienen los contratos de `/api/clients`.
- Se mantienen bienvenida, historial y eliminación actuales.
- Se mantiene el listado con Nombre, Empresa, WhatsApp, Bienvenida y Acciones.
- La creación informa correctamente que la bienvenida queda pendiente cuando el POST no la envía.
- Los botones de guardar se deshabilitan mientras la petición está en curso.

## Archivos funcionales modificados o creados

- `admin/clients-module.js` — nuevo módulo consolidado
- `admin/erp.js` — carga el módulo nuevo y deja inactivos ambos parches legacy
- `scripts/check-clients-consolidation.mjs` — validación estática
- `.github/workflows/clients-consolidation-check.yml` — ejecución automática en PR

## Commits funcionales relevantes

- `9cab5ea90621172817df9a5f4cf2cd4496ba47ad` — módulo explícito inicial
- `f8f59a8358624c1866d8f1e49f81d9582000c788` — loader usa el módulo consolidado
- `74c0f8d0b960ef948e6cd14f712bf2593781e42a` — corrección del guardado de edición
- `8e6b088dd5e427549325db75af16e13cd0520c52` — validación estática
- `d36f385545413bee30897a1f531e0475d17d8cb4` — workflow de GitHub Actions
- `99b4220883defa642a3609e7dd6275eb41f4d236` — menú de acciones integrado
- `a77418d6e6f55e25077141d19ee687fe54d3642c` — desactivación del menú legacy
- `20537df4d038a3b0185df4a2a2c7079e62541f22` — validación exige ambos parches inactivos

## Validaciones ejecutadas

### GitHub Actions

- Workflow: `Clients Consolidation Check`
- Run: `30600879695`
- Job: `validate-clients`
- Resultado: **success**

La validación comprueba:

- sintaxis JavaScript;
- presencia de los seis campos;
- presencia del menú integrado y acciones estables;
- ausencia de `MutationObserver`, clonación y reemplazo de botones;
- ausencia de carga de ambos parches legacy;
- conservación de los archivos legacy para rollback.

### Vercel Preview

- Deployment: `dpl_FgBtJBL1MeBP8FQvChC9KXbbQSFV`
- Commit: `20537df4d038a3b0185df4a2a2c7079e62541f22`
- Estado: **READY**
- Target: Preview, no producción

La Preview está protegida mediante SSO. La herramienta de lectura recibió redirección 302 y no permitió una inspección visual autenticada. Por tanto:

- el build está confirmado;
- la interfaz todavía necesita revisión manual autenticada;
- no se afirma que las pruebas visuales o de escritura estén aprobadas.

## Riesgos y bloqueadores actuales

1. No se ha confirmado que la Preview use una Supabase separada.
2. No se han ejecutado pruebas de creación o edición contra registros QA.
3. No se han ejecutado pruebas visuales autenticadas en escritorio, móvil o PWA.
4. `admin/erp-core.js` todavía mantiene una segunda implementación para llenar `erpClient` y envuelve `loadAll`.
5. `shipment-row-details.js` todavía vuelve a consultar `/api/clients`.
6. La eliminación física de clientes continúa siendo peligrosa y no se probará con datos reales.

## Próxima acción exacta

Unificar los selectores de clientes sin añadir otro parche:

1. Modificar `admin/erp-core.js` para utilizar la implementación compartida `fillClientSelects()`.
2. Eliminar su construcción local de opciones para `erpClient`.
3. Mantener el comportamiento de carga de Expedientes sin alterar APIs.
4. Añadir esta condición a la validación automática.
5. Ejecutar nuevamente GitHub Actions y Vercel Preview.

Después se revisará `shipment-row-details.js` para reutilizar los datos ya cargados, evitando su GET duplicado de `/api/clients`.

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
