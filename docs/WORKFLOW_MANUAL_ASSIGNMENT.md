# Asignación manual de tareas automáticas

La prueba de dos operadores de PR #315 encontró que actualizar Tracking revertía
una reasignación guardada desde Mis tareas. El owner SQL sync_workflow_task
copiaba siempre el equipo y usuario de workflow_task_routes.

La migración 20260916033448 añade workflow_assignment_manual a operational_tasks.
El RPC update_operational_task lo establece únicamente si cambia el equipo o
usuario de una tarea workflow. Editar título/prioridad no fija la asignación.
El reconciliador conserva ambos campos cuando la marca está activa, al actualizar
y al reabrir la misma tarea. Completar/cancelar y validar dependencias no cambia.
Las tareas sin intervención siguen las rutas, incluidos cambios posteriores.
Se mantienen bloqueo de fila, validación de equipo/usuario y acceso service_role.
No hay handlers, observers ni dueños alternativos. No cambia el contrato HTTP.

La migración marca asignaciones existentes cuando el último cambio manual del
historial coincide con la asignación actual. No restaura decisiones ya perdidas.
Una elección manual nula también se respeta. No se incorpora una acción nueva
para restablecer seguimiento automático de ruta; reasignar sigue disponible.

Validación: check-workflow-manual-assignment.mjs prueba migración sobre datos
anteriores, rutas automáticas, edición sin reasignación, persistencia tras edición,
completar/reabrir con documentos reales, equipo, sin responsable, validación de
miembros, cancelación/reapertura y privilegios. El recorrido de navegador añade
TW-06: después de actualizar Tracking, el responsable manual sigue viendo la
tarea y el anterior no la recupera; no duplica el aviso y no recarga la página.
Base aislada; transporte Storage explícitamente simulado. No envíos externos.

La aprobación exacta de CI, migración remota y despliegue se registran en el PR.
No constituye cierre integral de finanzas, reportes ni aceptación diaria del ERP.
