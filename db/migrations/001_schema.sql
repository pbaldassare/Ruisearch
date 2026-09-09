-- Schema del Registro Unico degli Intermediari assicurativi (IVASS).
-- Fonte: https://ruipubblico.ivass.it/inquiry-public-manager/inquiry-public/esporta-registro
-- Nove tabelle, una per CSV dell'export, rigenerato ogni notte dall'IVASS.

create extension if not exists pg_trgm;

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
  on intermediari using gin (denominazione gin_trgm_ops);

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
create index if not exists sedi_comune_trgm_idx   on sedi using gin (comune_sede gin_trgm_ops);

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
