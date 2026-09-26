## Estado vigente · 26 sep 2026 · Escritorio terminado y publicado

- La etapa de escritorio acordada con Daniel está cerrada. Avisarle antes de iniciar la revisión del iPhone físico. No reiniciar pendientes históricos ni detenerse en entregas intermedias ya resueltas.
- Entrega y evidencia consolidadas: [ERP_DESKTOP_HANDOFF.md](ERP_DESKTOP_HANDOFF.md). ERP: https://admin.exportmca.com · Figma: guía 141:2.
- Publicación final: PR #358, main `fc038fb9e56cf182df4b46db97af1ed1291d72a6`; Vercel `dpl_D7M6unyM73pSuBxsZxK62yTEq3Xt` READY. Once archivos exactos por GET; cuatro endpoints protegidos devuelven 401 sin sesión.
- Head probado `78f8e90a4693aa19142a419b2582a62a9f91d910`, árbol `bbe3cdcfdee19003d6347385db9389f2561eb0fe`. CI `36248419740`: 44/44 workflows, 22/22 trabajos, 174/174 visuales en Chromium y 174/174 en WebKit. Capturas finales revisadas.
- Compras: relaciones asíncronas estables dentro de su owner, descarte de respuestas obsoletas, detalle alineado con Figma y estados AP en español. Shell 224 px y espacio interior a cargo de cada módulo. Sin cambios de API, SQL, permisos, cálculos, payloads, historial ni idempotencia.
- Pruebas en memoria y bases desechables; ninguna escritura QA en producción/Preview, envío real, activación push o validación física del iPhone. WebKit simulado no certifica el dispositivo.
- Siguiente etapa: revisar el iPhone físico después del aviso a Daniel. No comprar tiempo de BrowserStack ni ejecutar envíos por cuenta propia.

Este estado sustituye los pendientes históricos resueltos de abajo.

---

## Continuidad 26 sep 2026 · Cierre integrado de escritorio en revisión

- Objetivo vigente: terminar escritorio y avisar a Daniel antes del iPhone físico. Continuar sin confirmaciones rutinarias.
- Inicio/comunicaciones publicado: PR #356, main 8642667, Vercel dpl_41cHz17WYm3J7bfya4i53tNWepH3 READY; 38 workflows, 22 trabajos y 142/142 visuales por motor; nueve assets exactos por GET, APIs sin sesión 401; guía 132:2 publicada.
- Publicaciones/asignaciones/supervisión publicado: #357, main a1e5d913, Vercel dpl_7hVAAF77UFU181XaHMd17Z9P4gvj READY; 34 workflows, 22 trabajos, 160/160 visuales por motor y nueve archivos exactos por GET. Guía 135:4515 publicada.
- Integración: Compras retira dos bridges de presentación y conserva sus relaciones en un desplegable estable; shell 224 px, sin márgenes duplicados. 26 gates y composición jsdom correctos; 14 pruebas nuevas por motor. Detalle en docs/FIGMA_DESKTOP_INTEGRATION.md.
- Pendiente antes del aviso: CI y capturas exactas, publicación y verificación GET. Sin QA en producción/Preview, envíos, suscripciones ni iPhone físico.

Este corte sustituye los pendientes históricos resueltos de abajo.

---

## Continuidad 26 sep 2026 · Publicaciones y supervisión en revisión

- Terminar escritorio y avisar a Daniel antes del iPhone físico; continuar sin confirmaciones rutinarias.
- Inicio/comunicaciones: PR #356; 142/142 visuales por motor pasaron en ba2664. La corrección final ed2fc49 conserva el color de Resolver al pasar el cursor y evita partir importes en pantallas estrechas; CI y publicación en curso, aún no declararla publicada.
- Actual: Publicaciones, asignaciones automáticas y supervisión. Seis vistas Figma, guía 135:4515. Implementación y gates locales correctos, 18 pruebas nuevas por motor enumeradas. Ver docs/FIGMA_PUBLICATIONS_WORKFLOW.md; revisar CI/capturas antes de publicar.
- Cierre pendiente: enlaces asíncronos relacionados de Compras (incluida trazabilidad AP), márgenes del shell y revisión integrada.
- Sin escrituras QA en producción/Preview, sin envíos ni activaciones push reales. No iniciar iPhone físico antes del aviso de cierre de escritorio.

Este corte sustituye los pendientes históricos resueltos de abajo.

---

## Continuidad 26 sep 2026 · Administración publicada; Inicio y comunicaciones en revisión

- Terminar escritorio y avisar a Daniel antes del iPhone físico; continuar sin confirmaciones rutinarias.
- Usuarios/Mi cuenta: PR #355 publicado en `2eddad863822d663b2190c7334b7f360d063e18a`, Vercel `dpl_6wBaiCXGU8RByjnt1LhUMzT2aV55` READY. 39 workflows, 22 trabajos y 121/121 visuales por motor correctos. Capturas revisadas, seis archivos exactos por GET y APIs sin sesión 401; guía 127:2 publicada.
- Actual: Inicio, alertas, bandeja/historial/preferencias. Diez vistas Figma (guía 132:2), owners revisados, 21 pruebas nuevas por motor enumeradas. Comprobar CI/capturas antes de publicar; docs/FIGMA_HOME_COMMUNICATIONS.md.
- Después: Publicaciones, configuración/supervisión de workflow y revisión integrada. Corregir el bridge asíncrono de Compras y márgenes/padding nativos del shell.
- Sin escrituras QA en producción/Preview, sin envíos ni activaciones push reales. No declarar el ERP completo ni iniciar iPhone físico antes de cerrar ese alcance.

Este corte sustituye los pendientes históricos resueltos de abajo.

---

## Continuidad 26 sep 2026 · Tareas publicadas; Administración en revisión

- Instrucción vigente: terminar escritorio y avisar a Daniel antes del iPhone físico; continuar sin confirmaciones rutinarias.
- Tareas y Trabajadores: PR #354 publicado en `1527d4af094c97179e4d696037e7d6e65ce73e11`; Vercel `dpl_71heePGGFim5KypdWXhKKttFtRo2` READY. 38 workflows, 22 trabajos y 99/99 visuales por motor correctos. Seis archivos de producción exactos; APIs sin sesión 401. Guía Figma 124:5 publicada.
- Bloque actual: Usuarios y acceso / Mi cuenta. Trece vistas Figma (guía 127:2), owners revisados, 22 nuevas pruebas por motor; verificar CI/capturas antes de publicar. Detalle en docs/FIGMA_ACCESS_ACCOUNT.md.
- Después: Inicio/alertas/notificaciones, Publicaciones, configuración/supervisión de workflow y revisión integrada. Resolver el bridge asíncrono de Compras que desplaza las acciones al insertar enlaces relacionados.
- No QA de escritura en producción ni Preview. No empezar iPhone físico ni declarar el ERP completo antes de cerrar ese alcance.

Este corte sustituye los pendientes históricos resueltos de abajo.

---

## Continuidad 26 sep 2026 · Directorios publicados; Tareas y Trabajadores en revisión

- Instrucción vigente: terminar el ERP de escritorio y avisar a Daniel antes de pasar al iPhone físico. Continuar sin confirmaciones rutinarias ni cerrar tras publicar un bloque.
- Clientes y Proveedores: PR #353 publicado en `735ccd339821134ad376719b5c7e3d4f54a72da1`, Vercel `dpl_CNN1dv7q8C75uFJmN5PGw5nmxVCw` READY. CI `36222871322`: 43/43 workflows, 22/22 trabajos y 83/83 pruebas visuales por motor. Diez archivos de producción exactos por GET; APIs sin sesión 401. Guía Figma `117:5` / `117:7` publicada.
- Bloque actual: Tareas y Trabajadores, nueve vistas Figma, guía `124:5` / estado `124:7`. Owners revisados, 16 pruebas nuevas por motor preparadas. Falta comprobar CI, capturas y publicación. Detalle en `docs/FIGMA_TASKS_WORKERS.md`.
- Pendiente: accesos/Mi cuenta, Inicio/alertas/notificaciones, Publicaciones/workflow y revisión integrada. Resolver el desplazamiento asíncrono de enlaces relacionados de Compras antes de considerar terminado el escritorio.
- Sin datos QA en producción ni Preview: memoria o PostgreSQL/PostgREST desechables. No ejecutar validación física del iPhone todavía.

Este corte sustituye los pendientes históricos ya resueltos que aparecen debajo.

---

## Continuidad · 26/09/2026 · Finanzas desde Figma

## Continuidad 26 sep 2026 · Finanzas publicado; Clientes y Proveedores en revisión

- Daniel pidió continuar hasta terminar el ERP de escritorio y avisarle antes de pasar al iPhone físico. No detener el trabajo tras un bloque ni declarar terminado el ERP.
- PR #352 publicado en `8dcde7411e0bd3357b79a105f62be74a24804234`: Vercel `dpl_H86FkYG4ukPcDZPwpzY47LkuJDVb` READY, 12 archivos exactos comprobados por GET. Head final `2aa9b000909d7a9ea94e8447523c373968516f4e`, CI `36221102523`: 46/46 workflows, 22/22 trabajos y 69/69 pruebas visuales por motor. Detalle en `docs/FIGMA_FINANCE.md`.
- Clientes y Proveedores: 7 vistas Figma revisadas, guía `117:5` / estado `117:7`; directorio ancho, alta con foco directo, errores junto al formulario, fichas, estados de proveedores por teclado. 14 nuevas pruebas por motor listas; comprobar CI y capturas antes de publicar. Detalle en `docs/FIGMA_DIRECTORIES.md`.
- Pendiente: Tareas, Trabajadores, accesos/Mi cuenta, Inicio/alertas/notificaciones, Publicaciones/configuración de workflow y revisión integrada. No QA de escritura en producción ni Preview; fixtures en memoria o PostgreSQL/PostgREST desechables. No iPhone físico aún.


- Daniel pidió terminar escritorio y avisar antes del iPhone físico. Continuar sin confirmaciones rutinarias; no cerrar la tarea al publicar un bloque.
- Logística publicada: PR #351, main `c15459f61ff19755e5fa0c0f20585eb63bc50b86`, tree `532875b5b5e429ba35922a29524beb627da46bf0`, Vercel `dpl_Ao7GVtchdtYvVxNRVBpLxHkK7JVZ` READY. 45/45 workflows; Browser Operator Acceptance `36218460503`, 22/22 jobs y 50/50 pruebas visuales por motor. Doce archivos de producción exactos; APIs sin sesión 401. Guía Figma `101:2` actualizada.
- Bloque actual: `feat/figma-finance-white`, Facturación, Cuentas por pagar y Reportes. Dieciséis vistas revisadas y tres componentes; guía Figma `112:5`. Implementación y pruebas en `docs/FIGMA_FINANCE.md`.
- APIs/SQL/cálculos/permisos/payloads permanecen en sus owners. Nunca escribir datos QA en producción ni Preview.
- Después: Clientes, Proveedores, Tareas y administración, revisión integrada y publicación final. No comenzar iPhone físico ni afirmar que todo el ERP está terminado antes de resolver ese alcance.

Este corte sustituye los pendientes históricos ya resueltos que aparecen debajo.

---

## Continuación Figma: Existencias y Productos — 2026-09-26

## Continuidad · 26/09/2026 · Logística desde Figma

- Instrucción vigente de Daniel: terminar escritorio y avisar antes de pasar al iPhone físico; continuar sin pedir confirmaciones rutinarias.
- Existencias y Productos publicados: PR #350, main `6f5b19a54e69eb719cbb0f82994cb5b28a36c6a1`, deployment `dpl_CuMyosMVLGkjkZyQQqHt14MPEsya`. 40 workflows aprobados; Browser Operator Acceptance `36216056815` con 22/22 jobs y 40/40 pruebas visuales por motor. Nueve assets de producción idénticos; APIs sin sesión responden 401.
- Bloque actual: Cargues, Tracking, registro/edición, documentos e historial y actualización de seguimiento. Nueve vistas Figma y cuatro componentes nuevos; implementación en rama `feat/figma-logistics-white`. Detalles en `docs/FIGMA_LOGISTICS.md`.
- Las validaciones de negocio usan datos ficticios y PostgreSQL/PostgREST desechables. Nunca usar producción ni Preview para escrituras QA.
- Continúan finanzas/reportes, clientes/proveedores/tareas/administración y revisión integrada. No declarar todo el ERP terminado al cerrar un bloque.


Recepciones #349 está publicada en `471fe6441f6a550a743a2d5a060973812cb6c3ab`,
con 39 workflows aprobados, 22/22 jobs de navegador y Vercel READY. Continúa
`feat/figma-stock-catalog-white` con seis vistas de escritorio de Existencias,
saldos WR, movimientos, catálogo y ficha de producto. Ver FIGMA_STOCK_CATALOG.md.
La PR correspondiente registra el commit probado y la publicación definitivos.

Daniel pidió continuar hasta terminar el ERP de escritorio y avisarle antes
de pasar a iPhone. Pendientes siguientes: Cargues/Tracking/documentos;
Facturación/cuentas por pagar/Reportes; Clientes/Proveedores/Tareas/admin;
revisión integral de escritorio. No declarar el ERP terminado por cerrar este
bloque. iPhone físico permanece diferido, sin abrir una nueva sesión de prueba.
No reiniciar módulos publicados. No escribir datos QA en producción ni Preview.

Este corte sustituye los pendientes históricos ya resueltos que figuran debajo.

---

## Continuación Figma: Recepciones (WR) — 2026-09-26

Compras #348 ya está publicada en `4c29b2dd8521c3c0ab1797089166a399ba251181`,
con árbol probado idéntico a producción, 22/22 trabajos de navegador aprobados
y Vercel READY. Gastos #347 continúa publicado. No repetir esos módulos.

La continuación actual aplica seis vistas de Recepciones en
`feat/figma-warehouse-white`. Ver `FIGMA_WAREHOUSE.md` para nodos, alcance y
pruebas. La PR #349 registra el head probado y publicación definitivos.
Daniel autorizó continuar e implementar/publicar. Escritorio prioritario;
iPhone físico sigue diferido. Sin QA comercial en producción ni Preview.
Se conservan APIs, permisos, recuperación de recepción e inventario.

Este corte sustituye los pendientes históricos ya resueltos que figuran debajo.

---

## Continuación Figma: Compras — 2026-09-25

Gastos ya está publicado por PR #347 en `9847906669e098dc88883f2ec7e59ab65276f2d1`,
con 22/22 jobs de navegador aprobados y producción Vercel READY. La continuación
actual implementa las seis vistas de Compras en `feat/figma-purchases-white`.
Ver `FIGMA_PURCHASES.md` para diseños, comportamiento y validación. La PR #348
registra el commit probado, integración y publicación definitivos.
Daniel autorizó continuar la implementación y publicación. No reiniciar módulos.

Este estado sustituye pendientes históricos ya resueltos que figuran debajo.
Escritorio prioritario; iPhone físico/BrowserStack sigue diferido. Sin pruebas
comerciales en producción ni Preview; los recorridos usan datos desechables.
No se cambian API, migraciones ni permisos de negocio.

---

## Continuación de recuperación — 2026-09-17

La base de esta continuación es la PR #331 ya publicada. No repetir como
pendiente su copia manual de archivos ni confundirla con restauración de base.

Se prepara `scripts/storage-backup.mjs`: exportación de lectura con paginación,
inventario antes/después, verificación de bytes/hashes y comprobación offline.
Dieciséis pruebas locales sintéticas aprobadas; CI, Preview e integración
finales constarán en la PR. No toca APIs, UI, migraciones ni datos comerciales.
No se ejecutó contra Storage real ni activa una agenda.

Leer `security/STORAGE_BACKUP_RUNBOOK.md` y `security/BACKUP_RECOVERY_STATUS.md`.
Pendiente real: conectar ejecutor/destino privado y acordar retención; obtener
la autorización del costo adicional para el ensayo de restauración aislado.
No se creó ningún recurso adicional. El ensayo sintético y la copia manual no
certifican una restauración real completa ni RPO/RTO. No afirmar cerrada la
recuperación. Mantener en privado los identificadores y evidencia del ensayo.

Las funciones y auditoría ya cerradas en #326/#327 se conservan.
Escritorio prioritario; iPhone físico, BrowserStack y push siguen diferidos.
Sin QA comercial en producción/Preview ni notificaciones reales.

---

## Estado vigente tras PR #330 — 2026-09-17

Este corte sustituye los pendientes históricos que siguen debajo.
Base publicada al iniciar esta revisión: `6500142d91f3577440f585110e845791f100aece`;
producción `dpl_35YAk5Es95kk6iPGXcp7Wa2ZR2jN` READY en ambos dominios.

- A-01 cerrado en #326: diagnósticos de notificaciones/historial proyectados
  sin exponer errores técnicos ni borrar la historia.
- A-02 cerrado en #327: recepción manual, líneas y auditoría atómicas;
  reintentos/concurrencia recuperan un WR; una anulación no restituye stock.
  La interfaz conserva la confirmación si falla el refresco. sw.js ya no devuelve
  una respuesta nula al perder una lectura sin caché.
- Evidencia del head ac2b69d8e22f4aa5d4d9baa3911cc17eee572922:
  **24/24 workflows, 43 checks aprobados, 18/18 recorridos de navegador**.
  Dos jobs de iPhone físico omitidos conforme al alcance, no certificados.
  Prueba dirigida de recepción: **36/36** verificaciones HTTP/PostgreSQL reales.
- Migración remota **20260916231419** aplicada. RPC idéntico al source,
  service_role autorizado, anon/authenticated sin EXECUTE, identidad e índice
  validados. Conteos preservados: 0 WR, 0 líneas, 0 movimientos.
- La jornada comercial de 18 pasos, repetir compra, pagos/cobros y variantes
  financieras publicadas anteriormente siguen resueltos. No reconstruir módulos.

**Recuperación verificada — 2026-09-17:** acceso al panel recuperado mediante
GitHub, elegido por Daniel. Se ven 7 copias físicas COMPLETED del 10 al 16 de
septiembre; la más reciente es 2026-09-16 11:48:13 UTC. Los 3 objetos actuales
(674427 bytes) se descargaron, cotejaron contra los checksums de origen y
guardaron en un ZIP privado independiente; extracción y SHA-256 de 3/3 aprobados.
PR #330 está integrada: 25 comprobaciones sintéticas, 53 tablas y 120 filas.
No confundir ese ensayo con la restauración real de la base.

**Pendiente concreto:** copia periódica de Storage y ensayo de la base real en
aislamiento. La copia más reciente precede a seis versiones de migración del
16 de septiembre; comprobar el esquema restaurado y aplicar únicamente en el
destino aislado lo que corresponda. El diálogo de clonado mostró $0, pero la
cotización de Supabase para esta organización devuelve USD 10/mes por proyecto.
No se creó un proyecto ni se inició una restauración: hace falta autorización
para el recurso adicional. Leer security/BACKUP_RECOVERY_STATUS.md.

Continuar por recuperación, con escritorio prioritario. iPhone físico,
BrowserStack, PWA instalada y push externo real siguen diferidos.
Sin QA comercial en producción/Preview ni notificaciones reales.
Evidencia funcional y publicación de #327:
https://github.com/mikro970328-sys/-export-mca-portfolio/pull/327
Evidencia de recuperación sintética y publicación de #330:
https://github.com/mikro970328-sys/-export-mca-portfolio/pull/330

---

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
