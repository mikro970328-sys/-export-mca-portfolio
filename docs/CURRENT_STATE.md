## Continuación — conservación de archivos (2026-09-15)

PR #308 publicada: main 2072fb563d04e9c2af48d14e5255869aff63908e.
Rama `fix/preserve-customs-upload`: un fallo posterior al commit podía borrar el
archivo del documento. Se elimina esa compensación destructiva en documentos
Cuba y API documental anterior. Ver DOCUMENT_UPLOAD_PRESERVATION.md y PR para
CI/publicación final. Tracking/documentos sigue como bloque de cierre funcional.

## Continuación — visibilidad de tareas relacionadas (2026-09-15)

PR #307 publicada, main 3b47f549074ef37cf35f48bb34122c84bd1c25de.
Rama actual `fix/task-related-visibility`: dependencias/dependientes deben respetar
la visibilidad del listado antes de enriquecer entidades. El contador de bloqueos
y el RPC siguen siendo autoritativos. Ver TASK_RELATED_VISIBILITY_ACCEPTANCE.md;
la PR registra CI exacto y publicación final. Escritorio sigue siendo prioridad.
El resto de este documento conserva los cortes anteriores como contexto.

# Current State — Export MCA ERP

Actualización: 2026-09-15 UTC. Prioridad: cierre funcional en navegador de escritorio.

## Entrega vigente

PR #306 (Repetir compra) está integrada/publicada, merge
58fbf289e47f8132f98fc4a084deb9de4f188cb1. Base actual consultada main:
f83a2f122257db3ab98f247149ae0ddfc202b337. Se preserva su cambio ajeno al ERP.

Rama fix/cancelled-sale-billing: el workspace ofrecía Crear factura después de
cancelar, aunque create_invoice_plan rechaza ventas no confirmadas/cerradas.
Se añade capability de creación al payload y se consume en ambos botones y su
handler. La confirmación aclara que cancelar conserva facturas, cobros y saldos.
No se cambia la regla comercial de cancelación ni se anulan documentos en cascada.
CF-13 amplía la aceptación aislada a facturas borrador, impagadas y con cobro parcial.
Consultar CANCELLED_SALE_BILLING_ACCEPTANCE.md y la PR para resultado final,
Preview y publicación; este corte no anticipa el merge.

Daniel difiere explícitamente iPhone/BrowserStack/PWA física/push. Se continúa
escritorio sin compra ni reintento manual de BrowserStack. WebKit emulado puede
seguir como regresión gratuita del CI existente; no es certificación física.

## Punto recuperado

Las PR #297–#304 están integradas. No presentar Cancelar venta, arranque móvil o
Direct Ship 840 → 810 como pendientes. #298 implementa la corrección física con
historia y #299 el índice del actor de auditoría. #300/#301 preservan fallos
transitorios en documentos, tareas e inbox; #302/#303 amplían y aíslan iPhone;
#304 corrige el error público de enlaces operativos.

Base recuperada: `3a354a44999b07f93503b9b888bb3821f024796f`, Vercel producción
`dpl_zHKeEqo8qM3jB5szNzi2hEkS29WW` READY, SHA coincidente.

## Entrega actual

Rama `audit/api-public-error-boundaries`, PR #305: se reproducen y corrigen 20
exposiciones directas en 19 endpoints, sin cambiar datos, permisos ni reglas
comerciales. Validaciones conocidas usan textos constantes y 400; fallos internos
500; transitorios agotados 503. WhatsApp fallido conserva el tracking guardado.

Matriz, owners y límites: [security/API_PUBLIC_ERROR_AUDIT.md](security/API_PUBLIC_ERROR_AUDIT.md).
Local: 97 comprobaciones de handlers, 17 del detector, 61 endpoints sin findings
directos, 13 gates complementarios, API financiera 11/11 y SQL ventas/logística
29/29. Resultados finales de CI y publicación se registran en la
[PR #305](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/305).
Consultar esa PR, commit exacto y deployment/aliases antes de retomar; este corte
no sustituye la verificación posterior al merge.

## Siguiente bloque

Continuar la auditoría por mensajes técnicos almacenados y objetos transportados
por helpers: el scanner directo no cubre todo flujo de datos. Contrastar los
inventarios de julio y B9 inicial con código/CI actuales. No declarar terminado
todo el ERP por esta entrega. Conservar las matrices comerciales y multioperador.

Safari/iPhone físico, PWA instalada y push real siguen sin certificar: #303
registra `Automate testing time expired`. No reintentos manuales de BrowserStack.
WebKit emulado y checks HTTP de publicación son evidencias diferentes.

## Método y fronteras

- Usar owners existentes; no nuevos observers, wrappers o reemplazos de botones.
- Rama/PR, regresión antes de corregir, CI del commit exacto, Preview READY y
  merge con expected head. El propietario ya autorizó corregir, probar e integrar.
- QA comercial solo en PostgreSQL/PostgREST desechables; Preview comparte
  producción. No mensajes a clientes, cambios de roles reales o credenciales en
  artefactos. Mantener Supabase fuera del navegador.
- Direct Ship no crea WR/inventario. No borrar historia ni ajustar cantidades
  reales para probar. Mantener reverso correctivo y devolución real diferenciados.
- No desactivar gates ni desplegar manualmente si GitHub genera el deployment.

## Historial

Corte anterior íntegro: [history/CURRENT_STATE_20260910_CANCEL_STARTUP.md](history/CURRENT_STATE_20260910_CANCEL_STARTUP.md).
Conserva referencias a Direct Ship, 2026-09-09 y entregas anteriores. Las notas
finales de cada PR son la evidencia posterior a su corte documental.
