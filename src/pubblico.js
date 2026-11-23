// Letture pubbliche, senza login: la ricerca della landing e i numeri della
// prima pagina. Il registro e' un dato pubblico, ma qui esce il minimo:
// numero RUI, nome, sezione e se e' operativo. La scheda resta riservata.

import { normalizzaRui, overview, sembraRui } from './query.js';

const MASSIMO_RISULTATI = 8;
const LUNGHEZZA_MINIMA = 3;
// I conteggi della prima pagina (4 count(*) sul registro) cambiano solo con un
// import: si ricalcolano al massimo ogni 5 minuti per istanza.
const DURATA_CACHE_MS = 5 * 60_000;

function erroreRichiesta(messaggio) {
  const e = new Error(messaggio);
  e.statusCode = 400;
  return e;
}

/** % e _ scritti dall'utente non devono fare da jolly in ILIKE (escape predefinito: la barra rovesciata). */
export function escapeLike(testo) {
  return String(testo ?? '').replace(/[\\%_]/g, '\\$&');
}

/**
 * Ricerca per nome o numero RUI, solo sezioni A, B, E: al massimo 8 risultati
 * con numero, denominazione, sezione e stato.
 */
export async function cercaPubblica(client, q) {
  const testo = String(q ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (testo.length < LUNGHEZZA_MINIMA) {
    throw erroreRichiesta(`scrivi almeno ${LUNGHEZZA_MINIMA} caratteri.`);
  }
  const colonne = `
    i.numero_iscrizione_rui, i.denominazione, i.sezione,
    (coalesce(i.inoperativo, false) or coalesce(i.data_inizio_inoperativita <= current_date, false)) as inoperativo`;
  const { rows } = sembraRui(testo)
    ? await client.query(
        `select ${colonne}
         from intermediari i
         where i.numero_iscrizione_rui = $1 and i.sezione in ('A', 'B', 'E')
         order by i.inoperativo, i.oss
         limit $2`,
        [normalizzaRui(testo), MASSIMO_RISULTATI],
      )
    : await client.query(
        `select ${colonne}
         from intermediari i
         where i.sezione in ('A', 'B', 'E')
           and i.denominazione ilike '%' || $1 || '%'
         order by (i.denominazione ilike $1 || '%') desc, i.denominazione, i.oss
         limit $2`,
        [escapeLike(testo), MASSIMO_RISULTATI],
      );
  return {
    items: rows.map((r) => ({
      numero_iscrizione_rui: r.numero_iscrizione_rui,
      denominazione: r.denominazione,
      sezione: r.sezione,
      inoperativo: r.inoperativo === true,
    })),
  };
}

const cache = new Map();

/** Solo per i controlli: svuota la cache dei conteggi. */
export function svuotaCachePubblica() {
  cache.clear();
}

/**
 * /overview con i conteggi in cache per 5 minuti. Ultimo tentativo di
 * aggiornamento e dati in uso si leggono sempre freschi (import_runs e' minuscola).
 *
 * dati_in_uso: l'ultimo caricamento che ha davvero sostituito il registro
 * ('completato', oppure 'incompleto' se dopo il caricamento e' fallita solo
 * la rete o le statistiche). ultimo_import puo' essere un tentativo fallito.
 */
export async function overviewPubblica(client, { sezione } = {}) {
  const chiave = String(sezione ?? '').trim().toUpperCase();
  // Sezione non ammessa: nessuna cache, overview risponde 400.
  if (!['', 'A', 'B', 'E'].includes(chiave)) return overview(client, { sezione });

  let voce = cache.get(chiave);
  if (!voce || voce.scade < Date.now()) {
    voce = { scade: Date.now() + DURATA_CACHE_MS, numeri: overview(client, { sezione: chiave || undefined }) };
    cache.set(chiave, voce);
    const questa = voce;
    // Un errore non resta in cache: la richiesta dopo riprova.
    voce.numeri.catch(() => {
      if (cache.get(chiave) === questa) cache.delete(chiave);
    });
  }
  const [numeri, aggiornamenti] = await Promise.all([voce.numeri, statoAggiornamenti(client)]);
  return { ...numeri, ...aggiornamenti };
}

const COLONNE_RUN = 'id, iniziato_il, concluso_il, esito, zip_sha256, zip_bytes, righe_totali, errore';

async function statoAggiornamenti(client) {
  const [ultimo, inUso] = await Promise.all([
    client.query(`select ${COLONNE_RUN} from import_runs order by id desc limit 1`),
    client.query(
      `select ${COLONNE_RUN} from import_runs
       where esito in ('completato', 'incompleto')
       order by id desc limit 1`,
    ),
  ]);
  return { ultimo_import: ultimo.rows[0] ?? null, dati_in_uso: inUso.rows[0] ?? null };
}
