# Gastos: implementación del diseño blanco de Figma

Fuente: archivo `aq38kVEYDEmmNlUOAOvfYg`, página `03 · Pantallas`.

| Vista | Nodo |
| --- | --- |
| Gastos / Escritorio | `37:261` |
| Gastos / Celular | `37:494` |
| Editar gasto / Formulario | `37:576` |
| Editar gasto / Celular | `39:487` |

La implementación usa el contexto y las capturas de estas cuatro vistas. Sigue los tokens compartidos de Inter, fondo blanco, texto carbón y acción naranja; conserva los propietarios `costs.html`, `costs.css` y `costs.js`.

La lista presenta tabla en escritorio y tarjetas en pantallas pequeñas. En móvil, las cuatro vistas financieras forman una cuadrícula de dos columnas. Editar queda visible y el menú Más conserva Detalle, Contabilizar y Anular según las capacidades del backend. El detalle conserva todas las distribuciones, sus notas y las notas del gasto.

El formulario usa campos de una columna en móvil, notas multilínea, vista previa del importe y de la distribución, controles de al menos 44 px y desplazamiento de todo el diálogo con `dvh` y área segura inferior. La vista previa solo suma lo escrito; no calcula reconocimiento, rentabilidad ni conversiones de moneda.

Los tipos de destino y las etapas siguen los valores existentes de la API. Crear usa `create`, editar borrador usa `replace` y corregir un contabilizado usa `revise_posted`. No se modifican API, migraciones, registros financieros ni permisos.

Validación: gates de propiedad frontend y UX6/UX7; fixture aislado con el propietario real; pruebas de navegador `figma-costs.spec.mjs` en Chromium y WebKit, con pantallas de 390×500 y 1440×700. Se comprueban búsqueda, monedas, acciones por permiso, cierre, validación, errores, distribución, creación, edición y corrección. Los guardados del fixture se interceptan en memoria y no salen a la red. WebKit móvil no sustituye una comprobación en iPhone físico.

## Continuación integrada — 2026-09-25

`costs-shell.spec.mjs` añade siete pasos al recorrido de aceptación existente:
entrada PWA y login de dos operadores, navegación a Gastos, corrección de un
contabilizado con historial/auditoría, actualización entre sesiones, creación y
edición de borrador, retirada de escritura, recarga y revocación de sesión.
El formulario se comprueba dentro del iframe real, bajo la cabecera del ERP,
con altura de pantalla de 500 px y el botón Guardar completamente visible.

Se ejecutan los handlers originales y PostgreSQL/PostgREST desechables. Los
guardados atraviesan la API y se contrastan con SQL; no se sustituyen respuestas
ni autenticación. El servidor QA sirve también la fuente Inter local para que
las capturas integradas conserven la tipografía de Figma. La migración ya
publicada de corrección contabilizada se carga únicamente en la base QA vacía.

El recorrido espera el evento real de fin de arranque antes de navegar; abrir
el menú mientras siguen llegando módulos se comprueba por separado en
`navigation-startup.spec.mjs`, con recursos deliberadamente retrasados.

La matriz CI ejecuta este recorrido en Chromium y WebKit móvil. Consultar los
resultados del commit en PR #347 antes de declararlo aprobado. No valida sesión
productiva, Safari en iPhone físico, teclado real ni notificaciones push.
