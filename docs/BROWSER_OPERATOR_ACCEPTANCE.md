# Aceptación en navegador de dos operadores

Fecha: 2026-09-09. Base: `a9698ea1f573836ccbf22b697bcd2767cfa0679a`.
Rama: `test/browser-operator-acceptance`. Estado: publicado; 20/20 escenarios y 52/52 workflows de PR aprobados.

## Dependencias y alcance

Se conservan los owners de Facturación (`admin/invoices.js`), navegación (`admin/navigation-shell.js`), permisos, sesión y sincronización (`admin/embedded-auto-refresh.js`). Los handlers originales se sirven sobre HTTP con PostgreSQL 17.6 y PostgREST 12.2.3 desechables. Se reutiliza el esquema y las cuentas aleatorias del bloque de operadores. La extensión del servidor QA únicamente permite servir archivos públicos y handlers adicionales; no sustituye autenticación, SQL ni respuestas.

Cada job tiene su propia base vacía, dos contextos de navegador y usuarios diferentes. No admite URL de ERP remoto ni secretos productivos. Los cambios de rol y revocación se preparan por API autenticada con el master QA; su efecto se comprueba en pantalla. Los cobros se realizan exclusivamente con el formulario real. No se prueban aquí las pantallas de administración de roles.

## Matriz definida antes de modificar código productivo

| ID | Resultado requerido |
|---|---|
| UI-01 | Entrada PWA al login; dos identidades reales y factura de USD 400 |
| UI-02 | A cobra USD 120; ambas pantallas muestran saldo 280 sin navegar; actor auditado |
| UI-03 | B conserva monto/notas mientras A cobra 60; saldo 220 al cerrar el editor |
| UI-04 | Cobro excesivo rechazado en pantalla; ningún asiento nuevo |
| UI-05 | Quitar escritura retira acciones y muestra aviso de lectura en la sesión abierta |
| UI-06 | Restituir permiso vuelve a habilitar acciones sin login adicional |
| UI-07 | B recupera saldo 195 tras volver la conexión; sin recarga de shell ni iframe |
| UI-08 | Recarga deliberada conserva sección/sesión; una sección visible y sin desborde horizontal |
| UI-09 | Revocar B conduce a login; A mantiene la sesión |
| UI-10 | Nuevo login de B conserva saldo; exactamente tres cobros, suma USD 205 |

## Evidencia y límites

El workflow `Browser Operator Acceptance` genera capturas y diagnósticos de API sin guardar contraseñas ni tokens. Dependencia de pruebas aislada: Playwright 1.61.1, versión e integridades del lockfile ya usado por el repositorio. No usa BrowserStack ni modifica su control de cuota. Las dos variantes son Chromium de escritorio y WebKit con viewport/tacto de iPhone 13 en Linux: esta última es emulación, no un iPhone real ni una PWA instalada. La entrada PWA y el service worker originales permanecen activos.

La [guía oficial de CI](https://playwright.dev/docs/ci-intro) y la [documentación de emulación](https://playwright.dev/docs/emulation) describen esa separación de motores/dispositivos. Preview continúa apuntando a producción y solo admite comprobaciones de entrada. No se certifican con este bloque Storage, integraciones externas, todos los recorridos comerciales, notificaciones push ni la auditoría integral.

## Defecto reproducido y corrección

Primera ejecución Chromium, run `34399244149`, head `a01b455`: UI-01 a UI-04 aprueban; UI-05 falla porque retirar `finance.write` deja el botón de cobro y las capacidades anteriores en pantalla. El backend ya impide escribir con el permiso retirado; el defecto es de actualización de interfaz. `account` refrescaba únicamente permisos/cuenta nativos y no invalidaba los módulos embebidos.

La corrección integra el ámbito `account` en el mapa existente de módulos dependientes; reutiliza su refresco y aplazamiento por editor, sin observers ni wrappers adicionales. Runtime `20260909-live7` y contratos de carga actualizados conjuntamente. Dos regresiones del runtime verifican invalidación por cambio de rol sin modificación comercial, silencio si la versión no cambia y conservación del modal. La segunda ejecución Chromium (`34400008852`, head `8319d83`) confirmó UI-01 a UI-08, incluyendo retirada y restitución de escritura. La revocación terminó antes del timeout y se instrumentó el ciclo de página para identificar su causa. WebKit confirmó que el cierre del detalle no recibe el clic: la captura muestra el encabezado sobre el botón. El iframe tenía un mínimo de 720 px y podía desplazar su diálogo detrás del encabezado fijo. El CSS del shell ahora reserva un viewport completo bajo el encabezado, con altura dinámica; la prueba exige que iframe y cierre queden accesibles. Ambos cambios conservan los owners existentes.

El servidor aislado también sirve los handlers originales de publicaciones y pagos a proveedores que cargan los módulos presentes. Las rutas API inexistentes (404), errores 5xx, errores JavaScript y salidas de red externas son fallos de aceptación. Las respuestas 403 de módulos sin permiso son esperadas.

## Tercera ejecución: causa de la interrupción de escritorio

Run `34401066282`, head `99006ad`: WebKit móvil aprobó los diez escenarios, sin errores JavaScript, salidas externas, API 404 ni 5xx. Capturas revisadas: formulario preservado y workspace separado del encabezado. Chromium volvió a aprobar UI-01 a UI-08 y registró `page-crash` al revocar B. El log nativo identifica `No binder found for interface blink.mojom.BadgeService for the service worker scope`, seguido de terminación del renderer. La limpieza de badge del service worker provoca el fallo del ejecutable reducido `chrome-headless-shell`; no se altera la implementación de sesión ni el service worker del ERP.

Se configura `channel: chromium`, el [modo headless de Chromium completo documentado por Playwright](https://playwright.dev/docs/browsers#chromium-new-headless-mode), manteniendo las mismas diez exigencias y ambos operadores. La nueva ejecución aprobó: ver evidencia final.

## Evidencia final antes de integrar main

[Run 34401479844](https://github.com/mikro970328-sys/-export-mca-portfolio/actions/runs/34401479844), head `26cf44003b17767381e25581546190506f589219`: diez de diez escenarios en Chromium completo y diez de diez en WebKit móvil. Los 52 workflows del head aprobaron. Ambos diagnósticos registran cero errores JavaScript, API 404, API 5xx, peticiones externas o caídas de página. Capturas revisadas del detalle (cierre bajo el encabezado), formulario conservado, revocación y saldo final USD 195; tres cobros por un total de USD 205. Preview `dpl_FsU26kh4ANZUpSzhXMcZgUKhsk22` READY y entrada PWA al login verificada.

Durante la validación se publicaron #290/#291 en main `58f523b9e08525285dc9e353abc43faf1d8b9586`, con una prueba visual inicial independiente. Se integran conservando sus archivos y su registro; la matriz de esta PR amplía permisos, formularios, conexión/sesión y WebKit. La versión combinada aprobó los controles antes de publicarse; ver el cierre siguiente.

## Cierre publicado

Publicado mediante [PR #289](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/289), commit `55c6ae255b7abcd26068b941f0bc7c43c9f7d1d4`. Producción `dpl_4pshzRmzZGJmzntku1i5K8mz4KYG` READY.

Run final de PR `34402541189`, head `cb133dda4e8c2e165e4fd9f48ecd5c5b9e7927b5`: 20/20 escenarios (diez por motor), 52/52 workflows; 55 check runs aprobados y uno omitido por condición. Preview `dpl_enFr3jigPxHr9aK9hLRHyo1qb2Be` READY y entrada PWA al login verificada. La prueba visual inicial de #290 también aprobó. El merge conservó el ajuste de configuración #292. No hay cambios de reglas financieras, migraciones ni datos productivos de prueba.

Main: ocho de nueve workflows aprobados, incluidos Browser Operator Acceptance `34402916794` y Operator and Concurrency Acceptance `34402917038`. BrowserStack `34402916772` aprobó su contrato de solo lectura; ambos jobs de iPhone fallaron por `Automate testing time expired`, sin reintentos manuales.

Producción: PWA, shell, runtime live7 y ambos CSS viewport1 responden HTTP 200; las revisiones publicadas contienen las correcciones. API de versiones y Facturas responden HTTP 401 sin sesión. Consulta de logs 5xx para este deployment sin resultados en el intervalo observado 20:37:06–20:47:06 UTC.

La emulación móvil valida este flujo con WebKit en Linux; quedan pendientes el dispositivo iPhone, instalación standalone, push del dispositivo y otros recorridos transversales. La auditoría integral sigue después del cierre funcional y las mejoras.
