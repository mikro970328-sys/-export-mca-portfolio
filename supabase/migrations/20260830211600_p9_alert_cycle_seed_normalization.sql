-- P9 · occurrence_count legacy no representa ciclos de condición.
-- Toda identidad canónica migrada comienza en ciclo 1; solo false -> true incrementa ciclos después de P9.
update public.operational_alert_conditions
set condition_cycle_count=1,
    updated_at=now()
where condition_cycle_count<>1;

-- Una resolución manual legacy no demuestra que la condición se haya cerrado.
-- Se conserva como ciclo abierto/silenciado para que el primer checker P9:
--   - la mantenga resuelta si la condición sigue true, o
--   - la cierre realmente si la condición ya es false.
update public.operational_alert_conditions c
set condition_active=true,
    condition_opened_at=coalesce(n.first_triggered_at,n.created_at,c.created_at),
    condition_closed_at=null,
    last_evaluated_at=now(),
    updated_at=now()
from public.notifications n
where n.id=c.notification_id
  and n.resolved_source='manual'
  and c.event_type<>'shipment_customs_documents_missing';
