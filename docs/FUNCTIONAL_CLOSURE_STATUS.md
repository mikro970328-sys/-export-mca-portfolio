## 2026-09-16 · Recuperación de recepciones manuales

A-01 publicado por PR #326: main 8c05bf50f7130eac71745f94d32410c450ca46ea,
producción dpl_GfxskdZ5RjJnWkVMftGSBtxewhD4 READY; 17/17 workflows y 16/16
recorridos. Historial y notificaciones conservan diagnóstico sin exponerlo.

A-02 reproducido: perder una confirmación y reintentar duplicó una entrega de
12 unidades en dos WR, 24 unidades y dos auditorías. La rama
fix/manual-receipt-recovery incorpora guardado transaccional e identidad estable.
35/35 verificaciones HTTP/PostgreSQL pasan; navegador, gates definitivos y
aplicación/publicación se registrarán en la PR. No asumir migración aplicada.
Leer MANUAL_RECEIPT_RECOVERY.md y security/BACKUP_RECOVERY_STATUS.md.
Supabase: organización en plan free; respaldo restaurable aún no acreditado.
Escritorio prioritario; iPhone físico/BrowserStack/push siguen diferidos.

## 2026-09-16 · Diagnósticos públicos de notificaciones (PR #326)

La reproducción aislada confirmó 21 exposiciones de errores almacenados/indirectos.
Corrección en los owners de API: Clientes, Contenedores, Historial y CSV; se
conservan registros internos, estados, permisos e identidad de los envíos.
28/28 escenarios nuevos, 97/97 errores públicos previos y 7/7 claims pasan en
el ensayo dirigido. CI completo/publicación: consultar PR #326, no inferirlos.
Leer security/STORED_NOTIFICATION_ERRORS.md. A-02 (confirmación de recepciones
manuales) y respaldo/restauración siguen pendientes; escritorio prioritario.

## Corte posterior a #324 — 2026-09-16

La jornada integrada ya aprobó 18 checkpoints en ambos motores y está publicada:
9f4aea87c412ac2dc467c0d934eee2f084307978. Matriz 16/16, 19/19 workflows, migración y despliegue
verificados en PR #324. La recuperación de pagos al proveedor también está cerrada.
La siguiente labor no es otro módulo financiero: resolver hallazgos concretos de
security/WORKDAY_TECHNICAL_AUDIT_20260916.md (errores indirectos/almacenados y
frontera transaccional de recepción manual por reproducir), y validar controles
de recuperación pendientes. No declarar el ERP totalmente certificado.
Los cortes de estado inferiores son históricos respecto de esta publicación.

# Estado vigente de cierre — 2026-09-16

Este corte sustituye los pendientes históricos conservados más abajo.
Base publicada PR #323. No equivale a una declaración de ERP totalmente certificado.

| Bloque | Evidencia vigente | Pendiente real |
|---|---|---|
| Compra, recepción, venta, inventario y despacho | Cadena integrada existente COM-01/12; variantes SQL/API y cancelación | Repetición final de la matriz con el nuevo cierre |
| Tracking, documentos, tareas y avisos personales | Recorridos de dos operadores publicados #312/316 | Auditoría técnica; entrega externa real no simulada sigue fuera de estas pruebas |
| Crédito, reversos, Direct Ship y proveedor | #317/322, DS-01/33 y aceptación financiera | Repetición de regresiones con el fix de pagos |
| Jornada y recuperación | Cobros idempotentes #322; selección de reportes #323; nuevo fallo de pagos a proveedor reproducido y corregido en rama | Finalizar COM-15/18, CI exacto, migración compatible y publicación; ver SUPPLIER_PAYMENT_RECOVERY.md |
| Auditoría técnica | B9, permisos/sesiones, errores públicos y ownership existentes | Consolidar arquitectura/dependencias, privilegios/datos y errores indirectos/almacenados contra el estado actual |

No rehacer funciones resueltas. No hacer QA comercial en producción/Preview.
iPhone físico, BrowserStack Automate, PWA instalada y push no bloquean escritorio.
No prometer porcentaje ni fecha de cierre sin cerrar la evidencia y sus límites.

---

## Registro histórico de decisiones (no usar como pendiente vigente)

# Pendientes para cierre funcional de escritorio

Corte 2026-09-16. Base publicada PR #322, 86bdec6215bf11cb3752616d5428a2120d33047b.
Prioridad de Daniel: funcionalidad, después mejoras y después auditoría integral.
Este documento consolida límites actuales, no afirma que todos sean defectos.

## Evidencia disponible

- Ocho recorridos de navegador vigentes: operators, commercial, direct-ship,
  cancellation-finance, navigation-startup, repeat-purchase, tracking-documents y tracking-workflow.
  Chromium escritorio y WebKit emulado; PR #315 aprobó 16/16 jobs y 35/35 workflows.
- Compras, recepciones, inventario, ventas, cargues, cobros y variantes de reversos
  cuentan con matrices SQL/API y recorrido comercial; no rehacerlos desde cero.
- Repetir compra (#306), corrección física Direct Ship 840→810 (#298), oferta de
  facturas tras cancelar (#307), acceso a tareas relacionadas (#308), conservación
  de archivos (#309) y recuperación de carga (#310) ya publicados.
- CF-13 amplió cancelación con factura borrador, impagada y parcialmente cobrada.
  Los límites anteriores a #307 sobre esas combinaciones ya no son el pendiente.

## Bloques por cerrar

| Bloque | Falta demostrar | Criterio de cierre |
|---|---|---|
| Tracking y documentos | Cadena integrada de estados marítimos; ciclo documental con dos operadores ya cubierto en #312 | Pruebas que comprueben estado e historial tras cada acción y resultado visible por otro operador |
| Tareas y notificaciones | Creación por eventos, asignación/permisos/dependencias y lectura entre usuarios en recorrido integrado; fallos de entrega y no duplicación | Matriz de eventos con destinatarios correctos, rechazo de accesos y sin duplicación; transportes externos de prueba explícitos |
| Variantes financieras y reportes | Facturación/cobros/proveedor en variantes Direct Ship todavía fuera de sus recorridos; refresco completo de Reportes tras operaciones y reversos | Saldos, caja, costos y reportes coherentes entre dos sesiones, con evidencia por variante |
| Aceptación final integrada | Recorrido de trabajo diario completo con roles y fallos de conexión/permisos en el alcance acordado | Matriz consolidada sin bloqueos críticos conocidos y publicación verificada |

El recorrido de documentos → tarea → aviso personal, reasignación y estado
marítimo desde UI está publicado en #315; #316 conserva la asignación manual.
Las 16 verificaciones SQL de #314 están incorporadas. El trabajo actual amplía
las variantes financieras y sus reportes con saldos a favor; sigue pendiente
la matriz final de trabajo diario completo.

## Después y fuera de prioridad actual

Mejoras: simplificar navegación, formularios y presentación según problemas
observados; no reescribir el ERP. Luego auditoría integral de arquitectura,
owners/dependencias, permisos, datos y errores transportados/almacenados, e
integraciones. La revisión parcial de errores públicos no es esa auditoría.

iPhone físico, PWA instalada y push real aplazados por Daniel. No son requisito
para continuar escritorio ni motivo para comprar BrowserStack ahora.
No estimar un porcentaje ni fecha de cierre sin completar la matriz integrada.
No enviar mensajes a clientes ni hacer QA comercial en producción/Preview.

## Reasignación manual de workflow

PR #315 detectó que la siguiente actualización del envío restauraba el responsable
de la ruta. La corrección en curso registra una reasignación explícita dentro del
RPC existente y la preserva al reconciliar y reabrir, incluso para equipo o sin
responsable. Las tareas automáticas siguen la ruta. No reconstruye asignaciones
antiguas ya sobrescritas ni añade un control para volver al modo automático.
Publicado en PR #316; 16/16 jobs de navegador. Ver WORKFLOW_MANUAL_ASSIGNMENT.md para alcance y pruebas.

## Trabajo actual: finanzas Direct Ship

Se reprodujo y corrigió en la vista propietaria la omisión del costo de Direct
Ship. Ver DIRECT_SHIP_FINANCIAL_REPORTS.md: corrección física 840→810, costo,
facturas, pagos y reportes entre dos operadores. Publicado en PR #317.

## Continuación: crédito por unidades facturadas

El caso físico 840→810 ya preserva los documentos; el ajuste comercial se hace
mediante una nota de crédito explícita. INVOICE_QUANTITY_CREDITS.md describe el
nuevo owner de notas y su integración con Facturación/Reportes, sin cambiar
facturas históricas ni el dinero recibido. Publicado en #318: 16 escenarios
SQL/API, DS-16/18 y 16/16 jobs de navegador.

## Continuación: uso del saldo a favor

INVOICE_CREDIT_SETTLEMENT.md describe aplicaciones a otra factura del mismo
cliente y moneda, registro de devoluciones efectivas y reversos de ambos con
motivo. El saldo neto, caja, Dashboard y Reportes comparten los mismos owners.
Quince escenarios SQL/API y DS-19/22 comprueban límites, permisos, concurrencia,
reintentos, dependencias y refresco entre usuarios. Consultar la PR para gates
y publicación finales; la existencia del archivo no acredita una migración remota.

Aplicaciones/devoluciones publicadas en #319: 50/50 workflows y 16/16 jobs de
navegador, con 22 pasos Direct Ship por motor. La continuación actual añade el
reverso de notas por cantidad descrito en INVOICE_CREDIT_REVERSALS.md. Protege
saldo ya utilizado, refacturación y redondeo, con historial inmutable. La PR
registra los gates y publicación finales.

Pendiente posterior: variantes financieras restantes y aceptación diaria
integral. No se cambia el precio de facturas emitidas ni se ejecutan transferencias
bancarias; iPhone físico continúa fuera de la prioridad actual.

## Continuación: anticipos y facturas parciales del proveedor

PR #320 publicó los reversos de notas de crédito por cantidad. El bloque actual
corrige dos fallos reproducidos en AP: diferencias subcentavo que impedían cerrar
facturas y valores numéricos especiales admitidos en líneas. Catorce casos SQL/API
y DS-27/33 comprueban facturas parciales, anticipo previo, redistribución, rechazo
atómico, pago final, reverso, permisos y concurrencia, con reportes entre usuarios.
Ver SUPPLIER_FINANCE_VARIANTS.md y la PR para resultados de publicación.

Con este bloque, la siguiente actividad es consolidar el recorrido diario con
roles y fallos de conexión/permisos. No declarar cerrado todo el ERP ni añadir
por defecto nuevas funciones financieras que no forman parte de estos recorridos.

## Recuperación diaria de cobros

La confirmación HTTP perdida reprodujo dos registros para un solo clic en
PostgreSQL desechable. Corrección actual: identidad estable de la intención,
auditoría atómica y aceptación de Facturación/Ventas, permisos y desconexión.
Ver INVOICE_PAYMENT_RECOVERY.md. CI y publicación finales en la PR; este caso
no sustituye la matriz consolidada ni la auditoría integral posterior.

## Selección de Reportes durante actualización

DS-28 ya tiene una reproducción controlada: el clic para cambiar a proveedor se
ignoraba durante la lectura automática de facturas de cliente. Se corrige en
reports.js conservando la intención más reciente y los filtros. Los datos SQL
no se perdían. Ver REPORT_SELECTION_RECOVERY.md y la PR para evidencia final.
No confundir este caso con cierre de la aceptación diaria global ni auditoría.
