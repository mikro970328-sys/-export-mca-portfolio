# Recuperación de carga documental

Base: 554c18b71abd2b0e87a10aefb06cac8e8225b727 (PR #309 publicada).
Owner: admin/containers-module.js, uploadCustomsDocument.

Antes, un fallo en refreshAfterCustomsChange mostraba «No se pudo subir el
documento. Intenta nuevamente» aunque la API ya hubiese confirmado el guardado.
La prueba previa reproduce ese mensaje incorrecto.

Ahora se recuerda la confirmación. Ante respuesta ambigua de finalización se
consulta una vez el listado y se compara storage_path, shipment_id, document_type
y ausencia de deleted_at. Nunca se repite finalize_upload ni se descarta storage
tras intentar finalizar. Una versión ya sustituida se informa como histórica.
Si la lectura no confirma el registro, se pide revisar antes de volver a cargar;
no se afirma que no exista. Se conserva el tratamiento anterior de fallo de PUT.

Validación: scripts/check-customs-upload-recovery.mjs ejecuta la función real con
DOM y transportes simulados explícitamente, sin red/negocio real. 11 escenarios:
éxito, refresco fallido tras confirmación, respuesta perdida con registro, sin
registro, lectura fallida, versión histórica, borrada, PUT fallido, distinto
archivo, distinto contenedor y refresco fallido después de recuperar el registro.
También gates Cuba, tracking y presentación. CI general en PR exacta.

No cambia backend, esquema, permisos ni idempotencia. La recuperación depende del
listado (limitado a 200 filas); ausencia no prueba fracaso. No constituye prueba
real de desconexión en navegador ni certificación física de iPhone.
Preview/producción solo se verifican sin escrituras. PR registra publicación.
Rollback: revertir PR, sin reversos de datos.
