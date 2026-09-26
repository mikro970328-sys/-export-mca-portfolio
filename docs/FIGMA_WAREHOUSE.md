# Recepciones (WR): continuidad de Figma

Entrega del 26 de septiembre de 2026. Continúa Compras #348 (`4c29b2d`) y
Gastos #347 sin reconstruir las operaciones existentes. Daniel autorizó seguir
con implementación, pruebas aisladas y publicación; escritorio prioritario.

## Diseños y correspondencia

Archivo Figma: https://www.figma.com/design/aq38kVEYDEmmNlUOAOvfYg

| Vista, página 03 · Pantallas | Nodo | Owner |
| --- | --- | --- |
| 14 · Recepciones / Escritorio | `74:1029` | warehouse.html / renderReceipts |
| 15 · Recepciones / Celular | `74:1246` | tarjetas bajo 1100 px |
| 16 · Nueva recepción / Escritorio | `74:1343` | receiptModal / addLine |
| 17 · Nueva recepción / Celular | `74:1344` | mismo formulario adaptable |
| 18 · Detalle de recepción / Escritorio | `74:1345` | detailModal / showReceipt |
| 19 · Detalle de recepción / Celular | `74:1346` | mismo detalle adaptable |

Utilidades: `MCA/Receipt row` (`71:70`) y `MCA/Mobile receipt` (`71:91`),
con anulación opcional según capacidades. Se reutilizan MCA/Button, Field,
Textarea, Badge y Data cell, 46 variables en dos colecciones y 7 estilos de
texto Inter. No se añaden variables, modos ni librerías de interfaz.
Las seis composiciones se revisaron visualmente y sin desbordamientos de
contenedores; textos Inter, controles de 44 px y enlaces lista → formulario /
detalle → lista. Los datos de Figma son ficticios.

## Implementación

Owners canónicos: `admin/warehouse.html`, `admin/warehouse.css`,
`admin/warehouse.js`. Presentación blanca, resúmenes numéricos, seis columnas,
mercancía con cantidades, tarjetas compactas, búsqueda y vistas activa/anulada.
Los formularios conservan campos y cálculos; etiqueta asociada a cada input,
foco contenido en el diálogo activo y regreso al control que lo abrió.
El detalle incorpora el estado recibido/anulado y un cierre al pie.

Se conserva el selector por pallets/unidades y el catálogo standalone. En el
ERP integrado, Productos sigue administrado por su owner canónico y no aparece
el creador rápido. Directorio de almacenes y catálogo reciben los tokens blancos
sin cambiar sus operaciones. El ancho real de navegación del ERP se mantiene;
los diálogos se adaptan al viewport del iframe con `dvh` y desplazamiento propio.

Recurso visible: la flecha `24:5`, instancia `I76:1216;24:5`, corresponde al SVG
original ya exportado en `admin/assets/purchase-chevron.svg`, 18 × 18. Se reutiliza
sin edición, con tamaño efectivo 18 × 18 en los selectores. El menú móvil sigue
perteneciendo al shell publicado; no se duplica dentro del iframe.

## Reglas conservadas

- POST `create_receipt`, `registration_request_id`, unidad/cantidad/pallets,
  moneda USD y demás payloads permanecen iguales.
- Guardado atómico, reintento con la misma identidad, bloqueo de doble guardado
  y confirmación conservada si falla el refresco: owners anteriores intactos.
- Anular se muestra solo cuando `capabilities.actions.cancel.allowed === true`;
  requiere escribir ANULAR. Las restricciones de inventario y Cargues siguen
  resueltas por el backend.
- No se modifican API, permisos, migraciones, inventario ni datos comerciales.

## Verificación

Antes de CI: smoke DOM con controlador real (lista, etiquetas, cálculo,
conservación de valores tras error y misma identidad de reintento), sintaxis y
contratos de ownership/versionado. Las verificaciones SQL se ejecutan en CI
con PostgreSQL/PostgREST desechables, no en producción ni en Preview.

`figma-warehouse.spec.mjs` usa datos ficticios y CSP sin red: lista/búsqueda,
anuladas, detalle/foco, campos accesibles, pallets/unidades, recurso SVG,
guardado visible a 390 × 500 y 1440 × 700, conservación tras error, anulación
confirmada, lectura sin escritura y diálogo anidado de catálogo standalone.
`warehouse-recovery.spec.mjs` conserva la recuperación HTTP/SQL real y añade
capturas y geometría de Guardar WR dentro del shell a 500 px de alto.

La PR registra el commit exacto, resultados definitivos, capturas, integración y
despliegue. No inferir resultados de navegador a partir de contratos estáticos.
WebKit simulado no certifica iPhone físico, Safari/PWA ni push; esa prueba sigue
diferida por la autorización vigente.
