# Pendientes para cierre funcional de escritorio

Corte 2026-09-16. Base publicada PR #316, 8b69bfbc9b98f126d7735e32e2dc3d96fd01173b.
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

Trabajo actual: recorrido integrado de documentos → tarea → aviso personal en
dos sesiones reales, reasignación y estado marítimo desde UI, sin recarga manual.
Ver TRACKING_WORKFLOW_BROWSER.md y PR #315 para CI final; se corrigen acceso a
Mis tareas y recorte del diálogo. Las 16 verificaciones SQL de #314 ya están
incorporadas. No confundir este recorrido con toda la aceptación diaria: quedan
las variantes financieras/reportes y la matriz final de trabajo completo.

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
facturas, pagos y reportes entre dos operadores. CI/publicación pendientes.
