# Compras: implementación del diseño de Figma

Fuente: archivo `aq38kVEYDEmmNlUOAOvfYg`, página `03 · Pantallas`.

| Vista | Nodo |
| --- | --- |
| Compras / Escritorio | `56:548` |
| Compras / Celular | `56:666` |
| Nueva compra / Almacén | `56:698` |
| Nueva compra / Direct Ship | `56:699` |
| Nueva compra / Celular | `56:700` |
| Direct Ship / Celular | `56:701` |

Se consultaron contexto y capturas de las seis vistas. Los propietarios siguen
siendo `purchases.html`, `purchases.css` y `purchases.js`, con Inter local, blanco,
texto carbón, bordes neutros y acción naranja. La navegación conserva el ancho
del shell real. La flecha de los selectores es el SVG original exportado de la
instancia visible `I58:769;24:5` (18 × 18), guardado sin modificar en
`admin/assets/purchase-chevron.svg`.

La lista usa seis columnas en escritorio y tarjetas en móvil. Ver y la siguiente
acción permitida quedan visibles; Más reúne Editar, Repetir compra y Cancelar
compra según las capacidades de la API. Los estados comerciales y de recepción
siguen siendo independientes. Se muestra el número de líneas completas: no se
suman unidades de productos diferentes. Los datos ficticios solo existen en QA.

El formulario agrupa proveedor, fechas, destino y mercancía. Almacén y Direct
Ship actualizan el campo canónico de destino, respetan sus bloqueos y preservan
la recuperación del borrador. El total estimado suma únicamente los valores del
formulario, respetando costo unitario o total por línea. El guardado conserva
`create_plan` y `replace_plan`, sus validaciones y el esquema de la API.

Todo el diálogo puede desplazarse, con `dvh`, área segura y controles de 44 px.
La banda funcional de autoguardado conserva la recuperación y usa los mismos
colores y márgenes del formulario. Tab permanece dentro del diálogo activo, Escape cierra el superior y devuelve
el foco al control de origen o a Más. Las versiones del módulo, navegación,
loader y contratos de caché se actualizan juntas; el service worker ya busca
los recursos en red y no almacena HTML/JS comerciales en su caché de respaldo.

Validación local: propietarios frontend, acciones canónicas, UX6/UX7, borradores,
refresco, motor de tareas y navegación; ensayo DOM con los scripts reales para
carga, totales, precio, destino, recuperación y payload. `figma-purchases.spec.mjs`
añade pruebas de búsqueda, filtros, permisos, bloqueos, menú y teclado, cambio de
destino, SVG original, scroll a 390 × 500 y 1440 × 700, validación, error de guardado
y recuperación. El fixture intercepta todas las llamadas en memoria y bloquea red.

Los recorridos comerciales existentes ejercitan las APIs y PostgreSQL/PostgREST
desechables: compra, recepción parcial/exceso, repetición, cancelación y venta
Direct Ship. La compra se guarda dentro del iframe real con pantalla de 500 px
de alto y el botón completamente visible. Resultados de Chromium/WebKit,
integración y despliegue definitivos constan en la PR de esta entrega.

Escritorio sigue siendo prioritario. WebKit simulado no certifica Safari en
iPhone físico, teclado nativo, PWA instalada ni push. BrowserStack físico sigue
diferido por el propietario; la ejecución anterior agotó el tiempo de Automate
antes de conectarse. No se compra tiempo ni se repite esa prueba.
