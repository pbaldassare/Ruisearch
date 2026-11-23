// Aggiornamento del registro dall'export ufficiale IVASS.
//
// L'IVASS pubblica l'intero registro come archivio zip rigenerato ogni notte.
// Qui lo si scarica, si valida e si ricarica. Non parte mai da solo: lo
// avvia l'admin dalla pagina Aggiornamento oppure `npm run import`.
//
// Il server IVASS e' lento (anche 40 KB/s) e taglia le connessioni lunghe:
// il download riprende da dove si e' fermato grazie alle richieste Range.
//
// Un import alla volta, chiunque lo lanci (API locale, terminale, GitHub
// Actions): lo garantisce un advisory lock di Postgres tenuto per tutta la
// durata. La riga di import_runs nasce subito ("in corso", con la fase) e si
// chiude sempre con l'esito: 'completato', 'identico', 'fallito' oppure
// 'incompleto' (registro caricato ma rete o statistiche non ricostruite).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { from as copyFrom } from 'pg-copy-streams';

import { TABELLE } from './tables.js';
import { leggiCsv, rigaPerCopy } from './parse.js';
import { withClientSenzaLimite } from './db.js';
import { ricostruisciRete } from './rete-materializzata.js';

export const URL_EXPORT =
  'https://ruipubblico.ivass.it/inquiry-public-manager/inquiry-public/esporta-registro';

const TENTATIVI_DOWNLOAD = 8;
// Se per un minuto non arriva nemmeno un byte, la connessione e' morta.
const SILENZIO_MASSIMO_MS = 60_000;

/** Fasi mostrate all'admin, in ordine. */
export const FASI = ['download', 'validazione', 'caricamento', 'rete', 'completato'];

// Chiave dell'advisory lock dell'import: un numero qualsiasi, uguale per tutti
// i processi che caricano il registro.
export const LOCK_IMPORT = 72_871_001;

// Un import "in corso" da piu' di cosi' non e' piu' vivo: il job di GitHub
// Actions viene ucciso a 40 minuti.
export const MINUTI_MASSIMI = 45;

// Avanzamento del download scritto in import_runs al massimo ogni 15 s.
const NOTA_OGNI_MS = 15_000;

function erroreOccupato(messaggio) {
  const e = new Error(messaggio);
  e.statusCode = 409;
  return e;
}

/** Prende il lock dell'import sulla connessione data, o spiega chi lo tiene. */
export async function prendiLock(client) {
  const { rows } = await client.query('select pg_try_advisory_lock($1) as ok', [LOCK_IMPORT]);
  if (rows[0]?.ok) return;
  let chi = '';
  try {
    const { rows: tiene } = await client.query(
      `select a.pid, a.backend_start, a.state
       from pg_locks l join pg_stat_activity a on a.pid = l.pid
       where l.locktype = 'advisory' and l.granted and l.classid = 0 and l.objid = $1::int::oid
       limit 1`,
      [LOCK_IMPORT],
    );
    if (tiene[0]) {
      const da = new Date(tiene[0].backend_start).toISOString().slice(0, 16).replace('T', ' ');
      chi = ` (connessione ${tiene[0].pid} aperta il ${da} UTC, stato ${tiene[0].state ?? 'sconosciuto'})`;
    }
  } catch {
    // Solo un dettaglio del messaggio.
  }
  throw erroreOccupato(
    `un altro aggiornamento del registro è già in corso${chi}: riprova quando ha finito.`,
  );
}

/**
 * Chiude come 'fallito' le righe rimaste "in corso". Da chiamare solo col lock
 * dell'import in mano: nessun altro sta caricando, quindi sono tutte orfane.
 */
export async function chiudiCorseOrfane(client, motivo) {
  const { rowCount } = await client.query(
    `update import_runs
     set esito = 'fallito', concluso_il = now(), errore = coalesce(errore, $1)
     where esito = 'in corso'`,
    [motivo],
  );
  return rowCount;
}

/** Chiude come 'fallito' le righe "in corso" piu' vecchie di 45 minuti: nessun import dura tanto. */
export async function chiudiCorseScadute(client, motivo) {
  const { rowCount } = await client.query(
    `update import_runs
     set esito = 'fallito', concluso_il = now(), errore = coalesce(errore, $1)
     where esito = 'in corso' and iniziato_il < now() - make_interval(mins => $2)`,
    [motivo, MINUTI_MASSIMI],
  );
  return rowCount;
}

/**
 * Per chi non sta caricando (passo finale del workflow): se nessuno tiene il
 * lock dell'import, ogni riga "in corso" e' orfana; altrimenti si toccano solo
 * quelle oltre i 45 minuti.
 */
export async function chiudiCorseInterrotte(client, motivo) {
  const { rows } = await client.query('select pg_try_advisory_lock($1) as ok', [LOCK_IMPORT]);
  if (!rows[0]?.ok) return { lockLibero: false, chiuse: await chiudiCorseScadute(client, motivo) };
  try {
    return { lockLibero: true, chiuse: await chiudiCorseOrfane(client, motivo) };
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_IMPORT]);
  }
}

async function scaricaUnaVolta(url, ricevuti, segnala) {
  const controllo = new AbortController();
  let timer = setTimeout(() => controllo.abort(), SILENZIO_MASSIMO_MS);
  const rinnova = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controllo.abort(), SILENZIO_MASSIMO_MS);
  };

  const giaPresi = ricevuti.reduce((n, b) => n + b.length, 0);
  const headers = giaPresi > 0 ? { range: `bytes=${giaPresi}-` } : {};
  try {
    const risposta = await fetch(url, { headers, signal: controllo.signal });
    if (!risposta.ok) {
      throw new Error(`il sito IVASS ha risposto ${risposta.status} ${risposta.statusText}`);
    }
    // Se il server ignora il Range ricomincia da capo: scartiamo il parziale.
    if (giaPresi > 0 && risposta.status !== 206) ricevuti.length = 0;

    const intervallo = risposta.headers.get('content-range');
    const lunghezza = Number(risposta.headers.get('content-length')) || 0;
    const totale = intervallo
      ? Number(intervallo.split('/')[1]) || 0
      : lunghezza;

    for await (const pezzo of risposta.body) {
      rinnova();
      ricevuti.push(Buffer.from(pezzo));
      segnala(ricevuti.reduce((n, b) => n + b.length, 0), totale);
    }
    return totale;
  } finally {
    clearTimeout(timer);
  }
}

/** Scarica l'export riprendendo dopo ogni interruzione. */
export async function scaricaArchivio({ segnala = () => {}, log = () => {} } = {}) {
  const ricevuti = [];
  let totale = 0;
  let ultimoErrore = null;

  for (let tentativo = 1; tentativo <= TENTATIVI_DOWNLOAD; tentativo++) {
    try {
      totale = await scaricaUnaVolta(URL_EXPORT, ricevuti, (preso, tot) => {
        if (tot) totale = tot;
        segnala(preso, tot);
      });
      const preso = ricevuti.reduce((n, b) => n + b.length, 0);
      if (!totale || preso >= totale) return Buffer.concat(ricevuti);
      ultimoErrore = new Error('connessione chiusa prima della fine');
    } catch (errore) {
      ultimoErrore = errore;
    }
    const preso = ricevuti.reduce((n, b) => n + b.length, 0);
    log(
      `download interrotto a ${(preso / 1024 / 1024).toFixed(1)} MB ` +
        `(${ultimoErrore?.name === 'AbortError' ? 'nessun dato da 60 s' : ultimoErrore?.message}), riprendo`,
    );
    await new Promise((ok) => setTimeout(ok, 2000 * tentativo));
  }
  throw new Error(
    `download dal sito IVASS non riuscito dopo ${TENTATIVI_DOWNLOAD} tentativi: ${ultimoErrore?.message}`,
  );
}

function estrai(zip) {
  const cartella = mkdtempSync(join(tmpdir(), 'rui-'));
  const percorso = join(cartella, 'registro.zip');
  writeFileSync(percorso, zip);
  try {
    execFileSync('unzip', ['-o', '-q', percorso, '-d', cartella]);
  } catch (errore) {
    rmSync(cartella, { recursive: true, force: true });
    throw new Error(`l'archivio scaricato non si apre (${errore.message})`);
  }
  return cartella;
}

function preparaTabella(cartella, spec) {
  let contenuto;
  try {
    contenuto = readFileSync(join(cartella, spec.file), 'utf8');
  } catch {
    throw new Error(`${spec.file} manca nell'archivio IVASS: il formato dell'export è cambiato.`);
  }
  const { righe, anomalie } = leggiCsv(contenuto, spec);

  if (anomalie.length > 0) {
    throw new Error(
      `${spec.file}: ${anomalie.length} righe malformate\n  ` + anomalie.slice(0, 5).join('\n  '),
    );
  }
  // Difesa contro un export troncato: meglio non caricare nulla che dimezzare
  // il registro perche' la fonte ha pubblicato un file incompleto.
  if (righe.length < spec.righeAttese) {
    throw new Error(
      `${spec.file}: solo ${righe.length} righe, ne attendevo almeno ${spec.righeAttese}. ` +
        'Export probabilmente incompleto, caricamento annullato.',
    );
  }
  return righe;
}

async function caricaTabella(client, spec, righe) {
  const colonne = spec.colonne.map(([nome]) => nome).join(', ');
  const flusso = client.query(
    copyFrom(`copy ${spec.tabella} (${colonne}) from stdin with (format csv, null '')`),
  );
  const sorgente = Readable.from(
    (function* () {
      for (const riga of righe) yield rigaPerCopy(riga);
    })(),
  );
  await pipeline(sorgente, flusso);
}

function sha256(zip) {
  return createHash('sha256').update(zip).digest('hex');
}

/** Estrae e controlla tutti i file; restituisce le righe pronte per COPY. */
function validaArchivio(zip, fase, log) {
  fase('validazione', 0, `archivio di ${(zip.length / 1024 / 1024).toFixed(1)} MB, controllo i file`);
  const cartella = estrai(zip);
  try {
    let totale = 0;
    const dati = TABELLE.map((spec, i) => {
      const righe = preparaTabella(cartella, spec);
      totale += righe.length;
      fase(
        'validazione',
        Math.round(((i + 1) / TABELLE.length) * 100),
        `${spec.file}: ${righe.length.toLocaleString('it-IT')} righe`,
      );
      return { spec, righe };
    });
    log(`validazione superata: ${totale.toLocaleString('it-IT')} record`);
    return { dati, totale };
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}

/**
 * Esegue l'intero aggiornamento.
 *
 * @param {object} opzioni
 * @param {Buffer} [opzioni.zip]       archivio gia' scaricato (salta il download)
 * @param {boolean} [opzioni.soloValidazione] scarica e controlla senza scrivere
 * @param {boolean} [opzioni.forza]    ricarica anche se l'archivio e' identico
 * @param {(stato: object) => void} [opzioni.avanzamento] fase, percentuale, messaggio
 * @param {(riga: string) => void} [opzioni.log]
 * @param {(id: number) => void} [opzioni.alAvvio] riceve l'id della riga di import_runs appena creata
 * @param {Function} [opzioni.scarica]        per i controlli senza rete (default scaricaArchivio)
 * @param {Function} [opzioni.conConnessione] per i controlli senza database (default withClientSenzaLimite)
 */
export async function eseguiImport({
  zip: zipDato,
  soloValidazione = false,
  forza = false,
  avanzamento = () => {},
  log = () => {},
  alAvvio = () => {},
  scarica = scaricaArchivio,
  conConnessione = withClientSenzaLimite,
} = {}) {
  const fase = (nome, percentuale, messaggio) => {
    avanzamento({ fase: nome, percentuale, messaggio });
    if (messaggio) log(messaggio);
  };

  async function scaricaConAvanzamento(nota) {
    fase('download', 0, 'scarico l\'export dal sito IVASS');
    let ultimaPercentuale = -1;
    return scarica({
      log,
      segnala: (preso, totale) => {
        const p = totale ? Math.floor((preso / totale) * 100) : null;
        if (p === ultimaPercentuale) return;
        ultimaPercentuale = p;
        const messaggio = totale
          ? `scaricati ${(preso / 1024 / 1024).toFixed(1)} di ${(totale / 1024 / 1024).toFixed(1)} MB`
          : `scaricati ${(preso / 1024 / 1024).toFixed(1)} MB`;
        avanzamento({ fase: 'download', percentuale: p, messaggio });
        nota?.('download', messaggio);
      },
    });
  }

  // Solo controllo: il database non si tocca (ne' lock ne' import_runs).
  if (soloValidazione) {
    const zip = zipDato ?? (await scaricaConAvanzamento());
    const { totale } = validaArchivio(zip, fase, log);
    fase('completato', 100, 'solo controllo: il database non e\' stato toccato');
    return { esito: 'validato', righe: totale, sha256: sha256(zip) };
  }

  return conConnessione(async (client) => {
    // Prima di tutto il lock: un secondo import si ferma subito, senza scaricare ne' scrivere righe.
    await prendiLock(client);
    try {
      const orfane = await chiudiCorseOrfane(client, 'interrotto: il processo che lo eseguiva si è fermato');
      if (orfane) log(`${orfane} aggiornamenti rimasti "in corso" segnati come interrotti`);
      return await importaColLock(client);
    } finally {
      // Se la connessione e' caduta il lock se ne va con lei: l'errore qui non conta.
      await client.query('select pg_advisory_unlock($1)', [LOCK_IMPORT]).catch(() => {});
    }
  });

  async function importaColLock(client) {
    const avvio = await client.query(
      'insert into import_runs (fase, messaggio) values ($1, $2) returning id',
      zipDato ? ['validazione', 'archivio gia\' scaricato'] : ['download', 'scarico l\'export dal sito IVASS'],
    );
    const idCorsa = Number(avvio.rows[0].id);
    alAvvio(idCorsa);

    // Fase e messaggio in import_runs: online la pagina Aggiornamento li legge da qui.
    let ultimaNota = 0;
    const nota = (nome, messaggio, subito = false) => {
      if (!subito && Date.now() - ultimaNota < NOTA_OGNI_MS) return Promise.resolve();
      ultimaNota = Date.now();
      return client
        .query('update import_runs set fase = $1, messaggio = $2 where id = $3', [nome, messaggio ?? null, idCorsa])
        .catch((errore) => log(`avanzamento non salvato: ${errore.message}`));
    };

    // Dopo il commit le tabelle sono gia' quelle nuove: un errore successivo non
    // rende "fallito" il caricamento, lo rende 'incompleto'.
    let caricato = false;
    let passo = 'il caricamento';
    try {
      const zip = zipDato ?? (await scaricaConAvanzamento(nota));
      const impronta = sha256(zip);
      await client.query('update import_runs set zip_sha256 = $1, zip_bytes = $2 where id = $3', [
        impronta,
        zip.length,
        idCorsa,
      ]);

      if (!forza) {
        const { rows } = await client.query(
          'select id from import_runs where zip_sha256 = $1 and esito = $2 and id <> $3 order by id desc limit 1',
          [impronta, 'completato', idCorsa],
        );
        if (rows.length > 0) {
          const messaggio = `i dati sono gia' aggiornati: export identico al caricamento #${rows[0].id}`;
          await client.query(
            `update import_runs set esito = 'identico', concluso_il = now(), fase = 'completato', messaggio = $1
             where id = $2`,
            [messaggio, idCorsa],
          );
          fase('completato', 100, messaggio);
          return { esito: 'identico', id: idCorsa, uguale_a: Number(rows[0].id), sha256: impronta };
        }
      }

      await nota('validazione', 'controllo i file', true);
      const { dati, totale } = validaArchivio(zip, fase, log);
      await client.query('update import_runs set righe_totali = $1 where id = $2', [totale, idCorsa]);

      await nota('caricamento', 'sostituisco le tabelle del registro', true);
      // Truncate e copy nella stessa transazione: se qualcosa fallisce il
      // registro resta quello precedente invece di restare a meta'. Intanto le
      // letture dell'API aspettano al massimo 3 s (lock_timeout) e rispondono
      // "Registro in aggiornamento".
      await client.query('begin');
      await client.query(`truncate ${TABELLE.map((t) => t.tabella).join(', ')} restart identity`);
      for (const [i, { spec, righe }] of dati.entries()) {
        fase(
          'caricamento',
          Math.round((i / dati.length) * 100),
          `carico ${spec.tabella} (${righe.length.toLocaleString('it-IT')} righe)`,
        );
        await caricaTabella(client, spec, righe);
      }
      await client.query('commit');
      caricato = true;
      fase('caricamento', 100, 'tabelle caricate');

      passo = 'la ricostruzione della rete A/B/E';
      await nota('rete', 'ricostruisco la rete A/B/E', true);
      fase('rete', 0, 'ricostruisco la rete A/B/E');
      const rete = await ricostruisciRete(client);
      fase(
        'rete',
        100,
        `rete A/B/E: ${Number(rete.archi).toLocaleString('it-IT')} collegamenti, ` +
          `${Number(rete.soggetti).toLocaleString('it-IT')} iscritti`,
      );

      // Statistiche aggiornate: senza, le ricerche restano lente dopo il carico.
      passo = "l'aggiornamento delle statistiche";
      for (const { spec } of dati) await client.query(`analyze ${spec.tabella}`);
      await client.query('analyze rete_collegati');
      await client.query('analyze rete_numeri');

      await client.query(
        `update import_runs set esito = 'completato', concluso_il = now(), fase = 'completato', messaggio = null
         where id = $1`,
        [idCorsa],
      );
      fase('completato', 100, `aggiornamento #${idCorsa} completato`);
      return { esito: 'completato', id: idCorsa, righe: totale, sha256: impronta };
    } catch (errore) {
      await client.query('rollback').catch(() => {});
      const esito = caricato ? 'incompleto' : 'fallito';
      const messaggio = caricato
        ? `registro caricato, ma ${passo} non è riuscita: ${errore.message}`
        : errore.message;
      await client
        .query('update import_runs set esito = $1, concluso_il = now(), errore = $2 where id = $3', [
          esito,
          String(messaggio).slice(0, 2000),
          idCorsa,
        ])
        .catch((e) => log(`esito non salvato in import_runs: ${e.message}`));
      if (caricato) {
        const finale = new Error(messaggio, { cause: errore });
        finale.esito = 'incompleto';
        throw finale;
      }
      throw errore;
    }
  }
}
