# A-01 · Diagnósticos almacenados e indirectos

Fecha: 2026-09-16. PR #326. Base: a1eb04af312084423d05a762bf3fc871cf0ce0e0.

## Defecto y alcance

La inspección de respuestas directas no sigue los datos devueltos por helpers ni
campos previamente almacenados. Los owners de Clientes, Contenedores, Historial
y exportación CSV devolvían textos de transporte/proveedor en esos campos.

La prueba nueva ejecuta los handlers originales con datos ficticios, transporte,
capabilities y autorización sustituidos. Bloquea fetch; no usa credenciales,
base real ni destinatarios reales. El commit de prueba anterior al runtime,
c42fc2e6d0d9df56436886ee485eae978ec1f4f2, produjo 21 fallos y 7 controles correctos.
Evidencia: https://github.com/mikro970328-sys/-export-mca-portfolio/actions/runs/35157272204
(job 104999592680).

## Corrección

- Proyección explícita de campos diagnósticos al construir las respuestas
  afectadas; no se cambia el serializador JSON global.
- Los diagnósticos siguen almacenados para investigación. Se conservan nulos,
  vacíos y mensajes de configuración conocidos por igualdad exacta.
- Historial de fallo manual: conserva transición y actor; sustituye únicamente
  el sufijo de error. Los eventos de negocio/success conservan sus detalles.
- El CSV mantiene columnas, estado e identificador del proveedor.
- Fallar WhatsApp no revierte la liberación. Se conservan los claims existentes,
  incluido el caso en que el proveedor acepta y falla la persistencia posterior.
- En Contenedores, validaciones conocidas 400 y bloqueo por Cargue 409; errores
  desconocidos 500/503 con un mensaje constante.

Owners: api/_lib.js (funciones puras de presentación explícita), api/clients.js,
api/shipments.js, api/history.js, api/export.js. Sin DDL, nuevo transporte,
reintento automático, limpieza de historial ni cambio de autorización.

## Verificación

Corrección dirigida: c5411599f559b3dcba249b4d524b2f0185ca1af1.
https://github.com/mikro970328-sys/-export-mca-portfolio/actions/runs/35157428002
(job 105000083080).

| Aceptación | Resultado |
| --- | --- |
| Listados/altas/ediciones y fallback; historial; acciones de alertas; CSV; errores/permisos | 28/28 |
| Errores públicos directos anteriores, 19 handlers | 97/97 |
| Claims tras aceptación/rechazo, reintentos cruzados y hitos | 7/7 |

El workflow B9 incorpora la aceptación nueva. CI completo, Preview y producción
del head definitivo se registran en PR #326. Este ensayo no certifica todos los
posibles campos de todas las APIs, la entrega real por WhatsApp ni restauración.

## Continuación

A-02: probar pérdida de confirmación de recepción manual con base desechable
antes de afirmar pérdida/duplicación; revisar header/items y compensación DELETE.
Backups: comprobar disponibilidad/retención y recuperación sin restaurar producción.
iPhone/BrowserStack/push físico siguen diferidos por el usuario.
