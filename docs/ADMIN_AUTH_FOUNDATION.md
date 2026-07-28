# Fase 2 — Base de autenticación del panel administrativo

## Objetivo

Preparar la transición del CRM logístico actual hacia un panel administrativo autenticado con Supabase Auth, sin interrumpir las APIs ni los datos existentes.

## Decisiones confirmadas

- Usuario Super Admin inicial: `mikro970328@gmail.com`
- Proyecto Supabase: reutilizar el proyecto existente
- Sitio público: `exportmca.com`
- Panel administrativo futuro: `admin.exportmca.com`
- Diseño: profesional, limpio y orientado a operaciones

## Alcance del primer bloque

1. Mantener el CRM existente en `/tracking` mientras se implementa la nueva autenticación.
2. Introducir Supabase Auth de forma progresiva.
3. Vincular usuarios autenticados con la tabla `profiles` de Arquitectura 1.0.
4. Proteger las rutas administrativas.
5. Mantener compatibilidad temporal con las APIs existentes hasta completar la migración.

## Variables requeridas en Vercel

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

No almacenar en el repositorio:

- `SUPABASE_SERVICE_ROLE_KEY`
- contraseñas
- tokens JWT
- secretos de Twilio o ShipsGo

## Flujo objetivo

1. El usuario introduce correo y contraseña.
2. Supabase Auth valida la sesión.
3. El sistema recupera el perfil interno asociado.
4. Se verifican estado, empresa, roles y permisos.
5. Si el usuario está autorizado, se carga el dashboard.
6. Si no existe perfil autorizado, se bloquea el acceso.

## Super Admin inicial

El usuario `mikro970328@gmail.com` deberá crearse en Supabase Auth y asociarse a:

- la empresa inicial `Export MCA LLC`;
- un perfil interno activo;
- el rol `super_admin` o equivalente definido por la migración;
- permisos completos del panel.

La creación del usuario real debe realizarse desde Supabase o mediante un proceso seguro del backend. No se incluirán contraseñas ni claves administrativas en GitHub.

## Siguiente implementación

- Crear cliente web de Supabase.
- Sustituir el login local por autenticación con correo.
- Añadir recuperación de contraseña.
- Añadir control de sesión y cierre seguro.
- Adaptar las APIs para validar JWT de Supabase.
- Añadir validaciones automatizadas para evitar secretos y regresiones.
