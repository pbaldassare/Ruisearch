-- Primo livello multi-cliente: società iscritta + operatori che accedono al loro estratto.

create table if not exists clienti (
  id                     bigint generated always as identity primary key,
  numero_iscrizione_rui  text not null,
  denominazione          text not null,
  sezione                text,
  attivo                 boolean not null default true,
  creato_il              timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clienti_rui_unique'
      and conrelid = 'public.clienti'::regclass
  ) then
    alter table clienti add constraint clienti_rui_unique unique (numero_iscrizione_rui);
  end if;
end $$;

create table if not exists operatori_cliente (
  id              bigint generated always as identity primary key,
  cliente_id      bigint not null references clienti (id) on delete cascade,
  email           text not null,
  password_hash   text not null,
  nome            text,
  attivo          boolean not null default true,
  creato_il       timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'operatori_cliente_email_unique'
      and conrelid = 'public.operatori_cliente'::regclass
  ) then
    alter table operatori_cliente add constraint operatori_cliente_email_unique unique (email);
  end if;
end $$;

create index if not exists operatori_cliente_cliente_idx on operatori_cliente (cliente_id);

comment on table clienti is
  'Società clienti (un RUI, oggi sezioni A/B). L''estratto è la loro rete A/B/E.';
comment on table operatori_cliente is
  'Login degli operatori del cliente. La password è uno scrypt, non in chiaro.';

alter table clienti enable row level security;
alter table operatori_cliente enable row level security;
drop policy if exists lettura_pubblica on clienti;
drop policy if exists lettura_pubblica on operatori_cliente;

revoke all on table clienti from anon, authenticated;
revoke all on table operatori_cliente from anon, authenticated;
grant select, insert, update, delete on table clienti to service_role;
grant select, insert, update, delete on table operatori_cliente to service_role;
grant usage, select on all sequences in schema public to service_role;
