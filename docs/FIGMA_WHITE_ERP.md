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


### Estado local de revisión

- `scripts/check-figma-sales.mjs`: 31 comprobaciones DOM aprobadas.
- Navegación y Dashboard: 90 comprobaciones DOM aprobadas.
- Gates de presentación de módulos, acceso, iconos, borradores y propiedad
  frontend: aprobados en el entorno local.
- Pruebas Chromium/WebKit y capturas: preparadas, pendientes de ejecución.
- La revisión automática rechazó la subida a la rama pública incluso después
  de comprobar que es el repositorio conectado a `admin.exportmca.com`.
  Requiere autorización explícita para publicar código en ese repositorio.
- No hay rama remota, PR, despliegue de Preview ni publicación de esta versión.
- `scripts/preview-figma-sales.mjs` genera una demostración privada portable
  de Inicio y Ventas, con estilos y fuente incrustados. Se verifican sus
  documentos anidados, render DOM, apertura del formulario, ausencia de
  recursos externos y guardado desactivado. No sustituye la revisión visual
  en un navegador.
