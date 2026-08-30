-- P9 · occurrence_count legacy no representa ciclos de condición.
-- Toda identidad canónica migrada comienza en ciclo 1; solo false -> true incrementa ciclos después de P9.
update public.operational_alert_conditions
set condition_cycle_count=1,
    updated_at=now()
where condition_cycle_count<>1;
