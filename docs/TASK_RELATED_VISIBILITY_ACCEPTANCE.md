# Visibilidad de tareas relacionadas

Base: main 3b47f549074ef37cf35f48bb34122c84bd1c25de; rama fix/task-related-visibility.

## Defecto y corrección

El detalle autorizaba la tarea principal, pero consultaba todas las relacionadas
sin visibilityQuery. La prueba aislada antes de corregir devuelve una cuarta tarea
privada que el operador no puede abrir directamente (404).
Se reutiliza visibilityQuery antes del enriquecimiento de entidades. Se devuelve
solo el número de dependencias restringidas para explicar su ausencia en pantalla.
No cambia tasks.manage, tasks.write, pertenencia a equipos ni la base de datos.

## Matriz y evidencia

`node scripts/check-task-related-visibility.mjs`: 12 escenarios API/UI.
Handler real con transporte PostgREST sustituido explícitamente; sin red/datos reales.
- Asignado, creador, miembro de equipo activo; operador sin equipos.
- Gestor y master_admin ven todas las relacionadas.
- Dependencias y dependientes privados no devuelven título/descripción/entidad;
  tampoco se consulta la factura privada para enriquecer su etiqueta.
- Acceso directo privado: 404 y sin lectura de relaciones.
- Error transitorio de equipos o consulta relacionada: 503, sin detalle parcial.
- open_dependency_count conserva 4 aunque el usuario vea menos relaciones.
- Transición sigue delegando al RPC: TASK_OPEN_DEPENDENCIES devuelve 400.
- Cuatro combinaciones de UI: vacía, solo restringidas, mixta y solo visibles.

CI añade el test al workflow UX6 Tasks Feedback y dispara también por api/tasks.js.
Gates de tareas, ownership, acceso y retry ejecutados localmente. Browser Operator
Acceptance es regresión general; no sustituye esta prueba específica de permisos.
Consultar PR para resultados finales, Preview y producción; no se anticipan aquí.

## Límites

No hay QA comercial en Preview/producción. El historial de la tarea autorizada
se conserva, incluidos IDs históricos en details; este cambio protege contenido
de tareas relacionadas, no certifica todos los datos transportados por helpers.
Comentarios de la tarea visible siguen siendo compartidos por sus participantes.
Sin cambios de esquema, nuevas dependencias o certificación de iPhone físico.
Rollback mediante revert de la PR, sin reverso de datos.
