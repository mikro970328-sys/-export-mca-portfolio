# Usuarios y acceso / Mi cuenta · Figma a código

Daniel pidió terminar el ERP de escritorio y avisarle antes de pasar al iPhone físico. Este bloque forma parte de ese cierre; no termina por sí solo el alcance pendiente.

## Diseño y correspondencia

Archivo `aq38kVEYDEmmNlUOAOvfYg`, página Screens `5:4`; guía `127:2`, estado `127:4`. Trece vistas revisadas con contexto de diseño, Inter, variables y componentes compartidos. Incluye el catálogo existente de 29 permisos, sin crear permisos nuevos.

| Vista | Nodo |
| --- | --- |
| Usuarios | 126:3522 |
| Roles y permisos | 126:3819 |
| Equipos | 126:4090 |
| Nuevo usuario | 126:4363 |
| Editar usuario | 126:4418 |
| Contraseña de usuario | 126:4467 |
| Nuevo rol | 126:4487 |
| Rol de sistema | 126:4713 |
| Nuevo equipo | 126:4944 |
| Editar equipo | 126:4980 |
| Desactivar acceso | 126:5017 |
| Mi cuenta | 126:5032 |
| Revocar sesiones | 126:5310 |

## Implementación

Los owners son `access-control-administration.js` / `access-control.css` y `account-administration.js` / `account-administration.css`. Cabeceras, cuatro métricas por módulo, directorios, campos, estados y diálogos usan el sistema blanco de Figma. Los directorios se reorganizan en tarjetas cuando el espacio se reduce. Los formularios y diálogos desplazan completos y se montan en el cuerpo para evitar recortes de la sección.

Usuarios, roles y equipos mantienen búsqueda, filtros, todos los controles de creación/edición/estado, selección de rol y membresías. Se asocian las etiquetas a sus campos, se añade navegación por flechas/Inicio/Fin en pestañas y se recupera el foco al limpiar o cerrar. Una respuesta tardía de otra pestaña no reemplaza el directorio activo. Las acciones se deduplican durante el guardado.

Mi cuenta conserva perfil, permisos, equipos, actividad, tres campos de contraseña con controles Mostrar/Ocultar y guía de requisitos. Se corrige el uso de `event.currentTarget` después del `await`: el formulario se conserva antes de iniciar la petición para poder limpiarlo al completar una rotación exitosa. La revocación conserva usuario, motivo, confirmación explícita, renovación de token cuando corresponde y feedback de errores.

No se modifican APIs, SQL, permisos efectivos, validaciones de negocio, payloads, protección del rol maestro, roles de sistema ni auditoría. No hay escrituras de QA en producción ni Preview, ni pruebas físicas en iPhone.

## Verificación

- Gates locales de acceso, cuenta, feedback, propiedad, shell, navegación e integraciones correctos.
- Fixture con owners reales, cuentas ficticias, API en memoria permitida por ruta y CSP sin red.
- 22 pruebas por motor: directorios a 1440/980/390 px; formularios a 1440×700 y 390×500; alta, edición, contraseñas, plantillas y 29 permisos, membresías, estados, master/sistema, acceso limitado, errores y reintento, foco, doble activación y respuestas tardías.
- El nuevo flujo de contraseña comprueba limpieza del formulario y renovación de token tras éxito. La revocación comprueba confirmación, cancelación, error retenido y renovación de la sesión propia.
- CI y capturas pendientes de verificar sobre el head exacto antes de publicar.

## Publicación anterior y continuación

Tareas y Trabajadores: PR #354, main `1527d4af094c97179e4d696037e7d6e65ce73e11`, deployment `dpl_71heePGGFim5KypdWXhKKttFtRo2` READY. Head verificado `4c69c54e4d3748dbdfb9b8da62aeff22a4d5c80b`; 38 workflows y 22 trabajos correctos; 99/99 pruebas visuales por motor en CI `36224011949`. Seis archivos de producción idénticos por GET; endpoints sin sesión responden 401. Guía Figma `124:5` / estado `124:7` publicada.

Después de este bloque: Inicio, alertas, notificaciones, Publicaciones y configuración/supervisión de workflow; revisión integrada del escritorio. Resolver el contenido relacionado asíncrono de Compras que inserta enlaces sobre las acciones del detalle. Avisar a Daniel cuando todo el escritorio esté cerrado, antes de iniciar iPhone físico.
