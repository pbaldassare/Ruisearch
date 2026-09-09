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

grant usage, select on all sequences in schema public to service_role;
