# Existencias y Productos: continuidad de Figma

Entrega del 26 de septiembre de 2026. Continúa Recepciones #349 (main
`471fe6441f6a550a743a2d5a060973812cb6c3ab`). Daniel pidió completar el ERP de
escritorio y avisarle antes de pasar a iPhone físico. Ese orden sigue vigente.

## Diseños y correspondencia

Archivo: https://www.figma.com/design/aq38kVEYDEmmNlUOAOvfYg

| Vista en 03 · Pantallas | Nodo | Owner |
| --- | --- | --- |
| 20 · Existencias · Escritorio | `88:1409` | inventory.html / renderInventory |
| 21 · Existencias · Origen WR | `88:1534` | inventoryRow / sourceDesktop |
| 22 · Movimientos · Escritorio | `88:1659` | renderTrace / traceWR |
| 23 · Productos · Escritorio | `88:1784` | products.html / productCard |
| 24 · Producto · Crear y editar | `88:1909` | productModal / productForm |
| 25 · Producto · Detalle | `88:1910` | productDetailModal / openDetails |

Componentes en Utilidades: Stock row `86:93`, Source balance row `86:108`,
Movement row `86:130` y Product row `86:155`. El último permite ocultar edición.
Se reutilizan botones, campos, textarea, badge y celdas; permanecen las 46
variables, dos colecciones y siete estilos Inter. Los datos son ficticios.

Las seis vistas se revisaron visualmente, con anchos consistentes y sin
contenedores desbordados. Se corrigió el destino activo de la navegación.
Se leyó el contexto de diseño antes de implementar. El menú real sigue bajo
su owner y conserva sus medidas; no se crea una navegación dentro del iframe.

## Implementación y reglas conservadas

Owners: inventory.html/css/js y products.html/css/js. La presentación usa blanco,
Inter, números de resumen, tablas legibles y controles de 44 px. Los registros
se adaptan a tarjetas en espacios estrechos. El formulario separa identidad,
unidad/manejo y procedencia, y mantiene todas las etiquetas y campos anteriores.
Los diálogos contienen el foco y las pestañas aceptan flechas, Inicio y Fin.

Existencias sigue siendo de consulta. Físico, reservado y disponible vienen de
la API; la presentación muestra unidades y pallets por separado sin recalcular
el saldo. Se mantienen filtros, expansión por WR, trazabilidad, permisos y
navegación a registros vinculados. Se corrigió el plural «combinaciones».
El indicador y selector reutilizan el SVG Figma original `24:5`, ya guardado en
`admin/assets/purchase-chevron.svg`, 18 × 18, sin modificarlo.

Productos conserva POST de alta, PATCH de edición y set_active, el control
write_access del servidor, validaciones, borradores locales, mensajes seguros
y confirmación de activación/desactivación. No se modifica la API, permisos,
esquema de datos ni cálculos de negocio. Crear una ficha sigue sin generar stock.

## Verificación

Smoke DOM local con los controladores reales: listado, balances, etiquetas y
pertenencia de los 13 campos al formulario. Pasan 19 contratos locales de
ownership, sesión, versiones, borradores y navegación. El test nuevo figura
tanto en testMatch de Playwright como en el comando del workflow.

`figma-stock-catalog.spec.mjs` contiene seis pruebas por motor: consulta y filtros
WR, error/reintento, catálogo y estados, detalle/foco, alta/edición/borrador/error a
1440 × 700 y 390 × 500, y acceso de lectura. Usa registros ficticios, API en
memoria y CSP sin red. Los resultados finales y capturas quedan en la PR.
La integración comercial usa exclusivamente PostgreSQL/PostgREST desechables de CI.
No hay QA comercial en producción ni en Preview, que comparte la base real.
WebKit simulado no certifica Safari/PWA ni iPhone físico.

## Continuidad

Después de publicar: Cargues/Tracking/documentos; Facturación/cuentas por pagar/
Reportes; Clientes/Proveedores/Tareas/administración; revisión integral de
escritorio. Avisar a Daniel al completar ese conjunto antes de iniciar iPhone.
