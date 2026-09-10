# Aceptación de cancelaciones financieras en navegador — PR #297

Base publicada: `af17d6b9bf1cb917fd437b58cbd4c82e31677a1e` (PR #296).
Rama `test/cancellation-finance-browser-acceptance`. Implementación completa de
los doce checkpoints siguientes; aceptación final/merge/deployment se verifican
en PR #297. Este corte conserva evidencia previa, no declara publicación.

## Frontera y métodos

Dos operadores con login real; uno escribe y otro solo lee. Dos ventas y dos PO,
con cliente/proveedor distinto y EUR como documentos de control, creados mediante
UI original. SQL solo prepara identidades/catálogos y verifica filas. Cada historia
usa PostgreSQL/PostgREST desechables. Preview comparte producción: no escrituras.

Todas las mutaciones comerciales exitosas nacen de formularios/clics reales.
Los intentos negativos adicionales de API usan un login QA legítimo y comprueban
que ocultar un botón no sea la única protección. No se inyectan tokens en el
navegador, no se fabrican botones ni se sustituyen respuestas.

## Matriz instrumentada

| Caso | Resultado exigido |
|---|---|
| CF-01 | Anticipo 100; cancelación denegada por capability/API y cero mutación |
| CF-02 | Factura 400; aplicar 50 deja disponible 50/saldo 350 sin caja nueva; reverso padre bloqueado |
| CF-03 | Motivo obligatorio; reversar aplicación restaura disponible 100/saldo 400 y conserva historial |
| CF-04 | Reembolso 20: disponible/caja 80 y una salida; reverso padre bloqueado |
| CF-05 | Reversar reembolso restaura disponible/caja 100, conserva fila y motivo |
| CF-07 | Factura proveedor 250/pago 60: saldo 190; anular rechaza y no altera libros |
| CF-08 | Reversar pago con motivo devuelve saldo AP 250; pago histórico reversed |
| CF-09 | Anular factura sin pago activo mantiene encabezado/líneas históricas |
| CF-10 | Cancelar PO una vez resuelto AP, sin alterar documentos EUR de control |
| CF-11 | Operador lector no ve acciones de anticipos y recibe 403 al intentar reversos |
| CF-12 | Aplicación 25 y reverso: otro operador ve saldo 400→375→400 sin recarga |
| CF-06 | Reversar anticipo y anular factura; Volver no cancela; confirmar cancela venta conservando historial |

CF-06 se ejecuta al final, después de proveedores y sincronización. No se omite.
CF-12 certifica la actualización local de las operaciones anteriores y Facturas
entre sesiones; no se presenta como una nueva certificación visual de todos los
datasets de Reportes. El alcance original más amplio queda como ampliación.

## Invariantes

Después de cada checkpoint, documentos de control iguales al snapshot previo,
cero WR/Cargues/movimientos de almacén. Los rechazos API comparan snapshots de
ventas, PO, facturas, pagos, anticipos, aplicaciones/reembolsos y audit_log antes
y después. No deben escribir ni siquiera una auditoría de éxito.

Los importes salen de las vistas canónicas. `executive_cash_movement_source`
usa event_type/event_id/payment_date/direction; amount es positivo en entradas y
salidas. La prueba agrega con signo según direction, sin cambiar la vista ni
simular cálculos comerciales. Aplicar anticipos no añade eventos; reversar un
registro erróneo lo excluye de caja activa sin borrar su historia.

Ruta neta USD comprobada: 100 → 80 → 100 → 40 (pago proveedor 60) → 100 → 0.
Los reversos son correcciones de registros erróneos, no transferencias bancarias
ni reembolsos reales. La cancelación comercial no mueve dinero automáticamente.

## Defecto reproducido y corrección

Run `34468562737`, head `42caa05`: fallo antes del primer caso porque la base QA
no tenía SELECT de load_expediente_documents usado por el workspace. Se aplican
solo a QA los mismos grants/shape de la suite comercial aprobada. La prueba
anterior también consultaba columnas inexistentes de caja y sumaba salidas como
entradas: se corrige el test, no los modelos productivos.

Head `f1513aa`, run `34469576506`: Chromium completó once checkpoints y llegó al
último paso con cancel capability true. Faltaba en la UI `[data-ws-action="cancel_sale"]`.
Artefacto `10149004195` inspeccionado, SHA256
`21e119daaee8ff85cdc11bfb8dcc585438e718279e911093019db4c7c0772bb7`.
Cero errores JavaScript/crashes/tráfico externo; no se sustituyó el clic por RPC.

Head `43a1a13`: se añade únicamente la ruta de cancelación en sales-workspace.js,
gobernada por la capability existente. Reutiliza diálogo y controller, maneja
rechazos async y mensajes públicos, conserva historial y muestra confirmación.
Asset `20260910-cancel1`. Sin migraciones ni cambios de API/reglas financieras.

Chromium completó los doce checkpoints en `34470426976`; artefacto inspeccionado
`10149320361`, SHA256 `08b3c28b9f070832ef697ffcce2360dc0df0a602bb8fde6eaae7329b62e61cf9`.
Caja final 0, sin errores JS/crashes/tráfico externo ni API 404/5xx. El gate del
owner ejercita seis combinaciones de capabilities y confirmación/declinación/
denegación/rechazos públicos e internos sobre las funciones reales. Se alinean
los gates que fijaban la revisión antigua del asset sin eliminar sus contratos.

## Límites y cierre

Verificar CI del head FINAL y ambos motores, no solo evidencia intermedia.
Mantener operators/commercial/Direct Ship; ocho jobs por matriz de navegador.
Antes de fusionar: Preview READY, revisión de diff y autorización vigente. Después:
merge/deployment/aliases/assets y protección sin sesión, registrados en PR #297.

CF-06 anula la factura antes de cancelar; no certifica todas las combinaciones de
cancelación con facturas activas, todo el refresco visual de Reportes ni finanzas
de cada variante Direct Ship. No cambios en datos o permisos reales. Sin mensajes
externos ni nuevos paquetes productivos. WebKit es emulado, no Safari/iPhone real,
PWA instalada ni push. BrowserStack no se reintenta manualmente por cuota.

Mantener riesgo de menú inicial móvil intermitente en revisión. Tras este bloque,
Tracking/documentos/tareas/notificaciones; después mejoras y auditoría integral.
