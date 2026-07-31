# Matriz de pruebas de Clientes — Export MCA ERP

Fecha: 2026-07-30
Estado: baseline previo al refactor

## 1. Propósito

Esta matriz define las pruebas mínimas que debe aprobar cualquier consolidación del módulo Clientes. No autoriza pruebas destructivas sobre datos reales.

## 2. Reglas de ejecución

- Ejecutar primero pruebas estáticas y de lectura.
- Usar una rama funcional separada.
- Usar Preview de Vercel para interfaz, pero confirmar antes qué Supabase utiliza la Preview.
- Si la Preview apunta a producción, utilizar únicamente registros de prueba identificables y no ejecutar escenarios destructivos con relaciones.
- No eliminar clientes existentes.
- No cambiar nombres técnicos de columnas durante esta fase.
- Registrar fecha, navegador, dispositivo, commit y resultado de cada prueba.

## 3. Datos de prueba propuestos

Crear, cuando el entorno lo permita, un cliente descartable con valores inequívocos:

- Nombre: `QA Cliente Clientes <fecha-hora>`
- Empresa: `QA Empresa`
- MIPYME: `QA MIPYME`
- Importadora: `QA Importadora`
- WhatsApp: número de prueba autorizado
- Correo: alias de prueba único

Nunca utilizar números o correos de clientes reales para pruebas de duplicados o WhatsApp.

## 4. Matriz

### A. Autenticación y carga

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-AUTH-001 | Sesión nueva | Iniciar sesión y abrir Clientes | El módulo carga sin error y muestra la lista |
| CL-AUTH-002 | Sesión restaurada | Cerrar y volver a abrir la PWA con token válido | Se restaura la sesión y Clientes funciona |
| CL-AUTH-003 | Token vencido | Probar con sesión expirada controlada | El sistema vuelve al login sin dejar la interfaz a medias |
| CL-LOAD-001 | Carga normal | Abrir Clientes con red disponible | Una sola lista consistente; sin filas duplicadas |
| CL-LOAD-002 | Actualización global | Ejecutar la acción de actualización disponible | Clientes y selectores se sincronizan |
| CL-LOAD-003 | Error API | Simular respuesta fallida en entorno de prueba | Se muestra error comprensible y no se destruye el DOM |

### B. Formulario

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-FORM-001 | Campos visibles | Abrir Agregar cliente | Se muestran Nombre, Empresa, MIPYME, Importadora, WhatsApp y Correo |
| CL-FORM-002 | Un solo botón | Inspeccionar formulario después de varios renders | Existe un único `saveClient` y un único manejador |
| CL-FORM-003 | Orden estable | Cambiar entre secciones y volver | Los campos conservan orden y no se duplican |
| CL-FORM-004 | Responsive | Abrir en ancho móvil | Campos y botón son utilizables sin desbordamiento |
| CL-FORM-005 | Accesibilidad básica | Navegar con teclado | Cada etiqueta corresponde al control correcto y el foco es visible |

### C. Creación

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-CREATE-001 | Cliente completo | Completar los seis campos y guardar | Se crea una sola fila con todos los valores correctos |
| CL-CREATE-002 | Campos opcionales vacíos | Crear con nombre y WhatsApp, dejando opcionales vacíos | Se crea y los opcionales quedan nulos o vacíos de forma consistente |
| CL-CREATE-003 | Nombre vacío | Intentar guardar sin nombre | API rechaza con “El nombre del cliente es obligatorio” |
| CL-CREATE-004 | WhatsApp inválido | Usar un formato no válido | Se muestra error de formato; no se crea cliente |
| CL-CREATE-005 | Correo normalizado | Guardar correo con mayúsculas y espacios | Se almacena normalizado a minúsculas |
| CL-CREATE-006 | Doble clic | Presionar Guardar repetidamente | El botón se deshabilita y no se crean duplicados |
| CL-CREATE-007 | Duplicado por teléfono | Usar teléfono existente de un registro QA | API responde 409 y muestra el cliente existente sin crear otro |
| CL-CREATE-008 | Duplicado por correo | Usar correo existente de un registro QA | API responde 409 y no crea otro registro |
| CL-CREATE-009 | Limpieza del formulario | Crear correctamente | Se limpian los seis campos una sola vez |
| CL-CREATE-010 | Estado inicial de bienvenida | Crear cliente | `welcome_status` queda `pending`; no se afirma que se envió si no ocurrió |

### D. Listado

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-LIST-001 | Datos principales | Revisar cliente completo | Los valores visibles corresponden al registro guardado |
| CL-LIST-002 | Valores vacíos | Revisar cliente con opcionales vacíos | Se muestra un marcador claro, no `undefined` |
| CL-LIST-003 | Escape HTML | Guardar texto QA con caracteres especiales permitidos | Se muestra como texto y no se ejecuta HTML |
| CL-LIST-004 | Estado bienvenida | Revisar pending, sent y failed | El estado y la acción disponible son coherentes |
| CL-LIST-005 | Render repetido | Ejecutar varias actualizaciones | No aparecen botones, menús o filas duplicados |
| CL-LIST-006 | Tabla móvil | Abrir en teléfono | La tabla o vista responsive permite acceder a todas las acciones |

### E. Acciones y menú

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-ACT-001 | Menú escritorio | Abrir `⋮` | Aparecen Editar, acción de bienvenida, Historial y Eliminar |
| CL-ACT-002 | Menú móvil | Abrir acciones en móvil | Se abre una hoja utilizable y se puede cerrar |
| CL-ACT-003 | Cerrar exterior | Tocar fuera del menú | El menú se cierra sin activar otra fila |
| CL-ACT-004 | Escape | Presionar Escape en escritorio | El menú se cierra |
| CL-ACT-005 | Acción por clave | Inspección funcional | Las acciones no dependen de ser el segundo botón o la cuarta columna |
| CL-ACT-006 | Re-render con menú | Actualizar lista | No quedan backdrops o popovers huérfanos |

### F. Edición

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-EDIT-001 | Editar nombre | Cambiar solo nombre | Solo cambia el nombre y queda auditoría |
| CL-EDIT-002 | Editar empresa | Cambiar `company` | Se actualizan listado, selectores, búsqueda y CSV |
| CL-EDIT-003 | Editar MIPYME | Cambiar `mipyme_name` | Se actualiza el detalle de cliente/contenedor y CSV |
| CL-EDIT-004 | Editar importadora | Cambiar `importer_name` | Se actualiza el detalle y CSV |
| CL-EDIT-005 | Editar teléfono | Cambiar a número QA válido | Se normaliza y se usa en futuros mensajes |
| CL-EDIT-006 | Editar correo | Cambiar correo | Se normaliza a minúsculas |
| CL-EDIT-007 | Nombre vacío | Borrar nombre y guardar | API rechaza; registro original permanece |
| CL-EDIT-008 | Colisión por teléfono | Cambiar a teléfono de otro QA | API responde 409; no sobrescribe datos |
| CL-EDIT-009 | Colisión por correo | Cambiar a correo de otro QA | API responde 409; no sobrescribe datos |
| CL-EDIT-010 | Cancelar | Cancelar edición antes de guardar | No hay petición PATCH ni cambios |
| CL-EDIT-011 | Sin consulta adicional | Abrir edición tras cargar lista | Usa el objeto ya cargado; no necesita otro GET de Clientes |

### G. Bienvenida por WhatsApp

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-WA-001 | Plantilla ausente | Ejecutar bienvenida en entorno sin SID | Estado `pending`, error registrado y notificación persistida |
| CL-WA-002 | Envío aceptado | Usar número QA autorizado y plantilla válida | Estado `sent`, SID, fecha y auditoría registrados |
| CL-WA-003 | Falla proveedor | Simular fallo de Twilio | Estado `failed`, error visible y registro persistido |
| CL-WA-004 | Reintento | Reintentar una bienvenida fallida | Aumenta el intento correspondiente y actualiza estado |
| CL-WA-005 | Etiqueta pending | Revisar acción | Muestra “Enviar bienvenida” |
| CL-WA-006 | Etiqueta sent | Revisar acción | Muestra “Reenviar bienvenida” |
| CL-WA-007 | Etiqueta failed | Revisar acción | Muestra “Reintentar bienvenida” |
| CL-WA-008 | No duplicación accidental | Abrir/cerrar menú y refrescar | No se envía nada sin confirmación explícita |

### H. Historial

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-HIST-001 | Creación | Abrir historial tras crear QA | Aparece auditoría de creación |
| CL-HIST-002 | Edición | Editar y abrir historial | Aparece actualización con fecha correcta |
| CL-HIST-003 | Bienvenida | Enviar o fallar bienvenida | Aparece notificación y auditoría relacionada |
| CL-HIST-004 | Eventos de shipment | Asociar contenedor QA | Los eventos relacionados aparecen sin duplicación artificial |
| CL-HIST-005 | Orden | Revisar varios eventos | Se ordenan por fecha descendente |
| CL-HIST-006 | Historial vacío | Cliente QA sin eventos adicionales | Se muestra estado vacío comprensible |

### I. Dependencias con Contenedores

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-SHIP-001 | Selector inicial | Abrir Registrar contenedor | El cliente QA aparece una sola vez |
| CL-SHIP-002 | Etiqueta selector | Revisar opción | Muestra la convención aprobada de nombre y empresa |
| CL-SHIP-003 | Actualización selector | Editar cliente y volver al selector | La opción refleja el cambio sin recargar toda la página |
| CL-SHIP-004 | Crear shipment QA | Seleccionar cliente QA y registrar contenedor de prueba autorizado | `client_id` queda correcto |
| CL-SHIP-005 | Búsqueda por empresa | Buscar el valor de `company` | Se encuentra el contenedor relacionado |
| CL-SHIP-006 | Detalle | Abrir detalle de la fila | Muestra nombre, MIPYME, importadora, teléfono, correo y bienvenida correctos |
| CL-SHIP-007 | Sin GET duplicado | Abrir detalle después de cargar | No vuelve a descargar toda la lista de clientes por cada render |

### J. Dependencias con Expedientes

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-OPS-001 | Selector | Abrir Nuevo expediente | El cliente QA aparece una sola vez |
| CL-OPS-002 | Convención estable | Actualizar `loadAll` varias veces | La etiqueta no cambia entre dos formatos distintos |
| CL-OPS-003 | Crear expediente QA | Seleccionar cliente QA | `operations.client_id` queda correcto |
| CL-OPS-004 | Listado | Revisar expediente | Se muestra el nombre correcto |
| CL-OPS-005 | Exportación | Exportar expedientes | Cliente y empresa corresponden al registro |

### K. Dashboard y alertas

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-DASH-001 | Conteo activo | Crear cliente QA | El total activo aumenta en uno después de refrescar |
| CL-DASH-002 | Bienvenida pendiente | Crear cliente QA pendiente | La alerta pendiente refleja el estado |
| CL-DASH-003 | Bienvenida enviada | Enviar bienvenida QA | El conteo pendiente se actualiza |
| CL-DASH-004 | Cliente inactivo | Solo en entorno aislado | No se cuenta como activo |

### L. Exportaciones

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-CSV-001 | CSV clientes | Exportar Clientes | Contiene las ocho columnas actuales y datos correctos |
| CL-CSV-002 | CSV tracking | Exportar Tracking | Nombre, empresa, teléfono y correo correctos |
| CL-CSV-003 | CSV expedientes | Exportar Expedientes | Nombre y empresa correctos |
| CL-CSV-004 | CSV notificaciones | Exportar Historial | Nombre y destinatario correctos |
| CL-CSV-005 | Caracteres especiales | Usar comas y comillas en registro QA | CSV permanece válido y escapado |
| CL-CSV-006 | UTF-8 | Usar acentos | Excel abre los caracteres correctamente |

### M. Eliminación y seguridad de datos

| ID | Escenario | Entorno permitido | Resultado esperado |
|---|---|---|---|
| CL-DEL-001 | Cancelar eliminación | Cualquier entorno | No se ejecuta DELETE |
| CL-DEL-002 | Cliente descartable sin relaciones | Solo registro QA verificado | Se elimina únicamente el cliente esperado |
| CL-DEL-003 | Cliente con shipment | Base aislada o fixture | Se documenta la cascada; no ejecutar en producción |
| CL-DEL-004 | Cliente con operación/factura/pago | Base aislada o fixture | La eliminación es bloqueada por `RESTRICT` |
| CL-DEL-005 | Historial con SET NULL | Base aislada o fixture | El evento permanece y `client_id` queda nulo |
| CL-DEL-006 | Confirmación reforzada | Futuro refactor | La UI informa dependencias antes de una eliminación física |

### N. Escritorio, móvil y PWA

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-UI-001 | Escritorio | Chrome/Safari en ancho amplio | Formulario, tabla y menús funcionan |
| CL-UI-002 | iPhone Safari | Navegador móvil | No hay bloqueo de scroll ni botones inaccesibles |
| CL-UI-003 | PWA instalada | Abrir desde pantalla de inicio | Carga Clientes y mantiene sesión según contrato actual |
| CL-UI-004 | Rotación | Cambiar orientación | Menús se cierran o reposicionan correctamente |
| CL-UI-005 | Recuperar foco | Mandar PWA a background y volver | No duplica campos, botones ni peticiones |
| CL-UI-006 | Red lenta | Simular conexión lenta | Botones muestran estado y evitan doble envío |

### O. Rendimiento y estabilidad

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| CL-PERF-001 | Observadores | Inspección estática | Cero `MutationObserver` dedicados a Clientes |
| CL-PERF-002 | Reemplazo de botón | Inspección estática | No se usa `cloneNode`/`replaceWith` para Guardar cliente |
| CL-PERF-003 | Función única | Inspección estática | Una sola implementación de crear y editar |
| CL-PERF-004 | Peticiones al cargar | DevTools | Una petición principal a `/api/clients` por ciclo de carga |
| CL-PERF-005 | Editar | DevTools | No hay GET adicional si el cliente ya está en memoria |
| CL-PERF-006 | Render repetido | Ejecutar 20 actualizaciones controladas | Sin crecimiento de listeners, menús o backdrops |
| CL-PERF-007 | Consola | Ejecutar todos los flujos | Sin errores JavaScript no manejados |

## 5. Pruebas que deben automatizarse posteriormente

### Unitarias

- normalización y validación de payload de cliente;
- etiqueta de acción según `welcome_status`;
- construcción de opciones de selector;
- escape de HTML;
- detección de campos modificados.

### API

- POST válido e inválido;
- duplicados por teléfono y correo;
- PATCH parcial;
- PATCH con conflicto;
- `resend_welcome` en pending, sent y failed;
- GET ordenado;
- DELETE en fixture con cada tipo de relación.

### End-to-end

- login → crear cliente → editar → enviar bienvenida → abrir historial;
- crear cliente → seleccionarlo en contenedor;
- crear cliente → seleccionarlo en expediente;
- vista móvil/PWA del menú de acciones.

## 6. Criterio de aprobación de la futura PR funcional

La PR de consolidación no podrá fusionarse hasta que:

- todas las pruebas no destructivas aplicables estén aprobadas;
- los escenarios destructivos estén probados en base aislada o marcados como bloqueados con razón documentada;
- no exista ningún `MutationObserver` de Clientes;
- no se reemplace `saveClient` después de cargar;
- no se sobrescriba `editClient` desde un parche;
- no haya consultas duplicadas de Clientes durante edición o detalle;
- Contenedores, Expedientes, Dashboard, Historial y CSV mantengan sus contratos;
- se documente el rollback;
- el usuario apruebe explícitamente la integración a `main`.

## 7. Registro de ejecución

| Fecha | Commit | Entorno | Navegador/dispositivo | Pruebas ejecutadas | Resultado | Responsable |
|---|---|---|---|---|---|---|
| Pendiente | — | — | — | — | — | — |
