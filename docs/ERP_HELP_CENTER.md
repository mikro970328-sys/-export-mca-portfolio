# Centro de ayuda del ERP de escritorio

Solicitud de Daniel, 26 de septiembre de 2026: incorporar una guía completa de trabajo y resolución de problemas dentro del ERP. iPhone queda fuera del alcance.

## Entrega

- Entrada nativa **Ayuda** al final del menú, disponible para todas las cuentas autenticadas.
- 43 artículos en siete temas: primeros pasos; ventas y clientes; compras y almacén; logística y documentos; finanzas; equipo y avisos; solución de problemas.
- Búsqueda por palabras, títulos, pasos y sinónimos, sin distinguir mayúsculas ni acentos; filtro de tema, estado vacío y retorno que conserva la búsqueda.
- Guías con pasos, comprobación del resultado, precauciones y artículos relacionados. Recorridos completos por almacén y Direct Ship, rutina diaria y glosario.
- Acceso al módulo que vuelve a comprobar su permiso al pulsarlo. Leer instrucciones no concede permisos.
- Impresión del artículo y plantilla copiable para escalar incidencias, con selección manual si el navegador impide copiar. No envía el reporte automáticamente.

La guía no promete resolver cualquier fallo. Explica cuándo detenerse y escalar al administrador; no inventa canales de soporte ni ejecuta correcciones, movimientos comerciales, mensajes o cambios de permisos.

## Propiedad y contenido

`admin/help-content.js` es el catálogo editorial. `admin/help-center.js` presenta y busca ese contenido; `admin/help-center.css` limita sus reglas a la sección. El markup estático pertenece a `admin/index.html`, la jerarquía al owner existente `navigation-shell.js` y el icono a `ui-icon-system.js`. No hay iframe de ayuda, observer compensatorio ni wrapper nuevo de navegación/autenticación.

El loader autenticado carga contenido antes del renderer. Si falla la ayuda, presenta un mensaje recuperable y permite continuar el arranque de las demás áreas. El catálogo contiene únicamente instrucciones generales, nunca datos comerciales ni credenciales. No requiere API, esquema, permisos adicionales, dependencias, IA o servicio externo.

| Guías | Fuentes del comportamiento revisadas |
|---|---|
| Navegación y acceso | `navigation-shell.js`, `admin-shell-runtime.js`, `section-state.js`, `access-control-administration.js`, `account-administration.js` |
| Compra, recepción, almacenes y cantidades | `purchases.js`, `warehouse.html`, `warehouse.js`, `warehouse.css`, aceptación de compras/inventario |
| Venta y Direct Ship | `sales.js`, `purchases.js`, `api/sales-supply.js`, aceptación de Direct Ship y logística |
| Documentos y tracking | Owners de contenedores/documentos, aceptación de tracking/documentos y reglas de integración P19 |
| Facturación, anticipos, proveedores, gastos y reportes | Owners financieros y `docs/FINANCE_ACCEPTANCE.md`; regresión financiera y controles de lectura de la auditoría |
| Personal, tareas y avisos | Owners de usuarios, trabajadores, tareas, rutas, supervisión, alertas y bandeja |
| Incidencias | Errores de los handlers, políticas de recuperación/reintento, permisos, estados y dependencias protegidas |

Las instrucciones siguen el alcance actual: el seguimiento se mantiene en el ERP; WhatsApp solo contempla bienvenida manual y hitos de salida/liberación. No se reintroduce el proveedor de tracking retirado ni se enseñan mecanismos para eludir permisos.

## Validación

- `node scripts/check-help-center.mjs`: integridad del catálogo, cobertura de secciones, enlaces relacionados, búsquedas, ausencia de tráfico comercial, permisos, revocación antes del clic y copia alternativa.
- `e2e/isolated/help-center.spec.mjs`: integración con el shell y control de acceso reales, administrador y cuenta restringida, navegación, filtros, accesibilidad del foco, impresión, copia fallida y pantallas de 1440/1024 px. Datos en memoria, tráfico externo bloqueado.
- Se incluye en Browser Operator Acceptance. Las pruebas de navegación y los contratos de caché existentes conservan sus exigencias, actualizando únicamente las referencias de los archivos modificados.
- Chequeos locales de ownership, integración P19 y los trece contratos de versión afectados aprobados. Composición completa en jsdom: ayuda visible para ambas cuentas, 43 artículos y enlace de administración bloqueado para la cuenta restringida.
- Head final probado `d9dabb84350491368e6f7c482104332be6dee982`, árbol `2bc760c6b7ce3802b63d2b74a5910af48a8c09ef`: **37/37 workflows aprobados**. Browser Operator Acceptance `36257733293`: **22/22 trabajos**, **179/179 pruebas visuales/de interfaz en Chromium** y **179/179 en WebKit**. Capturas de índice, guía y reporte revisadas a 1440/1024 px.
- Las pruebas generales detectaron y se corrigió un conflicto de arranque: Ayuda no participa como destino automático antes de que existan los módulos diferidos; sí se restaura cuando el usuario la eligió. `navigation-startup.spec.mjs` verifica apertura y recarga de Ayuda con un operador restringido; los recorridos existentes de Facturas, Gastos y Almacén conservan sus exigencias.
- La impresión se aplica solo con Ayuda activa. La prueba comprueba que Mi cuenta sigue visible al imprimir fuera de Ayuda. Las capturas desactivan animaciones para registrar el estado final.

## Publicación verificada

- PR **#360** integrado en main `f802588c7e80b049ca7121b42874325e88a536a6`; árbol idéntico al candidato probado.
- Vercel **`dpl_6uEJNkkvk2PCMUfn7zyaFDmth2gB` READY** el 26 de septiembre de 2026.
- GET a `https://admin.exportmca.com`: siete archivos con HTTP 200 y bytes idénticos al código probado: `index.html`, `erp.js`, `navigation-shell.js`, `ui-icon-system.js`, `help-center.js`, `help-center.css`, `help-content.js` dentro de `/admin/`.
- Ruta de uso: **ERP → Ayuda → Tu primer día en el ERP**. También se puede buscar una tarea o problema directamente.
- Verificación en memoria y bases desechables; sin escrituras QA en producción/Preview, envíos reales ni cambios de datos o permisos. No certifica preparación operativa de los catálogos ni el iPhone físico.

## Mantenimiento

Al cambiar una acción de negocio, revisar su guía en el mismo PR, actualizar la fecha editorial y ejecutar el verificador. Añadir artículos relacionados solo con identificadores existentes. No insertar datos productivos, nombres de usuarios, saldos, URLs privadas ni secretos. No copiar errores internos completos al contenido de ayuda.
