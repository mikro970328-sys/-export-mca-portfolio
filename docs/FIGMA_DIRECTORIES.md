# Clientes y Proveedores · Figma a código

Continuidad de escritorio autorizada por Daniel. No iniciar iPhone físico hasta terminar el escritorio y avisarle.

## Diseño revisado

Archivo `aq38kVEYDEmmNlUOAOvfYg`, página Screens `5:4`. Guía `117:5`, estado `117:7`. Se reutilizan los tokens, estilos Inter, botones, campos y celdas del sistema. Directory row `113:241` mantiene los mismos datos y acciones visibles por permiso.

| Vista | Nodo |
| --- | --- |
| Clientes, directorio y alta | 115:3018 |
| Editar cliente | 115:3320 |
| Información del cliente | 115:3373 |
| Proveedores | 115:3410 |
| Nuevo proveedor | 115:3676 |
| Detalle del proveedor | 115:3737 |
| Desactivar proveedor | 115:3773 |

## Implementación

Clientes conserva `index.html` como markup canónico y `clients-module.js/css` como owners. El directorio ocupa todo el ancho y el formulario sigue a la lista. Nuevo cliente desplaza y enfoca el alta existente. El mensaje de alta vive junto al formulario; los mensajes de acciones del directorio conservan su región. Actualizar y Limpiar operan sobre las funciones existentes. La tabla desplaza internamente, las acciones tienen texto visible y las fichas usan campos y tipografía del sistema.

Proveedores conserva `suppliers.html/css/js`. Búsqueda y estados preceden al directorio; las filas muestran identidad, contacto, estado y acciones. Las pestañas responden a flechas, Inicio y Fin. Dirección admite varias líneas conservando el mismo campo del payload. Formularios, detalle y confirmación desplazan completos en ventanas bajas. El foco inicial se aplica al abrir el diálogo sin un temporizador que pueda desplazar una interacción posterior.

No cambian API, SQL, permisos, reglas de alta/edición/eliminación, historial, importadoras ni welcome. La creación del cliente nunca envía bienvenida. La desactivación del proveedor continúa siendo reversible y mantiene sus datos. El acceso de solo consulta conserva únicamente sus acciones permitidas.

## Verificación

- 13 contratos locales de owners, datos, capacidades, caché, borradores, recuperación y navegación correctos.
- Smoke DOM real de ambos owners: dos filas iniciales, sin errores de ejecución.
- 14 pruebas nuevas por motor: búsquedas, importadoras, edición, alta, error/reintento, confirmación, solo consulta, historial, estados por teclado y reintento de lectura. Incluyen ventanas 1440×700 y 390×500 y comprobación de campos visibles que reciben el puntero.
- Fixtures en memoria con datos ficticios y CSP sin red; no se envían mensajes reales ni se escriben datos QA en producción o Preview.
- Publicado mediante PR #353: head `2f11f40e890cfef31861eeb0383a31a029c72ae4`, main `735ccd339821134ad376719b5c7e3d4f54a72da1`, Vercel `dpl_CNN1dv7q8C75uFJmN5PGw5nmxVCw` READY. Run `36222871322`: 43/43 workflows, 22/22 trabajos, 83/83 visuales por motor; 16 capturas por motor y formularios bajos revisados. Diez assets exactos por GET; APIs sin sesión 401. Guía Figma actualizada.

## Siguiente

Tareas, Trabajadores, administración de accesos y Mi cuenta; revisar Inicio, notificaciones, alertas, publicaciones y configuración de workflow. Terminar con la revisión integrada del escritorio y avisar antes de iPhone físico. WebKit simulado no es certificación de iPhone.

Browser review found and corrected the native Clients grid minimum width and the Suppliers header state block at 390px. The Clients draft banner now spans both form columns. Purchases modal focus is synchronous, matching the already verified Costs owner, so delayed focus cannot interrupt an immediately entered value or subsequent action. The repeat-purchase flow now observes its focused field and entered value before closing.

La comprobación de cancelación de Compras espera a que aparezcan los enlaces operativos relacionados: su bridge anterior carga contenido asíncrono por encima de las acciones. Revisar este comportamiento en el cierre integrado. Los contenedores de tablas anclan las etiquetas accesibles para que su posición absoluta no extienda el documento fuera del scroll interno.
