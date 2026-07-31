# Expedientes de exportación — línea base

## Alcance

Esta auditoría documenta el estado actual del módulo Expedientes antes de cualquier refactor. La rama `audit/operations-baseline` parte de la producción estable y no modifica comportamiento funcional.

## Entrada de interfaz

La navegación principal declara `newOperationsSection` como la sección de Expedientes de exportación. El contenido de esa sección no está definido en un módulo dedicado: se inyecta desde `admin/erp-core.js` durante el montaje del DOM.

## Funciones actuales del frontend

`admin/erp-core.js` contiene actualmente:

- construcción completa del formulario de alta;
- listado de expedientes;
- consulta de detalle;
- renderizado financiero y de mercancías;
- creación mediante `POST /api/operations`;
- recarga por evento `export-mca:clients-changed`;
- montaje sobre `newOperationsSection`.

El mismo archivo también contiene responsabilidades ajenas a Expedientes:

- instalación de eliminación de contenedores;
- observación dinámica de la tabla de contenedores;
- carga dinámica de `shipment-editor.js`.

## Contrato actual de la API

`api/operations.js` soporta:

- `GET /api/operations`: listado;
- `GET /api/operations?id=<uuid>`: detalle;
- `POST /api/operations`: creación;
- `PATCH /api/operations`: actualización parcial;
- `DELETE /api/operations?id=<uuid>`: eliminación física.

El detalle puede incluir:

- cliente;
- proveedor;
- importador;
- shipment;
- artículos;
- facturas;
- pagos;
- gastos;
- documentos.

## Efectos secundarios de creación

Cuando se crea un expediente con contenedor, el backend puede ejecutar esta secuencia:

1. insertar en `operations`;
2. insertar en `operation_items`;
3. localizar o crear un registro en `shipments`;
4. actualizar `operations.shipment_id`;
5. registrar historial del contenedor;
6. registrar auditoría;
7. enviar WhatsApp de registro;
8. registrar el resultado de la notificación.

No existe una transacción de base de datos que abarque toda la secuencia. Un fallo intermedio puede dejar datos parcialmente creados.

## Riesgos confirmados

### R1 — Propiedad mezclada

`erp-core.js` posee Expedientes y partes de Contenedores. Esto aumenta el riesgo de regresiones cruzadas.

### R2 — Dependencias globales

El módulo depende de símbolos globales como `api`, `note`, `openModal`, `fillClientSelects`, `loadAll`, `shipments` y `loadNotifications`.

### R3 — HTML interpolado sin escape explícito

Valores de base de datos se insertan con plantillas HTML. Debe verificarse protección contra contenido malicioso o accidental.

### R4 — Creación no atómica

La API realiza múltiples escrituras sin rollback global.

### R5 — Eliminación física disponible

La API permite `DELETE` directo sobre operaciones. Antes de exponer esta acción en interfaz debe definirse política de retención, dependencias y auditoría.

### R6 — Edición incompleta en frontend

La API soporta `PATCH`, pero el frontend actual solo crea, lista y abre detalle.

### R7 — Modelo financiero de solo lectura

El detalle calcula utilidad y pendiente usando agregados devueltos por la operación, pero la interfaz no administra facturas, pagos ni gastos desde Expedientes.

## Regla de refactor

La primera modificación funcional deberá ser una extracción mecánica hacia `admin/operations-module.js`, conservando exactamente:

- IDs del DOM;
- payloads;
- endpoints;
- textos visibles;
- eventos públicos;
- orden de carga;
- comportamiento en escritorio y PWA.

No se agregarán nuevas funciones durante esa extracción.
