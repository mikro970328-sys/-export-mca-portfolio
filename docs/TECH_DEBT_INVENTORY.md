# Inventario de deuda técnica — Export MCA ERP

Fecha de corte: 2026-07-30

## Propósito

Este documento registra las capas correctivas, dependencias implícitas y riesgos técnicos confirmados en el ERP actual. Esta fase es exclusivamente de auditoría. No modifica comportamiento, Supabase, APIs ni producción.

## Resumen ejecutivo

El backend y el modelo de datos son aprovechables. La principal deuda técnica se concentra en el frontend administrativo, que ha crecido mediante scripts cargados dinámicamente que modifican el DOM, sustituyen funciones globales, clonan botones existentes y observan continuamente el documento para reaplicar cambios.

La aplicación funciona, pero varios módulos dependen del orden exacto de carga. Un cambio visual pequeño puede activar efectos secundarios porque no existe un único controlador de estado, renderizado y navegación.

Clasificación actual de deuda técnica: **alta, pero recuperable sin reescribir todo el sistema**.

## Indicadores confirmados

- `admin/erp.js` carga dinámicamente 18 módulos administrativos después de restaurar la sesión.
- `admin/erp-core.js` carga adicionalmente `shipment-editor.js`.
- `admin/pwa.html` envuelve `admin/index.html` en un `iframe` y añade comportamiento sobre la aplicación interior.
- Se confirmaron al menos 12 instancias de `MutationObserver` en los módulos inspeccionados.
- Se confirmaron varias sustituciones o decoradores de funciones globales, especialmente `loadAll`, `showSection`, `renderStats`, `renderDashboardDetails` y `editClient`.
- Se confirmaron dos flujos que clonan y reemplazan botones originales: guardar cliente y guardar contenedor.
- Varios decoradores de tracking vuelven a consultar `/api/shipments` después de cada renderizado de la tabla.
- El proyecto no tiene actualmente scripts de lint, pruebas unitarias, pruebas de integración ni pruebas end-to-end en `package.json`; solo existe `vercel dev`.

## Mapa de capas del frontend

### 1. Entrada y sesión

| Archivo | Responsabilidad actual | Riesgo |
|---|---|---|
| `admin/index.html` | Shell principal, estilos, HTML, estado global y funciones base. | Crítico por tamaño y mezcla de responsabilidades. |
| `admin/erp.js` | Restaura sesión, elimina controles legacy y carga módulos en secuencia. | Crítico: el orden de carga es parte del contrato implícito. |
| `admin/pwa.html` | Carga `index.html` dentro de un iframe, registra service worker e inyecta integraciones. | Alto: crea una segunda capa de DOM y ciclo de vida. |
| `domain-router.html` | Redirige el dominio administrativo a `/admin/pwa.html`. | Bajo funcionalmente; debe revisarse durante la consolidación PWA. |

### 2. Funciones globales decoradas o sustituidas

| Función | Archivos implicados | Riesgo |
|---|---|---|
| `loadAll` | `admin/erp-core.js`, `admin/dashboard-operational-state.js`, `admin/mobile-interaction-core.js` | Crítico: varios wrappers encadenados y sensibles al orden de carga. |
| `showSection` | `admin/section-state.js` | Alto: navegación y persistencia quedan acopladas mediante sustitución global. |
| `renderStats` | `admin/dashboard-operational-state.js` | Alto: reemplaza el cálculo y renderizado original del dashboard. |
| `renderDashboardDetails` | `admin/dashboard-operational-state.js` | Alto: reemplaza el renderizado original. |
| `editClient` | `admin/client-extra-fields.js` | Alto: sustituye la edición original y depende de globals. |
| `deleteShipment` | `admin/erp-core.js` | Medio: función global añadida después de cargar la tabla. |

### 3. Observadores del DOM confirmados

| Archivo | Qué observa o modifica | Prioridad de consolidación |
|---|---|---|
| `admin/client-extra-fields.js` | Inserta campos y reemplaza el botón Guardar cliente. | Crítica |
| `admin/client-actions-menu.js` | Oculta botones y crea menú de acciones. | Alta |
| `admin/erp-core.js` | Reinstala el botón Eliminar en filas de shipments. | Alta |
| `admin/workers-responsive.js` | Envuelve tablas después de cada render. | Media |
| `admin/workers-actions-menu.js` | Oculta acciones y crea menú contextual. | Media |
| `admin/separate-container-tracking.js` | Mueve tarjetas, crea sección y navegación. | Alta |
| `admin/responsive-columns-control.js` | Detecta y reorganiza el selector de columnas. | Alta |
| `admin/module-export-controls.js` | Elimina control global e inserta exportaciones por módulo. | Media |
| `admin/tracking-fallback.js` | Reemplaza Guardar contenedor y decora controles de tracking. | Crítica |
| `admin/manual-tracking-switch.js` | Añade o elimina acciones según el modo de tracking. | Crítica |
| `admin/shipment-actions-menu.js` | Oculta botones y construye un menú según texto de la fila. | Alta |
| `admin/shipment-row-details.js` | Vuelve a consultar APIs y enlaza clics a filas. | Alta |

## Hallazgos por módulo

### Clientes

Archivos principales:

- `admin/index.html`
- `admin/client-extra-fields.js`
- `admin/client-actions-menu.js`
- `api/clients.js`

Problemas confirmados:

- Los campos `mipyme_name` e `importer_name` no pertenecen al formulario original; se insertan después de cargar.
- El botón original `saveClient` se clona y reemplaza para cambiar el flujo de guardado.
- La función global `editClient` se sustituye.
- El menú de acciones depende de la posición de columnas y botones en la tabla.
- Un `MutationObserver` recorre el documento para mantener el parche instalado.

Objetivo de consolidación:

- Integrar todos los campos directamente en el HTML y en la función original de guardado.
- Definir el renderizado completo de clientes en una sola función.
- Crear las acciones correctas durante el render, sin ocultar botones ni observar el DOM.
- Eliminar `client-extra-fields.js` y reducir o integrar `client-actions-menu.js`.

### Contenedores y tracking

Archivos principales:

- `admin/index.html`
- `admin/erp-core.js`
- `admin/separate-container-tracking.js`
- `admin/tracking-fallback.js`
- `admin/manual-tracking-switch.js`
- `admin/shipment-actions-menu.js`
- `admin/shipment-row-details.js`
- `admin/shipment-editor.js`

Problemas confirmados:

- El botón Guardar contenedor se clona y reemplaza.
- El mismo listado es decorado por varios módulos independientes.
- Distintos módulos consultan nuevamente `/api/shipments` para reconstruir datos que ya fueron cargados por `loadAll`.
- Las acciones se deduplican usando el texto visible del botón y el texto completo de la fila.
- El modo manual elimina acciones legacy del DOM y agrega controles nuevos.
- Los detalles de fila consultan `/api/shipments` y `/api/clients` nuevamente en cada ciclo de decoración.
- La separación entre Registrar contenedor y Tracking se hace moviendo nodos existentes después de cargar la página.

Riesgo principal:

Una sola actualización de la tabla puede activar varios observadores, varias consultas y varias modificaciones concurrentes sobre la misma celda de acciones.

Objetivo de consolidación:

- Una única fuente de datos para shipments.
- Un único `renderShipments` que cree columnas, detalles y acciones completas.
- Un controlador explícito para modo automático/manual.
- Cero consultas adicionales provocadas por decoradores del DOM.
- Eliminar observadores y generación de acciones basada en texto visible.

### Dashboard

Archivos principales:

- `admin/index.html`
- `admin/dashboard-operational-state.js`
- `admin/mobile-interaction-core.js`
- `admin/operational-alert-center.js`
- `admin/alert-phase2-stability.js`

Problemas confirmados:

- `loadAll` es envuelto por más de un módulo.
- `renderStats` y `renderDashboardDetails` son reemplazadas.
- Se elimina dinámicamente la tarjeta de distribución operativa.
- Existen comprobaciones temporizadas para esperar que las funciones estén disponibles.
- El cliente ejecuta comprobaciones de alertas además de los cron jobs de Vercel.

Objetivo de consolidación:

- Un único flujo `loadDashboard -> calculate -> render`.
- Un único scheduler de alertas en cliente, o eliminación del scheduler si los cron y la carga normal son suficientes.
- Integrar la estructura final del dashboard en el HTML original.

### Navegación y PWA

Problemas confirmados:

- `pwa.html` carga la aplicación dentro de un iframe.
- `pwa.html` y `erp.js` pueden intentar cargar `tracking-fallback.js`; el guard interno evita doble ejecución, pero sigue existiendo duplicidad de responsabilidades.
- `separate-container-tracking.js` crea navegación después de cargar.
- `section-state.js` sustituye `showSection`.
- `mobile-interaction-core.js` intercepta clics en fase de captura y detiene propagación inmediata.

Objetivo de consolidación:

- Una sola página administrativa responsive y PWA.
- Secciones y navegación declaradas en HTML, no creadas después de cargar.
- Persistencia de sección integrada en el router interno.
- Mantener instalación móvil y service worker sin iframe.

### Trabajadores

Problemas confirmados:

- La lógica principal es razonablemente autocontenida.
- La responsividad y el menú de acciones se aplican mediante dos observadores globales.
- El botón móvil recibe estilos desde JavaScript aunque corresponde a CSS base.

Objetivo de consolidación:

- Integrar wrappers y menú de acciones durante `renderWorkers`.
- Mover estilos permanentes a una hoja CSS o bloque central.
- Eliminar ambos observadores.

## Consultas duplicadas y carga innecesaria

Se confirmaron consultas adicionales independientes de `loadAll` en:

- `tracking-fallback.js` → `/api/shipments`
- `manual-tracking-switch.js` → `/api/shipments`
- `shipment-row-details.js` → `/api/shipments` y `/api/clients`
- módulos de alertas → `/api/notifications` y comprobaciones operativas

Estas consultas pueden ejecutarse otra vez después de un render porque los observadores detectan los cambios del DOM. La limpieza debe pasar los objetos ya cargados directamente a los componentes de renderizado.

## Riesgos operativos

1. **Condiciones de carrera:** dos scripts pueden modificar el mismo botón o la misma fila en distinto orden.
2. **Dependencia del texto:** varias acciones se reconocen por palabras como “Editar”, “Liberar”, “Manual” o “Eliminar”.
3. **Dependencia de posición:** algunos módulos asumen que una columna específica es la cuarta o la última.
4. **Ciclos de render:** un cambio de DOM activa observadores que vuelven a modificar el DOM.
5. **Carga duplicada:** la misma información se solicita varias veces.
6. **Difícil rollback conceptual:** un archivo puede parecer independiente, pero en realidad compensa una limitación de otro.
7. **Ausencia de pruebas automáticas:** los errores se detectan principalmente en producción o mediante inspección manual.
8. **Despliegue directo:** los commits a `main` activan producción automáticamente.

## Reglas obligatorias durante la limpieza

- No trabajar directamente en `main`.
- No mezclar refactor con funciones comerciales nuevas.
- No modificar Supabase durante la consolidación del frontend salvo que una fase lo requiera explícitamente.
- No eliminar un parche hasta integrar primero su comportamiento necesario en la fuente principal.
- Cada fase debe tener una Preview de Vercel y una lista de pruebas aprobada.
- Cada PR debe afectar un solo módulo o responsabilidad.
- No identificar acciones mediante el texto visible; utilizar claves de acción estables.
- No añadir nuevos `MutationObserver` para resolver problemas estructurales.
- No envolver nuevamente `loadAll`, `showSection` o funciones de renderizado globales.

## Estado del inventario

Este es el inventario inicial del frontend administrativo confirmado mediante inspección de los archivos cargados por `admin/erp.js`. La siguiente ampliación debe cubrir:

- todos los endpoints y sus dependencias de tablas;
- service worker y estrategia de caché;
- archivos públicos, portal y marketplace;
- scripts de migración y PR abierta de Arquitectura 1.0;
- variables de entorno y cron jobs;
- funciones o archivos no cargados actualmente.
