# Respuestas públicas de error — PR #305

Corte: 2026-09-14 UTC. Rama `audit/api-public-error-boundaries`.

## Finding reproducido

El detector inicial de #305, head `4d6fb68318767014e28b8602759f4661a9a2784c`,
falló en Actions `34777682955`, job `103778676957`: 20 findings en 19 de 61
endpoints. Se reprodujo localmente antes de editar las APIs. Los handlers
devolvían `error.message` como mensaje, `details` o `notification_error` de un 200.
Podían incluir cuerpos técnicos de PostgreSQL/PostgREST, Storage o mensajería.
El fallback 400 confundía fallos internos con entradas inválidas.

## Corrección y propietarios

Cada handler conserva autorización, consultas, mutaciones, auditoría y owner.
La corrección selecciona exclusivamente el mensaje y el estado de su respuesta.

| Superficie | Owners corregidos |
| --- | --- |
| Finanzas y trazabilidad | `ap-links`, `financial-links`, `invoice-expediente-context`, `reports`, `export` |
| Catálogos y expedientes | `products`, `suppliers`, `importers`, `operations` |
| Documentación | `documents`, `document-bundle`, `shipment-documents`, `shipment-document-readiness` |
| Tracking y alertas | `manual-tracking-event`, `tracking-alerts`, `manual-tracking-alerts`, `discharge-release-alerts`, `stagnant-shipment-alerts` |
| Acceso | `login` |

- Validaciones locales: coincidencia exacta en mapas de textos constantes del
  owner. Los códigos documentales reconocidos conservan su traducción fija,
  sin adjuntar el original. Ninguna coincidencia parcial devuelve texto arbitrario.
- Validaciones conocidas: 400. Se conservan los rechazos 401/403/409/429 del
  flujo. Fallos desconocidos: 500. Lecturas transitorias agotadas: 503 mediante
  `upstreamFailureStatus`, sin añadir reintentos.
- WhatsApp fallido después de guardar conserva HTTP 200, `updated:true`,
  `notified:false` y `notification_status:'failed'`; aviso público estable.
- Un ZIP iniciado conserva la destrucción del stream, sin añadir JSON después
  de enviar cabeceras.
- Sin migraciones, dependencias nuevas, cambios de permisos, reglas comerciales,
  frontend o datos históricos.

## Evidencia

`check-api-public-error-responses.mjs` ejecuta los handlers originales con
autorización, Storage y transporte sustituidos expresamente. Inyecta fallos
internos/transitorios y frases parecidas a validaciones. Verifica los 19 handlers,
denegación antes del transporte, formularios, códigos documentales, ZIP iniciado
y éxito parcial de tracking. No usa credenciales, base remota ni mensajes reales.
Falló antes del cambio; después aprueban 97 comprobaciones.

`check-api-public-error-audit.mjs`: 17 casos del detector con espacios, saltos de
línea, optional chaining, corchetes, variable de catch distinta, propiedades
técnicas, interpolación y respuesta larga. Delimita la llamada para no confundir
un log posterior con el cuerpo devuelto. Los 61 endpoints pasan el detector.

Ambas pruebas se integran en B9. P7 conserva 503 y exige ausencia de detalle
técnico. Los adaptadores financieros/logísticos usan el helper de estado real.
Validación local adicional: 13 gates de permisos/sesiones, ownership, contexto,
catálogos, reportes, documentación, superficie pública y reintentos; API financiera
11/11; SQL ventas/logística 29/29 en bases desechables.

CI del commit final, Preview y publicación se registran en
[PR #305](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/305).

## Límites y continuación

El scanner detecta expresiones directas; no es análisis completo de flujo de datos.
No certifica aliases arbitrarios, helpers que devuelven objetos técnicos ni
cadenas almacenadas en historial/auditoría/notificaciones. No se borran ni se
reinterpretan esos registros. Revisarlos es una continuación separada.

No se provocan fallos ni se hacen operaciones comerciales QA en producción o
Preview, que comparten base. Se conservan las cinco historias Chromium/WebKit
y concurrencia. BrowserStack agotó Automate según #303; Safari/iPhone físico,
PWA instalada y push real siguen sin certificar. No reintentos manuales ni
alteraciones de gates para aprobar. Rollback: revertir la PR, sin rollback de DB.
