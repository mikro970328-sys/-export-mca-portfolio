# AI Context — Export MCA ERP

Última actualización: 2026-09-09

## Punto de entrada vigente

Operadores/concurrencia validados en PR #287, base `95e352e0d466ca8392adef89e8e4897d19cf2da3`: 22/22 escenarios PostgreSQL/PostgREST reales y siete workflows aprobados para el head `490e6bfc18b85a2b55e4016c28fea96346bf3cbd`. Consultar `docs/OPERATOR_CONCURRENCY_ACCEPTANCE.md` y el corte vigente para el head final y publicación. No confundir HTTP/SQL con aceptación visual, ni usar Preview para escrituras comerciales: comparte producción.

Finanzas publicada mediante PR #285, commit funcional `e33cb87bf278b3886dd0acc42a9f3250c78f5285`, producción `dpl_GP9Jw7tBYUh44h8dK5S4xyscWQeR` READY. Los 40 escenarios (25 SQL, 11 API, cuatro refresco) y 58/58 workflows de PR aprobaron. Matriz y límites en `docs/FINANCE_ACCEPTANCE.md`.

Consultar primero el corte de septiembre en `docs/CURRENT_STATE.md`. Producción incluye la sincronización de las PR #278/#279 y la ampliación a Reportes de la PR #285 (runtime vigente `20260909-live6`), compras/inventario #281, ventas/logística #283 y finanzas #285. Las tres matrices de aceptación no se deben repetir como si faltaran ni confundir con aceptación real de navegador, concurrencia o móvil. El siguiente bloque son pruebas transversales con backend aislado, dos operadores e iPhone/PWA.

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
