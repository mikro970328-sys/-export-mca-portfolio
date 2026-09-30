# Rendimiento, notificaciones y mantenimiento

## Alcance

La revisión completa de la interfaz en iPhone queda fuera de este cierre.
Se mantiene la activación y recepción de notificaciones del dispositivo.

## Prueba de volumen y concurrencia

`Isolated Load Acceptance` ejecuta los handlers actuales con PostgreSQL 17.6,
PostgREST 12.2.3 y credenciales efímeras, exclusivamente por loopback. Inicializa
una base vacía con las migraciones reales de finanzas, permisos, tareas, push,
dashboard y caché. El límite REST de 1000 filas permite detectar truncamientos.

La primera ejecución reprodujo que el listado devolvía 1000 de 2000 filas.
Los contenedores, capacidades y relaciones de cumplimiento ahora se leen por
páginas con orden estable. Un error en una página rechaza la lectura completa.

Datos: 2000 contenedores, 500 clientes adicionales, 100 ventas/facturas emitidas y
50 cuentas independientes. Tres rondas por nivel de 5, 20 y 50 usuarios hacen
lecturas de cuenta, dashboard, finanzas y contenedores y guardados en registros
distintos. Cada guardado confirmado exige el valor persistido y exactamente una
entrada de historial y auditoría. No se dispara mensajería. Se conservan métricas
p50/p95/p99 y Server-Timing por ruta, sin tokens ni datos comerciales.

Estas latencias son del runner de CI. No incluyen Vercel, la región de producción,
la red del usuario ni el renderizado de la pantalla; no constituyen un SLA ni
una comparación contra Magaya. Los ensayos de cobros concurrentes sobre una
misma factura siguen en `Operator and Concurrency Acceptance`.

## Recuperación de notificaciones caducadas

Un permiso concedido por el navegador no demuestra que haya un dispositivo
registrado con sesión válida ni que la preferencia push esté habilitada. La
pantalla distingue estos estados. Al pulsar Activar, una suscripción local sin
registro activo se revoca y reemplaza antes de registrar el nuevo endpoint.
La carga de la página nunca solicita permiso ni renueva una suscripción.

La prueba de renovación usa dispositivos sintéticos, cubre expiración, sesión
revocada, permiso bloqueado, errores de registro y limpieza de la nueva suscripción.
El servicio push real requiere activar el dispositivo deseado y comprobar una
recepción autorizada; una prueba sintética no acredita esa recepción.

La revisión también reprodujo una alerta de descarga con miles de días porque
el helper convertía fechas vacías en 1970. Las fechas vacías/ilegibles ahora
devuelven null: no abren una condición de descarga. El reconciliador canónico
cierra las condiciones falsas preexistentes en su próxima ejecución, sin
borrar su historial; una descarga real atrasada sigue generando su alerta.

## Comprobación mensual de recuperación

`Backup Restoration Drill` queda programado el día 1 de cada mes a las 13:23 UTC,
además de sus disparadores manuales y por cambios de código. Hace dump y restore
entre dos servicios PostgreSQL vacíos y distintos y comprueba datos, funciones,
RLS, grants, secuencias y archivos sintéticos. No usa secretos ni copias comerciales.
Esto detecta regresiones del procedimiento; la recuperación de una copia real
de producción conserva como evidencia el ensayo autorizado del 18 de septiembre.
Un nuevo ensayo con una copia real debe registrar fecha, RPO/RTO, hashes y el
destino independiente, usando el runbook existente.

## Propuesta de retención: preparada, sin borrado

`workers/storage-backup/src/retention-plan.js` prepara un plan determinista y de
solo lectura: conserva la copia verificada más reciente de cada uno de los
últimos 30 días distintos con copia, la más reciente de los últimos 12 meses
distintos con copia, y siempre el punto señalado por `state/latest.json`.
Un mismo punto puede cubrir ambas categorías. Si faltan días o meses, conserva
los puntos existentes; no inventa copias. La selección usa UTC.

El catálogo de entrada debe verificar previamente COMPLETE, manifiesto y
SHA-256 de los objetos según el runbook. Las copias incompletas, no verificadas,
corruptas o con fecha futura se protegen. Un último punto no verificado o un
catálogo duplicado detiene el plan. El resultado tiene `dry_run: true` y
`deletion_enabled: false`; el módulo no dispone de operaciones R2 de borrado ni
es invocado por el cron del Worker.

Antes de aplicar limpieza real, se debe presentar el inventario de R2 y sus
candidatos concretos y obtener aprobación de la política y del borrado. El
Worker actual sigue conservando todas las copias. Ver
`docs/security/STORAGE_BACKUP_RUNBOOK.md`, sección Retención.
