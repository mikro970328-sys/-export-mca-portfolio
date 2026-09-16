# Estado de respaldo y recuperación

Corte: 2026-09-16. Consulta de configuración de solo lectura.

## Confirmado

- Proyecto qflncyhdspuvtrxsqgbj ACTIVE_HEALTHY, PostgreSQL 17.6.1.147.
- Organización Export MCA Tracking, swtsszwnkpzcpuzenlps: plan free,
  confirmado por get_organization; no se cambió la suscripción.
- El conector disponible no expone inventario de backups. El panel de copias
  redirige a inicio de sesión en este navegador; no se inició restauración.
- La documentación oficial indica copias diarias administradas para planes
  Pro/Team/Enterprise y recomienda exportaciones externas para free:
  https://supabase.com/docs/guides/platform/backups
- Los backups de base no incluyen los archivos de Storage; estos necesitan una
  copia y verificación propia. Revisado también el changelog oficial:
  https://supabase.com/changelog

## No acreditado

No se han acreditado copia recuperable, última fecha, retención, copia externa
de documentos ni ensayo completo de restauración del proyecto. ACTIVE_HEALTHY
y las bases de QA no demuestran recuperación ante desastre.

## Pasos concretos de cierre

1. Consultar el inventario real de copias mediante sesión autorizada del panel
   o Management API con acceso ya provisionado. No enviar claves por chat.
2. Establecer destino privado y retención para exportación de base y objetos de
   Storage, o elegir explícitamente una opción de respaldo administrado.
3. Ensayar en destino aislado: esquema/migraciones, usuarios/permisos, conteos y
   saldos, hashes de documentos y recorrido comercial; medir tiempo y punto
   recuperado. Confirmar que producción permaneció intacta.
4. Registrar fecha/hash/tamaño/retención de la copia y resultado de restauración.

No se compraron add-ons, crearon proyectos facturables, exportaron datos
comerciales ni restauró/reemplazó producción durante esta revisión.
