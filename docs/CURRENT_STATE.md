## 2026-09-16 · Diagnósticos públicos de notificaciones (PR #326)

La reproducción aislada confirmó 21 exposiciones de errores almacenados/indirectos.
Corrección en los owners de API: Clientes, Contenedores, Historial y CSV; se
conservan registros internos, estados, permisos e identidad de los envíos.
28/28 escenarios nuevos, 97/97 errores públicos previos y 7/7 claims pasan en
el ensayo dirigido. CI completo/publicación: consultar PR #326, no inferirlos.
Leer security/STORED_NOTIFICATION_ERRORS.md. A-02 (confirmación de recepciones
manuales) y respaldo/restauración siguen pendientes; escritorio prioritario.

## Publicación y auditoría vigente — 2026-09-16

PR #324 publicada en 9f4aea87c412ac2dc467c0d934eee2f084307978. Jornada comercial de 18 pasos aprobada en
Chromium/WebKit, matriz 16/16, API financiera 26/26 y concurrencia/HTTP 27/27.
Pagos al proveedor ahora recuperan confirmaciones perdidas sin duplicar dinero.
Migración aplicada 20260916214707; producción dpl_9KawWZViHyByoBhEAXw5ScdR32NN READY.
Ver security/WORKDAY_TECHNICAL_AUDIT_20260916.md: quedan A-01 errores indirectos/
almacenados y A-02 frontera legacy de recepción manual, aún por reproducir.
No volver a presentar la jornada #324 como pendiente ni declarar cerrado todo.

## 2026-09-16 · Cierre diario y recuperación de pagos al proveedor

PR #323 publicada en `1296968075ed1adce7a81b483fd65bd266999c2b`; selección de
Reportes durante refresco ya corregida. El cierre diario detectó que perder la
confirmación de un pago de 40 producía seis registros. Se corrige identidad,
reintento y audit atómico en los owners existentes. API 26/26, concurrencia/HTTP
27/27 y COM-14 Chromium ya aprobados; COM-15/18 y CI final en la PR actual.
Leer SUPPLIER_PAYMENT_RECOVERY.md. No declarar aplicada la migración ni publicado
el cambio sin verificar la PR. Después sigue auditoría técnica consolidada.
No repetir como pendientes los módulos funcionales ya probados; escritorio
prioritario, iPhone/BrowserStack/push físico diferidos.

## 2026-09-16 · Selección de Reportes mientras actualiza

PR #322 publicada en 86bdec6215bf11cb3752616d5428a2120d33047b: cobros
idempotentes y auditoría atómica. La repetición posterior dejó DS-28 pendiente.
Ahora se reprodujo la causa: Reportes ignoraba un clic de dataset durante una
lectura automática en curso. La corrección mantiene la última selección y lee
de nuevo desde el owner existente. Ver REPORT_SELECTION_RECOVERY.md y la PR
para CI y publicación finales; la aceptación diaria consolidada sigue abierta.

## 2026-09-16 · Recuperación diaria de cobros

Base publicada PR #321, 0bb0def569c4f9e736d6297fbb273373ef626660: precisión y
anticipos de proveedor, 19 workflows y 16/16 recorridos de navegador. La aceptación
diaria reprodujo un cobro duplicado al perder su confirmación HTTP. Se corrige
en el RPC existente y ambos formularios, con auditoría atómica y rechazo de
reutilizaciones distintas. Ver INVOICE_PAYMENT_RECOVERY.md y resultados de la PR.
Sigue pendiente el cierre consolidado de toda la matriz diaria, no rehacer módulos.

## 2026-09-16 · Precisión y anticipos de proveedores

PR #320 publicada en b827176978ccb834acbdd97da9d916155cfe4da0: reversos de notas de
crédito, 36/36 checks y 16/16 recorridos de navegador. La continuación reproduce
y corrige saldos de proveedor inferiores al centavo y entradas no finitas, y
amplía Direct Ship con anticipos, facturas parciales, distribución y pagos
simultáneos. Ver SUPPLIER_FINANCE_VARIANTS.md; CI, migración y publicación finales
en la PR. Próximo cierre: aceptación diaria integrada y fallos de conexión/permisos.

## 2026-09-16 · Reversos de notas de crédito

PR #319 publicada en 3e5cf437af7a9664706104058d2a927a1014b487: uso del saldo a
favor, 50/50 workflows y 16/16 jobs de navegador. Continuación actual: reversos
de notas con motivo e historial, límites de financiación y unidades reutilizadas.
Ver INVOICE_CREDIT_REVERSALS.md y la PR para CI, migración y publicación finales.
La siguiente etapa mantiene las variantes financieras y aceptación diaria.

## 2026-09-16 · Aplicación y devolución del saldo a favor

PR #318 publicada en d86d1804472959aab3cb15657499e58213373685: notas de crédito
por cantidad, 22/22 workflows y 16/16 jobs de navegador. Continuación actual:
aplicar el saldo a otra factura del mismo cliente y moneda, registrar una
devolución realizada y revertir estos movimientos con historial. Ver
INVOICE_CREDIT_SETTLEMENT.md; la PR registra CI, migración y publicación finales.
No incluye todavía reversos de las notas de crédito por cantidad.

## 2026-09-16 · Notas de crédito por cantidad

PR #317 publicada en 85b6e2b47ed39f1188371e22b2097038a6de5f61: COGS Direct Ship
corregido, 15 escenarios SQL y 16/16 jobs de navegador. Continuación actual:
notas de crédito por cantidad para facturas emitidas. Ver INVOICE_QUANTITY_CREDITS.md
para alcance, pruebas y límites; CI, migración y publicación finales en la PR.

## 2026-09-16 · COGS y reportes Direct Ship

La vista de costo por línea de venta omitía Direct Ship. Corrección y pruebas
descritas en DIRECT_SHIP_FINANCIAL_REPORTS.md. Publicado en PR #317.
La persistencia de asignación manual de tareas ya está publicada en PR #316.

## 2026-09-16 · Persistencia de reasignación manual

Corrección del owner SQL de workflow: conserva equipo/usuario elegidos manualmente
al actualizar y reabrir tareas. Ruta automática intacta sin intervención. Migración
y aceptación descritas en docs/WORKFLOW_MANUAL_ASSIGNMENT.md; publicación pendiente.

## Correcciones detectadas por el recorrido de navegador

Se añade Mis tareas al owner de navegación y su permiso tasks.read al owner de
accesos. El diálogo de tareas se monta fuera de la sección animada para evitar
recorte y bloqueo del botón Cerrar. Son correcciones de runtime; CI/publicación
definitivos constan en PR #315. Sin DDL ni mensajes reales.

## 2026-09-16 — Recorrido de Tracking, tareas e inbox en navegador

Base PR #314 publicada: 0d362ad97e7ab4a48622e6b909134700c0cddfe4.
Rama test/tracking-workflow-browser añade dos sesiones reales y PostgreSQL aislado:
documentos → tarea, lectura personal, reapertura, reasignación y tracking desde UI.
La prueba verifica cambios sin navegación/recarga manual. Validación remota pendiente;
ver TRACKING_WORKFLOW_BROWSER.md y PR para resultado final. Sin mensajes externos.

## 2026-09-16 — Aceptación SQL integrada de Tracking y tareas

PR #313 publicada: 8dff2add51817deb14d0abb464c11aac53f78141.
Nueva prueba tracking-workflow-lifecycle: 16 verificaciones sobre documentos,
tareas/dependencias, destinatarios/permisos y avisos personales con RPC SQL reales.
Ver TRACKING_WORKFLOW_LIFECYCLE.md; la PR registra CI final. Sin cambio de runtime
ni migración nueva. Falta integrar estas acciones en dos sesiones de navegador.

## 2026-09-16 — Protección de avisos aceptados en Tracking

PR #312 publicada en c156010464ef554cc17754c26e48d3befc006248; migración documental aplicada.
La continuación corrige liberación indebida del claim WhatsApp tras aceptación
por el proveedor si falla el PATCH posterior. Dos handlers afectados; sin DDL.
Prueba aislada de siete escenarios en check-tracking-notification-claim.mjs.
Ver TRACKING_NOTIFICATION_CLAIM.md y PR asociada para CI/publicación final.
Tareas integradas y demás pendientes siguen en FUNCTIONAL_CLOSURE_STATUS.md.

## Hallazgo durante aceptación documental — PR #312

La suite detectó duplicación por reenvío después de perder confirmación. Se añade
migración 20260916012951_customs_document_upload_idempotency.sql y prueba de
concurrencia. Ver TRACKING_DOCUMENTS_BROWSER_ACCEPTANCE.md y PR para CI, aplicación
de migración y publicación final. No asumir aplicada una migración por existir.

## Continuación — prueba documental integrada (2026-09-16)

PR #311 publicada, base ef0369fc1711868b3a16d7ddc0b8597953cd642e.
Rama test/tracking-documents-browser añade dos operadores, archivos/versiones,
readiness y pérdida de confirmación sobre backend SQL real y Storage local
simulado. Ver TRACKING_DOCUMENTS_BROWSER_ACCEPTANCE.md y PR para CI final.
No repetir como pendientes las recuperaciones de UI ya publicadas.

## Continuación y pendientes consolidados — 2026-09-16

PR #310 publicada: main b74b55e189f0511aa5bd7b1020736d226ed2a051.
Rama fix/customs-delete-recovery: recuperación tras eliminación documental.
Leer FUNCTIONAL_CLOSURE_STATUS.md para el pendiente vigente; los cortes anteriores
no sustituyen las pruebas más recientes. PR registra CI y publicación final.

## Continuación — recuperación de carga documental (2026-09-16)

PR #309 publicada: main 554c18b71abd2b0e87a10aefb06cac8e8225b727.
Rama fix/customs-upload-recovery: la UI consulta el archivo exacto tras un error
ambiguo y distingue guardado de refresco fallido. No repite escrituras ni borra
archivos. Ver CUSTOMS_UPLOAD_RECOVERY.md y PR para CI/publicación final.

## Continuación — conservación de archivos (2026-09-15)

PR #308 publicada: main 2072fb563d04e9c2af48d14e5255869aff63908e.
Rama `fix/preserve-customs-upload`: un fallo posterior al commit podía borrar el
archivo del documento. Se elimina esa compensación destructiva en documentos
Cuba y API documental anterior. Ver DOCUMENT_UPLOAD_PRESERVATION.md y PR para
CI/publicación final. Tracking/documentos sigue como bloque de cierre funcional.

## Continuación — visibilidad de tareas relacionadas (2026-09-15)

PR #307 publicada, main 3b47f549074ef37cf35f48bb34122c84bd1c25de.
Rama actual `fix/task-related-visibility`: dependencias/dependientes deben respetar
la visibilidad del listado antes de enriquecer entidades. El contador de bloqueos
y el RPC siguen siendo autoritativos. Ver TASK_RELATED_VISIBILITY_ACCEPTANCE.md;
la PR registra CI exacto y publicación final. Escritorio sigue siendo prioridad.
El resto de este documento conserva los cortes anteriores como contexto.

# Current State — Export MCA ERP

Actualización: 2026-09-15 UTC. Prioridad: cierre funcional en navegador de escritorio.

## Entrega vigente

PR #306 (Repetir compra) está integrada/publicada, merge
58fbf289e47f8132f98fc4a084deb9de4f188cb1. Base actual consultada main:
f83a2f122257db3ab98f247149ae0ddfc202b337. Se preserva su cambio ajeno al ERP.

Rama fix/cancelled-sale-billing: el workspace ofrecía Crear factura después de
cancelar, aunque create_invoice_plan rechaza ventas no confirmadas/cerradas.
Se añade capability de creación al payload y se consume en ambos botones y su
handler. La confirmación aclara que cancelar conserva facturas, cobros y saldos.
No se cambia la regla comercial de cancelación ni se anulan documentos en cascada.
CF-13 amplía la aceptación aislada a facturas borrador, impagadas y con cobro parcial.
Consultar CANCELLED_SALE_BILLING_ACCEPTANCE.md y la PR para resultado final,
Preview y publicación; este corte no anticipa el merge.

Daniel difiere explícitamente iPhone/BrowserStack/PWA física/push. Se continúa
escritorio sin compra ni reintento manual de BrowserStack. WebKit emulado puede
seguir como regresión gratuita del CI existente; no es certificación física.

## Punto recuperado

Las PR #297–#304 están integradas. No presentar Cancelar venta, arranque móvil o
Direct Ship 840 → 810 como pendientes. #298 implementa la corrección física con
historia y #299 el índice del actor de auditoría. #300/#301 preservan fallos
transitorios en documentos, tareas e inbox; #302/#303 amplían y aíslan iPhone;
#304 corrige el error público de enlaces operativos.

Base recuperada: `3a354a44999b07f93503b9b888bb3821f024796f`, Vercel producción
`dpl_zHKeEqo8qM3jB5szNzi2hEkS29WW` READY, SHA coincidente.

## Entrega actual

Rama `audit/api-public-error-boundaries`, PR #305: se reproducen y corrigen 20
exposiciones directas en 19 endpoints, sin cambiar datos, permisos ni reglas
comerciales. Validaciones conocidas usan textos constantes y 400; fallos internos
500; transitorios agotados 503. WhatsApp fallido conserva el tracking guardado.

Matriz, owners y límites: [security/API_PUBLIC_ERROR_AUDIT.md](security/API_PUBLIC_ERROR_AUDIT.md).
Local: 97 comprobaciones de handlers, 17 del detector, 61 endpoints sin findings
directos, 13 gates complementarios, API financiera 11/11 y SQL ventas/logística
29/29. Resultados finales de CI y publicación se registran en la
[PR #305](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/305).
Consultar esa PR, commit exacto y deployment/aliases antes de retomar; este corte
no sustituye la verificación posterior al merge.

## Siguiente bloque

Continuar la auditoría por mensajes técnicos almacenados y objetos transportados
por helpers: el scanner directo no cubre todo flujo de datos. Contrastar los
inventarios de julio y B9 inicial con código/CI actuales. No declarar terminado
todo el ERP por esta entrega. Conservar las matrices comerciales y multioperador.

Safari/iPhone físico, PWA instalada y push real siguen sin certificar: #303
registra `Automate testing time expired`. No reintentos manuales de BrowserStack.
WebKit emulado y checks HTTP de publicación son evidencias diferentes.

## Método y fronteras

- Usar owners existentes; no nuevos observers, wrappers o reemplazos de botones.
- Rama/PR, regresión antes de corregir, CI del commit exacto, Preview READY y
  merge con expected head. El propietario ya autorizó corregir, probar e integrar.
- QA comercial solo en PostgreSQL/PostgREST desechables; Preview comparte
  producción. No mensajes a clientes, cambios de roles reales o credenciales en
  artefactos. Mantener Supabase fuera del navegador.
- Direct Ship no crea WR/inventario. No borrar historia ni ajustar cantidades
  reales para probar. Mantener reverso correctivo y devolución real diferenciados.
- No desactivar gates ni desplegar manualmente si GitHub genera el deployment.

## Historial

Corte anterior íntegro: [history/CURRENT_STATE_20260910_CANCEL_STARTUP.md](history/CURRENT_STATE_20260910_CANCEL_STARTUP.md).
Conserva referencias a Direct Ship, 2026-09-09 y entregas anteriores. Las notas
finales de cada PR son la evidencia posterior a su corte documental.
