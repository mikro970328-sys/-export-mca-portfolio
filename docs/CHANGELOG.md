## 2026-09-16 — Recuperación al retirar documentos

- Confirmación de eliminación se conserva si falla el refresco.
- Ante respuesta perdida, una lectura verifica el ID exacto y su marca de borrado;
  ausencia del listado no se interpreta como eliminación.
- No se repite DELETE. Se conserva aviso de limpieza física pendiente conocido.
- 13 escenarios UI aislados y actualización de pendientes funcionales consolidados.
- Evidencia final de CI/publicación en PR de fix/customs-delete-recovery.

## 2026-09-16 — Recuperación de confirmación documental

- Carga Cuba reconoce guardado confirmado aunque falle el refresco posterior.
- Respuesta perdida: consulta por archivo, contenedor y tipo; no repite escritura.
- Si no puede confirmar, pide revisar el listado antes de volver a subir.
- Distingue versión vigente e histórica; pruebas aisladas en workflow documental.
- Evidencia y límites en CUSTOMS_UPLOAD_RECOVERY.md y PR asociada.

## 2026-09-15 — Conservar documentos ante fallos posteriores al guardado

- Se retira el borrado automático de storage en errores de finalización, tanto
  en documentos Cuba como en la API documental anterior.
- Una respuesta fallida no demuestra rollback: el documento puede estar guardado.
- Regresión aislada de ambas funciones; sin migraciones ni datos reales.
- Ver DOCUMENT_UPLOAD_PRESERVATION.md y PR para evidencia final de publicación.

## 2026-09-15 — Acceso a tareas relacionadas

- Detalle aplica el filtro canónico de visibilidad a dependencias y dependientes
  antes de consultar etiquetas de entidades; gestores conservan acceso completo.
- Aviso cuando existen dependencias fuera del acceso, sin exponer su contenido.
- Se conservan bloqueos, historial, comentarios y datos; sin migraciones.
- Prueba aislada reproduce la fuga previa y verifica API/UI; ver matriz y PR
  para CI e integración final.

## 2026-09-15 — Facturación coherente tras cancelar venta

- Capability del workspace impide ofrecer nueva factura cuando el RPC no admite
  la venta; ambos botones y acción usan el mismo permiso del servidor.
- Confirmación explica que facturas, cobros y saldos se conservan por separado.
- CF-13 amplía pruebas de navegador a factura borrador, impagada y cobro parcial.
- Prioridad de Daniel: escritorio; certificación física aplazada. Integración y
  publicación final en la PR de fix/cancelled-sale-billing.

# Changelog — Export MCA ERP

No se registra como publicado un cambio solo por estar en una rama o Preview.
El historial previo íntegro se conserva, sin cambios, en
[history/CHANGELOG_20260909.md](history/CHANGELOG_20260909.md).

## 2026-09-14 — Repetir compra

Rama `feat/repeat-purchase`. Evidencia final de CI, Preview y publicación en la PR
asociada; esta nota por sí sola no certifica producción.

- Acción «Repetir compra» en lista y detalle, autorizada por `procurement.write`,
  incluso si la original está cancelada o cerrada. Guarda por `create_plan`.
- Copia proveedor, destino, moneda, productos, cantidades/pallets, precio por
  unidad o total y notas. Fecha nueva; llegada estimada y referencia vacías.
- Identidades, recepciones, facturas y pagos independientes. Borradores locales
  separados por origen y del formulario normal; tras guardar muestra Borradores.
- Refresca catálogos/permisos y señala maestros inactivos para su sustitución.
- Matriz: [REPEAT_PURCHASE_ACCEPTANCE.md](REPEAT_PURCHASE_ACCEPTANCE.md).
  Sin nuevas dependencias, SQL, migraciones, permisos o refactors de otros módulos.

## 2026-09-14 — Respuestas de error seguras (PR #305)

Rama audit/api-public-error-boundaries. CI final y publicación registrados en
[PR #305](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/305).

- Corregidas 20 exposiciones directas en 19 endpoints con mensajes controlados;
  validaciones conocidas 400, fallos internos 500, transitorios agotados 503.
- WhatsApp fallido conserva el éxito parcial del tracking guardado.
- Detector sobre 61 endpoints, 17 regresiones del detector y 97 comprobaciones
  aisladas de handlers integradas en B9. Matriz: security/API_PUBLIC_ERROR_AUDIT.md.
- Gates locales 13/13, API financiera 11/11 y SQL ventas/logística 29/29.
  Sin dependencias nuevas, migraciones o QA comercial en producción.
- Continuidad actualizada desde #305; documentos del corte #297 íntegros en
  history. #298–#304 integradas. Límite BrowserStack y PWA/push real conservado.

## 2026-09-10 UTC — Carrera de primer clic del menú móvil (PR #297)

Causa reproducida en `3e9b49a`: apertura válida seguida de restauración automática
que cerraba el menú al emitir section-changed. Corrección canónica `6c398fe`:
erp/section-state identifican startup y navigation-shell conserva apertura solo
para ese origen. Navegación normal y Escape siguen cerrando. Sin retrasar arranque,
sin nuevas dependencias, SQL, APIs, cambios de permisos ni observadores productivos.

Assets navigation-shell/section-state `20260910-startup1`. El probe temporal de QA
se retiró; la regresión conserva bytes de scripts y service workers. La retención
HTTP en servidor QA corrige la precondición que la interceptación WebKit no cubría.
Head `15c7a8d`, run `34477240736`: diez jobs de navegador aprobados, incluyendo los
dos perfiles de arranque por motor y todos los escenarios financieros/comerciales
anteriores. Se alinean revisiones literales en tres gates sin quitar comprobaciones.

Método, evidencia y límites en `MOBILE_NAV_STARTUP_ACCEPTANCE.md`. Verificar head
final, integración y deployment en PR #297 antes de afirmar publicación.

## 2026-09-10 UTC — Cancelación de ventas y reversos financieros (PR #297)

Corrección funcional `43a1a1338340f2f3f4258f0f4a0c5df026a93df7`.
Verificar resultados finales y publicación en PR #297, no inferirlos de este corte.

- Se reproduce falta de Cancelar venta en workspace pese a capability permitida.
  Se restituye en owner canónico con confirmación, controller existente y errores
  seguros. Asset `20260910-cancel1`; sin cambios SQL/API/reglas financieras.
- Doce checkpoints de navegador, dos operadores, documentos de control EUR.
  Pasaron en Chromium y WebKit en `34470426976` y `34470898790`; este último
  quedó bloqueado por el menú comercial, diagnosticado y corregido arriba.
- Anticipos/aplicaciones/reembolsos, motivos e historial; AP y pago/anulación;
  permisos y saldo de factura actualizado entre sesiones sin recargar.
- Se corrige preparación QA (grant legacy) y consulta de caja: columnas reales,
  montos positivos con dirección in/out. No se modificó el cálculo productivo.
- El gate añade casos de confirmación, permisos y errores sobre funciones reales;
  se conservan controles previos y se alinean referencias a la revisión del asset.

## 2026-09-10 UTC — Direct Ship: hora local y aceptación (PR #296)

Aceptación del código `e5ad0c846ac3dbd8c5077bfed2692a34da34ba50` aprobada:
13 workflows; Browser Operator Acceptance `34427427673`, seis jobs.
La publicación se verifica por merge/deployment registrados en PR #296.

- Conversión de datetime-local a ISO con zona en el navegador y rechazo de
  fecha vacía/inválida; asset `20260909-directtime1`. Sin SQL ni reescritura histórica.
- Diez checkpoints por motor Direct Ship, preservando matrices comerciales y
  de operadores. Desvinculación/reutilización, despacho y protección de cantidades.
- Cero WR/Cargues/inventario; hora SQL/pantalla consistente; cinco casos
  zona/fecha y quince comprobaciones de entradas inválidas.
- Se corrigió la configuración QA (descubrimiento, handler, grant legacy local,
  espera de respuestas, cierre y evidencia). No son cambios de datos productivos.
- Estado y contexto consolidados; el corte anterior y changelog se preservan
  como blobs idénticos en history. Riesgos y límites en la matriz específica.

## 2026-09-09 — Publicación de Compras/Cargues y compra a cobro (PR #295)

Publicado en `f97c8744ce2e4c4d7ca9d5139cb1fdd65fe314b8`, deployment
`dpl_GZpRvCoHJ676YwcGXQ1VCEZ6Nhri` READY. Supera la nota anterior en validación.
Conserva proveedor/almacenes de Compras (`20260909-masters1`) y acceso al detalle
móvil de Cargues (`20260909-loadcard1`). 12 workflows de PR y seis de main
aprobados; 12 checkpoints comerciales por motor y matrices previas preservadas.
