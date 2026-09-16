# A-02 · Recepción manual y pérdida de confirmación

Fecha: 2026-09-16. Rama: fix/manual-receipt-recovery.

## Evidencia del defecto

Prueba con API, autenticación, PostgREST y PostgreSQL reales en contenedores
desechables. No hay URL remota, datos comerciales, transporte simulado ni
credenciales de producción. Solo se descarta la respuesta HTTP después de
confirmar el guardado real.

Commit test-only f779d8eaca2b78e019ed4ebb188640d59d3f74e6.
Run https://github.com/mikro970328-sys/-export-mca-portfolio/actions/runs/35157863588
(job 105001474698): una entrega de 12 unidades seguida de reintento produjo
2 recepciones, 2 líneas, 24 unidades físicas y 2 auditorías.
No se reprodujo borrado de mercancía; no afirmar que ocurrió.

## Owners y comportamiento

- api/warehouse.js delega create_receipt al nuevo RPC transaccional de la
  misma entidad. Se retira la secuencia cabecera/líneas/DELETE compensatorio.
- create_warehouse_receipt_canonical valida y escribe cabecera, líneas y audit
  en una transacción. Las reglas de medidas y anulación existentes siguen vigentes.
- Identidad UUID y payload/actor se conservan en warehouse_receipts. Un lock de
  transacción y un índice único resuelven reintentos concurrentes.
- La misma petición recupera el mismo WR, aunque después cambie el catálogo o
  se anule el WR; no restaura inventario cancelado ni duplica audit. Otro actor o
  payload da 409. El permiso vigente se verifica también al repetir.
- El formulario genera la identidad al abrir una recepción, conserva datos y
  clave tras un fallo, bloquea doble guardado/cierre durante el envío y mantiene
  éxito confirmado aunque falle recargar el listado.
- Clientes antiguos sin clave reciben una UUID del servidor para compatibilidad
  y guardado atómico, pero no deduplican peticiones HTTP distintas. Recargar el
  módulo actualizado habilita la identidad estable del formulario.
- No se fusionan entregas distintas por producto, precio ni cantidad iguales.
- Solo service_role ejecuta el RPC; no se otorgan accesos anon/authenticated.
  La identidad registrada no puede borrarse o cambiarse.
- No se revocan a ciegas los grants existentes de WR/items/inventory_movements:
  el endurecimiento global requiere trazar los demás callers.

## Migración

supabase/migrations/20260916222925_manual_receipt_retry_integrity.sql generada por
supabase CLI 2.117.0, run 35157863588. Añade columnas nulas al histórico,
índice parcial, guard de identidad y RPC. Es compatible con la API antigua
durante aplicación previa al despliegue. No modifica filas de negocio.

Preflight de producción: 0 WR, 0 líneas y 0 movimientos; sin la función o las
columnas nuevas. La PR debe registrar aplicación remota, verificación de grants
y deployment final antes de declarar la función publicada.

## Aceptación

- Corrección inicial: run 35158601630, job 105003841285. Resultado: 1 WR,
  1 línea, 12 unidades físicas, 1 auditoría, mismo identificador recuperado.
- Ampliación: run 35158900214, job 105004794794. **35/35** verificaciones reales
  HTTP/PostgreSQL: 8 peticiones concurrentes; cambios de campos/actor; líneas
  inválidas y valores no finitos; rollback al fallar audit; pallets; catálogo
  cambiado; permiso revocado/restaurado; anulación; identidad y grants.
- Ese run señaló referencias estáticas de caché/status que se actualizan con
  el contrato nuevo; no se omiten gates.
- warehouse-recovery.spec.mjs añade dos operadores por Chromium/WebKit:
  offline, confirmaciones descartadas, inventario sincronizado sin recarga,
  refresco fallido después de guardar, envío pendiente y permisos en formulario.
  El resultado definitivo se registra en la PR.
- Las demás historias comerciales siguen en la matriz Browser Operator Acceptance.

Límites: navegación móvil emulada no equivale a iPhone físico; no certifica
restauración de un backup de producción, ni persistencia del borrador después
de cerrar/recargar la página.
