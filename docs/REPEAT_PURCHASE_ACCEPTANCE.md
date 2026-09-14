# Repetir compra — aceptación

Fecha: 2026-09-14 UTC. Base main: `8e03848a0033c446b9bcec680ab8851f7e99cf49`
(PR #305). Rama: `feat/repeat-purchase`.

## Conducta y owners

`admin/purchases.js` conserva formulario, render y ciclo de vida. Lista/detalle
abren una nueva compra precargada. `api/purchases.js` publica la capacidad repeat
con el permiso existente procurement.write; el guardado utiliza el create_plan
original y sus validaciones. No hay RPC nuevo, migración ni endpoint de clonación.

Se copian proveedor, destino/almacén, moneda, productos, cantidades, pallets,
unidades por pallet, modo/valor del precio y notas. Se eliminan las identidades
de líneas, se usa la fecha local actual y se vacían llegada/referencia. Estado,
recepciones, facturas, pagos y asignaciones no se copian. Preparar/cerrar el
formulario no crea registros; Guardar crea una PO en borrador con nueva identidad.

Se refrescan catálogo y permisos antes de abrir. Los maestros inactivos dejan el
campo vacío con aviso. La API vuelve a autorizar al guardar. La copia tiene clave
de autoguardado por origen, separada de la edición y compra nueva normal; guardar
limpia esa copia y muestra el registro en Borradores.

## Matriz

| Caso | Evidencia |
| --- | --- |
| Compra terminal reutilizable y permiso de Compras separado de recepción | API-09 |
| Precio por total y por unidad, costo cero, fecha actual y referencia vacía | RP-01 |
| Preparar/cerrar no crea PO ni sustituye el borrador normal | RP-01 |
| Nueva identidad/número, líneas independientes y auditoría del operador | RP-02 |
| Recepciones, stock, factura parcial y pago existentes quedan intactos | RP-02, RP-03 |
| Direct Ship cancelado repetible desde detalle, sin WR | RP-03 |
| Borradores por origen, descarte y limpieza tras guardar | RP-04 |
| Catálogo actualizado, maestros inactivos y validación del destino | RP-05 |
| Usuario de lectura sin botón y permiso revocado rechazado al guardar | RP-06, RP-07 |

Regresión previa: API-09 falló en main porque repeat no existía; 8 casos anteriores
aprobaron. Después: 9/9 API y 19/19 SQL sobre 31 migraciones reales, en PGlite
local desechable (autorización/transporte del adaptador simulados explícitamente).

La historia repeat-purchase amplía Browser Operator Acceptance a seis historias
por Chromium escritorio/WebKit móvil. Usa usuarios y datos ficticios, login real,
handlers, HTTP, PostgREST y PostgreSQL locales. Los originales se preparan con RPC
reales como fixtures; todas las repeticiones se hacen por UI. Las capturas y JSON
excluyen credenciales. CI final y Preview se registran en la PR, no se infieren de
la ejecución local ni de esta nota.

## Límites y continuidad

WebKit móvil no certifica Safari/iPhone físico, PWA instalada ni push real.
Daniel indicó que pagará BrowserStack; no confirmó todavía activación/capacidad.
No se reintentan manualmente sesiones por esa intención de pago. Conservar los
workflows existentes y su frontera de lectura en producción.

No QA comercial en producción ni Preview porque comparten base. No mensajes a
clientes ni cambios de roles reales. La auditoría pendiente de errores almacenados
y objetos transportados por helpers se retoma después de esta función solicitada.
