# Changelog — Export MCA ERP

Este archivo registra cambios técnicos y funcionales confirmados. No se debe registrar como desplegado un cambio que exista solamente en una rama o Preview.

## 2026-07-30

### Auditoría de deuda técnica

Estado: **documentación fusionada en `main`; sin cambios funcionales**

- Se creó el inventario inicial de deuda técnica del frontend administrativo.
- Se identificaron loaders dinámicos, funciones globales sobrescritas, `MutationObserver`, timers, consultas duplicadas y dependencias por orden de carga.
- Se confirmó que la deuda técnica es alta, pero recuperable mediante consolidación progresiva sin reconstruir todo el ERP.
- Se definió el plan de limpieza por fases.
- Se estableció que ningún refactor funcional se realizará directamente en `main`.
- Se estableció el uso obligatorio de Preview Deployment de Vercel antes de integrar cambios funcionales.
- Se creó una fuente de contexto para continuidad entre chats mediante:
  - `docs/AI_CONTEXT.md`
  - `docs/CURRENT_STATE.md`
  - `docs/TECH_DEBT_INVENTORY.md`
  - `docs/CLEANUP_PLAN.md`
  - `docs/CHANGELOG.md`
- Se estableció Clientes como el primer módulo funcional que se consolidará después de completar su matriz de pruebas.
- La PR documental `#11` fue fusionada mediante squash en `main`.
- Commit de fusión: `1807f4a5e343c8b500e3f1534513a3e5234d56bb`.

### Producción

- No se modificó código operativo.
- No se modificó Supabase.
- No se modificaron APIs.
- No se cambió el comportamiento del ERP.
- La documentación de continuidad ya está disponible en la rama `main`.