-- Almacena el NIT con su formato original, y compara una versión normalizada
-- para que espacios, puntos, guiones y barras no permitan duplicar clientes.
alter table public.clients
  add column if not exists nit text,
  add column if not exists nit_normalized text generated always as (
    nullif(regexp_replace(upper(btrim(nit)), '[[:space:]./-]', '', 'g'), '')
  ) stored;

-- Conserva el nombre comercial que ya estaba capturado como MIPYME en el
-- campo comercial único que usarán las pantallas nuevas.
update public.clients
set company = nullif(btrim(mipyme_name), '')
where nullif(btrim(company), '') is null
  and nullif(btrim(mipyme_name), '') is not null;

create unique index if not exists clients_nit_normalized_uidx
  on public.clients (nit_normalized)
  where nit_normalized is not null;

comment on column public.clients.nit is
  'NIT del cliente. Conserva el formato capturado por el usuario; la unicidad se aplica sin espacios ni separadores comunes.';

comment on column public.clients.nit_normalized is
  'Clave calculada para detectar NIT repetidos ignorando mayúsculas, espacios, puntos, guiones y barras.';
