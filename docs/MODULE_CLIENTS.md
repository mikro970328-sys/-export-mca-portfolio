# Módulo de clientes

## Propósito

El módulo administra los clientes de Export MCA LLC, sus datos de contacto, su MIPYME, la importadora utilizada y una referencia interna para identificación operativa.

## Correspondencia de campos

| Campo visible | Columna técnica | Uso |
|---|---|---|
| Nombre completo | `name` | Nombre principal del cliente. |
| Importadora por la que importa | `company` | Entidad importadora utilizada por el cliente, por ejemplo Quimimport o Consumimport. |
| Nombre de la MIPYME | `mipyme_name` | Nombre de la MIPYME, cuando corresponda. |
| Identificador interno | `importer_name` | Apodo, código o referencia interna del cliente. |
| WhatsApp | `phone` | Número de contacto y destino de notificaciones. |
| Correo | `email` | Correo electrónico opcional. |

## Regla de compatibilidad

Los nombres visibles no deben confundirse con los nombres de las columnas. Por compatibilidad con el ERP existente:

- `company` continúa almacenando la importadora.
- `importer_name` continúa almacenando el identificador interno.

No se deben renombrar, eliminar o intercambiar estas columnas sin una migración auditada que cubra frontend, API, exportaciones, búsquedas, selectores y datos existentes.

## Dependencias confirmadas

La columna `company` participa en:

- formulario de creación y edición de clientes;
- tabla de clientes;
- selectores de clientes para contenedores y expedientes;
- búsqueda de contenedores;
- consultas relacionadas de shipments y operaciones;
- exportaciones CSV de clientes, tracking y expedientes.

La columna `importer_name` participa en:

- formulario de creación y edición de clientes;
- API de clientes;
- auditoría de creación y actualización;
- exportación CSV de clientes.

## Archivos relacionados

- `admin/index.html`
- `admin/client-extra-fields.js`
- `api/clients.js`
- `api/export.js`
- tabla `public.clients`

## Implementación visual vigente

`admin/client-extra-fields.js` adapta las etiquetas visibles y conserva intactos los nombres técnicos enviados a la API. También instala un hook no destructivo sobre el renderizado existente para cambiar únicamente el encabezado visible `Empresa` por `Importadora`.

## Pruebas mínimas obligatorias

Después de cualquier cambio en este módulo deben comprobarse:

1. carga del listado de clientes;
2. creación de cliente;
3. edición de todos los campos;
4. selector de clientes en contenedores;
5. selector de clientes en expedientes;
6. búsqueda por importadora;
7. exportación CSV de clientes;
8. exportación CSV de tracking;
9. exportación CSV de expedientes;
10. funcionamiento desde `admin/pwa.html`.
