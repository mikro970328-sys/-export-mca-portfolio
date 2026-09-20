# Copia verificable de Storage y ensayo real de recuperación

Actualizado: 2026-09-18. Owner local: `scripts/storage-backup.mjs`; owner remoto:
`workers/storage-backup`. La copia periódica en Cloudflare R2 y el ensayo real en
un proyecto temporal ya se ejecutaron. El ensayo sintético de PostgreSQL sigue
en `check-backup-restore.mjs` como evidencia complementaria.

## Uso y alcance

La herramienta enumera únicamente los buckets elegidos, pagina cada carpeta,
descarga los bytes mediante peticiones de lectura y repite el inventario al
terminar. Conserva bucket/key, visibilidad y configuración de bucket, metadatos
de revisión, tamaño y SHA-256 por archivo. Los nombres locales son secuenciales;
los nombres originales nunca se usan como rutas locales.

Rechaza inventarios cambiantes, páginas repetidas, metadatos inválidos, errores
HTTP, redirecciones, tamaño incorrecto y eTag distinto. Cuando el eTag es un MD5
simple de 32 caracteres, verifica además el contenido contra ese MD5. No trata
un eTag multipart como un hash MD5 del archivo completo. Relee todos los bytes
locales antes de escribir `COMPLETE`, que contiene el SHA-256 del manifiesto.
Una carpeta sin ese marcador no es una copia terminada.

Esto detecta cambios observados entre las dos enumeraciones; Storage no ofrece
una transacción conjunta con PostgreSQL. No es un snapshot atómico de la base y
sus archivos, no rescata archivos eliminados antes de la copia ni incluye Auth,
secretos, políticas, Edge Functions o configuración de integraciones. Las
políticas de Storage se recuperan con el esquema y se revisan por separado.

El manifiesto y su hash detectan corrupción accidental, no autentican a un
autor ni cifran datos. La carpeta contiene archivos privados en claro; debe
residir en un destino privado con cifrado y controles de acceso. Permisos
locales: directorio 0700 y archivos 0600. No subirla a Git, Vercel ni artifacts
del repositorio público. El exportador rechaza destinos dentro de un checkout
(también padres resueltos por symlink) y ejecución desde GitHub Actions. No
sobrescribe una carpeta existente y no elimina copias previas.

## Ejecución privada

Node 24, sin paquetes adicionales. Inyectar mediante un almacén seguro del
operador, sin pegar claves en comandos, chat o logs:

- `ERP_BACKUP_PROJECT_REF`: proyecto fuente aprobado.
- `ERP_BACKUP_BUCKETS`: lista explícita de buckets aprobados, separados por coma.
- `SUPABASE_SERVICE_ROLE_KEY`: clave existente del backend, o clave secreta
  equivalente. No usar anon/publishable ni tokens de usuarios: podrían devolver
  solo la parte del inventario visible bajo RLS. No crear una nueva clave por
  ejecutar este procedimiento. No copiar credenciales al repositorio.

El directorio padre privado debe existir. Cada ejecución elige un nombre nuevo:

```sh
node scripts/storage-backup.mjs export /private/erp-backups/2026-09-17T180000Z
node scripts/storage-backup.mjs verify /private/erp-backups/2026-09-17T180000Z
```

`verify` funciona sin red ni credenciales. Devuelve conteos y bytes, no rutas
privadas ni contenido. Rechaza manifiestos alterados, miembros faltantes,
tamaños/hashes distintos y symlinks de archivos. Antes de guardar una copia en
su destino definitivo, verificar también el paquete tras transportarlo.

Si falla la exportación, queda como parcial y no se considera éxito. Conservar
la copia anterior, revisar el código de error y reintentar en una carpeta nueva.
No repetir automáticamente en bucle sobre una fuente cambiante. No activar
limpieza automática de parciales ni de copias históricas en este cambio.

## Pruebas incluidas

`node --test scripts/check-storage-backup.mjs`: servidor HTTP local y archivos
sintéticos. Cubre paginación, carpetas anidadas, Unicode/espacios/porcentajes,
objetos vacíos, bucket vacío, recuperación byte a byte, corrupción, truncamiento,
objetos ausentes, cambio de inventario/visibilidad, redirección sin reenviar la
clave, paths maliciosos, symlinks, carpeta existente y bloqueo de CI público.
El workflow `Storage Backup Verification` no tiene claves ni uploads.

El exportador local aún no se ejecutó contra Storage productivo. El Worker remoto
sí ejecutó y verificó una copia real en R2. La copia manual de PR #331 conserva
su formato propio; no se afirma que el verificador local abra aquel ZIP.

## Activación periódica con Cloudflare R2

El componente `workers/storage-backup` prepara el destino y ejecutor propuestos.
Usa un Worker con Cron Trigger y el binding privado `BACKUPS` hacia
`export-mca-private-backups`. Revisa cada seis horas y crea como máximo una copia
cada 20 horas. Copia únicamente `erp-documents` y `publication-images`, relee
cada objeto desde R2, comprueba tamaño/SHA-256 y escribe `COMPLETE` y
`state/latest.json` al final.

Los fallos crean un aviso interno `integration_failure` solo para administradores
activos con permiso de notificaciones. El aviso pasa a crítico cuando la última
copia válida supera 24 horas. Los endpoints de estado y ejecución manual exigen
un secreto independiente de 32 bytes como mínimo y no devuelven rutas ni hashes.

No se incorporó limpieza automática: el Worker conserva todas las copias y las
ejecuciones parciales. La propuesta de 30 diarias y 12 mensuales necesita una
aprobación explícita antes de eliminar objetos históricos. La activación se
considera completa únicamente después de crear R2, cargar secretos con Wrangler,
desplegar, ejecutar una copia real y comprobar `COMPLETE` desde R2.

### Activación verificada el 2026-09-18

El Worker `export-mca-storage-backup` y el bucket privado
`export-mca-private-backups` están activos con el horario `15 */6 * * *`. La
primera ejecución real terminó a `2026-09-18T21:50:04.207Z`:

- backup `20260918T215004207Z-bebf439d`;
- 2 buckets, 3 objetos y 674427 bytes;
- SHA-256 del manifiesto
  `e4fb06f16d55c7e93c367298ba8a28de3d72fa2976e927204f71c125ab75b129`.

La verificación posterior descargó de R2 `state/latest.json`, el manifiesto,
`COMPLETE` y los tres miembros. Sus tamaños y SHA-256 coincidieron con el
manifiesto. El endpoint autenticado `/health` devolvió `healthy: true` y el
mismo conteo; sin token respondió 404. Los secretos permanecen en Cloudflare y
no se guardaron en el repositorio.

## Ensayo de base real: verificado el 2026-09-18

El procedimiento se ejecutó contra una copia física real en un proyecto aislado.
La base quedó `ACTIVE_HEALTHY` en aproximadamente cinco minutos y se verificaron
75 tablas, esquema, permisos/RLS, funciones, migraciones, Auth y Storage. Después
se repusieron desde R2 los 3 objetos, 674427 bytes, y se descargaron nuevamente:
3/3 tamaños y SHA-256 coincidieron. Las políticas temporales de recuperación se
limitaron a las tres rutas y se eliminaron al terminar.

El RPO observado fue de aproximadamente 10 h 43 min para la base y 28 min para
Storage. El RTO observado fue de unos 5 min para la base y 1 h 32 min para la
recuperación integral manual. El proyecto temporal tenía una cotización de
USD 9.68/mes y se eliminó irreversiblemente el 2026-09-20 con confirmación del
propietario.

### Procedimiento para futuras repeticiones

El operador identifica privadamente proyecto fuente y organización. El destino
es un nuevo proyecto temporal en la misma organización y región, creado mediante
Restore to new project. Registrar sus identificadores únicamente en la evidencia
privada. No cambiar dominios ni variables de Vercel para apuntarlos al destino.

Crear el destino añade costo. Consultar la cotización autenticada y solicitar
la autorización correspondiente antes de iniciar. Como referencia pública,
Micro cuesta USD 0.01344/h, aproximadamente USD 10/mes, redondeando fracciones de
hora. Es solo el cómputo; revisar disco y cualquier otro cargo en la confirmación
final. Un plan Pro existente no equivale a autorización para recursos adicionales.
Los proyectos de pago no se pausan; al terminar hay que planificar su retirada
y confirmar la eliminación irreversible del proyecto temporal identificado.
No prometer una pausa ni gratuidad por un valor $0 mostrado en un diálogo.

Pasos cuando esté autorizado el recurso:

1. Recuperar sesión del panel con el método que el propietario elija en el
   formulario seguro, cuando sea necesario.
2. Elegir la copia física COMPLETED más reciente y registrar su fecha exacta.
   Revalidar la disponibilidad actual; una observación histórica no acredita
   que siga disponible la misma copia.
3. Confirmar costo y destino antes de iniciar. Revisar extensiones con efectos
   externos en el estado de la copia; no ejecutar notificaciones, webhooks ni
   tareas programadas restauradas. Revisar pg_cron, pg_net, http, wrappers y
   demás mecanismos externos. El catálogo actual no demuestra todo el estado
   histórico correspondiente al punto de recuperación.
4. Registrar ref del nuevo proyecto, inicio/fin y resultado de restauración.
   No compartir claves/JWT de producción con una aplicación de pruebas.
5. Verificar catálogo restaurado, tablas, roles/RLS, grants, constraints,
   funciones, usuarios y conteos/saldos. Comparar con el punto de recuperación,
   no exigir que una copia antigua iguale escrituras posteriores de producción.
6. Identificar migraciones posteriores usando el catálogo restaurado y el código
   aprobado; aplicar solo las necesarias en el destino aislado. No asumir que
   los timestamps de los archivos locales son iguales al registro remoto.
7. Reponer únicamente los objetos de Storage del respaldo privado con sus
   bucket/key originales. Revisar bucket público/privado y políticas, cotejar
   tamaño y SHA-256 y comprobar referencias de documentos. Configurar las
   integraciones externas por separado, sin envíos reales.
8. Medir tiempo de recuperación real y antigüedad efectiva de los datos. Guardar
   evidencia privada; al repositorio público solo resultados agregados.
9. Finalizar el uso del proyecto temporal y obtener confirmación de su retirada
   irreversible. Revalidar que el ERP continúa apuntando al proyecto original.

Guardar el preflight y los resultados reales en un destino privado. La ejecución
del 2026-09-18 certifica ese punto concreto; futuras copias requieren su propia
prueba y la retirada de cada destino temporal necesita confirmación explícita.

Fuentes oficiales consultadas:
- [StorageFileApi: paginación y descarga](https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts).
- [StorageBucketApi: configuración de buckets](https://github.com/supabase/storage-js/blob/master/src/packages/StorageBucketApi.ts).
- [Backups y bytes de Storage](https://supabase.com/docs/guides/platform/backups).
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project).
- [Cómputo por hora](https://supabase.com/docs/guides/platform/manage-your-usage/compute).
- [Eliminación y restricción de pausa](https://supabase.com/docs/guides/platform/delete-project).
