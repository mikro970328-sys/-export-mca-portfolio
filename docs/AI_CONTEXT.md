# AI Context — Export MCA ERP

Última actualización: 2026-09-10 UTC.

## Punto de entrada vigente

Continuar desde **PR #296**, rama `test/direct-ship-browser-acceptance`.
El código `e5ad0c846ac3dbd8c5077bfed2692a34da34ba50` aprobó 13/13 workflows y
los seis jobs de Browser Operator Acceptance `34427427673`: Direct Ship,
operators y commercial, cada historia en Chromium y WebKit móvil aislados.
La matriz Direct Ship contiene diez checkpoints por motor y reproduce la
misma compra/venta/contenedor. Corrige la conversión de la hora de despacho
en el owner existente, asset `20260909-directtime1`; sin SQL productivo.

Leer `CURRENT_STATE.md` y `DIRECT_SHIP_BROWSER_ACCEPTANCE.md`, después verificar
PR/merge/deployment en GitHub y Vercel antes de afirmar publicación. Las notas
de publicación de la PR tienen precedencia sobre un estado de rama archivado.

La PR #295 ya se publicó: commit `f97c8744ce2e4c4d7ca9d5139cb1fdd65fe314b8`,
producción `dpl_GZpRvCoHJ676YwcGXQ1VCEZ6Nhri` READY. Sus selecciones de Compras,
detalle móvil de Cargues y aceptación compra-a-cobro están entregados; no
repetirlos como trabajo pendiente. Se conservan los bloques previos de
compras/inventario #281, ventas/logística #283, finanzas #285, operadores #287
y navegador/permisos #289/#290. Runtime de sincronización `20260909-live7`.

**Orden solicitado:** cierre funcional y pruebas, luego mejoras de interfaz,
finalmente auditoría integral. Seguridad/regresión de cada entrega no esperan
hasta la auditoría final. No empezar de cero ni reabrir fases sin evidencia.

## Lecturas y fuentes de verdad

Leer al menos: este archivo, `CURRENT_STATE.md`, `TECH_DEBT_INVENTORY.md`,
`CLEANUP_PLAN.md`, `CHANGELOG.md` y la documentación del módulo afectado.
Los diagnósticos de julio/agosto en esos archivos son históricos: contrastar
con código/CI actuales, no asumir que los archivos legacy sigan activos.
El estado anterior completo se conserva en `history/CURRENT_STATE_20260909.md`.

- Empresa Export MCA LLC; repo `mikro970328-sys/-export-mca-portfolio`.
- Producción `main`; Vercel Serverless Functions y Supabase PostgreSQL.
- Frontend HTML/CSS/JavaScript; autenticación administrativa personalizada.
- Dominios `admin.exportmca.com` y `app.exportmca.com`.
- Clientes: `clients` y `/api/clients`; contenedores: `shipments` y `/api/shipments`.
- Historial: `shipment_history` y `audit_log`; usuarios: `admin_users`.
- Integraciones ShipsGo y Twilio WhatsApp; no depender de ellas para QA comercial.
- `admin/pwa.html` es entrada al shell, no un segundo ERP dentro de un iframe.

## Método de trabajo obligatorio

1. Identificar módulo, owner, dependencias y comportamiento que debe conservarse.
2. Definir regresión antes del cambio; reproducir el fallo y separar defectos
   reales de carencias del entorno QA.
3. Trabajar en rama desde main vigente; preservar trabajo simultáneo. No cambios
   funcionales directos en main ni force-push para ocultar conflictos.
4. Corregir la fuente canónica. No mezclar refactor con funciones nuevas ni
   cambios visuales con migraciones de datos.
5. Ejecutar gates del head exacto, comprobar Preview READY y resultados de
   escritorio/móvil/PWA con sus límites expresos.
6. Actualizar estado, changelog y matriz; fusionar con autorización del
   propietario y expected head. La autorización de pruebas, correcciones e
   integración ya fue concedida en la sesión que origina este corte.
7. Verificar merge/deployment/assets/APIs y registrar las limitaciones; una
   Preview READY no demuestra funcionamiento autenticado ni publicación.

## Seguridad operacional

- No QA comercial en producción o Preview: comparten base. Usar exclusivamente
  PostgreSQL/PostgREST desechables; los inicializadores rechazan bases remotas.
- No enviar WhatsApp/correos/push de prueba a clientes reales.
- No almacenar tokens, cookies ni contraseñas en artefactos/capturas/logs.
- No exponer Supabase directamente al navegador ni cambiar auth/roles sin
  revisión del owner y pruebas de permisos por identidad.
- No renombrar columnas sin migración auditada ni reinterpretar campos con
  simples etiquetas. Un Direct Ship no crea WR ni inventario propio.
- No añadir MutationObserver ni envolver de nuevo loadAll/showSection/render.
- No identificar acciones de producción por texto visible; usar contratos
  canónicos y atributos estables. No borrar aparente duplicación sin rastreo.
- No quitar capas legacy hasta integrar su conducta necesaria y probarla.
- No desplegar manualmente cuando GitHub ya está generando el deployment.
- No ejecutar la antigua PR abierta de Arquitectura 1.0 en producción durante
  la limpieza. No modificar gates ni controles de cuota para forzar aprobación.
- BrowserStack agotó tiempo de Automate; no reintentos manuales. WebKit emulado
  no equivale a Safari/iPhone real, PWA instalada ni push certificado.

## Siguiente acción

Comprobar publicación de #296 y continuar variantes financieras de cancelación,
anticipos/proveedores y recorridos de Tracking/documentos/tareas/notificaciones.
La matriz de Direct Ship de compra a despacho está aprobada, no todas sus
variantes financieras. El fallo intermitente de menú inicial WebKit observado
en `34426597258` sigue documentado: un run posterior verde no prueba su eliminación.
Mantenerlo en revisión de arranque/permisos, sin saltarse la matriz existente.
