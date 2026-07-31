# AI Context — Export MCA ERP

Última actualización: 2026-07-30

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