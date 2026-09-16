## 2026-09-16 · Recuperación de recepciones manuales

A-01 publicado por PR #326: main 8c05bf50f7130eac71745f94d32410c450ca46ea,
producción dpl_GfxskdZ5RjJnWkVMftGSBtxewhD4 READY; 17/17 workflows y 16/16
recorridos. Historial y notificaciones conservan diagnóstico sin exponerlo.

A-02 reproducido: perder una confirmación y reintentar duplicó una entrega de
12 unidades en dos WR, 24 unidades y dos auditorías. La rama
fix/manual-receipt-recovery incorpora guardado transaccional e identidad estable.
35/35 verificaciones HTTP/PostgreSQL pasan; navegador, gates definitivos y
aplicación/publicación se registrarán en la PR. No asumir migración aplicada.
Leer MANUAL_RECEIPT_RECOVERY.md y security/BACKUP_RECOVERY_STATUS.md.
Supabase: organización en plan free; respaldo restaurable aún no acreditado.
Escritorio prioritario; iPhone físico/BrowserStack/push siguen diferidos.

## 2026-09-16 · Diagnósticos públicos de notificaciones (PR #326)

La reproducción aislada confirmó 21 exposiciones de errores almacenados/indirectos.
Corrección en los owners de API: Clientes, Contenedores, Historial y CSV; se
conservan registros internos, estados, permisos e identidad de los envíos.
28/28 escenarios nuevos, 97/97 errores públicos previos y 7/7 claims pasan en
el ensayo dirigido. CI completo/publicación: consultar PR #326, no inferirlos.
Leer security/STORED_NOTIFICATION_ERRORS.md. A-02 (confirmación de recepciones
manuales) y respaldo/restauración siguen pendientes; escritorio prioritario.

## Retomar desde #324 — jornada publicada, auditoría con hallazgos

Main 9f4aea87c412ac2dc467c0d934eee2f084307978; producción dpl_9KawWZViHyByoBhEAXw5ScdR32NN READY. 19/19 workflows,
16/16 recorridos; COM-01/18 cuadra venta/cobro 400, pago proveedor 250, AR/AP 0,
COGS real 250, costo 50, contribución 100, caja neta 150 e inventario 0.
Pagos proveedor idempotentes y audit atómico ya aplicados/publicados, sin cambiar
las cinco filas históricas. Leer security/WORKDAY_TECHNICAL_AUDIT_20260916.md.
Siguiente bloque concreto A-01: errores técnicos retornados indirectamente o
almacenados (shipments/history/clients/export); primero marcador de prueba y
luego saneamiento sin borrar historia. A-02: reproducir pérdida de confirmación
al crear recepción manual legacy; no afirmar defecto sin ensayo ni revocar
service_role a ciegas. No tocar otros módulos de #324 ni rehacer la jornada.
Escritorio prioritario; iPhone físico/BrowserStack/push diferidos. Nada de QA
comercial en producción/Preview ni mensajes reales. No subagentes por defecto.

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

# AI Context — Export MCA ERP

Última actualización: 2026-09-15 UTC.

## Continuación vigente

Daniel prioriza navegador de computadora; BrowserStack/iPhone/PWA física/push
quedan diferidos por su decisión. No solicitar compra para continuar escritorio.
Repetir compra está publicado: PR #306, merge 58fbf289e47f8132f98fc4a084deb9de4f188cb1.
Base main consultada: f83a2f122257db3ab98f247149ae0ddfc202b337 (cambio posterior
ajeno al ERP, preservado). Rama actual fix/cancelled-sale-billing.

Cierre funcional actual: corregir oferta de nueva factura en ventas no facturables
mediante capability del workspace; conservar facturas/cobros/saldos al cancelar y
explicarlo en la confirmación. CF-13 prueba borrador, emitida impagada y cobro
parcial, sin modificar la semántica de cancelación ni migrar datos.
Leer CANCELLED_SALE_BILLING_ACCEPTANCE.md y la PR para CI/publicación final.

Contexto previo de auditoría (retomar tras la función):

Retomar desde **PR #305**, rama `audit/api-public-error-boundaries`. Leer
CURRENT_STATE.md, security/API_PUBLIC_ERROR_AUDIT.md y la PR/CI final. Las PR
#297–#304 ya están integradas; no repetir cancelaciones, arranque móvil ni Direct
Ship 840 → 810 como pendientes. Base recuperada main `3a354a44999b07f93503b9b888bb3821f024796f`,
Vercel `dpl_zHKeEqo8qM3jB5szNzi2hEkS29WW` READY.

#305 corrige 20 exposiciones directas en 19 de 61 endpoints: validaciones públicas
constantes, fallos internos 500, transitorios 503 y éxito parcial de tracking si
falla WhatsApp. Sin migraciones, dependencias nuevas, datos, permisos o UI.
Verificar integración/publicación final en la PR; no inferirlas de una rama.
Siguiente revisión: errores almacenados y objetos a través de helpers. El scanner
directo no demuestra seguridad completa ni cierra todo el ERP. BrowserStack
limitado por Automate agotado (#303); Safari físico, PWA standalone y push real
sin certificación. No reintentos manuales.

## Fuentes y arquitectura

Leer TECH_DEBT_INVENTORY.md, CLEANUP_PLAN.md, CHANGELOG.md y documentación del
módulo afectado. Contrastar los inventarios antiguos con código/CI actual.
Contexto anterior íntegro: history/AI_CONTEXT_20260910_CANCEL_STARTUP.md.

- Export MCA LLC; repo mikro970328-sys/-export-mca-portfolio, main productivo.
- HTML/CSS/JavaScript, Vercel Serverless, Supabase PostgreSQL y autenticación propia.
- Dominios admin.exportmca.com y app.exportmca.com. admin/pwa.html entra al shell,
  no a un segundo ERP dentro de iframe.
- Clientes: clients/api/clients. Contenedores: shipments/api/shipments. Historial:
  shipment_history/audit_log. Usuarios: admin_users, permisos P3 y sesiones.
- No cambiar integraciones por inferencia desde documentación histórica.

## Método y autorización

1. Identificar owner, dependencias y conducta a conservar. Reproducir antes de
   corregir; separar defectos y carencias del entorno QA.
2. Trabajar en rama vigente preservando trabajo simultáneo. No force-push ni
   cambios funcionales directos en main. Corregir fuente canónica.
3. No mezclar refactor con funciones nuevas o cambios visuales con migraciones.
   No MutationObserver adicional ni wrappers de loadAll/showSection/render.
4. Mantener historial y semántica. Direct Ship no crea WR/inventario. No renombrar
   columnas sin migración auditada ni cambiar auth/roles sin revisión y pruebas.
5. Gates del commit exacto y aceptación aislada pertinente. Preview READY no
   certifica sesión autenticada ni publicación.
6. Actualizar estado/changelog/matriz. El propietario ya autorizó pruebas,
   correcciones e integración; fusionar con expected head tras validar.
7. Verificar deployment/aliases/assets/APIs y registrar límites en la PR.

Orden solicitado: cierre funcional y pruebas, mejoras de claridad y auditoría
integral. No empezar de cero ni reabrir trabajo terminado sin nueva evidencia.

## Seguridad operacional

No QA comercial en producción ni Preview, que comparten base. Solo bases
desechables y transportes de prueba explícitos. No WhatsApp/correo/push de prueba
a clientes. No tokens/cookies/contraseñas en evidencias. No acceso directo
Supabase desde frontend. No eliminar capas legacy sin integrar/probar su conducta
ni usar texto visible para reconocer acciones. No ejecutar la antigua PR de
Arquitectura 1.0 en producción. No alterar gates/cuotas para aprobar ni desplegar
manualmente cuando GitHub ya genera el deployment. Mantener la diferencia entre
reverso correctivo y devolución real de dinero.
