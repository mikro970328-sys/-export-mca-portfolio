# Aceptación de documentos en Tracking

Rama test/tracking-documents-browser, base ef0369fc1711868b3a16d7ddc0b8597953cd642e.
Nueva suite tracking-documents en Chromium escritorio y WebKit emulado.

Dos usuarios con login real, permisos P3 reales, handlers originales y PostgreSQL/
PostgREST desechables. Storage es un sustituto explícito HTTP en memoria, con
URLs temporales locales, multipart y bytes de archivo; no certifica Supabase
Storage real. Se impide tráfico exterior y no se envían mensajes.

Cinco checkpoints: lector sin mutaciones; Packing List visible por segundo
usuario y readiness parcial; Commercial Invoice completa readiness y descarga
con bytes exactos; pérdida de respuesta después de finalizar recupera versión sin
duplicar; pérdida de respuesta después de DELETE recupera retiro sin repetir.
Se verifican SQL, historial de versiones y la siguiente lectura del otro usuario.
No se afirma sincronización automática con el modal del lector ya abierto.

La pérdida de respuesta se produce en el navegador después de ejecutar el handler
real (route.fetch y abort); no se fabrica una respuesta de negocio. El servicio
de almacenamiento simulado se limita a la nueva suite. El servidor compartido
solo añade el handler documental y un hook optativo para ese servicio local.

CI pasa de 12 a 14 jobs. La PR registra fallos, correcciones y head final; no
anticipar aceptación hasta resultados. No se cambian código productivo, esquema,
permisos reales, dependencias ni datos de negocio. Estado marítimo y entrega de
notificaciones quedan para otra matriz; este caso cierra documentación en Tracking.

## Primer CI

Run 35043099136: ambos motores llegaron a cargar/leer el primer archivo y fallaron
por una expectativa incorrecta de readiness: la fixture sin salida tenía estado
not_required. La fixture ahora tiene departure_date, según la regla SQL canónica.
Se completan columnas legacy de importadores/clientes requeridas por sus APIs
para eliminar errores de preparación; se añade aserción de cero respuestas 5xx.
No se cambian reglas productivas ni se relajan aserciones de negocio.
