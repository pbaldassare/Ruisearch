-- Fidelizzazione: broker sorvegliati e avvisi quando qualcuno si iscrive sotto di loro.
-- Il confronto è sul registro già importato: la prima sorveglianza fa da baseline,
-- i successivi caricamenti dell'estratto segnalano i nuovi collaboratori A/B/E.

create table if not exists cliente_broker_sorvegliati (
  id              bigint generated always as identity primary key,
  cliente_id      bigint not null references clienti (id) on delete cascade,
  rui_broker      text not null,
  denominazione   text,
  sezione         text,
  creato_il       timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cliente_broker_sorvegliati_unico'
      and conrelid = 'public.cliente_broker_sorvegliati'::regclass
  ) then
    alter table cliente_broker_sorvegliati
      add constraint cliente_broker_sorvegliati_unico unique (cliente_id, rui_broker);
  end if;
end $$;

create index if not exists cliente_broker_sorvegliati_cliente_idx
  on cliente_broker_sorvegliati (cliente_id);

create table if not exists cliente_rete_snapshot (
  cliente_id  bigint not null references clienti (id) on delete cascade,
  rui_broker  text not null,
  rui_sotto   text not null,
  visto_il    timestamptz not null default now(),
  primary key (cliente_id, rui_broker, rui_sotto)
);

create index if not exists cliente_rete_snapshot_broker_idx
  on cliente_rete_snapshot (cliente_id, rui_broker);

create table if not exists cliente_alert (
  id                    bigint generated always as identity primary key,
  cliente_id            bigint not null references clienti (id) on delete cascade,
  rui_broker            text not null,
  broker_denominazione  text,
  rui_nuovo             text not null,
  nuovo_denominazione   text,
  sezione               text,
  letto                 boolean not null default false,
  creato_il             timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cliente_alert_unico'
      and conrelid = 'public.cliente_alert'::regclass
  ) then
    alter table cliente_alert
      add constraint cliente_alert_unico unique (cliente_id, rui_broker, rui_nuovo);
  end if;
end $$;

create index if not exists cliente_alert_cliente_idx on cliente_alert (cliente_id);
create index if not exists cliente_alert_non_letti_idx
  on cliente_alert (cliente_id, creato_il desc)
  where letto = false;

comment on table cliente_broker_sorvegliati is
  'Broker A/B/E che il cliente vuole sorvegliare: un nuovo iscritto sotto di loro genera un avviso.';
comment on table cliente_rete_snapshot is
  'Collaboratori A/B/E già visti sotto un broker sorvegliato. Serve a non ripetere lo stesso avviso.';
comment on table cliente_alert is
  'Avviso: un intermediario A/B/E è comparso sotto un broker sorvegliato dopo la baseline.';

alter table cliente_broker_sorvegliati enable row level security;
alter table cliente_rete_snapshot enable row level security;
alter table cliente_alert enable row level security;

revoke all on table cliente_broker_sorvegliati from anon, authenticated;
revoke all on table cliente_rete_snapshot from anon, authenticated;
revoke all on table cliente_alert from anon, authenticated;

grant select, insert, update, delete on table cliente_broker_sorvegliati to service_role;
grant select, insert, update, delete on table cliente_rete_snapshot to service_role;
grant select, insert, update, delete on table cliente_alert to service_role;
grant usage, select on all sequences in schema public to service_role;
