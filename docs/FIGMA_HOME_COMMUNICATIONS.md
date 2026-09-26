# Inicio, alertas y notificaciones · Figma a código

Daniel pidió terminar el ERP de escritorio y avisarle antes del iPhone físico. Este bloque continúa ese alcance; quedan Publicaciones, configuración/supervisión de workflow y revisión integrada.

## Diseño

Archivo Figma `aq38kVEYDEmmNlUOAOvfYg`, Screens `5:4`; guía `132:2`, estado `132:4`. Diez vistas construidas con variables, Inter y componentes compartidos; contexto de diseño revisado antes de implementar.

| Vista | Nodo |
| --- | --- |
| Inicio | 128:3965 |
| Inicio con filtros y detalle financiero | 128:4263 |
| Alertas operativas | 128:4617 |
| Mensajes WhatsApp | 128:4871 |
| Resolver alerta | 128:5111 |
| Posponer alerta | 128:5132 |
| Reintentar mensaje | 128:5153 |
| Bandeja | 128:5168 |
| Historial de mensajes | 128:5252 |
| Preferencias y dispositivos | 128:5320 |

## Cambios

Los owners existentes de Inicio, Centro de alertas, bandeja y dispositivos adoptan cabeceras blancas, métricas, controles de 44 px, estados, bordes y diálogos del sistema Figma. Inicio conserva sus diez accesos operativos, seis filtros autorizados, indicadores financieros por moneda y detalle desplegable. Conserva los filtros solicitados al fallar una actualización para que Reintentar use los mismos parámetros.

Alertas conserva búsqueda, ciclo pendiente/pospuesta/resuelta, lectura, resolución con motivo, plazo de posposición y confirmación explícita antes del reintento de mensaje. Las pestañas funcionan con flechas/Inicio/Fin y los diálogos tienen foco inicial inmediato, cierre y retorno de foco.

La bandeja conserva lectura, ocultación, navegación al trabajo, historial y las ocho preferencias. Los cambios de preferencias sobreviven a una actualización o guardado fallido; el guardado se deduplica. El panel mantiene el foco al cambiar de vista, limita Tab al diálogo, devuelve el foco a la campana y recupera el bloqueo de scroll al fallar la navegación a un registro. La presentación de dispositivos conserva los requisitos de permiso y pulsación explícita.

No se cambian API, SQL, permisos, payloads, cálculos, moneda, auditoría ni reconciliadores. No hay envíos, suscripciones ni datos de QA en producción o Preview. El fixture impide toda activación de dispositivos y solo simula reintentos en memoria.

## Verificación

- Gates de dashboard, alertas, Inbox, permisos, propiedad, iconos, shell, integración y lifecycle correctos.
- Fixture con owners y runtime reales, registros ficticios, API en memoria permitida por ruta, CSP sin red y fuente local incrustada.
- 21 pruebas nuevas por motor (42 enumeradas): 1440/390 px; filtros y moneda, disclosures, navegación, permisos, ciclo de alertas, confirmación/cancelación de mensajes, lectura/ocultación, historial, preferencias retenidas, deduplicación, foco/Tab, contraste y recuperación ante errores.
- Verificar CI y capturas del head exacto antes de publicar; WebKit simulado no certifica un iPhone físico.

## Publicación anterior

Usuarios y acceso / Mi cuenta: PR #355 publicado en `2eddad863822d663b2190c7334b7f360d063e18a`, deployment `dpl_6wBaiCXGU8RByjnt1LhUMzT2aV55` READY. Head probado `a12abfb7ea7d843080e5c7dc6dcb01b10e7002b4`, árbol `ca768d5c37f18e5e6eb3dbc39e26374f54c1e76b`; CI `36242548703`: 39 workflows, 22 trabajos y 121/121 visuales por motor correctos. Capturas corregidas revisadas; seis archivos de producción idénticos por GET; endpoints de cuenta y acceso sin sesión 401. Guía `127:2` publicada.

## Cierre de escritorio pendiente

Publicaciones, configuración/supervisión de workflow y revisión integrada. Resolver la inserción asíncrona de enlaces relacionados sobre las acciones de Compras; unificar márgenes de main y padding de owners nativos manteniendo el viewport de los iframes. Avisar antes del iPhone físico.
