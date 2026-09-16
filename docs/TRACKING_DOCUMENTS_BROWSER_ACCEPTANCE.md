# Aceptación de documentos en Tracking

Rama test/tracking-documents-browser, base ef0369fc1711868b3a16d7ddc0b8597953cd642e.
Nueva suite tracking-documents en Chromium escritorio y WebKit emulado.

Dos usuarios con login real, permisos P3 reales, handlers originales y PostgreSQL/
PostgREST desechables. Storage es un sustituto explícito HTTP en memoria, con
URLs temporales locales, multipart y bytes de archivo; no certifica Supabase
Storage real. Se impide tráfico exterior y no se envían mensajes.

Seis checkpoints (incluida concurrencia SQL): lector sin mutaciones; Packing List visible por segundo
usuario y readiness parcial; Commercial Invoice completa readiness y descarga
con bytes exactos; pérdida de respuesta después de finalizar recupera versión sin
duplicar; pérdida de respuesta después de DELETE recupera retiro sin repetir.
Se verifican SQL, historial de versiones y la siguiente lectura del otro usuario.
No se afirma sincronización automática con el modal del lector ya abierto.

La pérdida de respuesta se produce cerrando la conexión del servidor local después
de ejecutar el handler real; no se fabrica una respuesta de negocio. El servicio
de almacenamiento simulado se limita a la nueva suite. El servidor compartido
solo añade el handler documental y un hook optativo para ese servicio local.

CI pasa de 12 a 14 jobs. La PR registra fallos, correcciones y head final; no
anticipar aceptación hasta resultados. La prueba detectó duplicación ante reenvío: se corrige la función de registro
con una migración y se conserva el estado histórico en el payload de la API.
No se cambian permisos, dependencias ni datos de negocio existentes. Estado marítimo y entrega de
notificaciones quedan para otra matriz; este caso cierra documentación en Tracking.

## Primer CI

Run 35043099136: Chromium llegó a cargar/leer el primer archivo y falló
por una expectativa incorrecta de readiness: la fixture sin salida tenía estado
not_required. La fixture ahora tiene departure_date, según la regla SQL canónica.
Se completan columnas legacy de importadores/clientes requeridas por sus APIs
para eliminar errores de preparación; se añade aserción de cero respuestas 5xx.
No se cambian reglas productivas ni se relajan aserciones de negocio.

WebKit intentó pulsar la fila de tabla oculta en el layout móvil. El selector
exige ahora la representación visible (fila o tarjeta), sin force click.

## Sincronización de navegador

Run 35043427501 Chromium aprobó los cinco checkpoints; captura y JSON examinados,
sin errores JS/5xx/tráfico externo. Run 35043500343 WebKit llegó a DOC-04 pero el
helper aceptó el mensaje de éxito anterior antes del evento change del archivo.
Ahora exige también el nombre único del archivo recién cargado en el detalle.
La misma ejecución encontró COM-01 WebKit con total 0 en vez de 250. Se revisó
el artefacto 10426580321; se espera el foco programado del modal y se comprueban
cantidad, pallets, precio y total calculado antes de guardar. Se conserva la
aserción del total guardado; no se reintenta ciegamente ni se cambia producción.

Run 35043841444 volvió a dar dropped=0 en WebKit aunque el archivo nuevo ya era
visible: la espera de UI no resolvía la interceptación de tráfico del service
worker. Se mueve la inyección al res.end del servidor de pruebas: el handler
real ya produjo su JSON tras commit, pero se destruye la conexión sin entregarlo.
Se comprueba exactamente un corte por acción; no se desactiva el service worker.

## Defecto real encontrado y corrección

Run 35044054900: WebKit pasó; Chromium creó tres versiones (v1,v2,v3) al cortar
la conexión tras commit, con v2/v3 referidas al mismo storage_path. La interfaz
no repite POST explícitamente; el transporte puede reenviarlo antes de informar
el error. La aserción de dos versiones se conserva, no se relaja.

Migración 20260916012951_customs_document_upload_idempotency.sql, creada con CLI
2.117.0: reutiliza el bloqueo de shipment existente y devuelve ID/versión del
objeto ya registrado antes de incrementar versión o sustituir otra. Rechaza
metadata incompatible o archivo borrado. Una repetición histórica no altera la
versión vigente. Se conservan firma y permisos service_role; no modifica filas
históricas ni elimina duplicados existentes. La API conserva el estado histórico
del registro devuelto. Auditoría de intentos de la API puede registrar reenvíos;
no se promete deduplicar esos intentos, solo documentos/versiones.

Prueba local check-document-upload-idempotency.mjs: reenvío, historial, conflicto
de tipo/nombre, archivo eliminado y privilegios. DOC-06 usa conexiones PostgreSQL
independientes para dos registros simultáneos del mismo objeto. El changelog y
[guía de funciones Supabase](https://supabase.com/docs/guides/database/functions)
se revisaron; sin cambio relevante de API para esta corrección.

Antes de producción: CI exacto, Preview y advisors; aplicar función compatible
y verificar definición/permisos sin escrituras QA. Rollback restauraría la
función anterior y reabriría el riesgo, no requiere reverso de datos.
