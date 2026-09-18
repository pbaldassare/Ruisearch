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

  const { soggetti } = await risolviSoggetto(client, testo);
  return {
    tipo: 'cerca',
    domanda: testo,
    ok: soggetti.length > 0,
    risultati: soggetti,
    nota: 'Non ho riconosciuto un pattern. Ho cercato il testo come nome o RUI.',
  };
}
