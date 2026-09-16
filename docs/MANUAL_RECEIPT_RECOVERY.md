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

## Refresco interrumpido

Las 36 verificaciones HTTP/SQL pasaron en run 35159648354. Chromium también
completó WR-01/06. La inyección de fallo de lectura con context.route no cubre
peticiones del service worker en WebKit; por eso WR-03 esperaba un error aunque
la página mostraba éxito. La prueba ahora interrumpe la respuesta real del
servidor aislado, limitada a la sesión A, y exige evidencia del corte.
No se desactiva el service worker ni se fabrica una respuesta de negocio.

El refresco de un WR confirmado tiene un límite de 12 segundos: una conexión
que no termina se cancela, sin renderizado tardío, y el formulario conserva
la confirmación y puede cerrarse. El POST conserva su identidad de reintento.

La historia Direct Ship valida el valor de unidades por pallet antes del POST:
la captura del run 35159648336 mostró 10, no los 84 que la prueba pretendía
introducir; el ERP rechazó correctamente la medida inconsistente.

## Error de red en el service worker

Run 35160652902 completó WR-01/06 en WebKit, con saldos/auditoría correctos,
pero registró errores de página al cortar la lectura: el service worker
entregaba una respuesta nula cuando no existía una copia en caché.
El owner sw.js deja las API de negocio al manejo de red del módulo y devuelve
un error de red explícito si un recurso estático no tiene copia. Se conserva
la caché de recursos, push y los controles de la historia; no se filtran errores
de página para hacer pasar la prueba.

Referencia del contrato de red:
https://developer.mozilla.org/en-US/docs/Web/API/Response/error_static
