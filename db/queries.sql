-- Query della dashboard. Solo lettura. Nessun import.
-- Fonte unica: src/query.js (sezioni A, B, E). Qui il testo di riferimento.
-- Placeholder: $1 sezioni text[], poi q / rui / cursore.

-- ---------------------------------------------------------------------------
-- Overview
-- ---------------------------------------------------------------------------
select
  (select count(*) from intermediari) as intermediari,
  (select count(*) from collaboratori) as collaborazioni,
  (select count(*) from sedi) as sedi,
  (select count(*) from mandati) as mandati;

select id, iniziato_il, concluso_il, esito, righe_totali
from import_runs
order by id desc
limit 1;

-- ---------------------------------------------------------------------------
-- Intermediari (lista + cerca)
-- ---------------------------------------------------------------------------
select
  i.numero_iscrizione_rui,
  i.sezione,
  i.denominazione,
  i.data_iscrizione,
  i.inoperativo,
  i.persona_giuridica
from intermediari i
where ($1::text is null or i.sezione = $1)
  and (
    $2::text is null
    or i.numero_iscrizione_rui = upper($2)
    or i.denominazione ilike '%' || $2 || '%'
  )
order by i.denominazione
limit coalesce($3, 50)
offset coalesce($4, 0);

-- Ricerca per somiglianza (indice trigram gia' presente)
select numero_iscrizione_rui, sezione, denominazione,
       similarity(denominazione, $1) as score
from intermediari
where denominazione % $1
order by score desc
limit 30;

-- ---------------------------------------------------------------------------
-- Scheda intermediario
-- ---------------------------------------------------------------------------
select *
from intermediari
where numero_iscrizione_rui = $1;

select tipo_sede, comune_sede, provincia_sede, cap_sede, indirizzo_sede
from sedi
where numero_iscrizione_int = $1;

select web_url
from siti_internet
where numero_iscrizione = $1;

select codice_compagnia, ragione_sociale
from mandati
where matricola = $1;

-- Cariche: come societa' o come persona
select c.qualifica_intermediario, c.responsabile,
       c.numero_iscrizione_rui_pf, pf.denominazione as persona,
       c.numero_iscrizione_rui_pg, pg.denominazione as societa
from cariche c
left join intermediari pf on pf.numero_iscrizione_rui = c.numero_iscrizione_rui_pf
left join intermediari pg on pg.numero_iscrizione_rui = c.numero_iscrizione_rui_pg
where c.numero_iscrizione_rui_pg = $1
   or c.numero_iscrizione_rui_pf = $1;

select tipo, valore, etichetta, affidabilita, fonte
from contatti
where numero_iscrizione_rui = $1
order by tipo, valore;

-- ---------------------------------------------------------------------------
-- Rete: archi in uscita (io sono il principale)
-- ---------------------------------------------------------------------------
select
  c.livello,
  trim(c.qualifica_rapporto) as qualifica,
  c.num_iscr_collaboratori_i_liv as rui_collegato,
  i.denominazione,
  i.sezione
from collaboratori c
join intermediari i on i.numero_iscrizione_rui = c.num_iscr_collaboratori_i_liv
where c.num_iscr_intermediario = $1
order by i.denominazione;

-- Rete: archi in entrata (io sono collaboratore di qualcuno)
select
  c.livello,
  trim(c.qualifica_rapporto) as qualifica,
  c.num_iscr_intermediario as rui_collegato,
  i.denominazione,
  i.sezione
from collaboratori c
join intermediari i on i.numero_iscrizione_rui = c.num_iscr_intermediario
where c.num_iscr_collaboratori_i_liv = $1
   or c.num_iscr_collaboratori_ii_liv = $1
order by i.denominazione;

-- Grafo 1-hop (nodi + archi) per un RUI
with archi as (
  select num_iscr_intermediario as da,
         num_iscr_collaboratori_i_liv as a,
         trim(qualifica_rapporto) as qualifica,
         livello
  from collaboratori
  where num_iscr_intermediario = $1
     or num_iscr_collaboratori_i_liv = $1
     or num_iscr_collaboratori_ii_liv = $1
)
select da, a, qualifica, livello from archi
where da is not null and a is not null;

-- ---------------------------------------------------------------------------
-- Sedi / Mandati / Cariche (elenchi)
-- ---------------------------------------------------------------------------
select s.numero_iscrizione_int, i.denominazione, s.tipo_sede,
       s.comune_sede, s.provincia_sede, s.indirizzo_sede
from sedi s
left join intermediari i on i.numero_iscrizione_rui = s.numero_iscrizione_int
where ($1::text is null or s.provincia_sede = $1)
  and ($2::text is null or s.comune_sede ilike '%' || $2 || '%')
order by s.provincia_sede, s.comune_sede
limit coalesce($3, 50)
offset coalesce($4, 0);

select m.matricola, i.denominazione, m.codice_compagnia, m.ragione_sociale
from mandati m
left join intermediari i on i.numero_iscrizione_rui = m.matricola
where ($1::text is null or m.ragione_sociale ilike '%' || $1 || '%')
order by m.ragione_sociale
limit coalesce($2, 50)
offset coalesce($3, 0);

select c.numero_iscrizione_rui_pf, pf.denominazione as persona,
       c.numero_iscrizione_rui_pg, pg.denominazione as societa,
       c.qualifica_intermediario
from cariche c
left join intermediari pf on pf.numero_iscrizione_rui = c.numero_iscrizione_rui_pf
left join intermediari pg on pg.numero_iscrizione_rui = c.numero_iscrizione_rui_pg
where ($1::text is null
       or pf.denominazione ilike '%' || $1 || '%'
       or pg.denominazione ilike '%' || $1 || '%')
order by pg.denominazione, pf.denominazione
limit coalesce($2, 50)
offset coalesce($3, 0);

-- ---------------------------------------------------------------------------
-- Aggiornamento (solo storico, nessun lancio)
-- ---------------------------------------------------------------------------
select id, iniziato_il, concluso_il, esito, zip_sha256, zip_bytes, righe_totali, errore
from import_runs
order by id desc
limit 20;
