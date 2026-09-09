# Aceptación financiera — Export MCA ERP

Estado: publicado mediante [PR #285](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/285), desde `40cb5feba6dbbd4f0ff37afb14678584e4caad19`. Commit funcional `e33cb87bf278b3886dd0acc42a9f3250c78f5285`, producción `dpl_GP9Jw7tBYUh44h8dK5S4xyscWQeR` READY.

## Contrato y regresión

- Facturas: creación/edición atómica, cantidad pendiente, redondeo monetario, emisión, cobro parcial/completo, rechazo de exceso y reverso.
- Anticipos: caja recibida, aplicación a factura sin duplicar caja, reembolso, reversos, saldo disponible y aislamiento de venta/cliente/moneda.
- Proveedores: factura por total exacto, pago directo y no aplicado, distribución, rechazo de exceso/contexto incorrecto y reverso.
- Costes: asignación completa, contabilización/anulación, actor válido, coste reconocido y contribución por moneda.
- Reportes: AR/AP actuales, flujo de caja por fecha, inclusión de anticipos/reembolsos, separación de monedas, filtros y conciliación con el origen.
- API: permisos simulados con handlers reales, respuesta actualizada tras acción y errores de entrada claros.
- Refresco: Reportes reacciona a acciones locales, acciones desde iframe y versiones de otra sesión; espera mientras su modal está abierto.

## Fallos reproducidos y correcciones

1. Caja omitía anticipos y reembolsos. Caso controlado: anticipo 100, aplicación 50, devolución 20, cobro 40 y pago proveedor 60. Antes había dos filas y neto -20; ahora cuatro filas y neto 60. Aplicar 50 no añade caja. Dashboard y JSON/CSV comparten `executive_cash_movement_source` con las cuatro clases de movimientos, estados posted y moneda/fecha del origen.
2. Una factura vencida con cobro parcial dejaba el contador de vencidas en cero. `api/invoices.js` cuenta saldo pendiente y fecha de vencimiento aunque el estado de cobro sea parcial.
3. Cantidades de factura e importes/distribuciones de proveedor no finitos alcanzaban el RPC. Los handlers los rechazan antes del transporte, con error de entrada 400. No se afirma que el transporte productivo guardara un valor JavaScript Infinity: JSON lo transforma en null.
4. Reportes exponía una función de refresco, pero ninguna dependencia lo seleccionaba al cambiar los datos. Se añade `reportsSection` al mapa existente; las cuatro regresiones fallaron antes y aprueban después. No se añaden observers ni wrappers. Runtime `20260909-live6`.

La migración `20260909185121_finance_cash_reconciliation.sql` añade una vista de lectura y reemplaza únicamente los dos RPC ejecutivos. No modifica filas comerciales ni los libros de cobros/pagos, AR/AP o el cálculo de rentabilidad. Conserva el límite de 5000 filas de reportes y las monedas separadas. Las etiquetas de anticipos/reembolsos y los contadores del dashboard se muestran en español sin calcular importes en frontend.

## Evidencia de entrega

- Head inicial `3f06d8c856770d3c8ebffa8754f5526250db5f59`, Preview `dpl_EgkoE7PfmbbAhqTsFM6jA7Bq7EV7` READY. Navegador Chrome: entrada administrativa y PWA muestran el formulario de acceso. No se declara un flujo autenticado de negocio.
- CI inicial: 57/58 workflows aprobaron, incluido Finance Acceptance (`34391336034`). La única falla exigía literalmente la explicación anterior del dashboard; se actualizó esa expectativa a la explicación de anticipos/reembolsos, sin omitir el gate.
- Head final `616126e288cf7c9d1b4946d89c9623bcbfde832c`: 58/58 workflows aprobados, Finance Acceptance `34391915963`, 60 checks success/skipped según el diseño del workflow. Preview final `dpl_54Mc37jyVvrQbk75XU7QqduLciaZ` READY y formulario de entrada PWA verificado.
- El workflow de iOS en PR aprueba su contrato de solo lectura; el job de dispositivo está omitido por el diseño del workflow. Eso no certifica Safari/iPhone ni consume una nueva sesión de dispositivo.
- Supabase asignó la versión `20260909185121`: se conserva ese nombre en git con los mismos bytes SQL revisados. Ambas funciones y la vista coinciden con lo probado; `anon` y `authenticated` sin acceso, `service_role` con lectura/ejecución y vista `security_invoker=true`.
- Conciliación productiva por consultas de lectura: cero discrepancias entre los cuatro libros y la vista; cero discrepancias del dashboard. Cuatro eventos existentes, cuatro en el reporte. Revisión de importes no finitos: cero en los cuatro libros. No hubo escrituras comerciales QA.
- HTTP productivo: `/admin/pwa.html`, `/admin/index.html` y live6 responden 200; shell referencia live6 y runtime contiene la dependencia de Reportes. `/api/invoices`, `/api/supplier-payments` y `/api/reports` responden 401 sin sesión. Consulta de logs 5xx sin resultados, intervalo observado 18:44:02–18:59:02 UTC de 2026-09-09.
- Main, última ejecución por nombre: ocho de nueve workflows únicos aprobaron; Finance Acceptance `34392107499`, compras `34392107090`, ventas/logística `34392106927`, Pages `34392105402`. Hubo dos eventos push automáticos del mismo commit y un Pages anterior cancelado. Ambos runs iOS (`34392104514`, `34392106929`) fallaron por cuota `Automate testing time expired`, en las suites core y costs; no por una aserción del ERP. El contrato de solo lectura sí aprobó. No se lanzaron reintentos manuales ni se modificaron gates.

## Matriz ejecutada

| Grupo | Escenarios | Evidencia |
| --- | ---: | --- |
| Facturas y cobros | 6 | Total exacto a centavos, edición atómica, cantidad reservada por borradores, contexto, bloqueo de emitidas, exceso y reverso |
| Anticipos y proformas | 5 | Aplicación/caja sin duplicados, saldo disponible, contexto, motivos de reverso, instantánea de proforma sin AR/caja |
| Proveedores | 3 | Total exacto, pagos parciales/completos, saldo no aplicado, redistribución atómica y reversos |
| Costes y rentabilidad | 4 | Asignación completa, actor, anulación, venta 400/COGS 250/contribución 100, moneda distinta sin FX |
| Reportes | 6 | Caja completa, dashboard conciliado, AR/AP actuales, vencimiento parcial, fechas/monedas/contrapartes/producto y errores de filtro |
| Migración y privilegios | 1 | Reejecución sin cambios de datos y límites de acceso de vista/RPC |
| API reales con SQL aislado | 11 | Permisos simulados, operaciones, lectura posterior, capacidades, entradas inválidas, JSON/CSV |
| Runtime de refresco real con navegador simulado | 4 | Acción local, cambio externo, iframe y espera por modal |
| **Total** | **40** | **25 SQL + 11 API + 4 refresco** |

Comandos: `node scripts/check-finance-acceptance.mjs`, `node scripts/check-finance-api.mjs`, `node scripts/check-finance-refresh.mjs`. Workflow `finance-acceptance.yml`, sin credenciales. Los escenarios SQL dejan cero filas operativas; el adapter API reproduce la frontera JSON de los RPC y fechas, pero no todos los detalles de PostgREST.

El dashboard conserva su contrato de filtros: cliente restringe el lado cliente y proveedor el lado proveedor; moneda/producto/fecha aplican a ambos. En el dataset de caja, cada filtro restringe las filas devueltas. AR/AP del dashboard siguen siendo saldos actuales, aunque el período excluya su actividad original.

## Entorno y límites

PGlite desechable con los propietarios SQL financieros reales: 85 archivos de migración, 84 completos y el segmento financiero completo de P11. Se conserva la base de compras/ventas/logística y se añaden las migraciones financieras vigentes. P11 ejecuta sus definiciones financieras completas sin cambios; se omite únicamente la vista final de atención operativa, que depende de tareas/alertas fuera del bloque. No se sustituyen cálculos financieros por mocks. La fixture legacy reproduce `payments.amount numeric(14,2)` y `admin_users.is_active`, cotejados por lectura de esquema productivo. Se contrastaron 20 RPC actuales: 18 coinciden normalizando espacios y dos tienen únicamente diferencias de formato alrededor de puntuación, revisadas individualmente.

Cada escenario revierte sus filas. Preview comparte la base productiva: no se realizan allí escrituras comerciales QA. No certifica JWT real, transporte PostgREST, Storage, concurrencia entre conexiones ni iPhone instalado. Compras y logística ya tienen matrices propias.

Siguiente bloque: pruebas transversales con navegador y backend aislado, operadores simultáneos y móvil/PWA. La certificación automática iOS de main quedó bloqueada por cuota; esa validación continúa pendiente. Después, mejoras y auditoría integral según el orden solicitado.
