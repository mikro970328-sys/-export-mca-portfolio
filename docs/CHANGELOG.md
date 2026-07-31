# Changelog

## 2026-07-30

### Módulo de clientes

- Se cambió la etiqueta visible **Empresa** por **Importadora por la que importa**.
- Se cambió el encabezado visible **Empresa** del listado por **Importadora**.
- Se cambió la etiqueta visible **Importadora por la que importa** del campo secundario por **Identificador interno**.
- Se actualizaron los textos de edición para usar la misma terminología.
- Se actualizaron los encabezados de las exportaciones CSV de clientes, tracking y expedientes.
- Se conservaron intactas las columnas técnicas y los datos existentes:
  - `company` continúa almacenando la importadora.
  - `importer_name` continúa almacenando el identificador interno.
- No se modificó Supabase.
- No se eliminaron campos del DOM.
- Los selectores, búsquedas y APIs conservaron su implementación y contratos actuales.
- El encabezado de la tabla se ajusta mediante un decorador no destructivo de `renderClients`; la función original continúa ejecutándose y únicamente se cambia el texto visible después del renderizado.

### Archivos modificados

- `admin/client-extra-fields.js`
- `api/export.js`
- `docs/MODULE_CLIENTS.md`
