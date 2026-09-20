# Estado de respaldo y recuperación

Corte: 2026-09-20 UTC. Sustituye la preparación del corte anterior. El ensayo
real de base y archivos terminó correctamente en un proyecto aislado; la prueba
sintética sigue siendo evidencia separada. El proyecto temporal se eliminó con
confirmación explícita del propietario al terminar el ensayo.

## Ensayo real de recuperación — completado

Se restauró la copia física de `2026-09-18 11:34:24 UTC` en un proyecto nuevo,
en la misma organización y región. El destino quedó `ACTIVE_HEALTHY` sin cambiar
dominios, variables de Vercel ni el proyecto productivo. La base estuvo lista en
aproximadamente cinco minutos.

Comprobación agregada del destino restaurado:

- 75 tablas públicas comparadas; columnas, índices, restricciones, funciones,
  políticas, RLS, grants y catálogo de migraciones coinciden.
- 1 usuario de Auth coincide en conteo y hash.
- 2 buckets y 3 filas de metadatos de Storage coinciden.
- 70 de 75 tablas de datos coinciden exactamente. Las cinco diferencias son
  estado operativo posterior al punto de copia: `audit_log`, `erp_change_state`,
  `notifications`, `operational_alert_conditions` y `web_push_runtime_state`.
- Todas las tablas comerciales y financieras coinciden exactamente.
- La función crítica de recepción conserva el permiso esperado: solo
  `service_role`; `anon` y `authenticated` no pueden ejecutarla.
- No se encontraron `pg_cron`, `pg_net`, `http` ni `wrappers` activos.

La copia automática de Storage terminada a `2026-09-18T21:50:04.207Z` se leyó
desde Cloudflare R2. `state/latest.json`, `manifest.json`, `COMPLETE` y sus tres
miembros coincidieron con el SHA-256 registrado. Los 3 objetos, 674427 bytes, se
repusieron en el destino con sus rutas originales y se descargaron nuevamente:
3/3 tamaños y SHA-256 idénticos. Las políticas temporales limitadas a esas rutas
se eliminaron al terminar y una lectura nueva del bucket privado volvió a quedar
bloqueada para `anon`.

RPO observado al iniciar el ensayo: aproximadamente 10 h 43 min para la base y
28 min para los archivos. RTO observado: aproximadamente 5 min para disponer de
la base y 1 h 32 min para completar también la recuperación y verificación manual
de Storage, incluida la autorización interactiva.

El proyecto temporal tenía una cotización de USD 9.68/mes. Se eliminó de forma
irreversible el 2026-09-20 y Supabase volvió a mostrar únicamente el proyecto
productivo `ACTIVE_HEALTHY`. Su identificador, contraseña y demás evidencia
sensible se mantienen fuera del repositorio.

## Cuenta y acceso

- Organización Export MCA Tracking, swtsszwnkpzcpuzenlps, plan Pro verificado.
- Proyecto qflncyhdspuvtrxsqgbj ACTIVE_HEALTHY; PostgreSQL 17.6.1.147.
- El intento autorizado de verificación de ChatGPT volvió a mostrar Cloudflare.
  Daniel solicitó otro método y eligió GitHub en el formulario seguro.
  La sesión de Supabase mostró la organización, el proyecto y sus backups.
  Acceso al inventario administrado resuelto.

## Copias administradas reales

El panel Scheduled backups identifica las copias como Physical. En el ensayo
real se seleccionó la copia `2026-09-18 11:34:24 UTC`, restaurada correctamente.
El inventario histórico anterior había mostrado además estas siete COMPLETED:

| Fecha UTC | Estado |
| --- | --- |
| 2026-09-16 11:48:13 | COMPLETED |
| 2026-09-15 11:53:45 | COMPLETED |
| 2026-09-14 11:50:28 | COMPLETED |
| 2026-09-13 12:22:21 | COMPLETED |
| 2026-09-12 11:56:32 | COMPLETED |
| 2026-09-11 12:07:46 | COMPLETED |
| 2026-09-10 11:57:26 | COMPLETED |

La copia del 18 de septiembre está acreditada por restauración; las siete filas
anteriores acreditan inventario histórico, no ensayos individuales. El panel no
mostró tamaño de cada copia. No inventar ese dato.

Fuente autenticada:
https://supabase.com/dashboard/project/qflncyhdspuvtrxsqgbj/database/backups/restore-to-new-project

Pro conserva siete días de copias diarias de base. Los bytes de Storage
requieren respaldo independiente.
[Documentación de backups](https://supabase.com/docs/guides/platform/backups).

## Copia independiente de archivos — completada

Inventario antes y después de descargar: sin cambios.
erp-documents privado: 2 objetos / 510171 bytes.
publication-images público: 1 objeto / 164256 bytes.
Total: 3 objetos / 674427 bytes. Los dos documentos activos enlazan a Storage.

Los tres archivos se descargaron desde el panel autenticado. Sus tamaños y
MD5 coinciden con los eTag de origen observados. El ZIP privado conserva las
rutas bucket/key exactas, tipos, metadatos, flags públicos de bucket y SHA-256
individuales en el manifiesto. Tamaño del paquete: 623344 bytes.

Se comprobó la integridad del ZIP y se extrajo a una carpeta temporal vacía:
3/3 archivos recuperados con tamaño y SHA-256 idénticos. La copia independiente
quedó guardada de forma persistente y privada para Daniel. Los bytes, rutas
privadas e identidad del archivo guardado no están en este repositorio público.

Alcance: objetos actuales, no eliminados ni versiones antiguas. El paquete
no incluye un dump de la base, no programa copias futuras y no acredita una
restauración completa del ERP.

## Ensayo sintético — PR #330 integrada

Merge 6500142d91f3577440f585110e845791f100aece.
CI del head bbef430d9a218428da9b2aeef1c19b03536b5d84:
25 comprobaciones, 53 tablas, 120 filas sintéticas y 2 objetos.
Run 35175096791 aprobado; repetición en main 35175196094 aprobada.
Vercel dpl_35YAk5Es95kk6iPGXcp7Wa2ZR2jN READY para ese merge, con ambos aliases.

Dos PostgreSQL 17.6 desechables; pg_dump nativo, roles y archivos independientes.
La fuente se apaga antes de restaurar el archivo en el destino vacío.
Se comprueban datos, esquema, secuencias, permisos/RLS, funciones, índices,
restricciones, triggers, balances, acceso, corrupción y operaciones posteriores.
Los permisos predeterminados se normalizan sin ocultar nuevas concesiones;
un permiso anónimo añadido intencionalmente debe detectarse y luego retirarse.

Esto no restaura un backup real de Supabase ni certifica por sí solo su esquema
administrado, configuración externa, secretos, JWT, Twilio o ShipsGo.
[Evidencia de PR #330](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/330).

## Restauración real de la base — verificada

La cotización final aceptada fue USD 9.68/mes: USD 9.68 de cómputo y USD 0 de
disco. El ensayo usó el backup físico más reciente disponible y el catálogo
restaurado ya contenía la migración `20260916231419`; no fue necesario aplicar
migraciones adicionales. Los objetos de Storage se recuperaron por separado
desde R2, como exige el alcance de las copias físicas de Supabase.

[Costos de cómputo](https://supabase.com/docs/guides/platform/manage-your-usage/compute).
[Restaurar a otro proyecto](https://supabase.com/docs/guides/platform/clone-project).

## Pendientes operativos

La copia periódica de Storage ya está activa en Cloudflare R2 y el ensayo real
de base más archivos quedó certificado con resultados agregados. Ver
[procedimiento](STORAGE_BACKUP_RUNBOOK.md).

1. Definir y aprobar la retención de R2 antes de automatizar eliminaciones. El
   Worker conserva por ahora todas las copias completas y ejecuciones parciales.
2. Repetir el ensayo periódicamente y registrar nuevos RPO/RTO; este resultado
   acredita el punto de recuperación probado, no todos los futuros backups.

No se modificaron datos comerciales ni configuración del ERP productivo. El
cierre técnico de recuperación y la retirada del recurso temporal están
completos; queda como mejora operativa la política futura de retención.
