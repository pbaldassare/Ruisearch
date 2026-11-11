-- Ruisearch su Supabase condiviso (progetto moyfkdwsghidkcifesrg).
-- Tutto vive nello schema dedicato "ruisearch": niente in public, nessun
-- conflitto con le altre app del progetto (dealercrm, etideal, ...).
-- Generato da db/migrations/001-008: stesse tabelle, stesso ordine.
-- Applicato su Supabase il 2026-11-11 come migrazioni ruisearch_01_registro_rui,
-- ruisearch_02_area_clienti, ruisearch_03_rete_e_accessi. Rispetto alle migrazioni
-- originali: niente policy di lettura pubblica, niente indici doppi gia coperti
-- dai vincoli unique, search_path fisso sulla funzione di ricostruzione rete.
--
-- Il backend Node si collega come postgres e imposta
--   search_path = ruisearch, extensions, public
-- quindi il codice continua a usare i nomi senza prefisso.

create schema if not exists ruisearch;
comment on schema ruisearch is
  'Ruisearch: copia del Registro Unico Intermediari IVASS (A/B/E) e area clienti.';

-- Ricerca per somiglianza sui nomi (operatore %, similarity, indici trigram).
create extension if not exists pg_trgm with schema extensions;

set search_path = ruisearch, extensions;


-- ===========================================================================
-- 001_schema.sql
-- ===========================================================================
-- Schema del Registro Unico degli Intermediari assicurativi (IVASS).
-- Fonte: https://ruipubblico.ivass.it/inquiry-public-manager/inquiry-public/esporta-registro
-- Nove tabelle, una per CSV dell'export, rigenerato ogni notte dall'IVASS.


-- Ogni esecuzione del caricamento, per sapere a quando risalgono i dati.
create table if not exists import_runs (
  id            bigint generated always as identity primary key,
  iniziato_il   timestamptz not null default now(),
  concluso_il   timestamptz,
  esito         text not null default 'in corso'
                check (esito in ('in corso', 'completato', 'fallito')),
  zip_sha256    text,
  zip_bytes     bigint,
  righe_totali  bigint,
  errore        text
);

comment on table import_runs is
  'Storico dei caricamenti. zip_sha256 permette di saltare un export identico al precedente.';

-- ---------------------------------------------------------------------------
-- Intermediari (ELENCO_INTERMEDIARI.csv)
--
-- La chiave primaria e' oss, il progressivo della fonte: numero_iscrizione_rui
-- non e' univoco, quattro numeri risultano assegnati a due soggetti distinti.
-- L'intestazione del CSV dichiara 15 colonne ma le righe ne hanno 20: le cinque
-- finali, senza nome nella fonte, riguardano gli intermediari comunitari
-- (sezione U) e sono qui ricostruite dai valori osservati.
-- ---------------------------------------------------------------------------
create table if not exists intermediari (
  oss                        bigint primary key,
  numero_iscrizione_rui      text not null,
  sezione                    text generated always as (left(numero_iscrizione_rui, 1)) stored,
  data_iscrizione            date,
  inoperativo                boolean,
  data_inizio_inoperativita  date,

  cognome_nome               text,
  ragione_sociale            text,
  -- Nome da mostrare: persone fisiche e giuridiche non compaiono mai insieme.
  denominazione              text generated always as
                               (coalesce(nullif(cognome_nome, ''), ragione_sociale)) stored,
  persona_giuridica          boolean generated always as
                               (ragione_sociale is not null) stored,

  stato                      text,
  comune_nascita             text,
  provincia_nascita          text,
  data_nascita               date,

  titolo_individuale_sez_a   boolean,
  attivita_esercitata_sez_a  text,
  titolo_individuale_sez_b   boolean,
  attivita_esercitata_sez_b  text,

  -- Solo sezione U, intermediari con sede in altro Stato membro.
  autorita_vigilanza_estera  text,
  stato_estero               text,
  numero_iscrizione_estero   text,
  data_iscrizione_estero     date,
  regime_operativo           text
);

comment on column intermediari.sezione is
  'A agenti, B mediatori, C produttori diretti, D banche e finanziari, E collaboratori, U comunitari, F residuale.';
comment on column intermediari.numero_iscrizione_rui is
  'Non univoco: quattro numeri risultano duplicati nella fonte.';

create index if not exists intermediari_numero_iscrizione_idx on intermediari (numero_iscrizione_rui);
create index if not exists intermediari_sezione_idx           on intermediari (sezione);
create index if not exists intermediari_denominazione_trgm_idx
  on intermediari using gin (denominazione extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Collaboratori (ELENCO_COLLABORATORI.csv) - rapporti fra intermediari
-- ---------------------------------------------------------------------------
create table if not exists collaboratori (
  oss                            bigint primary key,
  livello                        text,
  num_iscr_intermediario         text not null,
  num_iscr_collaboratori_i_liv   text,
  num_iscr_collaboratori_ii_liv  text,
  qualifica_rapporto             text
);

create index if not exists collaboratori_intermediario_idx on collaboratori (num_iscr_intermediario);
create index if not exists collaboratori_i_liv_idx         on collaboratori (num_iscr_collaboratori_i_liv);
create index if not exists collaboratori_ii_liv_idx        on collaboratori (num_iscr_collaboratori_ii_liv);

-- ---------------------------------------------------------------------------
-- Sedi (ELENCO_SEDI.csv)
-- ---------------------------------------------------------------------------
create table if not exists sedi (
  oss                    bigint primary key,
  numero_iscrizione_int  text not null,
  tipo_sede              text,
  comune_sede            text,
  provincia_sede         text,
  cap_sede               text,
  indirizzo_sede         text
);

create index if not exists sedi_intermediario_idx on sedi (numero_iscrizione_int);
create index if not exists sedi_provincia_idx     on sedi (provincia_sede);
create index if not exists sedi_comune_trgm_idx   on sedi using gin (comune_sede extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Mandati (ELENCO_MANDATI.csv) - rapporti con le compagnie
-- ---------------------------------------------------------------------------
create table if not exists mandati (
  oss               bigint primary key,
  matricola         text not null,
  codice_compagnia  text,
  ragione_sociale   text
);

create index if not exists mandati_matricola_idx on mandati (matricola);
create index if not exists mandati_compagnia_idx on mandati (codice_compagnia);

-- ---------------------------------------------------------------------------
-- Cariche societarie (ELENCO_CARICHE.csv)
-- ---------------------------------------------------------------------------
create table if not exists cariche (
  oss                       bigint primary key,
  numero_iscrizione_rui_pf  text,
  numero_iscrizione_rui_pg  text not null,
  qualifica_intermediario   text,
  responsabile              text
);

create index if not exists cariche_pf_idx on cariche (numero_iscrizione_rui_pf);
create index if not exists cariche_pg_idx on cariche (numero_iscrizione_rui_pg);

-- ---------------------------------------------------------------------------
-- Collaboratori accessori (ELENCO_COLLABACCESSORI.csv)
-- Nessun progressivo nella fonte: chiave surrogata.
-- ---------------------------------------------------------------------------
create table if not exists collaboratori_accessori (
  id                   bigint generated always as identity primary key,
  numero_iscrizione_e  text not null,
  ragione_sociale      text,
  cognome_nome         text,
  sede_legale          text,
  data_nascita         date,
  luogo_nascita        text
);

create index if not exists collaboratori_accessori_numero_idx on collaboratori_accessori (numero_iscrizione_e);

-- ---------------------------------------------------------------------------
-- Siti internet (ELENCO_SITO_INTERNET.csv)
-- ---------------------------------------------------------------------------
create table if not exists siti_internet (
  id                 bigint generated always as identity primary key,
  numero_iscrizione  text not null,
  web_url            text not null
);

create index if not exists siti_internet_numero_idx on siti_internet (numero_iscrizione);

-- ---------------------------------------------------------------------------
-- Responsabili della distribuzione, sezione D (ELENCO_RESP_DISTRIB_SEZ_D.csv)
-- ---------------------------------------------------------------------------
create table if not exists responsabili_distribuzione_d (
  id                         bigint generated always as identity primary key,
  numero_iscrizione_d        text not null,
  ragione_sociale            text,
  cognome_nome_responsabile  text
);

create index if not exists responsabili_distribuzione_d_numero_idx
  on responsabili_distribuzione_d (numero_iscrizione_d);

-- ---------------------------------------------------------------------------
-- ELENCO_AG_VEN_PROD_NONST_ISCR_S.csv
-- Il nome della tabella ricalca quello del file: l'acronimo non e' sciolto
-- nella fonte. Collega un soggetto di sezione D a un intermediario di
-- sezione A, con la data di conferimento e la compagnia di riferimento.
-- ---------------------------------------------------------------------------
create table if not exists ag_ven_prod_nonst_iscr_s (
  id                   bigint generated always as identity primary key,
  numero_iscrizione_d  text not null,
  numero_iscrizione_a  text not null,
  data_conferimento    date,
  codice_compagnia     text,
  ragione_sociale      text
);

create index if not exists ag_ven_prod_nonst_d_idx on ag_ven_prod_nonst_iscr_s (numero_iscrizione_d);
create index if not exists ag_ven_prod_nonst_a_idx on ag_ven_prod_nonst_iscr_s (numero_iscrizione_a);

-- ---------------------------------------------------------------------------
-- RLS: dati di un registro pubblico, lettura aperta a tutti, scrittura a
-- nessun ruolo applicativo. Il caricamento gira come postgres, che ignora RLS.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'intermediari', 'collaboratori', 'sedi', 'mandati', 'cariche',
    'collaboratori_accessori', 'siti_internet', 'responsabili_distribuzione_d',
    'ag_ven_prod_nonst_iscr_s', 'import_runs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists lettura_pubblica on %I', t);
    execute format(
      'create policy lettura_pubblica on %I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- ===========================================================================
-- 002_enrichment.sql
-- ===========================================================================
-- Contatti e note raccolti fuori dal registro IVASS (LinkedIn, siti, visure).
-- Il numero RUI non e' chiave esterna: in fonte non e' univoco.

create table if not exists contatti (
  id                     bigint generated always as identity primary key,
  numero_iscrizione_rui  text not null,
  tipo                   text not null
                         check (tipo in (
                           'email', 'telefono', 'pec', 'linkedin',
                           'sito', 'indirizzo', 'partita_iva', 'codice_fiscale', 'altro'
                         )),
  valore                 text not null,
  etichetta              text,
  fonte                  text,
  fonte_url              text,
  affidabilita           text not null default 'da_verificare'
                         check (affidabilita in (
                           'ufficiale', 'pubblico_recente', 'storico',
                           'da_verificare', 'omonimo_possibile'
                         )),
  raccolto_il            date,
  note                   text
);

comment on table contatti is
  'Recapiti pubblici extra-RUI. Una riga per contatto, non per intermediario.';

create index if not exists contatti_rui_idx on contatti (numero_iscrizione_rui);
create unique index if not exists contatti_rui_tipo_valore_idx
  on contatti (numero_iscrizione_rui, tipo, valore);

create table if not exists profili_arricchiti (
  numero_iscrizione_rui  text primary key,
  sintesi                text,
  localita_operativa     text,
  attivita_extra_rui     text,
  aggiornato_il          timestamptz not null default now()
);

comment on table profili_arricchiti is
  'Sintesi umana / AI accanto all''anagrafica ufficiale del registro.';

do $$
declare t text;
begin
  foreach t in array array['contatti', 'profili_arricchiti'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists lettura_pubblica on %I', t);
    execute format(
      'create policy lettura_pubblica on %I for select to anon, authenticated using (true)', t);
    execute format('revoke all on table %I from anon, authenticated', t);
    execute format('grant select on table %I to anon, authenticated, service_role', t);
    execute format('grant insert, update, delete on table %I to service_role', t);
  end loop;
end $$;

grant usage, select on all sequences in schema ruisearch to service_role;

-- ===========================================================================
-- 003_sedi_geo.sql
-- ===========================================================================
-- Coordinate delle sedi, calcolate a richiesta con Geocoding (Google Maps).
-- Non e' un job di massa: si riempie quando apri una scheda azienda.

create table if not exists sedi_geo (
  oss                     bigint primary key,
  numero_iscrizione_rui   text not null,
  indirizzo_usato         text not null,
  lat                     double precision,
  lng                     double precision,
  stato                   text not null default 'in_corso'
                          check (stato in ('in_corso', 'ok', 'zero', 'errore')),
  errore                  text,
  geocodificato_il        timestamptz
);

comment on table sedi_geo is
  'Cache geocoding. oss ripete il progressivo della sede in registro.';

create index if not exists sedi_geo_rui_idx on sedi_geo (numero_iscrizione_rui);
create index if not exists sedi_geo_stato_idx on sedi_geo (stato);

alter table sedi_geo enable row level security;
drop policy if exists lettura_pubblica on sedi_geo;
create policy lettura_pubblica on sedi_geo
  for select to anon, authenticated using (true);

revoke all on table sedi_geo from anon, authenticated;
grant select on table sedi_geo to anon, authenticated, service_role;
grant insert, update, delete on table sedi_geo to service_role;

-- ===========================================================================
-- 004_clienti.sql
-- ===========================================================================
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
      and conrelid = 'ruisearch.clienti'::regclass
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
      and conrelid = 'ruisearch.operatori_cliente'::regclass
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
grant usage, select on all sequences in schema ruisearch to service_role;

-- ===========================================================================
-- 005_fidelizzazione_sorveglianza.sql
-- ===========================================================================
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
      and conrelid = 'ruisearch.cliente_broker_sorvegliati'::regclass
  ) then
    alter table cliente_broker_sorvegliati
      add constraint cliente_broker_sorvegliati_unico unique (cliente_id, rui_broker);
  end if;
end $$;


create table if not exists cliente_rete_snapshot (
  cliente_id  bigint not null references clienti (id) on delete cascade,
  rui_broker  text not null,
  rui_sotto   text not null,
  visto_il    timestamptz not null default now(),
  primary key (cliente_id, rui_broker, rui_sotto)
);


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
      and conrelid = 'ruisearch.cliente_alert'::regclass
  ) then
    alter table cliente_alert
      add constraint cliente_alert_unico unique (cliente_id, rui_broker, rui_nuovo);
  end if;
end $$;

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
grant usage, select on all sequences in schema ruisearch to service_role;

-- ===========================================================================
-- 006_rete_collegati.sql
-- ===========================================================================
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
      and conrelid = 'ruisearch.rete_stato'::regclass
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

-- ===========================================================================
-- 007_opportunity.sql
-- ===========================================================================
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
      and conrelid = 'ruisearch.cliente_opportunity'::regclass
  ) then
    alter table cliente_opportunity
      add constraint cliente_opportunity_unico unique (cliente_id, rui_target);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'cliente_opportunity_stato_check'
      and conrelid = 'ruisearch.cliente_opportunity'::regclass
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
  on mandati using gin (ragione_sociale extensions.gin_trgm_ops);

comment on table cliente_opportunity is
  'Prospect di mercato del cliente. I recapiti stanno in contatti, legati al RUI target.';

alter table cliente_opportunity enable row level security;
revoke all on table cliente_opportunity from anon, authenticated;
grant select, insert, update, delete on table cliente_opportunity to service_role;
grant usage, select on all sequences in schema ruisearch to service_role;

-- ===========================================================================
-- 008_ricerche_mercato.sql
-- ===========================================================================
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
      and conrelid = 'ruisearch.cliente_ricerca_mercato'::regclass
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
      and conrelid = 'ruisearch.cliente_ricerca_risultati'::regclass
  ) then
    alter table cliente_ricerca_risultati
      add constraint cliente_ricerca_risultati_unico unique (ricerca_id, rui);
  end if;
end $$;


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

grant usage, select on all sequences in schema ruisearch to service_role;

-- ===========================================================================
-- Chiusura accessi
-- Lo schema non e' esposto dalla Data API e nessun ruolo applicativo lo legge:
-- passa tutto dal backend. Le policy di lettura pubblica delle migrazioni
-- originali qui non servono e si tolgono.
-- ===========================================================================
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'ruisearch'
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

revoke all on schema ruisearch from public, anon, authenticated;
revoke all on all tables in schema ruisearch from anon, authenticated;
revoke all on all sequences in schema ruisearch from anon, authenticated;
revoke all on all functions in schema ruisearch from public, anon, authenticated;

grant usage on schema ruisearch to service_role;
grant select, insert, update, delete on all tables in schema ruisearch to service_role;
grant usage, select on all sequences in schema ruisearch to service_role;
grant execute on all functions in schema ruisearch to service_role;

alter default privileges in schema ruisearch revoke all on tables from anon, authenticated;
alter default privileges in schema ruisearch revoke all on functions from public, anon, authenticated;

-- La funzione di ricostruzione rete gira sempre sullo schema giusto.
alter function ruisearch.ricostruisci_rete_collegati()
  set search_path = ruisearch, extensions;

-- ===========================================================================
-- ruisearch_04_denominazione_pulita (2026-11-11)
-- Nomi che nella fonte iniziano con virgolette o spazi finivano in cima
-- all'elenco alfabetico. Indice (denominazione, oss) per la lista ordinata.
-- ===========================================================================
alter table ruisearch.intermediari drop column denominazione;

alter table ruisearch.intermediari add column denominazione text generated always as (
  case
    when coalesce(nullif(cognome_nome, ''), ragione_sociale) ~ '^[[:space:]"''`]'
      then btrim(coalesce(nullif(cognome_nome, ''), ragione_sociale), E' \t"''`')
    else coalesce(nullif(cognome_nome, ''), ragione_sociale)
  end
) stored;

create index intermediari_denominazione_trgm_idx
  on ruisearch.intermediari using gin (denominazione extensions.gin_trgm_ops);
create index intermediari_denominazione_oss_idx
  on ruisearch.intermediari (denominazione, oss);
