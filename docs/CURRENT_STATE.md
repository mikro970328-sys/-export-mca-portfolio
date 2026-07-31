# Current State — Export MCA ERP

Última actualización: 2026-07-30 22:58 ET

## Objetivo actual

Limpiar progresivamente la deuda técnica del ERP sin perder funciones existentes y sin interrumpir producción.

## Producción

- Rama productiva: `main`
- Último commit documental fusionado: `6cbe2cdb02ccb25c42163f5f8c57501bd6304837`
- PR `#13 — Documentar baseline y matriz de pruebas de Clientes`: fusionada.
- No se ha modificado código operativo, APIs ni Supabase.
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

**Fase 1 — Preparación de la consolidación del módulo Clientes**

La Fase 0 documental de Clientes está completada y fusionada.

## Hallazgos confirmados del módulo Clientes

### Frontend

- `admin/index.html` contiene la implementación base del formulario, listado, creación, edición, bienvenida e historial.
- `admin/client-extra-fields.js` inserta `mipyme_name` e `importer_name` después de cargar.
- Ese archivo clona y reemplaza `saveClient`, sustituye `editClient` y mantiene el parche mediante `MutationObserver`.
- `admin/client-actions-menu.js` asume posiciones de columnas y botones, oculta acciones originales y crea un menú mediante otro `MutationObserver`.
- La colección `clients` es una variable léxica; `window.clients` no es una fuente confiable.
- El selector de Expedientes es actualizado por dos implementaciones diferentes: `fillClientSelects()` y el wrapper de `admin/erp-core.js`.

### Backend y Supabase

- `api/clients.js` soporta GET, POST, PATCH, reenvío de bienvenida y DELETE físico.
- La creación guarda `welcome_status = pending`; no envía automáticamente la bienvenida.
- No existe una restricción única de base de datos para teléfono o correo.
- La tabla `clients` tiene 13 columnas actuales.
- Reglas de eliminación:
  - `CASCADE`: `shipments`, `notifications`, `documents`
  - `SET NULL`: `shipment_history`
  - `RESTRICT`: `operations`, `invoices`, `payments`

No se ejecutarán pruebas destructivas sobre clientes reales.

## Verificación de Preview

Vercel crea despliegues Preview para ramas, pero las herramientas disponibles no exponen el alcance de las variables de entorno. No se ha confirmado que Preview use una Supabase separada.

Mientras esto no se confirme:

- se permiten pruebas estáticas y de lectura;
- se permiten registros QA explícitos sin relaciones críticas;
- no se permiten eliminaciones destructivas ni cambios sobre clientes reales;
- una Preview no se considera por sí sola un entorno aislado.

## Trabajo completado

- inventario general de deuda técnica;
- documentación de continuidad en `main`;
- mapa completo del módulo Clientes;
- diccionario de datos y relaciones;
- flujo de creación, edición, listado, bienvenida e historial;
- dependencias con Contenedores, Expedientes, Dashboard y CSV;
- matriz de pruebas;
- estrategia de rollback;
- PR documental #13 fusionada.

## Próxima acción exacta

Crear desde el commit `6cbe2cdb02ccb25c42163f5f8c57501bd6304837` la rama:

`refactor/clients-consolidation`

Antes del primer cambio funcional se deben registrar los SHA actuales de:

- `admin/index.html`
- `admin/erp.js`
- `admin/client-extra-fields.js`
- `admin/client-actions-menu.js`
- `admin/erp-core.js`
- `admin/shipment-row-details.js`

## Primer bloque funcional aprobado

El primer bloque debe integrar dentro de la implementación principal:

1. los seis campos del formulario;
2. un único flujo de creación;
3. una única implementación de edición;
4. acciones con claves estables;
5. una sola fuente para los selectores de clientes.

No debe cambiar:

- los nombres técnicos `company`, `mipyme_name` e `importer_name`;
- Supabase;
- contratos de `/api/clients`;
- bienvenida, historial o CSV;
- semántica comercial de los campos.

## Estrategia de commits funcionales

1. Integrar formulario y creación sin retirar parches.
2. Integrar edición y acciones estables.
3. Unificar selectores y eliminar consultas duplicadas.
4. Ejecutar pruebas estáticas y Preview.
5. Retirar `client-extra-fields.js` y `client-actions-menu.js` en un commit separado.
6. Actualizar documentación y resultados.

## Reglas obligatorias

- No trabajar directamente en `main`.
- No añadir nuevos `MutationObserver`.
- No borrar parches antes de integrar y probar su funcionalidad.
- No ejecutar eliminación de clientes reales.
- No fusionar código funcional a producción sin aprobación explícita.

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

La documentación de Clientes está fusionada en `main`. La consolidación funcional todavía no ha comenzado y el comportamiento productivo del ERP permanece sin cambios.
