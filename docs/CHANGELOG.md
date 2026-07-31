# Changelog

## 2026-07-30

### Módulo de clientes

- El campo visible anteriormente como **Empresa** ahora se presenta como **Importadora por la que importa**.
- La columna **Empresa** del listado de clientes ahora se presenta como **Importadora**.
- El campo visible anteriormente como **Importadora por la que importa** ahora se presenta como **Identificador interno**.
- El identificador interno puede utilizarse para guardar un apodo, código o referencia operativa del cliente.
- No se modificó el esquema de Supabase. La compatibilidad se conserva utilizando las columnas existentes `company` e `importer_name`.

### Archivos modificados

- `admin/client-extra-fields.js`
