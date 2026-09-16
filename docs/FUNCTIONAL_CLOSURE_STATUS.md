# Pendientes para cierre funcional de escritorio

Corte 2026-09-16. Base publicada PR #310, b74b55e189f0511aa5bd7b1020736d226ed2a051.
Prioridad de Daniel: funcionalidad, después mejoras y después auditoría integral.
Este documento consolida límites actuales, no afirma que todos sean defectos.

## Evidencia disponible

- Seis recorridos de navegador vigentes: operators, commercial, direct-ship,
  cancellation-finance, navigation-startup y repeat-purchase. Chromium escritorio
  y WebKit emulado; PR #310 aprobó 12/12 jobs y 36/36 workflows.
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
| Tracking y documentos | Cadena integrada de estados, carga/vigencia/descarga/eliminación, readiness y recuperación de fallos en navegador con servicios aislados | Pruebas que comprueben estado e historial tras cada acción y resultado visible por otro operador |
| Tareas y notificaciones | Creación por eventos, asignación/permisos/dependencias y lectura entre usuarios en recorrido integrado; fallos de entrega y no duplicación | Matriz de eventos con destinatarios correctos, rechazo de accesos y sin duplicación; transportes externos de prueba explícitos |
| Variantes financieras y reportes | Facturación/cobros/proveedor en variantes Direct Ship todavía fuera de sus recorridos; refresco completo de Reportes tras operaciones y reversos | Saldos, caja, costos y reportes coherentes entre dos sesiones, con evidencia por variante |
| Aceptación final integrada | Recorrido de trabajo diario completo con roles y fallos de conexión/permisos en el alcance acordado | Matriz consolidada sin bloqueos críticos conocidos y publicación verificada |

Trabajo actual: recuperación tras eliminación documental. Validación aislada
específica documentada en CUSTOMS_DELETE_RECOVERY.md; PR certifica publicación.
No declarar cerrado el bloque documental solo por corregir sus mensajes.

## Después y fuera de prioridad actual

Mejoras: simplificar navegación, formularios y presentación según problemas
observados; no reescribir el ERP. Luego auditoría integral de arquitectura,
owners/dependencias, permisos, datos y errores transportados/almacenados, e
integraciones. La revisión parcial de errores públicos no es esa auditoría.

iPhone físico, PWA instalada y push real aplazados por Daniel. No son requisito
para continuar escritorio ni motivo para comprar BrowserStack ahora.
No estimar un porcentaje ni fecha de cierre sin completar la matriz integrada.
No enviar mensajes a clientes ni hacer QA comercial en producción/Preview.
