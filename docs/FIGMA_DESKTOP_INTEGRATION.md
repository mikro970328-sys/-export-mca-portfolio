# Cierre integrado del ERP de escritorio · Publicado

Daniel pidió terminar escritorio y avisarle antes del iPhone físico. Este bloque comprueba la composición final después de las migraciones por módulo.

Guía Figma `141:2`, estado `141:4`.

## Compras

Figma `aq38kVEYDEmmNlUOAOvfYg`: detalle con relaciones `138:4515` y cerrado `138:4559`; contextos revisados antes de implementar.

El detalle conserva todos los datos comerciales, físicos, referencias y notas, con la cabecera de 30 px, ancho de 1080 px y tarjetas blancas de Figma. Estados AP traducidos según los enums existentes.

Los bridges operativos y AP insertaban enlaces después de mostrar el detalle, desplazando sus botones. Compras ahora presenta esos enlaces en su owner, dentro de un desplegable con altura estable. Conserva los destinos de proveedor, recepciones, facturas y pagos, usando las mismas consultas de navegación. Los resultados de una compra cerrada o reemplazada se descartan; los fallos ofrecen reintento. Las acciones del detalle están listas de forma síncrona, y los adaptadores de navegación esperan la carga inicial.

Se retira Compras de ambos bridges y se conservan sus adaptadores públicos. No se cambian SQL, API, capacidades, permisos, payloads, cálculos, historial ni cancelaciones. CF-10 ya no espera enlaces para poder pulsar Cancelar compra.

## Shell

El menú lateral usa los 224 px de Figma. El main dentro del shell ocupa el ancho disponible sin margen adicional; cada owner conserva su padding. Los iframes mantienen el alto de viewport bajo la cabecera. No se añade CSS compensatorio global ni observadores de DOM.

## Verificación

- 26 gates locales de owners, navegación, contexto, Compras, trazabilidad, foundation, permisos y shell correctos.
- Composición jsdom de ocho owners reales en el shell original; carrera de respuestas de dos compras comprobada sin escrituras.
- 14 nuevas pruebas por motor (28 enumeradas): ocho pantallas nativas, menú expandido/contraído y ancho 1024/1440; transición nativa/iframe en 1440/390; relaciones lentas, listas largas, posición de Cancelar, respuesta obsoleta, reintento y destino de recepción.
- CI `36248419740`: 44/44 workflows, 22/22 trabajos y 174/174 pruebas visuales por motor, Chromium y WebKit. Capturas finales revisadas. Head `78f8e90a4693aa19142a419b2582a62a9f91d910`, árbol `bbe3cdcfdee19003d6347385db9389f2561eb0fe`.
- PR #358 publicada en `fc038fb9e56cf182df4b46db97af1ed1291d72a6`, Vercel `dpl_D7M6unyM73pSuBxsZxK62yTEq3Xt` READY. Once archivos idénticos por GET; Compras, enlaces operativos/AP y supervisión devuelven 401 sin sesión.
- Fixtures sin red y API en memoria; recorridos comerciales con PostgreSQL/PostgREST desechables. WebKit simulado no certifica el iPhone físico.

## Bloques anteriores

Inicio/comunicaciones: PR #356 publicada en `8642667ba88e121cfb3ae00eb4552164477410c2`, Vercel `dpl_41cHz17WYm3J7bfya4i53tNWepH3` READY. Head `ed2fc49fa5ab2ceb98b014f8eeb3c957cae508e4`, árbol `59cbbe8a125b30bcbba50ec6d649be54265f47cb`, CI `36245976462`: 38 workflows, 22 trabajos y 142/142 visuales por motor. Nueve assets exactos por GET; History e Inbox sin sesión 401; guía 132:2 publicada.

Publicaciones/asignaciones/supervisión: PR #357 publicada en `a1e5d913b826f5536a680d94154ff896b3069e06`, Vercel `dpl_7hVAAF77UFU181XaHMd17Z9P4gvj` READY. CI `36247353321`: 34/34 workflows, 22/22 trabajos y 160/160 visuales por motor; nueve assets exactos por GET. Guía 135:4515 publicada.

No se han enviado mensajes, activado dispositivos ni escrito datos QA en producción o Preview. El escritorio está cerrado; avisar a Daniel antes de pasar al iPhone físico. Estado consolidado: [ERP_DESKTOP_HANDOFF.md](ERP_DESKTOP_HANDOFF.md).
