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

-- ===========================================================================
-- ruisearch_05_api_keys (2026-11-23)
-- Chiavi per software esterni su /v1, generate dalla pagina Documentazione.
-- Solo l'hash SHA-256: la chiave in chiaro si mostra una volta, alla creazione.
-- ===========================================================================
create table if not exists ruisearch.api_keys (
  id          bigint generated always as identity primary key,
  nome        text not null,
  prefisso    text not null,
  hash        text not null unique,
  creata_il   timestamptz not null default now(),
  ultimo_uso  timestamptz,
  revocata_il timestamptz
);
alter table ruisearch.api_keys enable row level security;
grant select, insert, update, delete on ruisearch.api_keys to service_role;

-- ===========================================================================
-- ruisearch_06_accessi_falliti (2026-11-23)
-- Blocco del login: 5 password errate sulla stessa email in 15 minuti bloccano
-- l'accesso per 15 minuti (src/auth-login.js). Le righe vecchie si cancellano da sole.
-- ===========================================================================
create table if not exists ruisearch.accessi_falliti (
  email         text primary key,
  tentativi     integer not null default 0,
  primo_il      timestamptz not null default now(),
  bloccato_fino timestamptz
);
alter table ruisearch.accessi_falliti enable row level security;
grant select, insert, update, delete on ruisearch.accessi_falliti to service_role;

-- ===========================================================================
-- ruisearch_07_ruolo_api (2026-11-23)
-- Utente dedicato alla Edge Function al posto di postgres: legge e scrive solo
-- le tabelle dello schema ruisearch, niente DDL, niente schemi delle altre app.
-- BYPASSRLS: la RLS qui serve solo a chiudere anon/authenticated.
-- Password a parte, mai nel repo:
--   create role ruisearch_api login bypassrls connection limit 20 password '...';
-- La Edge Function lo usa tramite il segreto DATABASE_URL (vince su SUPABASE_DB_URL).
-- ===========================================================================
grant usage on schema ruisearch to ruisearch_api;
grant usage on schema extensions to ruisearch_api;
grant select, insert, update, delete on all tables in schema ruisearch to ruisearch_api;
grant usage, select on all sequences in schema ruisearch to ruisearch_api;
alter default privileges for role postgres in schema ruisearch grant select, insert, update, delete on tables to ruisearch_api;
alter default privileges for role postgres in schema ruisearch grant usage, select on sequences to ruisearch_api;

-- ===========================================================================
-- ruisearch_08_api_keys_limite (2026-11-23)
-- Contatore delle chiamate /v1 per chiave nel minuto corrente (src/api-keys.js).
-- ===========================================================================
alter table ruisearch.api_keys
  add column if not exists finestra_il timestamptz,
  add column if not exists richieste_finestra integer not null default 0;

-- ===========================================================================
-- ruisearch_09_ricerche_kimi (2026-11-23), rinominata ricerche_web in ruisearch_12
-- Ricerche web con Kimi dei clienti ("Cerca recapiti"): una ricerca sullo stesso
-- intermediario si riusa per 90 giorni (tutti i clienti) e ogni cliente ne fa al
-- massimo 20 nuove al giorno (src/opportunity.js).
-- ===========================================================================
create table if not exists ruisearch.ricerche_kimi (
  id         bigint generated always as identity primary key,
  cliente_id bigint not null references ruisearch.clienti (id) on delete cascade,
  rui_target text not null,
  sintesi    text,
  fatta_il   timestamptz not null default now()
);
create index if not exists ricerche_kimi_target_idx on ruisearch.ricerche_kimi (rui_target, fatta_il desc);
create index if not exists ricerche_kimi_cliente_idx on ruisearch.ricerche_kimi (cliente_id, fatta_il desc);
alter table ruisearch.ricerche_kimi enable row level security;
grant select, insert, update, delete on ruisearch.ricerche_kimi to service_role, ruisearch_api;

-- ===========================================================================
-- ruisearch_10_import_fasi (2026-11-23): Import: riga creata all'avvio, fase/messaggio, esiti identico e incompleto
-- Applicata in prod il 23/11.
-- ===========================================================================
-- Import del registro: fase ed esiti nuovi in import_runs.
--
-- Da applicare UNA volta in produzione PRIMA di pubblicare il nuovo codice
-- (push su main, che usa GitHub Actions per l'import, e `npm run deploy:api`):
-- il nuovo src/importa.js scrive fase/messaggio e gli esiti 'identico' e
-- 'incompleto', che con il vincolo di prima verrebbero rifiutati.
-- Idempotente: si puo' rilanciare senza effetti.

begin;

-- Fase raggiunta (download, validazione, caricamento, rete, completato) e
-- ultimo messaggio di avanzamento: online la pagina Aggiornamento li legge da
-- qui mentre l'import gira su GitHub Actions. Su una riga chiusa la fase dice
-- dove si e' fermato un import fallito.
alter table ruisearch.import_runs add column if not exists fase text;
alter table ruisearch.import_runs add column if not exists messaggio text;

-- Esiti:
--   in corso    la riga nasce all'avvio, prima del download
--   completato  registro sostituito, rete e statistiche ricostruite
--   identico    export uguale all'ultimo completato: niente caricamento
--   incompleto  registro sostituito, ma rete o statistiche non ricostruite
--   fallito     registro non toccato (restano i dati di prima)
alter table ruisearch.import_runs drop constraint if exists import_runs_esito_check;
alter table ruisearch.import_runs add constraint import_runs_esito_check
  check (esito in ('in corso', 'completato', 'identico', 'incompleto', 'fallito'));

comment on column ruisearch.import_runs.fase is
  'Fase raggiunta: download, validazione, caricamento, rete, completato.';
comment on column ruisearch.import_runs.messaggio is
  'Ultimo messaggio di avanzamento (es. MB scaricati), aggiornato al massimo ogni 15 s.';

commit;


-- ===========================================================================
-- ruisearch_11_rete_tramite_geo (2026-11-23): Rete con il collegamento I livello -> II livello (tramite), diretti/indiretti, cache geocoding per RUI + indirizzo
-- Applicata in prod il 23/11.
-- ===========================================================================
-- Da applicare UNA volta su produzione (progetto moyfkdwsghidkcifesrg), PRIMA di
-- pubblicare il codice che legge rete_collegati.tramite, rete_numeri.diretti/indiretti
-- e sedi_geo.indirizzo_chiave. Poi lanciare la ricostruzione della rete:
--   select * from ruisearch.ricostruisci_rete_collegati();
-- (oppure `npm run rete`). Il prossimo import la rilancia da solo.
--
-- Una volta applicato va riportato in db/supabase/ruisearch_schema.sql.

set search_path = ruisearch, extensions;

-- ===========================================================================
-- 1. Rete: anche il collegamento societa' di I livello → collaboratore di II livello
-- ===========================================================================
-- Contratto di rete_collegati:
--   livello 'I'  = collaboratore DIRETTO del principale (anche una societa' E
--                  di I livello con i suoi addetti di II livello);
--   livello 'II' = collaboratore INDIRETTO del principale, attraverso la
--                  societa' di I livello indicata in "tramite".
-- Se una persona e' sia diretta sia indiretta sotto lo stesso principale resta
-- un arco solo, quello diretto.

alter table rete_collegati add column if not exists tramite text;

comment on table rete_collegati is
  'Archi di rete A/B/E, uno per coppia (principale, collegato). livello I = diretto, II = indiretto tramite la societa di I livello in tramite.';
comment on column rete_collegati.livello is
  'I = collaboratore diretto del principale; II = indiretto, attraverso la societa di I livello in tramite.';
comment on column rete_collegati.tramite is
  'Solo livello II: RUI della societa di I livello attraverso cui passa il rapporto.';

-- rete_numeri.collaboratori resta il totale dei collegati unici (diretti +
-- indiretti, la lunghezza della lista "collaboratori" dell'API); diretti e
-- indiretti lo dividono.
alter table rete_numeri add column if not exists diretti integer not null default 0;
alter table rete_numeri add column if not exists indiretti integer not null default 0;

comment on table rete_numeri is
  'Conteggi per iscrizione: collaboratori unici (diretti + indiretti), principali unici, rapporti grezzi della fonte.';
comment on column rete_numeri.collaboratori is
  'Collegati unici sotto il soggetto: diretti + indiretti.';
comment on column rete_numeri.diretti is
  'Collegati unici di livello I (rapporto diretto).';
comment on column rete_numeri.indiretti is
  'Collegati unici di livello II (attraverso una societa di I livello).';
comment on column rete_numeri.rapporti is
  'Righe di ELENCO_COLLABORATORI che legano il soggetto a un suo collaboratore A/B/E (anche come societa di I livello), prima di togliere i doppioni.';

create or replace function ricostruisci_rete_collegati()
returns table (archi bigint, soggetti bigint)
language plpgsql
set search_path = ruisearch, extensions
as $$
declare
  n_archi bigint;
  n_soggetti bigint;
begin
  -- Rapporti grezzi con entrambi gli estremi A/B/E. Una tabella temporanea:
  -- servono sia agli archi (senza doppioni) sia al conteggio dei rapporti.
  drop table if exists pg_temp.rete_bruti;
  create temporary table rete_bruti on commit drop as
  with anag as (
    -- Una riga per numero RUI: quattro numeri sono doppi nella fonte.
    select distinct on (numero_iscrizione_rui)
      numero_iscrizione_rui, sezione
    from intermediari
    where sezione in ('A', 'B', 'E')
    order by numero_iscrizione_rui, inoperativo, oss
  ),
  bruti as (
    -- I livello: il principale e il suo collaboratore diretto.
    select
      c.num_iscr_intermediario as principale,
      c.num_iscr_collaboratori_i_liv as collegato,
      'I'::text as livello,
      null::text as tramite,
      nullif(trim(c.qualifica_rapporto), '') as qualifica
    from collaboratori c
    where c.livello = 'I'
      and c.num_iscr_collaboratori_i_liv is not null
    union all
    -- II livello, rapporto diretto: la societa' di I livello e il suo addetto.
    select
      c.num_iscr_collaboratori_i_liv,
      c.num_iscr_collaboratori_ii_liv,
      'I',
      null,
      nullif(trim(c.qualifica_rapporto), '')
    from collaboratori c
    where c.num_iscr_collaboratori_i_liv is not null
      and c.num_iscr_collaboratori_ii_liv is not null
    union all
    -- II livello, rapporto indiretto: il principale e l'addetto, tramite la societa'.
    select
      c.num_iscr_intermediario,
      c.num_iscr_collaboratori_ii_liv,
      'II',
      c.num_iscr_collaboratori_i_liv,
      nullif(trim(c.qualifica_rapporto), '')
    from collaboratori c
    where c.num_iscr_collaboratori_ii_liv is not null
  )
  select
    b.principale,
    b.collegato,
    b.livello,
    b.tramite,
    b.qualifica,
    p.sezione as sezione_principale,
    e.sezione as sezione_collegato
  from bruti b
  join anag p on p.numero_iscrizione_rui = b.principale
  join anag e on e.numero_iscrizione_rui = b.collegato
  where b.principale <> b.collegato;

  delete from rete_collegati;
  delete from rete_numeri;

  -- Un arco per coppia: vince il rapporto diretto ('I' < 'II').
  insert into rete_collegati (
    principale, collegato, livello, qualifica, sezione_principale, sezione_collegato, tramite
  )
  select distinct on (principale, collegato)
    principale, collegato, livello, qualifica, sezione_principale, sezione_collegato, tramite
  from rete_bruti
  order by principale, collegato, livello, tramite nulls first, qualifica;

  insert into rete_numeri (rui, collaboratori, diretti, indiretti, principali, rapporti)
  select
    x.rui,
    sum(x.uscita)::integer,
    sum(x.diretto)::integer,
    sum(x.indiretto)::integer,
    sum(x.entrata)::integer,
    0
  from (
    select
      principale as rui,
      1 as uscita,
      (livello = 'I')::integer as diretto,
      (livello = 'II')::integer as indiretto,
      0 as entrata
    from rete_collegati
    union all
    select collegato, 0, 0, 0, 1 from rete_collegati
  ) x
  group by x.rui;

  -- Rapporti grezzi: ogni riga della fonte una volta sola per soggetto (niente
  -- piu' doppio conteggio per i RUI duplicati in intermediari).
  update rete_numeri n
  set rapporti = r.n
  from (
    select principale as rui, count(*)::integer as n
    from rete_bruti
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

-- ===========================================================================
-- 2. Cache geocoding per RUI + indirizzo, non per oss
-- ===========================================================================
-- oss e' il numero di riga dell'export IVASS e cambia a ogni import: con la
-- chiave su oss una mappa poteva mostrare le coordinate di un altro
-- intermediario. La chiave diventa (RUI, indirizzo normalizzato); oss resta
-- come informazione. Stessa normalizzazione di chiaveIndirizzo() in src/geo.js.

alter table sedi_geo add column if not exists indirizzo_chiave text;

update sedi_geo
set indirizzo_chiave = upper(btrim(regexp_replace(indirizzo_usato, '\s+', ' ', 'g')))
where indirizzo_chiave is null;

-- Doppioni (stesso RUI e stesso indirizzo): resta il piu' recente.
delete from sedi_geo a
using sedi_geo b
where a.numero_iscrizione_rui = b.numero_iscrizione_rui
  and a.indirizzo_chiave = b.indirizzo_chiave
  and (coalesce(a.geocodificato_il, '-infinity'), a.oss)
    < (coalesce(b.geocodificato_il, '-infinity'), b.oss);

alter table sedi_geo alter column indirizzo_chiave set not null;

do $$
begin
  -- La chiave primaria passa da (oss) a (numero_iscrizione_rui, indirizzo_chiave).
  if exists (
    select 1 from pg_constraint
    where conrelid = 'ruisearch.sedi_geo'::regclass
      and conname = 'sedi_geo_pkey'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (oss)'
  ) then
    alter table sedi_geo drop constraint sedi_geo_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'ruisearch.sedi_geo'::regclass
      and contype = 'p'
  ) then
    alter table sedi_geo
      add constraint sedi_geo_pkey primary key (numero_iscrizione_rui, indirizzo_chiave);
  end if;
end $$;

alter table sedi_geo alter column oss drop not null;

comment on table sedi_geo is
  'Cache geocoding per RUI + indirizzo (indirizzo_chiave). oss e solo informativo: cambia a ogni import.';
comment on column sedi_geo.indirizzo_chiave is
  'indirizzo_usato maiuscolo con gli spazi compattati: chiave della cache insieme al RUI.';


-- ===========================================================================
-- ruisearch_12_area_cliente (2026-11-23): ricerche_kimi -> ricerche_web (prenotazione, tipo, costo), provenienza dei recapiti
-- Applicata in prod il 23/11.
-- ===========================================================================
-- ===========================================================================
-- pending_cliente.sql: area cliente (ricerche web, recapiti, sorveglianza broker)
-- Da applicare UNA volta in produzione (progetto moyfkdwsghidkcifesrg), tutto il
-- file in un colpo, PRIMA del deploy della Edge Function con il nuovo codice:
-- src/opportunity.js scrive su ricerche_web e su contatti.ricerca_id.
-- Idempotente: rilanciarlo non cambia niente.
-- ===========================================================================

begin;
set local search_path = ruisearch, extensions;

-- ---------------------------------------------------------------------------
-- 1. ricerche_kimi -> ricerche_web: stessi dati, nome indipendente dal fornitore AI.
--    Una riga per richiesta di "Cerca recapiti": anche le letture dalla cache
--    (tipo 'cache_*'), che non contano nel tetto giornaliero e non fanno da fonte
--    per il riuso. RUISearch registra solo il costo reale del fornitore
--    (costo_eur, lo riempirà il lavoro su Mistral), mai prezzi.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('ruisearch.ricerche_web') is null and to_regclass('ruisearch.ricerche_kimi') is not null then
    alter table ruisearch.ricerche_kimi rename to ricerche_web;
  end if;
  if to_regclass('ruisearch.ricerche_kimi_target_idx') is not null then
    alter index ruisearch.ricerche_kimi_target_idx rename to ricerche_web_target_idx;
  end if;
  -- Il tetto giornaliero ora conta per iniziata_il: indice nuovo più sotto
  if to_regclass('ruisearch.ricerche_kimi_cliente_idx') is not null then
    drop index ruisearch.ricerche_kimi_cliente_idx;
  end if;
  if exists (
    select 1 from pg_constraint
    where conname = 'ricerche_kimi_pkey' and conrelid = 'ruisearch.ricerche_web'::regclass
  ) then
    alter table ruisearch.ricerche_web rename constraint ricerche_kimi_pkey to ricerche_web_pkey;
  end if;
  if exists (
    select 1 from pg_constraint
    where conname = 'ricerche_kimi_cliente_id_fkey' and conrelid = 'ruisearch.ricerche_web'::regclass
  ) then
    alter table ruisearch.ricerche_web
      rename constraint ricerche_kimi_cliente_id_fkey to ricerche_web_cliente_id_fkey;
  end if;
end $$;

alter table ricerche_web
  add column if not exists stato       text not null default 'ok',
  add column if not exists tipo        text,
  add column if not exists iniziata_il timestamptz,
  add column if not exists costo_eur   numeric;

-- Le ricerche già fatte sono partite e finite insieme
update ricerche_web set iniziata_il = fatta_il where iniziata_il is null;

alter table ricerche_web
  alter column iniziata_il set default now(),
  alter column iniziata_il set not null,
  -- fatta_il = fine della ricerca: vuota finché è 'in_corso'
  alter column fatta_il drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ricerche_web_stato_check' and conrelid = 'ruisearch.ricerche_web'::regclass
  ) then
    alter table ruisearch.ricerche_web add constraint ricerche_web_stato_check
      check (stato in ('in_corso', 'ok', 'errore'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'ricerche_web_tipo_check' and conrelid = 'ruisearch.ricerche_web'::regclass
  ) then
    alter table ruisearch.ricerche_web add constraint ricerche_web_tipo_check
      check (tipo is null or tipo in (
        'nuova_con_risultati', 'nuova_senza_risultati', 'cache_con_risultati', 'cache_senza_risultati'
      ));
  end if;
end $$;

-- Una sola ricerca in corso per RUI, fra tutti i clienti: il secondo clic riceve 409
create unique index if not exists ricerche_web_in_corso_idx
  on ricerche_web (rui_target) where stato = 'in_corso';
create index if not exists ricerche_web_target_idx on ricerche_web (rui_target, fatta_il desc);
create index if not exists ricerche_web_cliente_idx on ricerche_web (cliente_id, iniziata_il desc);

comment on table ricerche_web is
  'Richieste "Cerca recapiti" dei clienti, una riga ciascuna (anche le letture dalla cache). '
  'Riuso 90 giorni solo da righe nuova_*; tetto 20 nuove al giorno per cliente (src/opportunity.js).';
comment on column ricerche_web.stato is 'in_corso (prenotata prima della chiamata AI) | ok | errore (non vale per il riuso).';
comment on column ricerche_web.tipo is
  'Esito: nuova_con_risultati | nuova_senza_risultati | cache_con_risultati | cache_senza_risultati; null se in corso o in errore.';
comment on column ricerche_web.costo_eur is 'Costo reale del fornitore AI per questa ricerca (null se non noto o letta dalla cache).';

-- ---------------------------------------------------------------------------
-- 2. contatti: provenienza (quando, da quale ricerca, di chi)
-- ---------------------------------------------------------------------------
alter table contatti
  add column if not exists ricerca_id bigint references ricerche_web (id) on delete set null,
  add column if not exists riferito_a text;

alter table contatti alter column raccolto_il set default ((now() at time zone 'Europe/Rome')::date);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contatti_riferito_a_check' and conrelid = 'ruisearch.contatti'::regclass
  ) then
    alter table ruisearch.contatti add constraint contatti_riferito_a_check
      check (riferito_a is null or riferito_a in ('persona', 'societa_collegata'));
  end if;
end $$;

create index if not exists contatti_ricerca_idx on contatti (ricerca_id) where ricerca_id is not null;

comment on column contatti.ricerca_id is 'Ricerca web (ricerche_web) che ha trovato il recapito; null per il registro.';
comment on column contatti.riferito_a is 'Di chi è il recapito: persona | societa_collegata; null = non detto.';

-- 2a. Recapiti che il nuovo validatore scarta (src/opportunity.js validaRecapito, provato sulle 14 righe
--     di produzione il 23/11): solo questa, una data salvata come recapito.
--       select id, numero_iscrizione_rui, tipo, valore, etichetta, fonte from contatti where id = 36;
--       -> 36 | E000768333 | altro | 16/01/2025 | Data iscrizione | kimi_web
delete from contatti
where id = 36 and numero_iscrizione_rui = 'E000768333' and tipo = 'altro' and valore = '16/01/2025';

-- 2b. Copie web di un indirizzo del registro (stesso testo a meno di maiuscole e punteggiatura): il nuovo
--     codice non le crea più. Anteprima eseguita il 23/11, 4 righe: 7 (A000000250), 13 (A000001728),
--     18 e 22 (A000000617). Si può saltare: senza, restano doppioni nella scheda Opportunity.
delete from contatti c
where c.fonte is distinct from 'rui'
  and c.tipo = 'indirizzo'
  and exists (
    select 1 from contatti r
    where r.numero_iscrizione_rui = c.numero_iscrizione_rui
      and r.tipo = c.tipo
      and r.fonte = 'rui'
      and r.id <> c.id
      and regexp_replace(lower(r.valore), '[^[:alnum:]@.]', '', 'g')
        = regexp_replace(lower(c.valore), '[^[:alnum:]@.]', '', 'g')
  );

-- 2c. Dati del registro: affidabilità 'ufficiale' (come fa ora il codice); e l'etichetta "Sede web"
--     che la vecchia upsert aveva scritto sopra la sede RUI di A000001728 (in sedi è "Sede operativa").
update contatti set affidabilita = 'ufficiale' where fonte = 'rui' and affidabilita <> 'ufficiale';
update contatti set etichetta = 'Sede operativa'
where id = 10 and numero_iscrizione_rui = 'A000001728' and fonte = 'rui' and etichetta = 'Sede web';

-- ---------------------------------------------------------------------------
-- 3. Esito delle ricerche già fatte (dopo la pulizia del punto 2): tutte nuove; con risultati solo se
--    hanno lasciato un recapito web che non è la copia di un dato del registro. Anteprima 23/11:
--    12 righe, tutte 'nuova_senza_risultati' (gli unici recapiti web erano le copie del punto 2b e la data).
-- ---------------------------------------------------------------------------
update ricerche_web w
set tipo = case
  when exists (
    select 1 from contatti c
    where c.numero_iscrizione_rui = w.rui_target
      and c.fonte = 'kimi_web'
      and not exists (
        select 1 from contatti r
        where r.numero_iscrizione_rui = c.numero_iscrizione_rui
          and r.tipo = c.tipo
          and r.fonte = 'rui'
          and regexp_replace(lower(r.valore), '[^[:alnum:]@.]', '', 'g')
            = regexp_replace(lower(c.valore), '[^[:alnum:]@.]', '', 'g')
      )
  ) then 'nuova_con_risultati'
  else 'nuova_senza_risultati'
end
where tipo is null and stato = 'ok';

-- ---------------------------------------------------------------------------
-- 4. Avvisi di broker non più sorvegliati: non si vedono e non si contano più, e bloccavano
--    (vincolo unico) gli avvisi dopo aver rimesso lo stesso broker. Anteprima 23/11: 0 righe.
--       select a.* from cliente_alert a where not exists (select 1 from cliente_broker_sorvegliati b
--         where b.cliente_id = a.cliente_id and b.rui_broker = a.rui_broker);
-- ---------------------------------------------------------------------------
delete from cliente_alert a
where not exists (
  select 1 from cliente_broker_sorvegliati b
  where b.cliente_id = a.cliente_id and b.rui_broker = a.rui_broker
);

commit;


-- ===========================================================================
-- ruisearch_13_ricerche_mistral_api (2026-11-23): fornitore per riga, chiamate /v1 (chiave API e codice agenzia)
-- Applicata in prod il 23/11 (riportata qui il 27/11 da supabase_migrations).
-- ===========================================================================
alter table ruisearch.ricerche_web add column if not exists fornitore text;
update ruisearch.ricerche_web set fornitore = 'kimi' where fornitore is null;
alter table ruisearch.ricerche_web alter column fornitore set default 'mistral';
alter table ruisearch.ricerche_web alter column fornitore set not null;
alter table ruisearch.ricerche_web alter column cliente_id drop not null;
alter table ruisearch.ricerche_web add column if not exists chiave_id bigint references ruisearch.api_keys (id) on delete set null;
alter table ruisearch.ricerche_web add column if not exists agenzia text;
comment on column ruisearch.ricerche_web.fornitore is 'mistral | kimi (storico): il riuso considera solo le ricerche mistral.';
comment on column ruisearch.ricerche_web.chiave_id is 'Chiamata da /v1: chiave API usata (cliente_id resta null).';
comment on column ruisearch.ricerche_web.agenzia is 'Chiamata da /v1: codice agenzia del software chiamante (es. Assicurapp), per i consumi.';

-- ===========================================================================
-- ruisearch_14_tipo_gia_richiesta (2026-11-24): /v1/recapiti, stessa agenzia e stesso RUI = gia_richiesta, costo 0
-- Applicata in prod il 24/11 (riportata qui il 27/11 da supabase_migrations).
-- ===========================================================================
alter table ruisearch.ricerche_web drop constraint if exists ricerche_web_tipo_check;
alter table ruisearch.ricerche_web add constraint ricerche_web_tipo_check
  check (tipo is null or tipo in (
    'nuova_con_risultati', 'nuova_senza_risultati', 'cache_con_risultati', 'cache_senza_risultati', 'gia_richiesta'
  ));
create index if not exists ricerche_web_agenzia_idx on ruisearch.ricerche_web (agenzia, rui_target, fatta_il desc)
  where agenzia is not null;

-- ===========================================================================
-- ruisearch_15_archivio_agenzie (2026-11-27): archivio personale di intermediari per agenzia di un software /v1
-- Applicata in prod il 27/11/2026 (progetto moyfkdwsghidkcifesrg). Rollback: drop table if exists ruisearch.agenzia_archivio;
-- ===========================================================================
-- Una riga per intermediario nell'archivio di un'agenzia: identità = (chiave_id, agenzia), cioè la chiave API
-- del software (Assicurapp, Assiquot...) e il codice agenzia che il software manda. Le voci entrano quando
-- l'agenzia apre una scheda (origine 'scheda'), fa una ricerca recapiti ('ricerca') o le scrive a mano
-- ('manuale', anche senza RUI).
--
-- telefoni ed email sono SOLO quelli che l'agenzia ha ricevuto dalle sue ricerche recapiti (copiati al momento
-- della ricerca) o scritto a mano: mai letti dal vivo da contatti, che è condivisa fra tutti.
-- Nome, sezione e sede si leggono dal registro per le voci con RUI; le colonne qui sono la copia del momento
-- dell'inserimento (o quanto scritto a mano) e valgono se il RUI sparisce dal registro.

begin;

create table if not exists ruisearch.agenzia_archivio (
  id            bigint generated always as identity primary key,
  -- api_keys.id; 0 = chiave RUI_API_KEY del .env (senza riga in api_keys). Niente FK: le chiavi si revocano, non si cancellano.
  chiave_id     bigint not null,
  agenzia       text not null,
  rui           text,
  nome          text not null,
  sezione       text,
  provincia     text,
  comune        text,
  indirizzo     text,
  telefoni      text[] not null default '{}',
  email         text[] not null default '{}',
  stato         text not null default 'archivio'
                check (stato in ('archivio', 'da_lavorare', 'contattato', 'scartato')),
  note          text,
  origine       text not null check (origine in ('scheda', 'ricerca', 'manuale')),
  creato_il     timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  -- Ultima ricerca recapiti dell'agenzia su questo RUI copiata in telefoni/email; null = mai cercato.
  recapiti_il   timestamptz
);

-- Un RUI una volta sola per agenzia; le voci manuali senza RUI senza vincolo.
create unique index if not exists agenzia_archivio_rui_idx
  on ruisearch.agenzia_archivio (chiave_id, agenzia, rui) where rui is not null;
create index if not exists agenzia_archivio_agenzia_idx
  on ruisearch.agenzia_archivio (chiave_id, agenzia, aggiornato_il desc);

comment on table ruisearch.agenzia_archivio is
  'Archivio personale di intermediari per agenzia di un software /v1 (chiave_id + agenzia), src/archivio.js.';
comment on column ruisearch.agenzia_archivio.telefoni is
  'Solo recapiti ricevuti dalle ricerche dell''agenzia o scritti a mano, mai letti da contatti.';

alter table ruisearch.agenzia_archivio enable row level security;
revoke all on table ruisearch.agenzia_archivio from anon, authenticated;
grant select, insert, update, delete on ruisearch.agenzia_archivio to service_role, ruisearch_api;
grant usage, select on all sequences in schema ruisearch to service_role, ruisearch_api;

commit;
