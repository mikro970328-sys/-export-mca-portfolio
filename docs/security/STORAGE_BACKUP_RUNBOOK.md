# Copia verificable de Storage y ensayo real de recuperación

Preparación: 2026-09-17. Owner operativo: `scripts/storage-backup.mjs`.
Este cambio prepara la copia repetible; no activa una tarea periódica ni crea
un proyecto. El ensayo sintético de PostgreSQL sigue en `check-backup-restore.mjs`.

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

La herramienta aún no se ejecutó contra Storage productivo. La copia manual
verificada en PR #331 conserva su formato propio; no se afirma que este nuevo
verificador pueda abrir aquel ZIP directamente.

## Activación periódica pendiente

Propuesta operativa para revisar: una copia diaria en un destino privado
independiente del proyecto de Supabase; conservación de 30 copias diarias y 12
mensuales. Hace falta confirmar el destino, configurar el ejecutor privado y
sus credenciales existentes, y acordar retención antes de activar la tarea.
El código no incorpora todavía esa agenda ni borrados por antigüedad.

El resultado exitoso debe incluir: inventario estable, verificación offline,
confirmación de persistencia en el destino y fecha de la última copia válida.
Un fallo debe conservar el respaldo anterior y avisar al operador por el canal
interno que se configure; no enviar avisos a clientes. El destino y la alerta
se consideran pendientes hasta probar una ejecución real.

## Ensayo de base real: acción preparada, sin ejecutar

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

Guardar el preflight y los resultados reales en un destino privado. La
restauración real, el RPO/RTO real y la periodicidad siguen sin certificar.

Fuentes oficiales consultadas:
- [StorageFileApi: paginación y descarga](https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts).
- [StorageBucketApi: configuración de buckets](https://github.com/supabase/storage-js/blob/master/src/packages/StorageBucketApi.ts).
- [Backups y bytes de Storage](https://supabase.com/docs/guides/platform/backups).
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project).
- [Cómputo por hora](https://supabase.com/docs/guides/platform/manage-your-usage/compute).
- [Eliminación y restricción de pausa](https://supabase.com/docs/guides/platform/delete-project).
