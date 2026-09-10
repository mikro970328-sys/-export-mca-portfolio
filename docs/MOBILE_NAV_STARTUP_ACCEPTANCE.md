# Menú móvil durante el arranque — PR #297

Fecha: 2026-09-10 UTC. Base publicada: PR #296 (`af17d6b`).
La corrección de este documento no implica publicación: verificar el head exacto,
la PR #297 y su deployment. No se aceptan reintentos como sustituto de diagnóstico.

## Causa reproducida

El shell se revela antes de cargar módulos/datos no críticos. El menú puede abrirse
cuando NavigationShell ya está instalado y el bootstrap todavía está seleccionando
la primera sección permitida. `section-state.js` emitía section-changed sin origen
y `navigation-shell.js` cerraba el menú incondicionalmente, incluso para esa selección
automática. La carrera también afectaba a la restauración tardía de la sección guardada.
No era un rechazo de permisos ni un cálculo financiero incorrecto.

Commit diagnóstico `b1b6382` añadió observación temporal solo al servidor QA.
El run `34475491485` conservó los recorridos originales y mostró el orden de eventos.
El probe registraba estado/viewport/stack, nunca tokens, contraseñas o inputs.
No se presenta su ejecución normal verde como resolución del fallo intermitente.

Regresión previa a la corrección, head `3e9b49a`, run `34476089054`:
se pausa admin-data-loader.js, se pulsa el menú UNA vez, se confirma que abrió,
se libera el script y se observa que el inicio lo cerró. Chromium artifact
`10151562876`, SHA256 `af8513ad9e6850f8da844b9ddbbd35d0241e90e4da6f2cbd11e716dbf2841ccf`:
a 1386ms estaba abierto; a 1422ms ensureVisibleSection -> showSection -> section-changed
llamó closeMobileMenu. Viewport constante 390x664, sin error JS/404/5xx/red externa.

La primera versión de esa regresión en WebKit no interceptó la petición reenviada
por el service worker y falló en la PRECONDICIÓN de retención del script, antes
del clic. Artifact `10151584624`, no se confunde con un segundo fallo del producto.
Se mueve únicamente la retención de la respuesta al servidor HTTP de QA, manteniendo
serviceWorkers=allow, el handler original, status y bytes intactos. No se fabrica
una respuesta, no se bloquea el worker y no se relajan las aserciones de navegación.

## Corrección canónica

- `erp.js` identifica la selección automática con `{source:'startup'}`.
- El wrapper YA EXISTENTE de `section-state.js` transmite esa causa y también
  identifica sus restauraciones de inicio. Conserva el control de permisos previo.
- `navigation-shell.js` conserva el menú para eventos explícitos de startup.
  Toda navegación normal, incluyendo eventos sin metadata, mantiene el cierre.
- No se retrasa el revelado de la app; no se cambia orden de módulos, auth,
  tareas, compras, finanzas, SQL, APIs ni usuarios. Assets de navegación/sección
  `20260910-startup1`; loader principal permanece en su URL estable y network-first.
- Se retira el probe temporal antes de la aceptación de la corrección.

## Aceptación y límites

`navigation-startup.spec.mjs` añade dos perfiles en cada motor: lector de almacén
con admin-data-loader retenido, operador con permisos comerciales con section-state
retenido. Ambos usan viewport táctil 390x664. Las otras cuatro historias conservan
sus viewports normales; la matriz ahora tiene cinco historias por dos motores.

Cada caso pulsa una vez antes de liberar el script, espera modules-ready y exige
menú abierto/aria-expanded=true. Después selecciona Existencias y verifica cierre;
reabre y cierra con Escape. No hay escrituras comerciales, clicks forzados, esperas
fijas, retries, autenticación inyectada ni mocks de componentes/SQL.

Evidencia post-corrección inspeccionada en WebKit, head `15c7a8d`, run `34477240736`,
artifact `10152106670`, SHA256 `cff9511a0fbc4bb8fafebc6fa03a47d1c48518088580e2eb231b669bae836a2d`:
los dos perfiles terminaron abiertos tras startup, sin errores JS/API/red externa.
Los resultados del head final completo y de producción deben constar en PR #297.
Los gates de revisiones de assets conservan sus comprobaciones y solo actualizan
las cadenas de navegación/sección, no las capacidades ni el orden de módulos.

Este caso demuestra la corrección de la carrera identificada, no ausencia absoluta
de cualquier otro fallo móvil. WebKit emulado no certifica iPhone/Safari físico,
PWA instalada ni push. BrowserStack no se reintenta por cuota. Después de publicar,
continúan Tracking/documentos/tareas/notificaciones y luego mejoras/auditoría.
