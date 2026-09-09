# Aceptación de compras, recepción e inventario

Fecha: 2026-09-09. Base: `4081f2d1120816f4179a75697af1ac14b75e8e14` (PR #280).

## Resultado y alcance

27 escenarios aprobados: 19 de PostgreSQL y 8 de los handlers de Compras e Inventario. Es aceptación técnica del recorrido de datos; no certifica todavía el recorrido completo en un navegador, dos operadores diferentes ni iPhone/PWA.

Los ensayos crean una base PGlite desechable, ejecutan 31 migraciones reales sin modificar su contenido y usan proveedores, productos, almacenes, clientes y operaciones ficticios. Cada escenario revierte sus escrituras; las tablas operativas terminan vacías. No se insertaron compras, recepciones ni saldos en Supabase y no se aplicó ninguna migración productiva.

La fixture legacy representa solo las tablas maestras externas necesarias, no todo el esquema productivo. No sustituye las funciones de compras, recepción, inventario, reserva, cancelación ni cuentas por pagar. Las nueve definiciones productivas consultadas en modo lectura coinciden con las cargadas para el ensayo, salvo formato: `set_erp_updated_at`, `create_purchase_order_plan`, `replace_purchase_order_plan`, `receive_purchase_order_lines`, `purchase_order_action_state`, `guard_purchase_order_ap_cancellation`, `cancel_warehouse_receipt_canonical`, `reserve_load`, `release_load`.

El adaptador de API ejecuta los handlers reales con SQL aislado. Simula las fronteras de autenticación/autorización, transporte PostgREST y entrega de auditoría; por tanto, sus pruebas de permisos comprueban qué permiso pide la API y cómo presenta capacidades, no validan JWT ni la matriz productiva completa. PGlite no demuestra concurrencia entre conexiones PostgreSQL independientes. La lista explícita de migraciones debe revisarse al cambiar dependencias; no representa una reproducción completa de ventas, costos o tracking.

## Matriz ejecutada

| Caso | Resultado comprobado | Evidencia |
|---|---|---|
| Crear compra | Compra de 840 cajas/28 pallets conserva total exacto 1000 y costo derivado; no crea stock | PO-01, API-02 |
| Datos y estados inválidos | Cantidad negativa, medidas incompatibles, producto inactivo y transiciones inválidas se rechazan sin escrituras parciales | PO-02, PO-03 |
| Editar borrador | Cambio de producto, proveedor, destino y moneda; error posterior revierte la revisión | PO-04 |
| Editar confirmada | Conserva identidad de línea y costo histórico del WR; impide bajar de lo comprometido o alterar estructura, moneda, proveedor y medida recibida | PO-05, API-02 |
| Recepción parcial | 4 pallets de 10 crean 40 cajas, conservan lote/costo/peso y dejan 60 pendientes | WR-01 |
| Recepción inválida | Línea posterior inválida, otro almacén y mezcla de proveedores no dejan WR, líneas ni asignaciones parciales | WR-02, WR-03 |
| Recepción conjunta | Dos PO del mismo proveedor generan un WR con dos lotes, ambas referencias y 200 cajas | WR-04 |
| Exceso | 120 sobre 100 requieren confirmación, incluso repitiendo una línea; exceso acumulado y recepción completa se reconocen | WR-05, API-04, API-05 |
| Anular WR | Retira stock, reabre cantidad pendiente y conserva enlaces históricos; impide anular dos veces | WR-06 |
| Reserva e inventario | Reserva no cambia existencia física; al liberar vuelve disponibilidad. Cargue activo o historial impiden anular WR | WR-07 |
| Inventario desde API | Dos lotes suman 100; reserva 30 deja 70 disponibles; al anular el lote libre de 60 quedan 40 físicos/10 disponibles | API-08 |
| Direct Ship | No admite WR ni crea stock propio; cancelar libera vínculos sin contenedor; con contenedor vinculado bloquea cancelación | DS-01, DS-02, DS-03 |
| Historia financiera de compra | Factura 150, pago aplicado 40 y saldo 110 se conservan al cancelar la PO; cantidad facturada limita revisión | AP-01 |
| Estado terminal | Compra cerrada o cancelada impide revisiones, recepciones y cancelaciones improcedentes | PO-06, WR-06 |
| Capacidades de API | Sin sesión o solo lectura no ejecuta mutación; distingue permiso de compras del permiso de recepción | API-01, API-03 |
| Errores de entrada | Moneda incompleta, almacén omitido o línea inexistente devuelven 400 con mensaje seguro | API-06, API-07 |
| Fixtures anteriores | Se ejecutan las fixtures SQL UX5 de compras y WR y se verifica residuo cero | `ux5_purchase_order_actions.sql`, `ux5_warehouse_receipt_actions.sql` |

## Defectos reproducidos y corregidos

1. `Boolean(body.allow_over_receipt)` aceptaba el texto `"false"` como autorización de exceso. Antes de la corrección API-05 devolvió 200 y creó el WR de prueba. Solo el booleano JSON `true` autoriza exceso ahora; cadenas, números y objetos reciben 409 y no crean recepción. El frontend vigente ya envía booleanos.
2. Moneda inválida, almacén omitido y línea de compra inexistente devolvían 500 genérico. API-06/API-07 reprodujeron ese resultado. Se traducen los tres errores conocidos a 400 con mensajes seguros; no se expone SQL.
3. La fixture UX5 de compras seguía exigiendo prohibir toda edición confirmada, contradiciendo la revisión protegida publicada en septiembre. Se actualizó para exigir modo protegido y bloqueo de proveedor/moneda. Los escenarios de revisión ejecutan además las protecciones reales.

El único archivo de ejecución productiva modificado es `api/purchases.js`. No hay cambio de esquema, interfaz, assets, sincronización, datos comerciales ni autenticación.

## Reproducción y continuidad

Desde la raíz del repositorio, tras `npm ci --ignore-scripts --no-audit --no-fund`:

```sh
node scripts/check-purchase-inventory-acceptance.mjs
node scripts/check-purchase-inventory-api.mjs
```

Workflow: `.github/workflows/purchase-inventory-acceptance.yml`. No requiere credenciales ni servicios externos.

Pendiente para cerrar el bloque funcional completo: recorrido de formularios y mensajes en navegador con backend QA aislado, dos usuarios reales con roles diferentes, doble envío/concurrencia entre conexiones y certificación móvil/PWA. BrowserStack conserva el bloqueo de cuota ya registrado; no se repitió un ensayo de pago ni se modificó ese control.

Después continúa el siguiente bloque de datos: ventas y logística, incluyendo cargue/despacho, contenedor, tracking y documentos; luego conciliación financiera completa y permisos. No interpretar esta matriz como auditoría integral ni como aceptación del ciclo de despacho Direct Ship.
