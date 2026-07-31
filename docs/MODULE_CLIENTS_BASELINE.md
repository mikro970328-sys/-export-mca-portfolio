# Baseline técnico del módulo Clientes — Export MCA ERP

Fecha de corte: 2026-07-30
Estado: auditoría documental; sin cambios funcionales
Rama: `audit/clients-baseline`

## 1. Objetivo

Registrar cómo funciona realmente el módulo Clientes antes de consolidarlo. Este documento define datos, dependencias, flujos, riesgos y límites del futuro refactor.

No decide todavía nuevos nombres comerciales para los campos. Durante la consolidación se conservarán los contratos actuales hasta que el significado de cada campo sea aprobado expresamente.

## 2. Fuentes inspeccionadas

### Frontend

- `admin/index.html`
- `admin/erp.js`
- `admin/client-extra-fields.js`
- `admin/client-actions-menu.js`
- `admin/erp-core.js`
- `admin/shipment-row-details.js`
- `admin/module-export-controls.js`

### Backend

- `api/clients.js`
- `api/history.js`
- `api/export.js`
- `api/shipments.js`
- `api/operations.js`
- `api/dashboard.js`

### Base de datos

- Tabla `public.clients`
- Llaves foráneas que apuntan a `clients.id`
- Índices, RLS y políticas existentes

## 3. Modelo real de datos

La tabla `public.clients` tiene actualmente estas columnas:

| Columna | Tipo | Nulo | Valor por defecto | Uso actual |
|---|---|---:|---|---|
| `id` | uuid | No | `gen_random_uuid()` | Identificador principal |
| `name` | text | No | — | Nombre completo del cliente |
| `company` | text | Sí | — | Se muestra actualmente como “Empresa” y se usa en selectores, búsqueda y CSV |
| `phone` | text | No | — | WhatsApp normalizado por la API |
| `email` | text | Sí | — | Correo normalizado a minúsculas |
| `active` | boolean | No | `true` | Conteo de clientes activos |
| `created_at` | timestamptz | No | `now()` | Fecha de creación |
| `updated_at` | timestamptz | No | `now()` | Última modificación |
| `welcome_status` | text | No | `'pending'` | Estado de bienvenida |
| `welcome_sent_at` | timestamptz | Sí | — | Fecha del envío exitoso |
| `welcome_error` | text | Sí | — | Último error de bienvenida |
| `mipyme_name` | text | Sí | — | Nombre de la MIPYME; campo añadido al formulario mediante parche |
| `importer_name` | text | Sí | — | Importadora; campo añadido al formulario mediante parche |

### Restricciones confirmadas

- La única restricción única de base de datos es la clave primaria `clients_pkey` sobre `id`.
- No existe índice único de base de datos para `phone` o `email`.
- La detección de duplicados depende actualmente de `api/clients.js`.
- RLS está habilitado en `clients`, pero no existen políticas para la tabla.
- Las APIs usan la conexión administrativa del backend; la revisión de seguridad se realizará en una fase posterior.

## 4. Relaciones con otras tablas

| Tabla que referencia al cliente | Columna | Regla al eliminar cliente | Riesgo |
|---|---|---|---|
| `shipments` | `client_id` | `CASCADE` | Eliminar un cliente puede eliminar sus contenedores |
| `notifications` | `client_id` | `CASCADE` | Puede eliminar su historial de mensajes y alertas |
| `documents` | `client_id` | `CASCADE` | Puede eliminar registros documentales asociados |
| `shipment_history` | `client_id` | `SET NULL` | El historial permanece, pero pierde la relación directa al cliente |
| `operations` | `client_id` | `RESTRICT` | Bloquea la eliminación si existen expedientes |
| `invoices` | `client_id` | `RESTRICT` | Bloquea la eliminación si existen facturas |
| `payments` | `client_id` | `RESTRICT` | Bloquea la eliminación si existen pagos |

### Conclusión de seguridad de datos

`DELETE /api/clients` realiza eliminación física. Su resultado depende de las relaciones existentes: unas se borran en cascada y otras bloquean la operación. Por tanto, la prueba de eliminación no debe ejecutarse sobre clientes reales con operaciones o contenedores.

La consolidación inicial del frontend no cambiará todavía este contrato. El archivado lógico debe tratarse como una mejora de datos separada y auditada.

## 5. Flujo actual de carga

1. `admin/index.html` declara una variable léxica `clients`.
2. `loadAll()` solicita en paralelo:
   - `/api/clients`
   - `/api/shipments`
   - `/api/dashboard`
   - `/api/admins` cuando corresponde.
3. La respuesta de Clientes se asigna a `clients`.
4. Se ejecutan:
   - `renderClients()`
   - `renderShipments()`
   - `fillClientSelects()`
5. `admin/erp-core.js` vuelve a envolver `window.loadAll` para actualizar el selector de Expedientes y recargar operaciones.
6. Los parches de Clientes observan el DOM y modifican el formulario y la tabla después de esos renders.

### Problema confirmado

`clients` fue declarada con `let`; no es necesariamente `window.clients`. `client-extra-fields.js` intenta leer `window.clients` durante la edición y, cuando no existe, ejecuta otra petición a `/api/clients`.

## 6. Formulario y creación de clientes

### Implementación base en `admin/index.html`

El formulario original contiene:

- `clientName`
- `clientCompany`
- `clientPhone`
- `clientEmail`
- `saveClient`

El manejador original envía solamente:

- `name`
- `company`
- `phone`
- `email`

### Capa de `client-extra-fields.js`

Después de cargar la página:

1. Inserta `clientMipyme` y `clientImporter` después de `clientCompany`.
2. Clona el botón `saveClient`.
3. Reemplaza el botón original por el clon.
4. Instala un segundo flujo de guardado que envía los seis campos.
5. Usa un `MutationObserver` global para reinstalar el parche si cambia el DOM.

### Contrato del backend

`POST /api/clients`:

- exige `name`;
- normaliza `phone`;
- normaliza `email` a minúsculas;
- busca duplicados por teléfono o correo;
- guarda `company`, `mipyme_name` e `importer_name`;
- establece `active = true`;
- establece `welcome_status = pending`;
- registra auditoría `client_created`;
- devuelve la bienvenida como `pending`.

La creación actual no envía automáticamente la bienvenida. El envío se realiza mediante la acción explícita `resend_welcome`.

## 7. Edición

### Implementación base

La función original `editClient` permite cambiar:

- `name`
- `company`
- `phone`
- `email`

### Capa de parche

`client-extra-fields.js` reemplaza globalmente `window.editClient` para añadir:

- `mipyme_name`
- `importer_name`

Si no encuentra el cliente en `window.clients`, vuelve a consultar `/api/clients`.

### Contrato del backend

`PATCH /api/clients`:

- admite cambios parciales;
- valida que `name` no quede vacío;
- normaliza teléfono y correo;
- evita duplicados contra otros clientes;
- actualiza `updated_at`;
- registra auditoría `client_updated`.

## 8. Listado y acciones

`renderClients()` crea actualmente las columnas:

1. Nombre
2. Empresa
3. WhatsApp
4. Bienvenida
5. Acciones

Y crea cuatro botones:

- Editar
- Reenviar bienvenida
- Historial
- Eliminar

`client-actions-menu.js` modifica después esa tabla:

- asume que el estado de bienvenida está en la cuarta columna;
- asume que la acción de bienvenida es el segundo botón;
- cambia el texto según el estado;
- oculta los botones originales;
- crea un botón `⋮` y un menú contextual;
- usa un `MutationObserver` global para decorar filas nuevas.

Estas suposiciones por posición son frágiles. La implementación consolidada deberá usar claves estables como `data-action="edit"` y objetos de acción definidos durante el render.

## 9. Bienvenida por WhatsApp

La función `welcome(id)` envía:

```json
{ "id": "...", "action": "resend_welcome" }
```

`api/clients.js` entonces:

- busca el cliente;
- verifica `TWILIO_WELCOME_CONTENT_SID`;
- envía WhatsApp mediante Twilio si la plantilla existe;
- actualiza `welcome_status`, `welcome_sent_at` y `welcome_error`;
- inserta una notificación;
- registra auditoría.

Estados relevantes:

- `pending` / `pending_config`
- `sent`
- `failed`

El menú debe derivar su etiqueta desde el dato `welcome_status`, no leyendo el texto de una celda.

## 10. Historial

`clientHistory()` consulta:

`GET /api/history?client_id=<id>`

La respuesta combina:

- eventos de `shipment_history` relacionados al cliente;
- notificaciones relacionadas al cliente;
- eventos de `audit_log` con `entity_type = client`.

La interfaz mezcla esos registros y los ordena por `created_at`.

## 11. Dependencias fuera del módulo Clientes

### Contenedores

- `fillClientSelects()` llena `shipmentClient`.
- La etiqueta del selector combina `name` y `company`.
- La búsqueda de tracking incluye `clients.company`.
- `/api/shipments` incluye datos básicos del cliente en la relación.
- `shipment-row-details.js` vuelve a consultar `/api/clients` para mostrar `mipyme_name`, `importer_name`, teléfono, correo y bienvenida.

### Expedientes

- `admin/erp-core.js` usa la colección global `clients` para llenar `erpClient`.
- Ese selector actualmente muestra solamente `name`, aunque `fillClientSelects()` intenta también llenarlo con `name · company`; el wrapper de `erp-core.js` puede sobrescribirlo según el orden de ejecución.
- `/api/operations` relaciona cada operación con `clients(id,name,company,phone,email)`.
- La exportación de expedientes incluye `company`.

### Dashboard y alertas

- `/api/dashboard` cuenta clientes activos.
- Considera pendiente cualquier bienvenida cuyo estado no sea `sent`.

### Exportaciones

`/api/export` usa los datos de Clientes en:

- CSV de clientes: `name`, `company`, `mipyme_name`, `importer_name`, teléfono, correo y bienvenida.
- CSV de tracking: `name`, `company`, teléfono y correo.
- CSV de expedientes: `name` y `company`.
- CSV de notificaciones: nombre y teléfono.

## 12. Mapa de responsabilidades actual

| Responsabilidad | Fuente base | Parche o dependencia adicional |
|---|---|---|
| Formulario | `admin/index.html` | `client-extra-fields.js` inserta dos campos |
| Guardar | `admin/index.html` | `client-extra-fields.js` reemplaza botón y flujo |
| Editar | `admin/index.html` | `client-extra-fields.js` reemplaza función global |
| Listar | `admin/index.html` | `client-actions-menu.js` modifica acciones |
| Bienvenida | `admin/index.html` + `api/clients.js` | Menú cambia etiqueta por posición |
| Historial | `admin/index.html` + `api/history.js` | Depende de tres fuentes de datos |
| Selector de contenedor | `fillClientSelects()` | Depende de `company` |
| Selector de expediente | `fillClientSelects()` y `erp-core.js` | Dos implementaciones compiten |
| Detalle de tracking | `shipment-row-details.js` | Nueva consulta de Clientes por render |
| CSV | `api/export.js` | Contratos de encabezados y columnas |
| Conteos | `api/dashboard.js` | Depende de `active` y `welcome_status` |

## 13. Riesgos confirmados

1. Reemplazo del botón `saveClient` después de cargar.
2. Sustitución de la función global `editClient`.
3. `MutationObserver` global dedicado a mantener el parche.
4. Dependencia de posiciones de columnas y botones.
5. Petición adicional durante edición por la diferencia entre `clients` y `window.clients`.
6. Dos implementaciones que llenan `erpClient`.
7. Mensajes de creación que sugieren una bienvenida automática aunque el POST devuelve `pending`.
8. Duplicados protegidos solo por la API, sin restricción única de base de datos.
9. Eliminación física con reglas mixtas `CASCADE`, `RESTRICT` y `SET NULL`.
10. Una Preview de Vercel puede seguir usando Supabase de producción si no tiene variables separadas; Preview no implica aislamiento de datos.

## 14. Límite propuesto para la futura consolidación

La primera PR funcional de Clientes deberá:

1. Integrar los seis campos directamente en el formulario declarado.
2. Tener un solo manejador de creación.
3. Tener una sola implementación de edición.
4. Renderizar acciones con claves estables.
5. Crear el menú de acciones durante `renderClients`, no mediante observación posterior.
6. Actualizar explícitamente los selectores después de cargar clientes.
7. Evitar consultas adicionales para mostrar datos ya cargados.
8. Mantener intactos los nombres de columnas y contratos de API.
9. Mantener intactos bienvenida, historial, duplicados y exportaciones.
10. Retirar `client-extra-fields.js` y `client-actions-menu.js` solamente después de aprobar todas las pruebas.

### Archivos funcionales candidatos

- `admin/index.html`
- `admin/erp.js`
- posiblemente un módulo estático y explícito de Clientes, si se decide extraerlo del HTML monolítico
- `admin/erp-core.js`, únicamente para eliminar la competencia sobre `erpClient`
- `admin/shipment-row-details.js`, únicamente si se reutilizan datos ya cargados

### Archivos que no deberían cambiar en esta primera consolidación

- `api/clients.js`, salvo corrección confirmada por pruebas
- esquema de Supabase
- `api/export.js`, salvo regresión comprobada
- contratos de ShipsGo o Twilio

## 15. Estrategia de rollback

1. Mantener el refactor en una rama propia desde el `main` más reciente.
2. Registrar SHA de cada archivo antes de modificarlo.
3. No borrar los parches en el primer commit funcional; primero desactivarlos de forma controlada en la rama.
4. Probar la nueva implementación en Preview.
5. Conservar un commit intermedio donde la nueva implementación y los parches puedan compararse.
6. Retirar los parches en un commit separado.
7. Si aparece una regresión, revertir la PR completa o volver al commit anterior a la retirada.
8. No ejecutar pruebas destructivas contra clientes reales.

## 16. Condiciones para comenzar código

El refactor puede comenzar solo cuando:

- la matriz `docs/CLIENTS_TEST_MATRIX.md` esté revisada;
- se haya definido cómo probar sin afectar datos reales;
- se confirme si Vercel Preview usa una base separada o Supabase de producción;
- se acuerde que los nombres técnicos `company`, `mipyme_name` e `importer_name` permanecerán sin cambios durante esta fase;
- la rama funcional se cree desde el `main` más reciente.
