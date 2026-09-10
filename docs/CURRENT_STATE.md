# Current State — Export MCA ERP

Actualización del corte: 2026-09-10 UTC.

## Punto exacto de continuidad — Direct Ship (PR #296)

La aceptación de código está aprobada en el head
`e5ad0c846ac3dbd8c5077bfed2692a34da34ba50`: 13/13 workflows y los seis jobs del
run `34427427673`. Diez checkpoints Direct Ship en Chromium y diez en WebKit
móvil, más las dos matrices previas operators/commercial sin modificaciones.

El único cambio funcional productivo de esta entrega está en el owner
`admin/sales-supply-workspace.js`: convierte la hora local del despacho a ISO
con zona antes del POST y rechaza una fecha vacía/no válida. Asset
`20260909-directtime1`. No cambia API/SQL, cantidades ni fechas históricas.

El recorrido enlaza una compra de 100 cajas/10 pallets (USD 250) y una venta
de 100 cajas/10 pallets (USD 400); crea, desvincula y reutiliza el mismo
contenedor; despacha; rechaza la reducción a 99 cajas. Cada checkpoint exige
cero WR, Cargues, movimientos y existencias de almacén. La venta termina
`dispatched`. La hora 10:15 de Nueva York del 09-09 se conserva como 14:15 UTC
en SQL y se muestra 10:15 local en la pantalla. Evidencia y límites:
[DIRECT_SHIP_BROWSER_ACCEPTANCE.md](DIRECT_SHIP_BROWSER_ACCEPTANCE.md).

La publicación no se infiere de este archivo: comprobar el estado de
[PR #296](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/296), su
merge SHA y el deployment productivo correspondiente. La PR registra también
los resultados posteriores a la integración. Preview del código validado:
`dpl_Co7TkPUwxtSuhcpSeqYjHt2gxogN` READY; su entrada HTTP redirigió a SSO (302),
no se presenta como aceptación visual autenticada de Preview.

## Último corte productivo verificado antes de #296 — PR #295

Commit `f97c8744ce2e4c4d7ca9d5139cb1fdd65fe314b8`, producción
`dpl_GZpRvCoHJ676YwcGXQ1VCEZ6Nhri` READY. Conserva proveedor/almacenes en Compras
ante respuestas tardías (`20260909-masters1`) y añade apertura independiente
del detalle de Cargues en tarjetas móviles (`20260909-loadcard1`).

PR #295: 12/12 workflows; main: 6/6. Cadena comercial 12 checkpoints por
motor y matriz operators 10 por motor. Publicación, assets 200 y APIs 401 sin
sesión comprobados. La descripción completa verificada está en
[PR #295](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/295).
El antiguo encabezado «#295 en validación» quedó superado por esa publicación.

## Siguiente bloque funcional y riesgos abiertos

1. Variantes financieras de cancelación: anticipos, facturas/pagos de proveedor
   y anulaciones vinculadas, con datos aislados y trazabilidad conservada.
2. Recorridos de Tracking/documentos, tareas y notificaciones; comprobar
   permisos de otro operador, documentos faltantes y actualización sin recarga.
3. Investigación de arranque móvil: en run `34426597258` la matriz comercial
   WebKit se detuvo al abrir el menú inicial. La matriz final aprobó sin saltar
   ese caso, pero eso no demuestra que se haya eliminado toda intermitencia.

La aceptación Direct Ship de este corte no incluye facturación/cobro de esa
misma cadena, todas las cancelaciones ni proveedores. No repetir las matrices
anteriores como si no existieran; ampliar las variantes que faltan.

Orden del propietario: terminar funcionamiento y aceptación; después mejoras
de claridad/compactación/feedback móvil; finalmente auditoría integral. Las
revisiones de seguridad de cada cambio se hacen antes de publicar.

## Fronteras que permanecen vigentes

- QA de escrituras solo en PostgreSQL/PostgREST desechables. Preview comparte
  producción. No cuentas, facturas, cobros, despachos ni mensajes QA reales.
- WebKit emulado no certifica Safari/iPhone real, PWA instalada ni push.
  BrowserStack no se reintenta manualmente con cuota agotada.
- API autenticada personalizada en Vercel; no acceso directo del navegador a
  Supabase. Sin nuevos owners, wrappers, observers ni dependencias productivas.
- Runtime de sincronización `20260909-live7`; protección de editores abiertos.
- Cambios por rama/PR, CI del head exacto, Preview READY y verificación de
  producción. No sustituir fallos por mocks ni desactivar gates para fusionar.

## Historial preservado

El corte anterior completo está conservado sin cambios en
[history/CURRENT_STATE_20260909.md](history/CURRENT_STATE_20260909.md), blob
`1c7050f501b7d223f095ab2ac4da14780d6a5fe6`. Incluye los cortes #281, #283, #285,
#287, #289 y #290 y el historial de fases. Sus estados antiguos no sustituyen
el punto de continuidad anterior ni las verificaciones actuales de GitHub/Vercel.
