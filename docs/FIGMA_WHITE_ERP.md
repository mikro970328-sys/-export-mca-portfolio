# Diseño blanco aprobado en Figma

Daniel aprobó la propuesta «EXPORT MCA · Rediseño visual del ERP» el
2026-09-22. Referencia editable:
https://www.figma.com/design/aq38kVEYDEmmNlUOAOvfYg?node-id=14-2

Se consultaron con `get_design_context` las vistas de escritorio (14:2),
celular (14:3) y Nueva venta (14:4) antes de implementar. La adaptación usa
los owners HTML, CSS y JavaScript existentes, sin introducir React ni otra
capa visual. Base de esta rama: `2d8b3de`.

## Aplicación

- Fondo blanco fijo, texto carbón, superficies neutras y naranja de acción
  `#b54708`, incluso con el sistema operativo en modo oscuro.
- Navegación blanca con los grupos, búsqueda, permisos y destinos actuales.
  Se mantiene una anchura de 248 px para los nombres y grupos completos del
  ERP. Los SVG conservan exactamente la geometría utilizada en Figma.
- Cabeceras de los módulos: fondo, título, descripción y tarjetas de resumen
  se adaptan conjuntamente en sus owners para evitar blanco sobre blanco.
- Ventas: resumen compacto, tabla en escritorio y tarjetas en móvil,
  búsqueda, filtros y recuento visible. «Más acciones» conserva Asignar
  mercancía, Editar y Crear Cargue con sus condiciones originales.
- Nueva venta: etiquetas persistentes, notas multilínea, campos agrupados,
  total y acciones al pie. «Calcular usando» utiliza el cálculo existente;
  editar unitario o total sigue seleccionando ese origen automáticamente.
- Inter se sirve localmente. Archivo original de `rsms/inter`,
  `docs/font-files/InterVariable.woff2`, blob Git
  `5a8d3e72ad7ffb62af3b146e1b1f54ab5813a212`; licencia SIL OFL incluida.
- Recursos modificados, loader y caché PWA versionados juntos.

Los importes, clientes y conteos del diseño no se incorporan al producto:
las pantallas mantienen sus fuentes de datos. No cambian APIs, esquema,
reglas comerciales, permisos, reservas, asignaciones ni credenciales.
Los detalles de otros módulos conservan su estructura actual; la renovación
completa de tabla y formulario de esta entrega corresponde a Ventas.

## Verificación y revisión

Los gates de owners, acceso, iconos, borradores y navegación se ejecutan con
datos sintéticos. Las expectativas de tokens y versiones se actualizan al
diseño aprobado sin retirar los contratos funcionales.

`figma-sales.spec.mjs` ejecuta los owners reales con respuestas sintéticas y
red bloqueada: lista, filtros, permisos, acciones, teclado, formulario,
cálculo por precio/total, ausencia de desbordamiento y capturas. Se ejecuta
en CI junto a `header-contrast.spec.mjs` en Chromium de escritorio y WebKit
móvil. Las capturas usan la fuente local, embebida en el fixture.

La solicitud de cambios registra los resultados definitivos de CI y la URL
de Preview. Una Preview usa los servicios comerciales existentes: no crear
operaciones de prueba allí. Las pruebas sintéticas nunca contactan esos
servicios. Esta entrega se prepara para revisión visual antes de publicar.


### Estado publicado — 2026-09-22

- Diseño aprobado de Figma integrado en PR #345 y publicado en producción,
  commit `785e7e8798599392edea97481bd2a06329d2a4ca`.
  Pasaron 57 workflows, incluidos los recorridos aislados de navegador.
- Contraste de las acciones secundarias corregido en cuatro cabeceras;
  contratos funcionales y umbrales de contraste conservados.
- Corrección posterior del detalle móvil y edición de gastos en PR #346,
  commit de producción `86b2c9af7093491473ac5c60f6593985f82bac71`.
  Vercel `dpl_CCpGqjKofVHST5EdC2Ez1enqvfxk` confirmado READY/production.
- El detalle de Ventas desplaza su contenido completo. El módulo Costos
  ofrece Editar cuando el backend permite `revise` y guarda mediante
  `revise_posted`, conservando el historial. Los borradores mantienen `replace`.
- PR #346: 18 workflows aprobados; los 20 jobs de Browser Operator Acceptance
  terminaron correctamente. Las suites visuales aprobaron 18 pruebas cada una
  en Chromium y WebKit, incluidas pantallas de 390×500 y 1440×700,
  acceso al último evento, apertura/cancelación del editor y permisos de lectura.
- Guardado del owner Costos comprobado adicionalmente con DOM y respuestas
  sintéticas: acción de corrección/borrador, importe y asignación preservados;
  edición denegada oculta. No se modificaron registros comerciales reales.
- HTTP 200 y contenido exacto de los archivos desplegados comprobados en
  `admin.exportmca.com`: `sales-workspace.css?v=20260922-scroll1` y
  `costs.js?v=20260922-costedit2`; ambos HTML referencian esas versiones.

### Alcance y comprobación pendiente

La prueba WebKit móvil no equivale a una prueba en el iPhone físico del
propietario. Falta su confirmación del comportamiento con las barras reales
de Safari y el teclado abierto. No declarar ese recorrido físico certificado.

Esta entrega completa la renovación de lista/formulario de Ventas y aplica
la base blanca compartida. No acredita un rediseño completo en Figma de los
formularios específicos de todos los módulos. Sus estructuras actuales y
funciones se conservan.

`scripts/preview-figma-sales.mjs` sigue ofreciendo una demostración portable
con datos ficticios y guardado desactivado. Las pruebas comerciales se hacen
en aislamiento; las Preview conectadas a producción no son bases de prueba.
