# AI Context — Export MCA ERP

Última actualización: 2026-09-09

## Punto de entrada vigente

PR #295 en validación desde `5e2620b`: cadena comercial de navegador aislado y corrección de selecciones borradas por una respuesta tardía de catálogos de Compras. Consultar primero su bloque en `CURRENT_STATE.md` y `COMMERCIAL_BROWSER_ACCEPTANCE.md`. No confundir estado de rama con publicación; las matrices anteriores aprobadas siguen vigentes.

Publicado mediante [PR #289](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/289), commit `55c6ae255b7abcd26068b941f0bc7c43c9f7d1d4`. Producción `dpl_4pshzRmzZGJmzntku1i5K8mz4KYG` READY. Run final de PR `34402541189`, head `cb133dda4e8c2e165e4fd9f48ecd5c5b9e7927b5`: 20/20 escenarios (diez por motor), 52/52 workflows; 55 check runs aprobados y uno omitido por condición. Preview `dpl_enFr3jigPxHr9aK9hLRHyo1qb2Be` READY y entrada PWA al login verificada. Corrige permisos obsoletos en módulos embebidos y diálogos móviles cubiertos por el encabezado; runtime live7 y CSS viewport1. Se conservaron #290/#291/#292. Main: ocho de nueve workflows aprobados, incluidos Browser Operator Acceptance `34402916794` y Operator and Concurrency Acceptance `34402917038`. BrowserStack `34402916772` aprobó su contrato de solo lectura; ambos jobs de iPhone fallaron por `Automate testing time expired`, sin reintentos manuales. Matriz: `docs/BROWSER_OPERATOR_ACCEPTANCE.md`. No repetir estos escenarios como si faltaran ni presentar WebKit emulado como iPhone real. El siguiente bloque amplía otros recorridos transversales de navegador; después mejoras y auditoría integral.

Operadores/concurrencia publicados mediante PR #287, commit `81648443ce66eda2ce4ed2e331146ad631ae751e`, producción `dpl_6bf5Vba4JxrwFsDxrSCxgqfnptUb` READY: 22/22 escenarios PostgreSQL/PostgREST reales. La aceptación visual aislada se publicó mediante PR #290, commit `dfe47514aeaafa6aa32d34ca960332464749c07a`: run `34401166506`, dos operadores/contextos Chromium, ruta PWA con viewport iPhone, cobros UI y saldos 400 → 280 → 200 sin recarga, con diferimiento mientras el diálogo permanece abierto. Consultar `docs/OPERATOR_CONCURRENCY_ACCEPTANCE.md`. No usar Preview para escrituras comerciales: comparte producción. No declarar Safari, instalación standalone ni hardware iPhone certificados. El siguiente bloque amplía los recorridos transversales de navegador todavía pendientes; después mejoras y auditoría integral. No repetir las matrices ya aprobadas como si faltaran.

Finanzas publicada mediante PR #285, commit funcional `e33cb87bf278b3886dd0acc42a9f3250c78f5285`, producción `dpl_GP9Jw7tBYUh44h8dK5S4xyscWQeR` READY. Los 40 escenarios (25 SQL, 11 API, cuatro refresco) y 58/58 workflows de PR aprobaron. Matriz y límites en `docs/FINANCE_ACCEPTANCE.md`.

Consultar primero el corte de septiembre en `docs/CURRENT_STATE.md`. Producción incluye la sincronización de las PR #278/#279 y la ampliación a Reportes de la PR #285 (runtime vigente `20260909-live7`), compras/inventario #281, ventas/logística #283 y finanzas #285. La PR #290 añade solo la aceptación visual aislada a CI. Las matrices y el caso multioperador/PWA emulado no se deben repetir como si faltaran; sí faltan otros recorridos transversales y el dispositivo iPhone/Safari real.

Orden solicitado por el propietario: cerrar la validación funcional, después mejoras y finalmente auditoría integral. Las verificaciones de seguridad y regresión de cada cambio no se posponen hasta esa auditoría.

Migración financiera `20260909185121_finance_cash_reconciliation.sql` aplicada y verificada: vista/funciones/permisos coinciden con lo probado; cero diferencias de caja con los libros existentes. PWA, shell y live6 responden 200; Facturas, Pagos Proveedores y Reportes responden 401 sin sesión. En main aprobaron ocho de nueve workflows únicos; BrowserStack iOS quedó bloqueado por cuota agotada en sus ejecuciones automáticas. No modificar controles ni lanzar reintentos manuales de cuota; tampoco declarar móvil certificado. La autorización de pruebas, correcciones y publicación ya fue concedida por el propietario en esta sesión.

Las descripciones de deuda y estados de julio que siguen son una referencia histórica, no prueba de que esos archivos sigan activos. Conservar las reglas de trabajo, pero contrastar cada hallazgo con el código actual y no reabrir fases ya entregadas sin evidencia.

## Propósito de este archivo

Este documento es el punto de entrada obligatorio para cualquier IA, desarrollador o nuevo chat que vaya a trabajar en el ERP de Export MCA LLC.

Antes de proponer o ejecutar cambios se deben leer, como mínimo:

1. `docs/AI_CONTEXT.md`
2. `docs/CURRENT_STATE.md`
3. `docs/TECH_DEBT_INVENTORY.md`
4. `docs/CLEANUP_PLAN.md`
5. `docs/CHANGELOG.md`
6. La documentación específica del módulo afectado, cuando exista.

## Proyecto

- Empresa: Export MCA LLC
- Repositorio: `mikro970328-sys/-export-mca-portfolio`
- Rama de producción: `main`
- Hosting: Vercel
- Base de datos: Supabase PostgreSQL
- Frontend: HTML, CSS y JavaScript puro
- Backend: Vercel Serverless Functions
- Integraciones principales: ShipsGo y Twilio WhatsApp
- Dominio administrativo: `admin.exportmca.com`

## Estado arquitectónico actual

El backend y el esquema de datos son aprovechables. La principal deuda técnica está en el frontend administrativo.

El frontend creció mediante scripts cargados dinámicamente que:

- insertan o mueven elementos después de cargar;
- clonan y sustituyen botones originales;
- sobrescriben o envuelven funciones globales;
- observan continuamente el DOM mediante `MutationObserver`;
- repiten consultas a APIs después de cada renderizado;
- dependen del orden exacto de carga.

La aplicación funciona, pero un cambio pequeño puede producir regresiones en módulos relacionados.

## Regla principal de la limpieza

No se elimina un parche hasta haber integrado primero toda su funcionalidad necesaria en la fuente principal del módulo y haber aprobado las pruebas de regresión.

## Proceso obligatorio para cualquier cambio

1. Identificar el módulo y sus dependencias.
2. Documentar el comportamiento actual que debe conservarse.
3. Definir pruebas de regresión antes de escribir código.
4. Crear una rama específica desde la versión más reciente de `main`.
5. No realizar cambios funcionales directamente en `main`.
6. No mezclar refactor con funciones comerciales nuevas.
7. No mezclar cambios visuales con migraciones de Supabase.
8. Crear Preview Deployment en Vercel.
9. Probar escritorio, móvil y PWA.
10. Registrar resultados y riesgos en `docs/CURRENT_STATE.md`.
11. Actualizar `docs/CHANGELOG.md` y la documentación del módulo.
12. Fusionar solamente después de aprobación explícita.

## Reglas de seguridad operacional

- No renombrar columnas de Supabase sin una migración completa y auditada.
- No cambiar la semántica de campos existentes mediante una simple etiqueta visual.
- No añadir nuevos `MutationObserver` para resolver problemas estructurales.
- No envolver nuevamente `loadAll`, `showSection` ni funciones globales de renderizado.
- No identificar acciones mediante el texto visible de botones o filas.
- No borrar archivos porque parezcan duplicados sin rastrear primero quién los carga y qué comportamiento compensan.
- No desplegar manualmente si GitHub ya está generando el despliegue correspondiente, salvo que exista una razón documentada.
- No ejecutar la PR abierta de Arquitectura 1.0 en producción durante la limpieza del frontend.

## Fuentes de verdad actuales

- Clientes: tabla `clients` y endpoint `/api/clients`.
- Contenedores: tabla `shipments` y endpoint `/api/shipments`.
- Historial: `shipment_history`, `audit_log` y notificaciones relacionadas.
- Alertas y mensajes: tabla `notifications` y APIs correspondientes.
- Usuarios administrativos: `admin_users` y autenticación personalizada actual.

## Áreas de alto riesgo confirmadas

### Clientes

- `admin/client-extra-fields.js` inserta campos después de cargar.
- Clona y reemplaza `saveClient`.
- Sustituye `editClient`.
- `admin/client-actions-menu.js` modifica acciones después del renderizado.

### Contenedores y tracking

- Varios módulos modifican simultáneamente la tabla de shipments.
- Se repiten consultas a `/api/shipments` y `/api/clients`.
- El modo manual, ShipsGo, acciones y detalles de filas están distribuidos entre varios decoradores.

### Dashboard y alertas

- Varias capas envuelven `loadAll`.
- El dashboard reemplaza funciones globales de cálculo y renderizado.
- Existen cron jobs en Vercel y comprobaciones adicionales desde el navegador.

### Navegación y PWA

- `admin/pwa.html` carga `admin/index.html` dentro de un iframe.
- Otros scripts crean o mueven secciones después de cargar.
- La persistencia de navegación sustituye `showSection`.

## Orden aprobado de limpieza

1. Baseline y documentación.
2. Clientes.
3. Navegación y secciones.
4. Contenedores y tracking.
5. Dashboard y alertas.
6. Trabajadores.
7. Expedientes y operaciones.
8. Entrada PWA única.
9. Pruebas y automatización.
10. Backend y seguridad.

## Fase activa

La fase activa es **Fase 0 — Baseline y control de cambios**.

No se ha iniciado todavía el refactor funcional de Clientes.

## Instrucción de continuidad para otro chat

Un nuevo chat debe leer `docs/CURRENT_STATE.md` para conocer el último commit, rama, PR, pruebas, bloqueadores y siguiente acción exacta. No debe asumir que un cambio está en producción por aparecer en una rama o PR.
