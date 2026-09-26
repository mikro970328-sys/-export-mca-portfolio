# Publicaciones, asignaciones y supervisión · Figma a código

Continúa el cierre de escritorio autorizado por Daniel. Avisar antes del iPhone físico. No declarar finalizado el ERP hasta la revisión integrada.

## Diseño

Archivo `aq38kVEYDEmmNlUOAOvfYg`, página `5:4`, guía `135:4515`, estado `135:4517`. Seis vistas con componentes, variables e Inter; contexto de diseño revisado antes de implementar.

| Vista | Nodo |
| --- | --- |
| Catálogo de Publicaciones | 133:4203 |
| Nueva publicación | 133:4514 |
| Editar publicación | 133:4627 |
| Eliminar publicación | 133:4752 |
| Asignaciones automáticas | 133:4767 |
| Supervisión de tareas | 133:4889 |

## Comportamiento

Publicaciones usa un catálogo con métricas y búsqueda, editor en diálogo de 1080 px y confirmación de 700 px. Conserva borradores, validaciones, visibilidad, máximo de dos fotografías, compresión y API de almacenamiento. El guardado y las acciones se deduplican; un error mantiene los valores y una eliminación fallida de foto repone la vista. Los controles respetan publications.write, incluyendo el editor de solo lectura.

Asignaciones automáticas conserva rutas, equipos, usuarios elegibles, prioridad y plazo. Guardar una ruta no borra cambios pendientes de otra. Los errores mantienen el borrador; guardar/sincronizar evita solicitudes duplicadas. Se mantienen los payloads de workflow-routes, incluida reconciliación explícita de tareas existentes.

Supervisión mantiene seis métricas, filtros, salud de asignación y apertura de la tarea en su owner. Se puede abrir por teclado y recuperar un destino no disponible. No introduce mutaciones.

Los tres diálogos ofrecen foco inicial inmediato, Tab limitado al diálogo, Escape, retorno de foco y scroll completo. Los fallos técnicos se registran sin exponer diagnóstico privado en la interfaz.

## Verificación

- Gates locales de Publicaciones, foundation, workflow, tareas, borradores, propiedad, integración y shell correctos; flujos jsdom de error/borrador/guardado verificados.
- 18 pruebas nuevas por motor enumeradas (36): 1440/390 px, alturas 700/500; catálogo, validación, fotos, borrador, estados, eliminación confirmada, permisos, elegibilidad, plazos, conservación de otros formularios, deduplicación, supervisión y errores.
- Fixture con owners y runtime reales, API e imágenes en memoria, CSP sin red y datos ficticios. No QA de escritura en producción/Preview ni activación de dispositivos o envío de mensajes.
- Publicado en PR #357: main `a1e5d913b826f5536a680d94154ff896b3069e06`, Vercel `dpl_7hVAAF77UFU181XaHMd17Z9P4gvj` READY. Head probado `d64ae6a132caf3ee57968850f80d5d92a88f1b39`, árbol `a8c325e99397915b68c74f017af90c912c8ea982`; CI `36247353321`: 34/34 workflows, 22/22 trabajos y 160/160 visuales por motor. Capturas revisadas; nueve archivos exactos en producción por GET. Guía 135:4515 publicada.

Sin cambios en API, SQL, permisos, cálculos financieros, auditoría ni reconciliadores de negocio. Después de este bloque: estabilidad de enlaces relacionados en Compras, márgenes del shell nativo y revisión integrada de escritorio.
