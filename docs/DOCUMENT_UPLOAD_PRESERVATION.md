# Conservación de archivos al finalizar documentos

Base main: 2072fb563d04e9c2af48d14e5255869aff63908e (PR #308 publicada).
Rama: fix/preserve-customs-upload.

## Reproducción

Los finalizadores de api/shipment-documents.js y api/documents.js envolvían
escritura, lectura, auditoría y firma de vista previa en un catch que eliminaba
el objeto de storage. Si el commit había ocurrido, el documento permanecía en
BD, pero su archivo desaparecía. Una respuesta perdida del RPC presenta el mismo
riesgo. El test previo falló: finalize/commit_response produjo una eliminación.

## Cambio

Se elimina esa compensación. Los errores siguen propagándose por el handler
canónico; no se afirma éxito tras un error. La carga se conserva incluso cuando
no es posible determinar si hubo commit. Se mantienen permisos, versiones,
validaciones de ruta/tipo/tamaño, historial y la eliminación explícita existente.
No se cambia la UI ni se revive el módulo retirado de Expedientes; se corrige
su API existente porque conservaba el mismo riesgo.

## Pruebas

`node scripts/check-document-upload-preservation.mjs`: 11 escenarios sobre las
funciones reales extraídas, con helpers/transportes sustituidos expresamente.
Ambas: éxito, respuesta de commit perdida, vista previa fallida, auditoría fallida
y respuesta vacía. Documentos Cuba: además fallo en lectura tras registrar.
Se exige cero borrados de storage tras intentar registrar. Sin acceso a red,
base o archivos reales. No es una prueba de transacción real PostgreSQL/storage.
Gate Cuba y 97 comprobaciones de errores públicos también pasan localmente.
Workflow dedicado añade la regresión; PR registra CI exacto y despliegue final.

## Límites y siguiente trabajo

Un fallo antes del commit puede dejar un objeto huérfano: se prefiere conservarlo
hasta poder reconciliar de forma fiable, en vez de borrar un archivo comprometido.
No se añade limpieza automática, idempotencia de carga ni recuperación de archivos
ya perdidos. Tras un error ambiguo debe revisarse el listado antes de repetir la
carga; no se modifica el mensaje existente en esta entrega.
No hay QA comercial en Preview/producción. Certificación física diferida.
Rollback: revertir PR; sin migraciones ni reversos de datos.
