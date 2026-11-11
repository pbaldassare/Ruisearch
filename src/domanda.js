// Interpreta domande in italiano sulle dimensioni del registro.
// Niente modello AI: pattern + SQL. Ambiguo → lista candidati.

import { cercaIntermediari, mandatiViaPrincipali, numeriDi, rete, sembraRui } from './query.js';

function pulisci(testo) {
  return String(testo || '')
    .trim()
    .replace(/^dimmi\s+(se\s+)?/i, '')
    .replace(/^dimmelo\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function risolviSoggetto(client, grezzo) {
  const q = String(grezzo || '').trim();
  if (!q) return { soggetti: [], query: q };
  const { items } = await cercaIntermediari(client, { q, limite: 8 });
  return { soggetti: items, query: q };
}

export { mandatiViaPrincipali, numeriDi };

export async function lavoraConCompagnia(client, rui, compagnia, { soloAgenti = false } = {}) {
  const reteSoggetto = await rete(client, rui);
  const like = `%${compagnia}%`;
  const principali = reteSoggetto.principali.filter((p) => !soloAgenti || p.sezione === 'A');
  const ruiList = [
    rui,
    ...principali.map((p) => p.rui_collegato),
  ];
  const { rows } = await client.query(
    `
    select distinct on (m.matricola, m.ragione_sociale)
      m.matricola as rui,
      i.denominazione,
      i.sezione,
      m.codice_compagnia,
      m.ragione_sociale
    from mandati m
    join intermediari i on i.numero_iscrizione_rui = m.matricola
    where m.matricola = any($1::text[])
      and (m.ragione_sociale ilike $2 or m.codice_compagnia ilike $2)
    order by m.matricola, m.ragione_sociale
    `,
    [ruiList, like],
  );
  const propri = rows.filter((r) => r.rui === rui);
  const tramite = rows.filter((r) => r.rui !== rui);
  return {
    si: rows.length > 0,
    compagnia,
    solo_agenti: soloAgenti,
    mandati_propri: propri,
    tramite_principali: tramite,
  };
}

const ETICHETTA_SEZIONE = { A: 'agenti', B: 'broker', E: 'collaboratori' };

/**
 * Riconosce i filtri di una domanda tipo
 * "agenti con mandato axa in provincia di BS" o "broker inoperativi a Milano".
 * Restituisce null se la frase non contiene nessun filtro.
 */
export function leggiFiltri(testo) {
  const t = ` ${String(testo || '').toLowerCase()} `;
  const filtri = {};

  const sezioni = new Set();
  if (/\bagent[ie]\b|\bsezione a\b/.test(t)) sezioni.add('A');
  if (/\bbroker\b|\bmediator[ei]\b|\bsezione b\b/.test(t)) sezioni.add('B');
  if (/\bcollaborator[ie]\b|\bsezione e\b/.test(t)) sezioni.add('E');
  if (sezioni.size) filtri.sezioni = [...sezioni];

  const prov = t.match(/\bprovincia\s+(?:di\s+)?([a-z]{2})\b/);
  if (prov) filtri.provincia = prov[1].toUpperCase();

  // "sezione a" non e' la preposizione "a": la tolgo prima di cercare il comune.
  const senzaSezione = t.replace(/\bsezione\s+[abe]\b/g, ' ');
  const comune = senzaSezione.match(
    /\b(?:comune\s+di|a)\s+([a-zà-ù' ]{3,}?)(?=\s+(?:con|operativ|inoperativ|in\s+provincia)\b|\s*$)/,
  );
  if (comune && !/\b(provincia|mandat)/.test(comune[1])) filtri.comune = comune[1].trim();

  if (/\binoperativ[ioe]\b/.test(t)) filtri.inoperativo = true;
  else if (/\boperativ[ioe]\b/.test(t)) filtri.inoperativo = false;

  if (/\baziend[ae]\b|\bsociet[aà]\b|\bpersone giuridiche\b/.test(t)) filtri.personaGiuridica = true;
  else if (/\bpersone( fisiche)?\b/.test(t)) filtri.personaGiuridica = false;

  const comp = t.match(
    /\bcon\s+(?:il\s+|un\s+)?(?:mandat[oi]\s+)?(?:con\s+|di\s+|per\s+)?([a-z0-9][a-z0-9 .&'-]*?)(?=\s+(?:in|nella|a|nel|del|della|operativ[ioe]|inoperativ[ioe])\b|\s*$)/,
  );
  if (comp && comp[1].trim().length >= 2) filtri.compagnia = comp[1].trim();

  return Object.keys(filtri).length ? filtri : null;
}

function descriviFiltri(f) {
  const parti = [];
  parti.push(f.sezioni ? f.sezioni.map((s) => ETICHETTA_SEZIONE[s]).join(' e ') : 'intermediari A/B/E');
  if (f.personaGiuridica === true) parti.push('solo aziende');
  if (f.personaGiuridica === false) parti.push('solo persone');
  if (f.inoperativo === true) parti.push('inoperativi');
  if (f.inoperativo === false) parti.push('operativi');
  if (f.compagnia) parti.push(`con mandato ${f.compagnia.toUpperCase()}`);
  if (f.comune) parti.push(`sede a ${f.comune.toUpperCase()}`);
  if (f.provincia) parti.push(`provincia di ${f.provincia}`);
  return parti.join(' · ');
}

export async function elencoFiltrato(client, filtri, { limite = 50 } = {}) {
  const params = [filtri.sezioni ?? ['A', 'B', 'E']];
  const where = [];
  if (filtri.inoperativo != null) {
    params.push(filtri.inoperativo);
    where.push(`coalesce(i.inoperativo, false) = $${params.length}`);
  }
  if (filtri.personaGiuridica != null) {
    params.push(filtri.personaGiuridica);
    where.push(`i.persona_giuridica = $${params.length}`);
  }
  if (filtri.provincia) {
    params.push(filtri.provincia);
    where.push(`exists (select 1 from sedi s
      where s.numero_iscrizione_int = i.numero_iscrizione_rui and s.provincia_sede = $${params.length})`);
  }
  if (filtri.comune) {
    params.push(filtri.comune);
    where.push(`exists (select 1 from sedi s
      where s.numero_iscrizione_int = i.numero_iscrizione_rui and s.comune_sede ilike $${params.length})`);
  }
  if (filtri.compagnia) {
    params.push(`%${filtri.compagnia}%`);
    where.push(`exists (select 1 from mandati m
      where m.matricola = i.numero_iscrizione_rui
        and (m.ragione_sociale ilike $${params.length} or m.codice_compagnia ilike $${params.length}))`);
  }
  params.push(limite);
  const { rows } = await client.query(
    `
    with i as (
      select distinct on (numero_iscrizione_rui)
        numero_iscrizione_rui, denominazione, sezione, inoperativo, persona_giuridica
      from intermediari
      where sezione = any($1::text[])
      order by numero_iscrizione_rui, inoperativo, oss
    )
    select i.numero_iscrizione_rui, i.denominazione, i.sezione, i.inoperativo,
           count(*) over () as totale
    from i
    ${where.length ? `where ${where.join('\n      and ')}` : ''}
    order by i.denominazione, i.numero_iscrizione_rui
    limit $${params.length}
    `,
    params,
  );
  return { totale: Number(rows[0]?.totale ?? 0), items: rows.map(({ totale, ...r }) => r) };
}

function unaRisposta(soggetti, verbo) {
  if (soggetti.length === 0) {
    return { ok: false, errore: `nessun intermediario A/B/E per «${verbo}»` };
  }
  return {
    ok: true,
    scelto: soggetti[0],
    candidati: soggetti.length > 1 ? soggetti : [],
  };
}

export async function interpretaDomanda(client, testoGrezzo) {
  const testo = pulisci(testoGrezzo);
  if (!testo) {
    const err = new Error('scrivi una domanda');
    err.statusCode = 400;
    throw err;
  }

  let m = testo.match(/^quanti\s+(intermediari|collaborator[ie]|mandati|collaborazioni|sedi)\s+ha\s+(.+)$/i);
  if (m) {
    const metrica = m[1].toLowerCase();
    const { soggetti, query } = await risolviSoggetto(client, m[2]);
    const scelta = unaRisposta(soggetti, query);
    if (!scelta.ok) return { tipo: 'conteggio', domanda: testo, ...scelta };
    const numeri = await numeriDi(client, scelta.scelto.numero_iscrizione_rui);
    const chiave = metrica.startsWith('collaborator') && metrica !== 'collaborazioni'
      ? 'intermediari'
      : metrica === 'intermediari'
        ? 'intermediari'
        : metrica;
    return {
      tipo: 'conteggio',
      domanda: testo,
      ok: true,
      scelto: scelta.scelto,
      candidati: scelta.candidati,
      metrica: chiave,
      valore: numeri[chiave],
      numeri,
    };
  }

  m = testo.match(/^(.+?)\s+lavora\s+con\s+(?:gli\s+)?agenti\s+con\s+(.+)$/i);
  if (m) {
    const { soggetti, query } = await risolviSoggetto(client, m[1]);
    const scelta = unaRisposta(soggetti, query);
    if (!scelta.ok) return { tipo: 'compagnia_agenti', domanda: testo, ...scelta };
    const dettaglio = await lavoraConCompagnia(client, scelta.scelto.numero_iscrizione_rui, m[2].trim(), {
      soloAgenti: true,
    });
    return {
      tipo: 'compagnia_agenti',
      domanda: testo,
      ok: true,
      scelto: scelta.scelto,
      candidati: scelta.candidati,
      ...dettaglio,
      risposta: dettaglio.si
        ? `Sì: ${scelta.scelto.denominazione} collabora con agenti che hanno mandato ${m[2].trim()}.`
        : `No: nessun agente principale di ${scelta.scelto.denominazione} ha un mandato ${m[2].trim()}.`,
    };
  }

  m = testo.match(/^(.+?)\s+lavora\s+con\s+(.+)$/i);
  if (m && !/^quanti\b/i.test(m[1])) {
    const { soggetti, query } = await risolviSoggetto(client, m[1]);
    const scelta = unaRisposta(soggetti, query);
    if (!scelta.ok) return { tipo: 'compagnia', domanda: testo, ...scelta };
    const dettaglio = await lavoraConCompagnia(client, scelta.scelto.numero_iscrizione_rui, m[2].trim());
    return {
      tipo: 'compagnia',
      domanda: testo,
      ok: true,
      scelto: scelta.scelto,
      candidati: scelta.candidati,
      ...dettaglio,
      risposta: dettaglio.si
        ? `Sì: risulta un mandato ${m[2].trim()} in proprio o tramite un principale.`
        : `No: nessun mandato ${m[2].trim()} in proprio né sui principali A/B/E.`,
    };
  }

  m = testo.match(/^(?:cerca|scheda)\s+(.+)$/i);
  if (m || sembraRui(testo)) {
    const q = m ? m[1] : testo;
    const { soggetti } = await risolviSoggetto(client, q);
    return {
      tipo: 'cerca',
      domanda: testo,
      ok: soggetti.length > 0,
      risultati: soggetti,
    };
  }

  const filtri = leggiFiltri(testo);
  if (filtri) {
    const { totale, items } = await elencoFiltrato(client, filtri);
    const descrizione = descriviFiltri(filtri);
    return {
      tipo: 'elenco',
      domanda: testo,
      ok: totale > 0,
      filtri,
      totale,
      risposta: totale > 0
        ? `${totale.toLocaleString('it-IT')} iscritti trovati: ${descrizione}.`
        : `Nessun iscritto trovato: ${descrizione}.`,
      nota: totale > items.length ? `Mostro i primi ${items.length} in ordine alfabetico.` : undefined,
      risultati: items,
    };
  }

  const { soggetti } = await risolviSoggetto(client, testo);
  return {
    tipo: 'cerca',
    domanda: testo,
    ok: soggetti.length > 0,
    risultati: soggetti,
    nota: soggetti.length
      ? 'Non ho riconosciuto una domanda, quindi ho cercato il testo come nome o numero RUI.'
      : 'Non ho riconosciuto una domanda e nessun nome corrisponde. Prova uno degli esempi.',
  };
}
