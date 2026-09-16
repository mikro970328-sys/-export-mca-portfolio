# Pendientes para cierre funcional de escritorio

Corte 2026-09-16. Base publicada PR #318, d86d1804472959aab3cb15657499e58213373685.
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

Pendiente posterior: reverso de notas de crédito por cantidad, variantes
financieras restantes y aceptación diaria integral. Este bloque tampoco cambia
precios de facturas emitidas ni ejecuta transferencias bancarias.
