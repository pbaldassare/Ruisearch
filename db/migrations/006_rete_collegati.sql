-- Rete A/B/E materializzata: una riga per coppia (principale, collegato),
-- I e II livello, senza doppioni. Entrambi gli estremi sono A/B/E.
-- Si ricostruisce dopo ogni import del registro, non in automatico.

create table if not exists rete_collegati (
  principale           text not null,
  collegato            text not null,
  livello              text,
  qualifica            text,
  sezione_principale   text not null,
  sezione_collegato    text not null,
  primary key (principale, collegato)
);

create index if not exists rete_collegati_collegato_idx on rete_collegati (collegato);
create index if not exists rete_collegati_principale_sez_idx
  on rete_collegati (principale, sezione_collegato);

create table if not exists rete_numeri (
  rui             text primary key,
  collaboratori   integer not null default 0,
  principali      integer not null default 0,
  rapporti        integer not null default 0
);

create table if not exists rete_stato (
  id              integer primary key default 1,
  ricostruita_il  timestamptz not null default now(),
  archi           bigint not null default 0,
  soggetti        bigint not null default 0
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rete_stato_unico'
      and conrelid = 'public.rete_stato'::regclass
  ) then
    alter table rete_stato add constraint rete_stato_unico check (id = 1);
  end if;
end $$;

comment on table rete_collegati is
  'Archi di rete A/B/E: una persona unica sotto ogni principale, I e II livello.';
comment on table rete_numeri is
  'Conteggi per iscrizione: collaboratori unici, principali unici, rapporti grezzi.';
comment on table rete_stato is
  'Quando è stata ricostruita la rete materializzata.';

create or replace function ricostruisci_rete_collegati()
returns table (archi bigint, soggetti bigint)
language plpgsql
as $$
declare
  n_archi bigint;
  n_soggetti bigint;
begin
  delete from rete_collegati;
  delete from rete_numeri;

  insert into rete_collegati (
    principale, collegato, livello, qualifica, sezione_principale, sezione_collegato
  )
  with anag as (
    select distinct on (numero_iscrizione_rui)
      numero_iscrizione_rui, sezione
    from intermediari
    where sezione in ('A', 'B', 'E')
    order by numero_iscrizione_rui, inoperativo, oss
  ),
  bruti as (
    select
      c.num_iscr_intermediario as principale,
      c.num_iscr_collaboratori_i_liv as collegato,
      c.livello,
      nullif(trim(c.qualifica_rapporto), '') as qualifica
    from collaboratori c
    where c.livello = 'I'
      and c.num_iscr_collaboratori_i_liv is not null
    union all
    select
      c.num_iscr_intermediario,
      c.num_iscr_collaboratori_ii_liv,
      c.livello,
      nullif(trim(c.qualifica_rapporto), '')
    from collaboratori c
    where c.num_iscr_collaboratori_ii_liv is not null
  )
  select distinct on (b.principale, b.collegato)
    b.principale,
    b.collegato,
    b.livello,
    b.qualifica,
    p.sezione,
    e.sezione
  from bruti b
  join anag p on p.numero_iscrizione_rui = b.principale
  join anag e on e.numero_iscrizione_rui = b.collegato
  where b.principale <> b.collegato
  order by b.principale, b.collegato, b.livello, b.qualifica;

  insert into rete_numeri (rui, collaboratori, principali, rapporti)
  select
    x.rui,
    sum(x.uscita)::integer,
    sum(x.entrata)::integer,
    0
  from (
    select principale as rui, 1 as uscita, 0 as entrata from rete_collegati
    union all
    select collegato, 0, 1 from rete_collegati
  ) x
  group by x.rui;

  update rete_numeri n
  set rapporti = r.n
  from (
    select c.num_iscr_intermediario as rui, count(*)::integer as n
    from collaboratori c
    join intermediari p
      on p.numero_iscrizione_rui = c.num_iscr_intermediario
     and p.sezione in ('A', 'B', 'E')
    join intermediari e
      on e.numero_iscrizione_rui = c.num_iscr_collaboratori_i_liv
     and e.sezione in ('A', 'B', 'E')
    group by 1
  ) r
  where n.rui = r.rui;

  select count(*) into n_archi from rete_collegati;
  select count(*) into n_soggetti from rete_numeri;

  insert into rete_stato (id, ricostruita_il, archi, soggetti)
  values (1, now(), n_archi, n_soggetti)
  on conflict (id) do update
    set ricostruita_il = excluded.ricostruita_il,
        archi = excluded.archi,
        soggetti = excluded.soggetti;

  return query select n_archi, n_soggetti;
end;
$$;

revoke all on function ricostruisci_rete_collegati() from public;
grant execute on function ricostruisci_rete_collegati() to service_role;

alter table rete_collegati enable row level security;
alter table rete_numeri enable row level security;
alter table rete_stato enable row level security;

revoke all on table rete_collegati from anon, authenticated;
revoke all on table rete_numeri from anon, authenticated;
revoke all on table rete_stato from anon, authenticated;

grant select, insert, update, delete on table rete_collegati to service_role;
grant select, insert, update, delete on table rete_numeri to service_role;
grant select, insert, update, delete on table rete_stato to service_role;
