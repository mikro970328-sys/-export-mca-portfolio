# Estado de respaldo y recuperación

Corte: 2026-09-17 UTC. Sustituye el bloqueo de acceso y la falta de copia de
archivos del corte anterior. La prueba sintética y la recuperación real de la
base siguen siendo evidencias distintas.

## Cuenta y acceso

- Organización Export MCA Tracking, swtsszwnkpzcpuzenlps, plan Pro verificado.
- Proyecto qflncyhdspuvtrxsqgbj ACTIVE_HEALTHY; PostgreSQL 17.6.1.147.
- El intento autorizado de verificación de ChatGPT volvió a mostrar Cloudflare.
  Daniel solicitó otro método y eligió GitHub en el formulario seguro.
  La sesión de Supabase mostró la organización, el proyecto y sus backups.
  Acceso al inventario administrado resuelto.

## Copias administradas reales

El panel Scheduled backups identifica las copias como Physical.
Restore to new project muestra las siete con estado COMPLETED:

| Fecha UTC | Estado |
| --- | --- |
| 2026-09-16 11:48:13 | COMPLETED |
| 2026-09-15 11:53:45 | COMPLETED |
| 2026-09-14 11:50:28 | COMPLETED |
| 2026-09-13 12:22:21 | COMPLETED |
| 2026-09-12 11:56:32 | COMPLETED |
| 2026-09-11 12:07:46 | COMPLETED |
| 2026-09-10 11:57:26 | COMPLETED |

Esto acredita copias concretas listadas por Supabase; no una restauración.
El panel no mostró tamaño de cada copia. No inventar ese dato.

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

## Preparación de la restauración real

Se revisó el diálogo previo al clonado de la copia del 16 de septiembre.
Destino: nuevo proyecto en Export MCA Tracking, us-east-2, tamaño de cómputo
heredado y disco indicado como 1.5 veces el original. No se confirmó Continue.

El diálogo mostró USD 0 para cómputo y disco; la consulta autenticada get_cost
para la misma organización devuelve USD 10 mensuales por un proyecto adicional.
No asumir gratuidad ante esta diferencia. La documentación factura cómputo por
hora activa, redondeando fracciones a una hora; Micro cuesta USD 0.01344/h.
Concretar el recurso y obtener autorización antes de crearlo.
[Costos de cómputo](https://supabase.com/docs/guides/platform/manage-your-usage/compute).

La consulta actual de extensiones no encontró pg_cron, pg_net, http ni wrappers.
Antes del ensayo debe comprobarse también el estado correspondiente a la copia,
pues el clonado físico puede iniciar trabajos externos incluidos en el backup.
Los objetos de Storage y varias configuraciones externas no se clonan.
[Restaurar a otro proyecto](https://supabase.com/docs/guides/platform/clone-project).

La copia más reciente observada precede a estas seis versiones del catálogo actual:

- 20260916144607 invoice_credit_settlement
- 20260916174532 invoice_credit_note_reversal
- 20260916183219 supplier_finance_precision_integrity
- 20260916195235 invoice_payment_retry_integrity
- 20260916214707 supplier_payment_retry_integrity
- 20260916231419 manual_receipt_retry_integrity

El catálogo de migraciones restaurado será la evidencia definitiva; no asumir
que esa copia ya contiene las correcciones actuales. Revisar la compatibilidad
y, cuando corresponda, aplicar los cambios posteriores solo al destino aislado.

## Pendientes operativos

Continuación del 17 de septiembre: `scripts/storage-backup.mjs` prepara una
exportación repetible de los buckets elegidos y su verificación offline.
Dieciséis pruebas locales sintéticas HTTP/archivos aprobadas; consultar la PR
de esta continuación para CI y publicación. No se ejecutó contra Storage
productivo ni se activó una tarea periódica. La copia privada de #331 sigue
siendo la evidencia real disponible. Ver [procedimiento](STORAGE_BACKUP_RUNBOOK.md).

La herramienta y el procedimiento general no contienen datos de producción.
El ensayo real y la activación periódica conservan los pendientes indicados abajo.

1. Autorizar y realizar una restauración real en un destino aislado, o preparar
   una exportación lógica segura. El plan Pro no autoriza recursos adicionales.
2. Comparar migraciones, permisos, usuarios, conteos y saldos; reponer los objetos
   con sus rutas y comprobar sus hashes. Validar el recorrido pertinente sin
   avisos reales ni QA comercial en producción o Preview.
3. Medir RPO/RTO real. Los tiempos sintéticos no representan el volumen real.
4. Definir y automatizar la copia periódica de Storage, destino y retención.
   La copia puntual ya completada no sustituye ese proceso.

En esta revisión no se crearon proyectos, contrataron extras, restauraron bases
ni modificaron datos comerciales. El cierre integral de recuperación sigue
pendiente de la prueba real y la periodicidad de archivos.
