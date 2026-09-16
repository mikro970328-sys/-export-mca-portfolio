# Estado de respaldo y recuperación

Corte: 2026-09-16. Consulta de configuración y panel autenticado, de solo lectura.

## Confirmado

- Proyecto qflncyhdspuvtrxsqgbj ACTIVE_HEALTHY, PostgreSQL 17.6.1.147.
- Organización Export MCA Tracking, swtsszwnkpzcpuzenlps, plan free.
- El acceso mediante GitHub se completó con browserAuth; el panel del proyecto
  mostró la organización, main Production y Scheduled backups. Ya no está
  bloqueado por falta de inicio de sesión.
- El panel dice expresamente que Free no incluye backups del proyecto; ofrece
  Pro con hasta siete días de copias programadas. No hay inventario de copias
  restaurables accesible en el plan actual. No afirmar que existe una copia.
- URL observada del panel:
  https://supabase.com/dashboard/project/qflncyhdspuvtrxsqgbj/database/backups/scheduled?method=github
- Precio público revisado: Pro desde USD 25/mes, con siete días de backups de
  base. El precio final depende de proyectos, cómputo y consumo.
  https://supabase.com/pricing
- La documentación recomienda exportación externa para free. Los backups de
  base excluyen los objetos de Storage, que necesitan copia independiente.
  https://supabase.com/docs/guides/platform/backups

## Pendiente y decisión necesaria

1. Elegir un destino privado ya disponible para exportar base y archivos, o
   autorizar por separado un plan de respaldo administrado. No contratar planes
   ni add-ons sin presupuesto/autorización. No asumir que Pro cubre Storage.
2. Obtener acceso de exportación por un canal seguro. No pedir contraseñas,
   connection strings ni claves por chat; no colocar datos en el repo público
   ni en artifacts de Actions. No usar la base del ERP como único destino.
3. Crear la copia y documentar fecha, tamaño, integridad y retención.
4. Ensayar en destino aislado: esquema/migraciones, usuarios/permisos, conteos y
   saldos, hashes de archivos y recorrido comercial; medir punto y tiempo
   recuperados sin sustituir producción.

## Límite de la evidencia

No se ha acreditado copia recuperable, última fecha, retención externa de
documentos ni ensayo completo de restauración. La base saludable y las pruebas
de QA no demuestran recuperación ante desastre. La funcionalidad publicada
(#326/#327) y la restaurabilidad son resultados separados.

No se compraron planes, crearon proyectos facturables, exportaron datos
comerciales ni restauró/reemplazó producción durante esta revisión.
