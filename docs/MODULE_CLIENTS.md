# Módulo de clientes

## Propósito

El módulo administra los clientes de Export MCA LLC, sus datos de contacto, su MIPYME, la importadora utilizada y una referencia interna para identificación operativa.

## Campos visibles

| Campo visible | Columna actual | Uso |
|---|---|---|
| Nombre completo | `name` | Nombre principal del cliente. |
| Importadora por la que importa | `company` | Entidad importadora utilizada por el cliente, por ejemplo Quimimport o Consumimport. |
| Nombre de la MIPYME | `mipyme_name` | Nombre de la MIPYME del cliente, cuando corresponda. |
| Identificador interno | `importer_name` | Apodo, código o referencia interna utilizada para reconocer al cliente. |
| WhatsApp | `phone` | Número de contacto y destino de notificaciones. |
| Correo | `email` | Correo electrónico opcional. |

## Compatibilidad

El ajuste de nombres es únicamente semántico y visual. No se renombraron columnas ni se modificó Supabase.

La aplicación mantiene esta correspondencia por compatibilidad:

- `company` representa la importadora.
- `importer_name` representa el identificador interno.

Cualquier cambio futuro del esquema debe incluir una migración auditada y la actualización simultánea de la API, frontend y documentación.

## Archivos relacionados

- `admin/client-extra-fields.js`
- `admin/index.html`
- `api/clients.js`
- Tabla `public.clients`

## Regla de mantenimiento

Toda modificación de campos, validaciones, exportaciones o presentación del módulo debe registrarse en `docs/CHANGELOG.md` y en este documento.
