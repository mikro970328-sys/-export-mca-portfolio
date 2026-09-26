# Cargues, Tracking y documentos · Figma a código

Daniel pidió terminar el ERP de escritorio y avisarle antes de empezar la validación física de iPhone. Este bloque continúa después de Existencias y Productos, publicados por PR #350 (`6f5b19a54e69eb719cbb0f82994cb5b28a36c6a1`).

## Diseño

Archivo Figma: `aq38kVEYDEmmNlUOAOvfYg`; página Screens `5:4`.

| Vista | Nodo |
| --- | --- |
| Cargues · escritorio | 95:1830 |
| Nuevo cargue · plan por WR | 95:1962 |
| Cargue · detalle operativo | 95:1963 |
| Cargue · asignar contenedor | 95:1964 |
| Tracking · escritorio | 95:1965 |
| Registrar contenedor | 95:2097 |
| Contenedor · documentos Cuba | 95:2229 |
| Contenedor · editar ficha | 95:2230 |
| Contenedor · actualizar seguimiento | 95:2231 |

Guía de continuidad: `101:2` en página Guide `5:2`.

Componentes reutilizables: Load row `93:143`, Container row `93:164`, Document card `93:185` y Load source row `93:205`. Se reutilizan los 46 tokens, siete estilos Inter y controles existentes. El chevron exacto de Figma continúa en `admin/assets/purchase-chevron.svg`; no hay nuevos iconos aproximados ni dependencias visuales.

Se revisaron las nueve vistas. Se corrigió el fondo de los cuatro hitos pendientes y se comprobó de nuevo la captura de Documentos Cuba.

## Implementación

Owners: `loads.html/css/js`, markup estático de registro/Tracking en `index.html`, `containers-module.js/css`, `shipment-editor.js/css`. Fondo blanco, márgenes de 32 px, texto Inter, títulos 30/38, métricas 32/40, controles de 44 px. La tabla de Tracking agrupa sus datos en siete columnas sin perder cliente, importadora, cantidad, fechas, booking, B/L, readiness ni acciones.

Los formularios y diálogos mantienen desplazamiento completo en ventanas bajas. Los campos de cantidades y pallets del plan tienen etiquetas visibles y siguen siendo independientes. Cargues contiene el foco dentro del diálogo activo y restaura el foco al cerrar. Las opciones de seguimiento son radios nativos visibles; su aviso de WhatsApp también se actualiza con teclado.

Se conservan las APIs, payloads, permisos, capacidades, saldos, estados y operaciones de negocio. Registro requiere cuatro letras y siete números; edición conserva referencias provisionales de hasta 40 caracteres. Readiness usa únicamente Packing List Cuba y Factura comercial Cuba vigentes. Se conserva el historial y la recuperación tras respuestas perdidas de carga/eliminación.

## Verificación

- 19 contratos locales aprobados, sintaxis y `git diff --check` limpios.
- Smoke con DOM real: ambos owners arrancan; cuatro cargues, tabla de Tracking con siete columnas, versiones de documentos y etiquetas de campos presentes.
- Diez pruebas de presentación por motor: filtros, detalles, WR, asignación, validaciones, permisos, radio/teclado, errores y recuperación. Se incluyen ventanas 1440×700 y 390×500 y comprobación de que el campo recibe el puntero.
- Fixtures ficticias en memoria con CSP que bloquea la red. No escriben en producción ni Preview.
- Las suites existentes con PostgreSQL/PostgREST desechables siguen comprobando reservas, despacho, documentación/versiones, recuperación, workflow y concurrencia.
- CI y capturas del head final se registrarán en el PR antes de integrar. WebKit simulado no equivale a iPhone físico.

## Pendiente del ERP de escritorio

Después de este bloque: Facturación/cuentas por pagar/Reportes; Clientes/Proveedores/Tareas/administración; revisión integral y publicación final. Avisar a Daniel antes de pasar al iPhone físico.
