// Aggiornamento del registro dall'export ufficiale IVASS.
//
// L'IVASS pubblica l'intero registro come archivio zip rigenerato ogni notte.
// Qui lo si scarica, si valida e si ricarica. Non parte mai da solo: lo
// avvia l'admin dalla pagina Aggiornamento oppure `npm run import`.
//
// Il server IVASS e' lento (anche 40 KB/s) e taglia le connessioni lunghe:
// il download riprende da dove si e' fermato grazie alle richieste Range.

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
import { withClient } from './db.js';
import { ricostruisciRete } from './rete-materializzata.js';

export const URL_EXPORT =
  'https://ruipubblico.ivass.it/inquiry-public-manager/inquiry-public/esporta-registro';

const TENTATIVI_DOWNLOAD = 8;
// Se per un minuto non arriva nemmeno un byte, la connessione e' morta.
const SILENZIO_MASSIMO_MS = 60_000;

/** Fasi mostrate all'admin, in ordine. */
export const FASI = ['download', 'validazione', 'caricamento', 'rete', 'completato'];

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
  const contenuto = readFileSync(join(cartella, spec.file), 'utf8');
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

/**
 * Esegue l'intero aggiornamento.
 *
 * @param {object} opzioni
 * @param {Buffer} [opzioni.zip]       archivio gia' scaricato (salta il download)
 * @param {boolean} [opzioni.soloValidazione] scarica e controlla senza scrivere
 * @param {boolean} [opzioni.forza]    ricarica anche se l'archivio e' identico
 * @param {(stato: object) => void} [opzioni.avanzamento] fase, percentuale, messaggio
 * @param {(riga: string) => void} [opzioni.log]
 */
export async function eseguiImport({
  zip: zipDato,
  soloValidazione = false,
  forza = false,
  avanzamento = () => {},
  log = () => {},
} = {}) {
  const fase = (nome, percentuale, messaggio) => {
    avanzamento({ fase: nome, percentuale, messaggio });
    if (messaggio) log(messaggio);
  };

  let zip = zipDato;
  if (!zip) {
    fase('download', 0, 'scarico l\'export dal sito IVASS');
    let ultimaPercentuale = -1;
    zip = await scaricaArchivio({
      log,
      segnala: (preso, totale) => {
        const p = totale ? Math.floor((preso / totale) * 100) : null;
        if (p !== ultimaPercentuale) {
          ultimaPercentuale = p;
          avanzamento({
            fase: 'download',
            percentuale: p,
            messaggio: totale
              ? `scaricati ${(preso / 1024 / 1024).toFixed(1)} di ${(totale / 1024 / 1024).toFixed(1)} MB`
              : `scaricati ${(preso / 1024 / 1024).toFixed(1)} MB`,
          });
        }
      },
    });
  }

  const impronta = createHash('sha256').update(zip).digest('hex');
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

    if (soloValidazione) {
      fase('completato', 100, 'solo controllo: il database non e\' stato toccato');
      return { esito: 'validato', righe: totale, sha256: impronta };
    }

    return await withClient(async (client) => {
      if (!forza) {
        const { rows } = await client.query(
          'select id from import_runs where zip_sha256 = $1 and esito = $2 limit 1',
          [impronta, 'completato'],
        );
        if (rows.length > 0) {
          fase('completato', 100, `i dati sono gia' aggiornati: export identico al caricamento #${rows[0].id}`);
          return { esito: 'identico', id: Number(rows[0].id), righe: totale, sha256: impronta };
        }
      }

      const avvio = await client.query(
        'insert into import_runs (zip_sha256, zip_bytes, righe_totali) values ($1, $2, $3) returning id',
        [impronta, zip.length, totale],
      );
      const idCorsa = Number(avvio.rows[0].id);

      try {
        // Truncate e copy nella stessa transazione: se qualcosa fallisce il
        // registro resta quello precedente invece di restare a meta'.
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
        fase('caricamento', 100, 'tabelle caricate');

        fase('rete', 0, 'ricostruisco la rete A/B/E');
        const rete = await ricostruisciRete(client);
        fase(
          'rete',
          100,
          `rete A/B/E: ${Number(rete.archi).toLocaleString('it-IT')} collegamenti, ` +
            `${Number(rete.soggetti).toLocaleString('it-IT')} iscritti`,
        );

        // Statistiche aggiornate: senza, le ricerche restano lente dopo il carico.
        for (const { spec } of dati) await client.query(`analyze ${spec.tabella}`);
        await client.query('analyze rete_collegati');
        await client.query('analyze rete_numeri');

        await client.query(
          'update import_runs set esito = $1, concluso_il = now() where id = $2',
          ['completato', idCorsa],
        );
      } catch (errore) {
        await client.query('rollback').catch(() => {});
        await client.query(
          'update import_runs set esito = $1, concluso_il = now(), errore = $2 where id = $3',
          ['fallito', String(errore.message).slice(0, 2000), idCorsa],
        );
        throw errore;
      }

      fase('completato', 100, `aggiornamento #${idCorsa} completato`);
      return { esito: 'completato', id: idCorsa, righe: totale, sha256: impronta };
    });
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}
