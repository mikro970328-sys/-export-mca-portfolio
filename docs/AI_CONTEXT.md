# AI Context — Export MCA ERP

Última actualización: 2026-09-15 UTC.

## Continuación vigente

Daniel prioriza navegador de computadora; BrowserStack/iPhone/PWA física/push
quedan diferidos por su decisión. No solicitar compra para continuar escritorio.
Repetir compra está publicado: PR #306, merge 58fbf289e47f8132f98fc4a084deb9de4f188cb1.
Base main consultada: f83a2f122257db3ab98f247149ae0ddfc202b337 (cambio posterior
ajeno al ERP, preservado). Rama actual fix/cancelled-sale-billing.

Cierre funcional actual: corregir oferta de nueva factura en ventas no facturables
mediante capability del workspace; conservar facturas/cobros/saldos al cancelar y
explicarlo en la confirmación. CF-13 prueba borrador, emitida impagada y cobro
parcial, sin modificar la semántica de cancelación ni migrar datos.
Leer CANCELLED_SALE_BILLING_ACCEPTANCE.md y la PR para CI/publicación final.

Contexto previo de auditoría (retomar tras la función):

Retomar desde **PR #305**, rama `audit/api-public-error-boundaries`. Leer
CURRENT_STATE.md, security/API_PUBLIC_ERROR_AUDIT.md y la PR/CI final. Las PR
#297–#304 ya están integradas; no repetir cancelaciones, arranque móvil ni Direct
Ship 840 → 810 como pendientes. Base recuperada main `3a354a44999b07f93503b9b888bb3821f024796f`,
Vercel `dpl_zHKeEqo8qM3jB5szNzi2hEkS29WW` READY.

#305 corrige 20 exposiciones directas en 19 de 61 endpoints: validaciones públicas
constantes, fallos internos 500, transitorios 503 y éxito parcial de tracking si
falla WhatsApp. Sin migraciones, dependencias nuevas, datos, permisos o UI.
Verificar integración/publicación final en la PR; no inferirlas de una rama.
Siguiente revisión: errores almacenados y objetos a través de helpers. El scanner
directo no demuestra seguridad completa ni cierra todo el ERP. BrowserStack
limitado por Automate agotado (#303); Safari físico, PWA standalone y push real
sin certificación. No reintentos manuales.

## Fuentes y arquitectura

Leer TECH_DEBT_INVENTORY.md, CLEANUP_PLAN.md, CHANGELOG.md y documentación del
módulo afectado. Contrastar los inventarios antiguos con código/CI actual.
Contexto anterior íntegro: history/AI_CONTEXT_20260910_CANCEL_STARTUP.md.

- Export MCA LLC; repo mikro970328-sys/-export-mca-portfolio, main productivo.
- HTML/CSS/JavaScript, Vercel Serverless, Supabase PostgreSQL y autenticación propia.
- Dominios admin.exportmca.com y app.exportmca.com. admin/pwa.html entra al shell,
  no a un segundo ERP dentro de iframe.
- Clientes: clients/api/clients. Contenedores: shipments/api/shipments. Historial:
  shipment_history/audit_log. Usuarios: admin_users, permisos P3 y sesiones.
- No cambiar integraciones por inferencia desde documentación histórica.

## Método y autorización

1. Identificar owner, dependencias y conducta a conservar. Reproducir antes de
   corregir; separar defectos y carencias del entorno QA.
2. Trabajar en rama vigente preservando trabajo simultáneo. No force-push ni
   cambios funcionales directos en main. Corregir fuente canónica.
3. No mezclar refactor con funciones nuevas o cambios visuales con migraciones.
   No MutationObserver adicional ni wrappers de loadAll/showSection/render.
4. Mantener historial y semántica. Direct Ship no crea WR/inventario. No renombrar
   columnas sin migración auditada ni cambiar auth/roles sin revisión y pruebas.
5. Gates del commit exacto y aceptación aislada pertinente. Preview READY no
   certifica sesión autenticada ni publicación.
6. Actualizar estado/changelog/matriz. El propietario ya autorizó pruebas,
   correcciones e integración; fusionar con expected head tras validar.
7. Verificar deployment/aliases/assets/APIs y registrar límites en la PR.

Orden solicitado: cierre funcional y pruebas, mejoras de claridad y auditoría
integral. No empezar de cero ni reabrir trabajo terminado sin nueva evidencia.

## Seguridad operacional

No QA comercial en producción ni Preview, que comparten base. Solo bases
desechables y transportes de prueba explícitos. No WhatsApp/correo/push de prueba
a clientes. No tokens/cookies/contraseñas en evidencias. No acceso directo
Supabase desde frontend. No eliminar capas legacy sin integrar/probar su conducta
ni usar texto visible para reconocer acciones. No ejecutar la antigua PR de
Arquitectura 1.0 en producción. No alterar gates/cuotas para aprobar ni desplegar
manualmente cuando GitHub ya genera el deployment. Mantener la diferencia entre
reverso correctivo y devolución real de dinero.
