# AI Context — Export MCA ERP

Última actualización: 2026-09-10 UTC.

## Punto de entrada vigente

Continuar desde **PR #297**, rama `test/cancellation-finance-browser-acceptance`.
Leer `CURRENT_STATE.md` y `CANCELLATION_FINANCE_BROWSER_ACCEPTANCE.md`; después
verificar estado de PR, head exacto, CI y deployment. La matriz de doce checkpoints
amplía anticipos/aplicaciones/reembolsos, AP, cancelación y permisos. Reprodujo la
falta de Cancelar venta en el workspace pese a capability permitida. La corrección
usa el owner/controller existentes, asset `20260910-cancel1`, sin migración SQL.
El corte documental contiene evidencia previa; las notas finales de PR #297
registran aceptación/publicación posteriores. No inferir producción de una rama.

La PR #296 ya está publicada en `af17d6b9bf1cb917fd437b58cbd4c82e31677a1e`,
Vercel `dpl_4hdBSibhzVqLXaN5aza2CBbuWmZM` READY. Direct Ship preserva hora local,
con diez checkpoints por motor; 13 workflows de PR y seis de main aprobados.
La PR #295 también está publicada en `f97c8744ce2e4c4d7ca9d5139cb1fdd65fe314b8`,
producción `dpl_GZpRvCoHJ676YwcGXQ1VCEZ6Nhri`. Compras/Cargues y compra-a-cobro
no son trabajo pendiente. Se conservan #281/#283/#285/#287/#289/#290 y live7.

**Orden solicitado:** cierre funcional y pruebas, luego mejoras de interfaz,
finalmente auditoría integral. Seguridad/regresión de cada entrega no esperan
hasta la auditoría final. No empezar de cero ni reabrir fases sin evidencia.

## Lecturas y fuentes de verdad

Leer al menos: este archivo, `CURRENT_STATE.md`, `TECH_DEBT_INVENTORY.md`,
`CLEANUP_PLAN.md`, `CHANGELOG.md` y la documentación del módulo afectado.
Los diagnósticos de julio/agosto son históricos: contrastar con código/CI.
El corte previo completo se conserva en `history/CURRENT_STATE_20260910_DIRECT_SHIP.md`
y el anterior en `history/CURRENT_STATE_20260909.md`.

- Empresa Export MCA LLC; repo `mikro970328-sys/-export-mca-portfolio`.
- Producción `main`; Vercel Serverless Functions y Supabase PostgreSQL.
- Frontend HTML/CSS/JavaScript; autenticación administrativa personalizada.
- Dominios `admin.exportmca.com` y `app.exportmca.com`.
- Clientes: `clients` y `/api/clients`; contenedores: `shipments` y `/api/shipments`.
- Historial: `shipment_history` y `audit_log`; usuarios: `admin_users`.
- Integraciones ShipsGo y Twilio WhatsApp; no depender de ellas para QA comercial.
- `admin/pwa.html` es entrada al shell, no un segundo ERP dentro de un iframe.

## Método de trabajo obligatorio

1. Identificar módulo, owner, dependencias y comportamiento que debe conservarse.
2. Definir regresión antes del cambio; reproducir el fallo y separar defectos
   reales de carencias del entorno QA.
3. Trabajar en rama desde main vigente; preservar trabajo simultáneo. No cambios
   funcionales directos en main ni force-push para ocultar conflictos.
4. Corregir la fuente canónica. No mezclar refactor con funciones nuevas ni
   cambios visuales con migraciones de datos.
5. Ejecutar gates del head exacto, comprobar Preview READY y resultados de
   escritorio/móvil/PWA con sus límites expresos.
6. Actualizar estado, changelog y matriz; fusionar con autorización del
   propietario y expected head. La autorización de pruebas, correcciones e
   integración ya fue concedida en la sesión que origina este corte.
7. Verificar merge/deployment/assets/APIs y registrar limitaciones; una Preview
   READY no demuestra funcionamiento autenticado ni publicación.

## Seguridad operacional

- No QA comercial en producción o Preview: comparten base. Usar exclusivamente
  PostgreSQL/PostgREST desechables; los inicializadores rechazan bases remotas.
- No enviar WhatsApp/correos/push de prueba a clientes reales.
- No almacenar tokens, cookies ni contraseñas en artefactos/capturas/logs.
- No exponer Supabase directamente al navegador ni cambiar auth/roles sin
  revisión del owner y pruebas de permisos por identidad.
- No renombrar columnas sin migración auditada ni reinterpretar campos con
  simples etiquetas. Un Direct Ship no crea WR ni inventario propio.
- No añadir MutationObserver ni envolver de nuevo loadAll/showSection/render.
- No identificar acciones de producción por texto visible; usar contratos
  canónicos y atributos estables. No borrar aparente duplicación sin rastreo.
- No quitar capas legacy hasta integrar su conducta necesaria y probarla.
- No desplegar manualmente cuando GitHub ya está generando el deployment.
- No ejecutar la antigua PR de Arquitectura 1.0 en producción durante limpieza.
- No modificar gates ni controles de cuota para forzar aprobación. Versionar
  assets y alinear referencias literales no autoriza eliminar comprobaciones.
- BrowserStack agotó Automate; no reintentos manuales. WebKit emulado no equivale
  a Safari/iPhone real, PWA instalada ni push certificado.

## Siguiente acción

Cerrar aceptación/publicación de #297 si aún falta. Después ampliar recorridos
de Tracking/documentos/tareas/notificaciones y revisión de arranque móvil.
No confundir reverso correctivo con devolución real de dinero. La prueba #297
anula la factura antes de cancelar la venta; no certifica todas las combinaciones
con facturas activas ni refresco visual de cada dataset de Reportes.
Mantener el riesgo de menú inicial WebKit en revisión, sin saltar su matriz.
