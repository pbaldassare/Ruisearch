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
