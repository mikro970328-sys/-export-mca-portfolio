# Proveedores: precisión monetaria y anticipos en Direct Ship

Base publicada PR #320, b827176978ccb834acbdd97da9d916155cfe4da0. Esta continuación cierra
las variantes de facturas parciales, anticipo, redistribución y pago final
en el recorrido Direct Ship, con dos operadores y reportes en vivo.

## Defectos reproducidos

[Runner de base](https://github.com/mikro970328-sys/-export-mca-portfolio/actions/runs/35131318093),
sin datos reales: 3 × 0.33333333 mostraba USD 1.00 pero rechazaba pagar 1;
3 × 0.33333334 aceptaba 1 y quedaba pendiente 0.00000002.
Los totales y costos especiales NaN/Infinity también llegaban a contabilizarse.
La lectura productiva encontró 4 facturas, 4 líneas, 5 pagos y 4 aplicaciones,
sin importes no finitos ni totales efectivos o movimientos fuera de centavos.

## Corrección en el origen

Migración 20260916175720_supplier_finance_precision_integrity.sql, generada con Supabase CLI
2.117.0. El campo generado existente supplier_bill_items.line_total pasa a
round(billed_quantity * unit_cost,2). No se añaden otro libro ni vistas de saldos:
AP, costo de mercadería, validación de aplicaciones, Dashboard y Reportes ya
consumen esa línea o el total exacto introducido. Cantidades y costos unitarios
conservan precisión; los totales exactos, pagos y aplicaciones admiten centavos.

La [operación SET EXPRESSION de PostgreSQL 17](https://www.postgresql.org/docs/17/sql-altertable.html)
recalcula el campo generado. Antes y después se verifican los campos fuente,
el resultado generado esperado, saldos normalizados y pagos/aplicaciones.
No se modifican cantidades, costos introducidos, totales exactos, historial ni caja.

Constraints almacenados rechazan valores especiales y fracciones de centavo
en totales exactos/pagos/aplicaciones. Los RPC existentes devuelven errores
operativos y conservan sus permisos. La API valida cadenas decimales sin aceptar
booleanos, listas, hexadecimal o números no finitos; no trunca importes.
El frontend calcula sólo la vista previa con enteros decimales, redondea cada
línea antes de sumar y respeta el campo que el operador eligió al abrir un modal.
El recorrido detectó además que crear una factura desde Pagos dejaba el listado
en Pagos, ocultando el borrador recién creado. Al guardar una factura nueva se
abre Facturas → Abiertas y se limpia la búsqueda para mostrarla. La misma fila
permanece visible al contabilizarla y permite continuar directamente al pago.

## Aceptación SQL/API y navegador

14 escenarios SF-01/14: liquidación alrededor del centavo, empate decimal y varias
líneas, total exacto, entradas inválidas, rollback de sustitución, anticipo antes
de factura, distribución/redistribución, rechazo por contexto/exceso, reverso con
historial, JSON/CSV/Dashboard, permisos y costos cero válidos.

DS-27/33 amplían los 26 pasos anteriores sin rehacer la logística:
- Anular la factura de proveedor sin pagos activos y registrar anticipo 1600.
- Dos facturas de 420 unidades a 2.50000001/2.49999999 quedan en 1050 cada una.
- Distribuir 1000/500 deja AP 50/550 y anticipo sin aplicar 100.
- Un exceso se rechaza conservando filas; redistribuir 1050/550 deja AP 0/500.
- Pagar los 500 mostrados cierra completamente la segunda factura.
- Revertir el anticipo conserva sus aplicaciones y restaura AP 1050/550.
- Dos pagos simultáneos del saldo 550 permiten un ganador; el lector recibe 403.
  Resultado: AP 1050, salida activa a proveedor 1050, AR cliente 120 y entrega 810.

El segundo operador recibe cambios sin recargar/navegar el documento. Se exige
cero stock/WR/cargues de almacén, errores JS, crashes, tráfico externo y API 404/5xx.
Sólo PostgreSQL/PGlite desechables para QA comercial; Preview comparte producción.

## Publicación y límites

La PR registra CI del head final, versión remota de migración, comprobación de
huellas y despliegue exacto. La existencia del SQL no acredita aplicación remota.
El runtime local de comandos no responde; validación ejecutable en CI.

El reverso de un pago corrige un registro erróneo; no representa una devolución
bancaria real del proveedor. No introduce notas de crédito de proveedor, reembolsos
bancarios, conversión monetaria ni cambios en precios históricos. La aceptación
diaria integrada y los fallos de conexión/permisos continúan como próximo cierre;
iPhone físico permanece aplazado.
