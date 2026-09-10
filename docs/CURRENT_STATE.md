# Current State — Export MCA ERP

Actualización: 2026-09-10 UTC. Corte de continuidad: **PR #297**.

## Trabajo actual: cancelaciones financieras

Rama `test/cancellation-finance-browser-acceptance`, base productiva
`af17d6b9bf1cb917fd437b58cbd4c82e31677a1e` (PR #296).
Matriz y diagnósticos: [CANCELLATION_FINANCE_BROWSER_ACCEPTANCE.md](CANCELLATION_FINANCE_BROWSER_ACCEPTANCE.md).

La nueva historia tiene doce checkpoints con dos operadores reales, dos ventas,
dos PO y clientes/proveedores/monedas de control. Usa UI original, HTTP y
PostgreSQL/PostgREST desechables. Los POST negativos adicionales prueban el
backend con sesión QA real; no sustituyen los formularios positivos.

Se reprodujo un defecto real: después de resolver anticipos y anular la factura,
el backend permitía cancelar, pero el workspace no exponía esa acción. El cambio
está exclusivamente en `admin/sales-workspace.js`: botón Cancelar venta gobernado
por capabilities, confirmación existente, controller existente, errores seguros
y refresco. Asset `20260910-cancel1`. Sin cambios de API, SQL o reglas financieras.

Head funcional `43a1a1338340f2f3f4258f0f4a0c5df026a93df7`: Chromium completó los
doce checkpoints en run `34470426976`; evidencia inspeccionada `10149320361`.
El gate de workspace también aprobó seis presentaciones por capabilities y los
casos de confirmar, volver y manejar rechazos. Otros gates todavía exigían la
revisión anterior del asset; se alinea únicamente esa referencia, sin omitirlos.
Este documento no declara aprobado el head final ni publicado el cambio.

**Antes de continuar:** verificar la PR #297, los resultados del head exacto,
ambos motores, Preview y, tras merge autorizado, deployment/aliases/assets.
Las notas finales de la PR registran la aceptación y publicación posteriores
sin confundir esta evidencia previa con CI del último commit.

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

Tras publicar #297: recorridos de Tracking/documentos/tareas/notificaciones,
documentos faltantes y permisos de otro operador. Mantener la investigación del
menú móvil intermitente: un run verde no demuestra su eliminación. Después,
mejoras de claridad/densidad/feedback y auditoría integral, en el orden solicitado.

## Fronteras operacionales

No escrituras QA en producción/Preview (comparten base). No mensajes de prueba a
clientes ni credenciales en capturas. Sin acceso Supabase desde navegador, nuevos
wrappers/observers, dependencias productivas o cambios de roles reales. BrowserStack
no se reintenta manualmente por cuota. WebKit emulado no certifica Safari/iPhone
real, instalación standalone ni push. CI del head exacto, sin desactivar gates.

## Historial

Corte anterior íntegro: [history/CURRENT_STATE_20260910_DIRECT_SHIP.md](history/CURRENT_STATE_20260910_DIRECT_SHIP.md),
blob `0c12d489d8139a658bc67999f9024014d2c923ea`. Conserva la referencia al historial
anterior `history/CURRENT_STATE_20260909.md` y a las entregas #281/#283/#285/#287/#289/#290.
