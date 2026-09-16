# Tracking: conservar el claim después de aceptar un aviso

Corte 2026-09-16; base PR #312. Resultado de CI y despliegue en PR asociada.

## Defecto y cambio

`manual-tracking-event` y `shipments` envolvían envío y persistencia posterior en
el mismo catch. Un PATCH fallido después de recibir SID del proveedor borraba
el claim y registraba falsamente fallo de envío; confirmar otra vez podía duplicar
el WhatsApp. El catch ahora abarca exclusivamente sendWhatsApp. La persistencia
posterior conserva el claim y propaga el error al límite existente del handler.
No se comunica éxito del guardado que falló. Un reintento permitido puede guardar
el estado sin reenviar. El guard de liberación existente sigue vigente; la
corrección de un estado ya liberado se hace por el flujo de tracking.

No se cambian permisos, plantillas, destinatarios, SQL ni reglas de tareas. El
tratamiento de errores lanzados por el propio transporte queda igual: esta
corrección cubre aceptación confirmada seguida de fallo local, no garantiza
exactly-once ante pérdida de respuesta del proveedor ni muerte del proceso.

## Evidencia reproducible

`node scripts/check-tracking-notification-claim.mjs`: handlers originales y helper
original de delivery keys; base de datos/claims y transporte sustituidos por
dobles con estado; autorización/lifecycle sustituidos y guard de liberación
modelado. Toda red bloqueada. No es aceptación integrada de SQL ni de permisos.

Siete escenarios: cuatro combinaciones de endpoint inicial/reintento con fallo
del PATCH posterior, rechazo simulado del proveedor en cada endpoint seguido de
reintento por tracking, y avance/retroceso/reconfirmación de hitos (solo salida y
liberación envían). Se comprueba claim conservado, ausencia de falso registro de
envío fallido y una sola llamada al transporte tras aceptación. La regresión
fallaba antes de separar el catch. También pasan los 97 checks de errores públicos
y el contrato SQL existente de asignación de contenedor a Tracking.

CI incorpora estos checks al workflow Container Tracking Notifications. Sin
mensajes reales ni escrituras de QA en producción o Preview.
