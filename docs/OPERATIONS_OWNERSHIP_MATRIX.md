# Expedientes — matriz de propiedad

## Objetivo

Definir un único propietario por responsabilidad antes de separar código. Ningún comportamiento debe quedar implementado simultáneamente en dos módulos.

| Responsabilidad | Propietario actual | Propietario objetivo | Dependencias permitidas |
|---|---|---|---|
| Montar `newOperationsSection` | `admin/erp-core.js` | `admin/operations-module.js` | DOM, cliente HTTP compartido |
| Renderizar formulario de expediente | `admin/erp-core.js` | `admin/operations-module.js` | catálogo de clientes |
| Crear expediente | `admin/erp-core.js` + `api/operations.js` | `admin/operations-module.js` + `api/operations.js` | autenticación, auditoría |
| Listar expedientes | `admin/erp-core.js` | `admin/operations-module.js` | `GET /api/operations` |
| Abrir detalle | `admin/erp-core.js` | `admin/operations-module.js` | modal compartido o adaptador explícito |
| Formatear totales del expediente | `admin/erp-core.js` | `admin/operations-module.js` | utilidad monetaria compartida opcional |
| Reaccionar a cambios de clientes | `admin/erp-core.js` | `admin/operations-module.js` | evento `export-mca:clients-changed` |
| Crear/enlazar shipment desde operación | `api/operations.js` | `api/operations.js` o servicio backend dedicado | Supabase, historial, auditoría |
| Eliminar shipment desde la tabla | `admin/erp-core.js` | módulo de Contenedores | `/api/shipments` |
| Observar tabla de shipments | `admin/erp-core.js` | retirar o trasladar temporalmente al módulo de Contenedores | DOM de Contenedores |
| Cargar `shipment-editor.js` | `admin/erp-core.js` | bootstrap explícito del módulo de Contenedores | carga estática preferida |
| Administrar artículos | creación básica en ambos extremos | Expedientes + endpoint dedicado o contrato de operaciones | `operation_items` |
| Administrar facturas | solo lectura en API detalle | módulo financiero futuro | `invoices` |
| Administrar pagos | solo lectura en API detalle | módulo financiero futuro | `payments` |
| Administrar gastos | solo lectura en API detalle | módulo financiero futuro | `expenses` |
| Administrar documentos | solo lectura en API detalle | módulo documental futuro | `documents` |

## Límites obligatorios

### `admin/operations-module.js`

Debe poseer exclusivamente la experiencia frontend de Expedientes:

- formulario;
- validación de interfaz;
- alta;
- listado;
- detalle;
- edición futura;
- coordinación explícita con clientes.

No debe:

- modificar la tabla de Contenedores;
- crear botones para shipments;
- cargar scripts de tracking;
- depender de la variable global `shipments`.

### Módulo de Contenedores

Debe poseer:

- alta y edición de shipments;
- búsqueda y filtros;
- acciones de tracking;
- eliminación controlada;
- detalles de shipment.

No debe renderizar ni administrar Expedientes.

### `api/operations.js`

Debe poseer el contrato HTTP de operaciones. La lógica de efectos secundarios complejos podrá extraerse posteriormente a servicios internos, pero sin duplicar rutas ni reglas.

## Dependencias transitorias aceptadas

Durante la primera extracción se permiten adaptadores a las funciones globales actuales (`api`, `note`, `openModal`, `fillClientSelects`) para conservar comportamiento. Cada dependencia debe quedar declarada al inicio del módulo y eliminarse en una fase posterior, no durante la extracción mecánica.

## Criterio de finalización de propiedad

La separación se considera completa cuando:

1. `erp-core.js` no contiene cadenas, selectores ni handlers de Expedientes;
2. `operations-module.js` no contiene lógica de shipments fuera del vínculo propio del expediente;
3. solo existe un listener para cada acción de Expedientes;
4. no se inyectan scripts dinámicamente desde Expedientes;
5. la matriz de pruebas de regresión pasa sin cambios visuales ni funcionales.
