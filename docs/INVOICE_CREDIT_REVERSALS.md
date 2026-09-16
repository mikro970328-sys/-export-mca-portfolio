# Reversos de notas de crédito por cantidad

Facturación permite revertir una nota completa con motivo obligatorio. La nota
original, sus líneas/importes y los cobros permanecen inmutables. Un nuevo
registro RC identifica motivo, actor y fecha del reverso; el detalle distingue
notas Vigentes y Revertidas y explica los bloqueos. Revertir puede restaurar
deuda; no registra cobro, devolución bancaria ni cambio físico del despacho.

## Fuente de verdad

Migración local 20260916171249_invoice_credit_note_reversal.sql, generada por
Supabase CLI 2.117.0 en runner aislado. El entorno local de comandos dejó de
responder; la validación ejecutable de esta entrega corresponde a CI.
invoice_credit_note_reversals es append-only, con RLS y lectura solo backend.
Un único reverso por nota y un UUID con contenido/actor guardados hacen que los
reintentos devuelvan el mismo registro y los cambios de intención se rechacen.

invoice_active_credit_notes y invoice_active_credit_note_lines excluyen las
notas revertidas. invoice_net_items, creación de nuevas notas y el importe
acreditado consumen esas vistas, manteniendo los owners existentes de saldos,
capacidad de facturación, COGS, rentabilidad, Dashboard y Reportes/CSV. La nota
revertida permanece visible; reintentar su emisión original no la reactiva.
Se puede emitir otra nota válida con una nueva solicitud. Si no queda ninguna
nota vigente, vuelve a aplicar la regla normal de anulación de la factura.

## Dependencias protegidas

- Notas posteriores sobre la misma línea deben revertirse primero. Sus importes
  fueron redondeados desde el remanente anterior; este orden conserva centavos.
  Notas de productos independientes no se bloquean entre sí.
- Aplicaciones o devoluciones ya realizadas deben conservar financiación. Si el
  saldo libre no cubre el importe a restaurar, se rechaza el reverso. Primero
  deben corregirse esos usos. Otros usos que siguen cubiertos se conservan.
- Las cantidades restauradas no pueden superar lo vendido al sumar todas las
  facturas activas, incluidos borradores. Si ya se facturaron de nuevo, se exige
  corregir/anular la factura que las reutilizó antes de restaurarlas.

invoice_credit_note_action_state es el único cálculo de capacidades y bloqueos
para API/UI y reverse_invoice_quantity_credit. El RPC valida actor activo y
motivo; bloquea factura, venta y líneas de venta antes de revisar dependencias.
Comparte los locks de facturación para impedir rebill concurrente. El permiso
finance.write se exige en la API y se enmascara en las capacidades del lector.
Los reversos de varias líneas son atómicos. No se admite reverso parcial de nota
ni reverso del reverso: para un nuevo descuento se emite una nota nueva.

## Evidencia de aceptación

Catorce escenarios SQL/API: AR, COGS/margen, CSV, caja, inmutabilidad, reintentos,
conflictos, permisos/actor, importes fraccionarios y de cero centavos, notas con
varias líneas, independencia de productos, rebill borrador/emitido, saldo
devuelto/aplicado, usos todavía financiados, anulación y anticipos.

DS-23/26 amplían Direct Ship en dos motores y dos operadores: reversos desde UI,
bloqueo por unidades refacturadas, anulación de factura receptora, restauración
de AR y carreras reales de reverso contra rebill y doble reverso. Se conserva
la entrega física 810, factura original 3360 y cobros 3240; tras revertir todas
las notas queda AR 120. El lector ve los cambios sin navegar ni recargar.

Las pruebas comerciales se ejecutan solo en bases desechables. La PR registra
los gates finales, artefactos, migración remota y publicación exacta. No confundir
la existencia de esta migración con su aplicación remota. No incluye ajuste de
precios, documento fiscal local, correcciones de proveedor ni aceptación diaria
integral; iPhone físico sigue aplazado.
