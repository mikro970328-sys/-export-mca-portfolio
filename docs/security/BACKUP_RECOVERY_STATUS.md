# Estado de respaldo y recuperación

Corte: 2026-09-17 UTC. La confirmación de Pro sustituye el límite Free del corte
anterior. El ensayo aislado y una restauración productiva son evidencias distintas.

## Confirmado en la cuenta

- Daniel comunicó que contrató Pro. La consulta autenticada de la organización
  Export MCA Tracking, swtsszwnkpzcpuzenlps, devuelve plan pro.
- Proyecto qflncyhdspuvtrxsqgbj ACTIVE_HEALTHY; PostgreSQL 17.6.1.147.
- Inventario de solo lectura, 2026-09-17 02:16–02:18 UTC:
  erp-documents privado: 2 objetos / 510171 bytes.
  publication-images público: 1 objeto / 164256 bytes.
  Total: 3 objetos / 674427 bytes.
- Hay 2 documentos activos; ambos enlazan a objetos de Storage. No se encontraron
  documentos activos sin objeto. Esto comprueba referencias, no bytes ni backups.
- Pro incluye backups diarios de base con acceso a siete días. No incluye
  el contenido de Storage: necesita copia independiente.
  https://supabase.com/docs/guides/platform/backups

## Acceso al inventario administrado

La sesión nueva del panel volvió a mostrar login. El formulario seguro recibió
la elección ChatGPT. La página de autenticación mostró una verificación humana
de Cloudflare. No se intentó completarla sin autorización y no se cambió el
método elegido por el usuario. Por ello aún no se acredita fecha, tamaño ni
estado de una copia administrada concreta. Pro activo no sustituye esa prueba.

Panel de destino:
https://supabase.com/dashboard/project/qflncyhdspuvtrxsqgbj/database/backups/scheduled

## Ensayo de recuperación aislado — PR #330

El nuevo workflow Backup Restoration Drill usa dos PostgreSQL 17.6 desechables.
Carga el slice canónico de compras, ventas, inventario, logística, finanzas,
usuarios y documentos con fixtures sintéticos. Exporta pg_dump nativo y roles
sin contraseñas de PostgreSQL; los archivos se copian por separado.

El ensayo valida hashes/tamaños antes de restaurar y rechaza una copia corrupta
o incompleta. Cambia y apaga la fuente; recupera a partir del archivo guardado en
el segundo servicio vacío. Compara datos, secuencias, esquema, funciones,
restricciones, índices, RLS, permisos, vistas, triggers y roles. Comprueba saldos,
verificadores de acceso de tres operadores, bytes documentales, identidad de
reintento y una nueva operación válida. El workflow no publica dumps ni objetos.

Resultado definitivo de CI y head exacto: ver PR #330.
Esto ensaya la técnica con datos sintéticos. No restaura un backup real de
Supabase ni certifica todo su esquema administrado, roles internos, Storage,
configuración externa, secretos de Vercel, JWT, Twilio o ShipsGo.

## Siguiente cierre operativo

1. Desbloquear el acceso seguro al panel y registrar una copia real completada:
   fecha UTC, retención, tipo y versión de PostgreSQL. No restaurar producción.
2. Copiar los tres objetos a un destino privado durable independiente del
   proyecto. Conservar bucket, key, tamaño y SHA-256 en un inventario privado.
   Copiar todas las versiones necesarias y comprobar la lectura de cada copia.
3. Definir una copia periódica y su retención. Una descarga puntual no constituye
   un proceso automático. No usar el propio proyecto como único destino.
4. Obtener una exportación segura de la base o preparar una restauración
   administrada en un destino aislado. Pro no autoriza add-ons ni un segundo
   proyecto de pago; concretar cualquier costo adicional antes de contratar.
5. Ensayar con la copia real, cotejar migraciones, usuarios/permisos, conteos,
   saldos, hashes de archivos y recorrido comercial. Medir RPO/RTO real.
   La prueba sintética no proporciona un RTO productivo.

No colocar datos comerciales ni secretos en el repositorio público o artifacts
de Actions. No pedir connection strings, tokens ni contraseñas por chat. No usar
el SQL de fixtures ni este workflow sobre producción o Preview.

## Límite de cierre

Pro verificado; inventario de Storage y referencias comprobados. Pendientes:
copia administrada concreta, copia durable de objetos y restauración real
aislada. No declarar el ERP completamente certificado por el cambio de plan.

En esta revisión no se contrataron extras, crearon proyectos facturables,
enviaron notificaciones reales ni alteraron datos comerciales.
