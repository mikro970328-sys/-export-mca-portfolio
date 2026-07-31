# Plan de limpieza técnica — Export MCA ERP

Fecha inicial: 2026-07-30

## Objetivo

Transformar el ERP actual en una aplicación mantenible y predecible sin perder funciones existentes, sin reescribir todo desde cero y sin interrumpir la operación comercial.

La estrategia será de consolidación progresiva: primero se integra el comportamiento útil de cada parche dentro del módulo principal y después se elimina la capa correctiva correspondiente.

## Principio de ejecución

Cada fase seguirá este ciclo:

1. Auditar dependencias del módulo.
2. Definir comportamiento actual que debe conservarse.
3. Preparar pruebas de regresión.
4. Refactorizar en una rama independiente.
5. Desplegar Preview en Vercel.
6. Probar escritorio, móvil y PWA.
7. Revisar diferencias de API y datos.
8. Integrar a `main` únicamente después de aprobación.
9. Actualizar documentación.

## Prohibiciones temporales

Durante la limpieza:

- no se agregarán módulos comerciales nuevos;
- no se cambiará la semántica de columnas existentes;
- no se ejecutará la PR de Arquitectura 1.0 en producción;
- no se mezclarán cambios de Supabase con refactors visuales;
- no se harán commits funcionales directos a `main`;
- no se resolverá un problema estructural agregando otro parche dinámico.

## Fase 0 — Baseline y control de cambios

### Trabajo

- Crear inventario de archivos, globals, observers, timers y llamadas API.
- Definir matriz de pruebas manuales obligatorias.
- Añadir comprobaciones estáticas para detectar nuevos `MutationObserver`, reemplazos de funciones globales y clonación de botones.
- Definir una rama y PR por módulo.
- Usar Preview Deployment antes de producción.

### Resultado esperado

Un punto de partida verificable. Ningún comportamiento funcional cambia.

### Estado

En progreso.

## Fase 1 — Consolidación del módulo Clientes

### Motivo para comenzar aquí

Clientes es un módulo pequeño, crítico y ya demostró tener dependencias ocultas. Permite validar el método de limpieza antes de intervenir tracking o alertas.

### Cambios propuestos

- Integrar `mipyme_name` e `importer_name` directamente en `admin/index.html`.
- Integrar el payload completo en el guardado original.
- Integrar la edición completa en la implementación principal.
- Crear las acciones correctas directamente desde `renderClients`.
- Conservar todas las columnas de Supabase y contratos de `/api/clients`.
- Eliminar la necesidad de clonar `saveClient`.
- Eliminar el `MutationObserver` de clientes.
- Retirar `client-extra-fields.js` cuando su comportamiento esté integrado.
- Integrar o simplificar `client-actions-menu.js` sin depender de posiciones de columna.

### Pruebas obligatorias

- Inicio de sesión y restauración de sesión.
- Carga del listado.
- Crear cliente.
- Editar cada campo.
- Detección de duplicados.
- Bienvenida pendiente, enviada y fallida.
- Reenvío de bienvenida.
- Historial de cliente.
- Selector de cliente en contenedores.
- Selector de cliente en expedientes.
- Exportación CSV.
- Vista de escritorio.
- Vista móvil y PWA.

### Criterio de salida

- Cero `MutationObserver` dedicados a clientes.
- Cero reemplazos de botones.
- Una sola implementación de crear, editar y renderizar clientes.

## Fase 2 — Consolidación de navegación y secciones

### Cambios propuestos

- Declarar `Registrar contenedor` y `Tracking` como secciones reales en el HTML.
- Eliminar movimiento dinámico de tarjetas de `separate-container-tracking.js`.
- Integrar persistencia de sección dentro de una única función de navegación.
- Eliminar el wrapper de `showSection`.
- Integrar comportamiento móvil sin `stopImmediatePropagation` global cuando sea posible.
- Mantener permisos de master admin.

### Criterio de salida

- Navegación declarativa.
- Una sola función `showSection`.
- Ninguna sección creada o movida después de cargar.

## Fase 3 — Consolidación de Contenedores y Tracking

### Cambios propuestos

- Crear un único controlador de datos de shipments.
- Mantener una sola colección en memoria alimentada por `/api/shipments`.
- Integrar el fallback de ShipsGo dentro del flujo principal de registro.
- Integrar modo manual/automático dentro del render original.
- Generar botones con claves estables como `data-action`, no interpretando texto.
- Integrar detalles de fila utilizando el objeto ya cargado.
- Integrar menú de acciones durante el render.
- Integrar eliminación dentro del módulo principal.
- Eliminar consultas repetidas provocadas por decoradores.
- Retirar gradualmente:
  - `tracking-fallback.js`
  - `manual-tracking-switch.js`
  - `shipment-actions-menu.js`
  - `shipment-row-details.js`
  - observer de eliminación en `erp-core.js`

### Pruebas obligatorias

- Registrar contenedor con ShipsGo correcto.
- Registrar contenedor con error de ShipsGo.
- Pasar a manual.
- Confirmar cada evento manual.
- Volver a automático.
- Reconectar ShipsGo.
- Editar contenedor.
- Ver historial.
- Liberar.
- Entregar.
- Reactivar.
- Eliminar en ERP y ShipsGo.
- Buscar, filtrar y personalizar columnas.
- Probar WhatsApp y notificaciones asociadas.

### Criterio de salida

- Un solo render de shipments.
- Una sola consulta principal por actualización.
- Cero observers dedicados a decorar filas o acciones.

## Fase 4 — Dashboard y Centro de alertas

### Cambios propuestos

- Definir una única función para cargar datos del dashboard.
- Definir una única función para calcular estados operativos.
- Integrar la estructura final del dashboard en el HTML.
- Eliminar wrappers múltiples sobre `loadAll`.
- Unificar refresco de alertas.
- Revisar si el chequeo del navegador es necesario además de los cron jobs.
- Mantener deduplicación, snooze, resolución, severidad y contador sin cambios funcionales.

### Pruebas obligatorias

- KPIs y totales.
- Actividad reciente.
- Alertas activas, críticas, pospuestas y resueltas.
- Campana y contador.
- Centro de alertas.
- Regreso desde background en móvil.
- Ejecución de cron y refresco manual.

### Criterio de salida

- Una sola versión de `loadAll`.
- Una sola versión de `renderStats`.
- Un solo scheduler de alertas en cliente, si continúa siendo necesario.

## Fase 5 — Trabajadores

### Cambios propuestos

- Crear wrappers responsive directamente al renderizar tablas.
- Crear menú de acciones directamente durante `renderWorkers`.
- Mover CSS permanente fuera de inyecciones dinámicas.
- Eliminar `workers-responsive.js` y `workers-actions-menu.js` después de integrar su comportamiento.

### Criterio de salida

- Cero observers en el módulo Trabajadores.
- Render y acciones autocontenidos.

## Fase 6 — Expedientes y Operaciones

### Cambios propuestos

- Separar formulario, listado y detalle en responsabilidades claras.
- Evitar que `erp-core.js` envuelva `loadAll`.
- Integrar el selector de clientes mediante actualización explícita.
- Separar la lógica de shipments de la lógica de operations.
- Revisar transacciones de backend para creación de operación, shipment, items y notificaciones.

### Criterio de salida

- Operaciones no modifica funciones globales del núcleo.
- Flujo de creación consistente y recuperable ante errores parciales.

## Fase 7 — PWA y entrada única

### Cambios propuestos

- Eliminar el iframe como envoltura de la aplicación administrativa.
- Llevar manifest, service worker y metadatos PWA a la entrada principal.
- Integrar Publicaciones comerciales como sección declarada.
- Eliminar carga duplicada de `tracking-fallback.js`.
- Servir el ERP desde `admin.exportmca.com` manteniendo instalación móvil.
- Revisar estrategia de caché y versionado de assets.

### Criterio de salida

- Una sola aplicación y un solo DOM.
- URL limpia.
- PWA instalable en iPhone y Android.
- Sin pérdida de sincronización al recuperar foco.

## Fase 8 — Calidad y automatización

### Trabajo

- Incorporar ESLint o comprobaciones equivalentes.
- Incorporar pruebas unitarias para normalización, estados y payloads.
- Incorporar pruebas de API.
- Incorporar pruebas end-to-end para los flujos críticos.
- Añadir validación en GitHub Actions.
- Bloquear merge cuando fallen pruebas.

### Flujos end-to-end mínimos

1. Login y restauración de sesión.
2. Crear y editar cliente.
3. Registrar contenedor.
4. Fallback manual de ShipsGo.
5. Actualizar tracking.
6. Liberar y entregar.
7. Crear expediente.
8. Gestionar alerta.
9. Crear y desactivar trabajador.

## Fase 9 — Backend, seguridad y consistencia de datos

Esta fase comenzará después de estabilizar el frontend.

### Áreas

- Transacciones para operaciones de múltiples tablas.
- Manejo de errores y rollback.
- Auditoría obligatoria y observable.
- Autenticación, revocación de sesión y almacenamiento del token.
- Revisión de autorización de cron y webhooks.
- Cabeceras de seguridad y CSP.
- Revisión de RLS y uso de service role.
- Variables de entorno.
- Rate limiting.

## Orden de ejecución aprobado

1. Baseline e inventario.
2. Clientes.
3. Navegación.
4. Contenedores y tracking.
5. Dashboard y alertas.
6. Trabajadores.
7. Expedientes.
8. PWA.
9. Pruebas y calidad.
10. Backend y seguridad.

## Política de despliegue

- Las ramas de auditoría no se despliegan a producción.
- Cada refactor funcional debe producir una Preview de Vercel.
- `main` seguirá conectado a producción.
- No se fusionará una fase con pruebas pendientes.
- El rollback será el revert de una única PR de alcance limitado.

## Definición de software limpio para este proyecto

El ERP se considerará técnicamente limpio cuando:

- cada módulo tenga una fuente principal de verdad;
- no existan parches que clonen botones o reorganicen el DOM después de cargar;
- los renderizados no dependan del texto visible;
- no existan observers globales innecesarios;
- los datos se carguen una sola vez por ciclo;
- las funciones críticas no se sobrescriban desde varios archivos;
- escritorio, móvil y PWA compartan la misma implementación;
- existan pruebas automáticas para los flujos críticos;
- cada cambio quede documentado y sea reversible.
