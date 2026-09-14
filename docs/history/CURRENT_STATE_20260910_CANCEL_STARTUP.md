# Current State — Export MCA ERP

Actualización: 2026-09-10 UTC. Corte de continuidad: **PR #297**.

## Trabajo actual: cancelaciones financieras y arranque móvil

Rama `test/cancellation-finance-browser-acceptance`, base productiva
`af17d6b9bf1cb917fd437b58cbd4c82e31677a1e` (PR #296).
Matrices y diagnósticos:
[CANCELLATION_FINANCE_BROWSER_ACCEPTANCE.md](CANCELLATION_FINANCE_BROWSER_ACCEPTANCE.md) y
[MOBILE_NAV_STARTUP_ACCEPTANCE.md](MOBILE_NAV_STARTUP_ACCEPTANCE.md).

La historia financiera tiene doce checkpoints con dos operadores reales, dos ventas,
dos PO y clientes/proveedores/monedas de control. Usa UI original, HTTP y
PostgreSQL/PostgREST desechables. Los POST negativos adicionales prueban el
backend con sesión QA real; no sustituyen los formularios positivos.

Se reprodujo un defecto real: después de resolver anticipos y anular la factura,
el backend permitía cancelar, pero el workspace no exponía esa acción. El owner
`admin/sales-workspace.js` presenta Cancelar venta gobernado por capabilities,
confirmación existente, controller existente, errores seguros y refresco.
Asset `20260910-cancel1`. Sin cambios de API, SQL o reglas financieras.

Los doce checkpoints financieros aprobaron en ambos motores para `43a1a13`
y `af549e3`. El head af549e3 no se publicó: el recorrido comercial WebKit falló
al iniciar el menú; 14/15 workflows y 7/8 jobs de navegador aprobados.

## Bloqueo móvil: causa reproducida y corrección en validación

El primer clic abría el menú, pero al terminar el arranque una selección automática
de sección disparaba el cierre. La regresión determinista en `3e9b49a`, run
`34476089054`, lo reprodujo en Chromium sin errores de datos ni cambios de viewport.
La primera instrumentación WebKit no retenía peticiones del service worker;
se corrigió el gate de entrega HTTP de QA sin desactivar el worker ni alterar bytes.

La corrección `6c398fe` distingue `source:'startup'` en los owners existentes
erp/section-state/navigation-shell; conserva el menú al restaurar y lo cierra
al navegar. Mantiene revelado temprano, permisos, orden de módulos y Escape.
Assets de navegación/sección `20260910-startup1`. El probe de diagnóstico ya
está retirado. El head `15c7a8d` demuestra ambos perfiles de arranque en WebKit;
no se infiere de eso la aprobación de todas las matrices ni su publicación.

La matriz ahora tiene cinco historias (operators, commercial, direct-ship,
cancellation-finance, navigation-startup), cada una en Chromium y WebKit: diez jobs.
No se saltan escenarios previos ni se añaden reintentos para esconder fallos.

**Antes de continuar:** verificar PR #297, resultados del head exacto, ambos motores,
Preview y, tras merge autorizado, deployment/aliases/assets. Las notas finales de
la PR registran la aceptación y publicación posteriores a este corte documental.

## Última producción verificada antes de #297

PR #296: commit `af17d6b9bf1cb917fd437b58cbd4c82e31677a1e`, deployment
`dpl_4hdBSibhzVqLXaN5aza2CBbuWmZM` READY. Direct Ship conserva hora local;
13/13 workflows de PR y 6/6 de main; diez checkpoints por motor, con matrices
comerciales/multioperador conservadas. Publicación verificada en su PR.

PR #295: `f97c8744ce2e4c4d7ca9d5139cb1fdd65fe314b8`, producción
`dpl_GZpRvCoHJ676YwcGXQ1VCEZ6Nhri`. Selecciones de Compras y acceso a Cargues
móviles entregados; doce checkpoints comerciales por motor. Runtime live7.

## Alcance y próximos bloques

En #297 se comprueban reversos correctivos y reembolso real como operaciones
diferentes, aplicaciones sin doble caja, AP, historial, permisos y actualización
de Facturas entre operadores. La prueba anula la factura antes de cancelar la
venta; no certifica todas las combinaciones de cancelación con facturas activas.
No vuelve a certificar visualmente todos los datasets de Reportes ni todas las
variantes de Direct Ship. La matriz financiera anterior sigue documentada.

Tras publicar #297: Tracking/documentos/tareas/notificaciones, documentos faltantes
y permisos de otro operador. La carrera de menú identificada tiene regresión
específica; no equivale a certificar todo comportamiento móvil. Después, mejoras
de claridad/densidad/feedback y auditoría integral, en el orden solicitado.

## Fronteras operacionales

No escrituras QA en producción/Preview (comparten base). No mensajes de prueba a
clientes ni credenciales en capturas. Sin acceso Supabase desde navegador, nuevos
wrappers/observers, dependencias productivas o cambios de roles reales. BrowserStack
no se reintenta manualmente por cuota. WebKit emulado no certifica Safari/iPhone
real, instalación standalone ni push. CI del head exacto, sin desactivar gates.

## Historial

Corte Direct Ship íntegro: [history/CURRENT_STATE_20260910_DIRECT_SHIP.md](history/CURRENT_STATE_20260910_DIRECT_SHIP.md),
blob `0c12d489d8139a658bc67999f9024014d2c923ea`. Conserva la referencia al historial
anterior `history/CURRENT_STATE_20260909.md` y a las entregas #281/#283/#285/#287/#289/#290.
