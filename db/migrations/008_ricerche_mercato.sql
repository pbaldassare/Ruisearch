-- Ricerche mercato del cliente: una riga per filtro, risultati senza doppioni.

create table if not exists cliente_ricerca_mercato (
  id            bigint generated always as identity primary key,
  cliente_id    bigint not null references clienti (id) on delete cascade,
  chiave        text not null,
  frase         text,
  zona          text,
  compagnia     text,
  sezione       text not null,
  nota          text,
  creato_il     timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cliente_ricerca_mercato_unico'
      and conrelid = 'public.cliente_ricerca_mercato'::regclass
  ) then
    alter table cliente_ricerca_mercato
      add constraint cliente_ricerca_mercato_unico unique (cliente_id, chiave);
  end if;
end $$;

create index if not exists cliente_ricerca_mercato_cliente_idx
  on cliente_ricerca_mercato (cliente_id, aggiornato_il desc);

create table if not exists cliente_ricerca_risultati (
  id            bigint generated always as identity primary key,
  ricerca_id    bigint not null references cliente_ricerca_mercato (id) on delete cascade,
  rui           text not null,
  denominazione text,
  sezione       text,
  inoperativo   boolean,
  subagenti     integer not null default 0,
  comuni        text,
  province      text
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cliente_ricerca_risultati_unico'
      and conrelid = 'public.cliente_ricerca_risultati'::regclass
  ) then
    alter table cliente_ricerca_risultati
      add constraint cliente_ricerca_risultati_unico unique (ricerca_id, rui);
  end if;
end $$;

create index if not exists cliente_ricerca_risultati_ricerca_idx
  on cliente_ricerca_risultati (ricerca_id);

comment on table cliente_ricerca_mercato is
  'Una ricerca mercato per cliente e filtro (zona/compagnia/sezione). Nessun doppione.';
comment on table cliente_ricerca_risultati is
  'Nominativi trovati in una ricerca. Unici per (ricerca, RUI).';

do $$
declare t text;
begin
  foreach t in array array['cliente_ricerca_mercato', 'cliente_ricerca_risultati'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table %I to service_role', t);
  end loop;
end $$;

grant usage, select on all sequences in schema public to service_role;
