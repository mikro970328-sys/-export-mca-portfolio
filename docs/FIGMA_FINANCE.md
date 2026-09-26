# Finanzas y Reportes · Figma a código

Daniel pidió terminar el ERP de escritorio y avisarle antes de empezar iPhone físico. Continúa después de Logística, publicada por PR #351 en `c15459f61ff19755e5fa0c0f20585eb63bc50b86`.

## Diseño

Archivo Figma `aq38kVEYDEmmNlUOAOvfYg`, Screens `5:4`. Guía `112:5`, estado `112:7`. Las 16 vistas se revisaron con el contexto de diseño; los reportes contienen todas las columnas de la API y desplazan dentro de su región.

| Vista | Nodo |
| --- | --- |
| Facturación | 104:2372 |
| Nuevo borrador | 104:2504 |
| Detalle de factura | 104:2505 |
| Registrar cobro | 104:2506 |
| Nota de crédito | 104:2507 |
| Aplicar saldo | 104:2508 |
| Registrar devolución | 104:2509 |
| Confirmación financiera | 104:2510 |
| Cuentas por pagar: facturas | 104:2511 |
| Nueva factura de proveedor | 104:2643 |
| Cuentas por pagar: pagos | 104:2644 |
| Registrar pago | 104:2776 |
| Aplicar pago | 104:2777 |
| Detalle financiero del proveedor | 104:2778 |
| Reportes: ventas | 104:2779 |
| Reportes: inventario actual | 104:2911 |

Componentes: Finance row `102:188`, Finance line `102:215`, Report row `102:244`. Se reutilizan tokens, Inter, campos y botones del sistema existente. La segunda acción y los campos de costo, total y nota son opcionales según el formulario. Las columnas del reporte tienen anchos suficientes para los nombres; no se eliminan columnas por falta de espacio.

## Implementación

Owners únicos: `invoices.html/css/js`, `payables.html/css/js`, `reports.html/css/js`. Se retiran adornos y contadores decorativos, se conservan los indicadores de actualización accesibles y se ordenan filtros, resultados y acciones. Formularios y confirmaciones desplazan completos en ventanas bajas.

Cantidades/notas de factura y cantidad/costo/total/nota del proveedor tienen etiquetas vinculadas a cada campo. La distribución muestra su etiqueta de monto. Reportes admite flechas, Inicio y Fin en las pestañas y conserva el foco al actualizar resultados.

No cambian APIs, SQL, payloads, permisos, capabilities, idempotencia, cálculo monetario ni reglas financieras. Costo unitario y total exacto continúan siendo fuentes alternativas sincronizadas. Cobros/pagos conservan la misma identidad de solicitud al reintentar. Créditos, aplicaciones, devoluciones y reversos mantienen motivos y efectos existentes. Registrar devolución no ejecuta una transferencia bancaria. Reportes respeta dimensiones, monedas separadas, snapshot actual y CSV autenticado.

## Verificación

- Contratos locales de presentación, ownership, recuperación, capacidades, notas de crédito, reversos y aplicaciones.
- Smoke con DOM real de los tres owners: listados y etiquetas de todos los campos dinámicos.
- 19 pruebas de navegador por motor: listas, detalle, cobro y pago con reintento estable, crédito/aplicación/devolución, precio exacto, distribución, permisos, errores y CSV. Ventanas 1440×700 y 390×500, campo visible y capaz de recibir el puntero.
- Fixtures ficticias en memoria, CSP sin red, columnas de reportes tomadas de la definición oficial de la API local. No prueban la contabilidad del servidor; las suites existentes con PostgreSQL/PostgREST desechables mantienen esa cobertura.
- Sin escrituras QA en producción ni Preview. WebKit simulado no certifica iPhone físico.
- Revisión inicial PR #352, run `36219654228`: 66/69 visuales por motor. Detectó que la regla de grid superaba `hidden` en el formulario de aplicación de saldo; corregido en los owners. La fixture de Reportes ahora respeta `include_options=0` como la API real. Las capturas también motivaron elevar pestañas a 44 px/14 px y marcar la pestaña activa de Reportes con el color del sistema.
- Segunda revisión `a4845743e076573fb5f89580e766ff02182c27c1`, run `36220242532`: 69/69 visuales por motor. El flujo Direct Ship detectó una espera incompleta en su prueba: el detalle cierra antes de terminar la recarga de compras. Se añadió la comprobación del estado comercial visible antes de la siguiente transición.
- PR #352 publicado: head final `2aa9b000909d7a9ea94e8447523c373968516f4e`, tree `94d6466d70d4b75db985309d798850b23bd2d56c`, run `36221102523`: 46/46 workflows, 22/22 trabajos de navegador y 69/69 visuales por motor. Capturas revisadas.
- La repetición de compras ahora observa la selección inicial autorizada de Compras para ambos operadores de prueba, sin competir con la apertura automática del menú.
- Merge `8dcde7411e0bd3357b79a105f62be74a24804234`; Vercel `dpl_H86FkYG4ukPcDZPwpzY47LkuJDVb` READY con ese SHA y alias admin/app. GET de 12 archivos coincide exactamente con el código publicado. APIs invoices/payables/reports responden 401 sin sesión. Guía Figma `112:7` marcada publicada.

## Pendiente

Clientes, Proveedores, Tareas y administración; revisión integrada final del ERP de escritorio. Avisar a Daniel antes de comenzar iPhone físico.
