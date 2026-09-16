# Recuperación al retirar documentos

Base main b74b55e189f0511aa5bd7b1020736d226ed2a051, PR #310 publicada.
Owner: deleteCustomsDocument en admin/containers-module.js.
La prueba antes de corregir reproduce que un refresco fallido después de DELETE
confirmado muestra «No se pudo eliminar ... Intenta nuevamente».

Se conserva la confirmación; si la respuesta es ambigua, se consulta una vez el
listado. Solo ID y shipment_id exactos con deleted_at confirman retiro. Ausencia,
versión actual, lectura fallida o documento de otro contenedor no lo confirman.
La recuperación no afirma limpieza física completada: esa operación separada puede
seguir pendiente. Tras una respuesta confirmada se conserva su aviso de limpieza.
Sin DELETE repetido, cambios de permisos/backend/esquema o operaciones reales.

scripts/check-customs-delete-recovery.mjs: 13 casos ejecutan función real con
transportes/DOM de prueba. Éxito, limpieza pendiente, refresco fallido, respuesta
perdida y borrado confirmado, aún vigente, ausente, lectura fallida, otro ID,
otro contenedor, refresco de recuperación fallido, rechazar confirmación, sin
permiso y versión histórica. Regresión de carga, gates Cuba/tracking/presentación.
No equivale a fallo real de red en navegador. CI y despliegue final en PR.
Rollback con revert, sin reverso de datos.
