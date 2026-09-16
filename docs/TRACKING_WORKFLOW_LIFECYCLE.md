# Tracking, documentos, tareas y avisos personales

Corte 2026-09-16. Base publicada PR #313. Resultado CI en la PR de esta prueba.

`node scripts/check-tracking-workflow-lifecycle.mjs` ejecuta PostgreSQL embebido
(PGlite) con las migraciones originales P3/P4/P5/P8/P9/P10/B10, la cadena financiera
y documental existente y usuarios de prueba. Los RPC de documentos, tareas,
permisos efectivos, destinatarios, reconciliación e inbox son reales. No se
sustituyen sus funciones por dobles. Las tablas históricas notifications y
webhook_events se toman de schema.sql; provider completa el fixture histórico.
No hay solicitudes HTTP ni transportes de WhatsApp, email o push.

## Dieciséis verificaciones

1. El contenedor que requiere documentos genera una tarea para el responsable.
2. Reconciliar dos veces genera un solo aviso de asignación.
3. Un usuario no puede marcar leído el aviso personal del otro: RPC rechaza.
4. El destinatario sí puede leerlo; deja de contarse como no leído.
5. Un documento no basta; ambos tipos completan la tarea e inactivan el aviso.
6. Eliminar Packing List reabre la misma tarea, sin duplicarla ni duplicar el
   aviso de la misma asignación. Conserva su estado de lectura.
7. Reasignar genera un aviso para el nuevo responsable; el anterior es histórico.
8. Sin documents.write no se es destinatario elegible de la tarea documental.
9. Restaurar permiso y reponer documento completa la tarea; campana sin pendiente.
10. Historial conserva una creación, dos completados y una reapertura.
11. Dependencia pendiente impide completar una tarea; completarla permite continuar.
12. Cambio de tracking avisa al usuario habilitado y respeta exclusión voluntaria.
13. Reactivar la preferencia entrega el evento disponible una sola vez.
14. Salida, llegada, descarga, liberación y entrega generan una identidad por
    evento/destinatario aunque se repita la reconciliación.
15. Revocar logistics.read impide recibir el aviso del siguiente cambio.
16. No se crean entregas externas ni cola push sin suscripciones.

## Límites de esta evidencia

Los cambios de estado marítimo se introducen en SQL como hechos de origen; esta
prueba valida sus avisos, no la autorización ni la corrección del handler que
cambia estados. Las altas/permisos iniciales son setup de fixtures. PGlite usa
una conexión y no acredita carreras entre sesiones. No es un recorrido de UI.

El ciclo documental ya tiene navegador en #312 y las reclamaciones de envío
aceptado cuentan con regresión aislada en #313. Sigue pendiente unir estados,
pantallas de tareas y notificaciones en un recorrido de dos sesiones con HTTP y
PostgreSQL concurrente. Las pruebas físicas de iPhone/push siguen aplazadas.
No se cambia comportamiento de producción ni se aplica migración en este bloque.
