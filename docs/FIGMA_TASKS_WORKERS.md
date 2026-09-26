# Tareas y Trabajadores · Figma a código

Daniel pidió continuar hasta terminar el ERP de escritorio y avisarle antes de pasar al iPhone físico. Este bloque continúa esa entrega; no cierra por sí solo el ERP.

## Diseño

Archivo `aq38kVEYDEmmNlUOAOvfYg`, página Screens `5:4`. Guía `124:5`, estado `124:7`. Reutiliza tokens, Inter, botones, campos, celdas y checkbox del sistema. Task row `113:262` y Directory row `113:241` conservan datos y acciones por permiso.

| Vista | Nodo |
| --- | --- |
| Mis tareas | 119:3262 |
| Nueva tarea | 119:3557 |
| Detalle e historial de tarea | 119:3621 |
| Bloquear tarea | 119:3687 |
| Dependencias | 119:3705 |
| Trabajadores | 119:3730 |
| Nuevo trabajador | 119:3998 |
| Historial de trabajador | 119:4031 |
| Desactivar trabajador | 119:4046 |

## Implementación

Los owners siguen siendo `tasks-workspace.js/css` y `workers-module.js/css`. Las cabeceras, métricas, búsqueda, listas, formularios y diálogos usan el sistema revisado. El estado de sincronización permanece accesible. Tareas conserva cinco métricas interactivas; Trabajadores mantiene las cuatro existentes, incluida la cantidad de activos sin cargo.

Tareas mantiene filtros de estado, prioridad, equipo y responsable. El foco sobre una métrica persiste al renderizarla; Limpiar lleva el foco a búsqueda. Los formularios enfocan su primer campo al abrir; los detalles enfocan Cerrar. Los diálogos desplazan completos en ventanas bajas, sin pie fijo que tape campos. Se respeta la validación requerida del título antes de crear o editar.

Trabajadores muestra nombre, fecha, cargo, teléfono, estado y acciones. En ventanas estrechas la fila se reorganiza en tarjeta. Las pestañas conservan flechas, Inicio y Fin. Sus diálogos se montan directamente en el cuerpo para que la animación de la sección no los recorte; eventos, Escape, Tab y regreso del foco siguen en el owner.

No cambian APIs, SQL, payloads, permisos, capabilities, reglas de transición ni historial. Cancelar y bloquear tareas conservan el motivo; dependencias restringidas permanecen privadas. Los trabajadores se desactivan o reactivan con su historial, sin borrarlos.

## Verificación

- Contratos locales de owners, tareas, capacidades relacionadas, handoffs, formularios, navegación, shell y límites de integración correctos.
- Smoke DOM con los owners reales: dos filas iniciales por módulo, diálogos montados en el cuerpo, sin errores de ejecución.
- 16 pruebas por motor (32 registradas): filtros y teclado, edición, alta, validaciones, asignación por equipo, error y reintento, motivos, comentarios, dependencias, historial, desactivación/reactivación, acceso de consulta y recuperación de lectura.
- Ventanas de 1440 y 390 px; formularios de 700 y 500 px de alto, comprobando que los campos reciben el puntero y no hay desbordamiento del documento.
- Fixtures en memoria, datos ficticios y CSP sin red. No se escriben datos QA en producción ni Preview. La CI y las capturas del head final deben verificarse antes de publicar.

## Continuidad

PR #353 de Clientes y Proveedores está publicado en `735ccd339821134ad376719b5c7e3d4f54a72da1`, deployment `dpl_CNN1dv7q8C75uFJmN5PGw5nmxVCw` READY. CI `36222871322`: 43/43 workflows, 22/22 jobs, 83/83 pruebas visuales por motor. Diez archivos exactos por GET; APIs sin sesión 401. Revisadas las capturas de directorios y formularios bajos.

Después: accesos/Mi cuenta, Inicio/alertas/notificaciones, Publicaciones y configuración de workflow. Revisar el contenido relacionado asíncrono de Compras: el bridge anterior inserta enlaces por encima del pie y puede desplazar acciones durante una interacción rápida. La prueba financiera espera ahora su carga visible. Resolver la revisión integrada antes de avisar y comenzar iPhone físico.

La inspección de las primeras 99 capturas comprobadas por motor detectó una regla hover que reducía el contraste de los botones primarios. Se corrigió en ambos propietarios y la prueba de creación exige contraste de texto ≥ 4,5 al pasar el puntero. La búsqueda de trabajadores conserva un botón de una sola línea y el directorio cambia a tarjetas antes de estrecharse dentro del shell.
