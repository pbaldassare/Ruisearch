-- Opportunity di mercato: prospect scelti dal cliente, con recapiti extra-RUI in contatti.

create table if not exists cliente_opportunity (
  id                   bigint generated always as identity primary key,
  cliente_id           bigint not null references clienti (id) on delete cascade,
  rui_target           text not null,
  denominazione        text,
  sezione              text,
  rui_broker           text,
  broker_denominazione text,
  zona                 text,
  compagnia            text,
  stato                text not null default 'nuova',
  note                 text,
  sintesi              text,
  arricchito_il        timestamptz,
  creato_il            timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cliente_opportunity_unico'
      and conrelid = 'public.cliente_opportunity'::regclass
  ) then
    alter table cliente_opportunity
      add constraint cliente_opportunity_unico unique (cliente_id, rui_target);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'cliente_opportunity_stato_check'
      and conrelid = 'public.cliente_opportunity'::regclass
  ) then
    alter table cliente_opportunity
      add constraint cliente_opportunity_stato_check
      check (stato in ('nuova', 'in_lavorazione', 'contattata', 'scartata'));
  end if;
end $$;

create index if not exists cliente_opportunity_cliente_idx
  on cliente_opportunity (cliente_id, creato_il desc);

create index if not exists cliente_opportunity_target_idx
  on cliente_opportunity (rui_target);

create index if not exists mandati_ragione_trgm_idx
  on mandati using gin (ragione_sociale gin_trgm_ops);

comment on table cliente_opportunity is
  'Prospect di mercato del cliente. I recapiti stanno in contatti, legati al RUI target.';

alter table cliente_opportunity enable row level security;
revoke all on table cliente_opportunity from anon, authenticated;
grant select, insert, update, delete on table cliente_opportunity to service_role;
grant usage, select on all sequences in schema public to service_role;
