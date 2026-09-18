#!/usr/bin/env node
// Ricostruisce il Registro Unico degli Intermediari nel database.
//
// L'IVASS pubblica l'intero registro come archivio zip rigenerato ogni notte,
// quindi non serve alcuno scraping: si scarica, si valida e si ricarica.
//
//   node scripts/import.js              scarica e carica
//   node scripts/import.js --dry-run    scarica e valida, senza toccare il db
//   node scripts/import.js --zip FILE   usa un archivio gia' scaricato

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { from as copyFrom } from 'pg-copy-streams';

import { TABELLE } from '../src/tables.js';
import { leggiCsv, rigaPerCopy } from '../src/parse.js';
import { withClient, closePool } from '../src/db.js';
import { ricostruisciRete } from '../src/rete-materializzata.js';

const URL_EXPORT =
  'https://ruipubblico.ivass.it/inquiry-public-manager/inquiry-public/esporta-registro';

const argomenti = process.argv.slice(2);
const soloValidazione = argomenti.includes('--dry-run');
const zipIndicato = argomenti.includes('--zip')
  ? argomenti[argomenti.indexOf('--zip') + 1]
  : null;

function log(messaggio) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${messaggio}`);
}

async function scaricaArchivio() {
  log('scarico l\'export dal registro IVASS');
  const risposta = await fetch(URL_EXPORT, { signal: AbortSignal.timeout(300_000) });
  if (!risposta.ok) {
    throw new Error(`l'export ha risposto ${risposta.status} ${risposta.statusText}`);
  }
  return Buffer.from(await risposta.arrayBuffer());
}

function estrai(zip) {
  const cartella = mkdtempSync(join(tmpdir(), 'rui-'));
  const percorso = join(cartella, 'registro.zip');
  writeFileSync(percorso, zip);
  try {
    execFileSync('unzip', ['-o', '-q', percorso, '-d', cartella]);
  } catch (errore) {
    throw new Error(`estrazione fallita, serve il comando unzip: ${errore.message}`);
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
  log(`${spec.file.padEnd(35)} ${String(righe.length).padStart(7)} righe`);
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

async function main() {
  const zip = zipIndicato ? readFileSync(zipIndicato) : await scaricaArchivio();
  const impronta = createHash('sha256').update(zip).digest('hex');
  log(`archivio di ${(zip.length / 1024 / 1024).toFixed(1)} MB, sha256 ${impronta.slice(0, 16)}`);

  const cartella = estrai(zip);
  let totale = 0;
  try {
    const dati = TABELLE.map((spec) => {
      const righe = preparaTabella(cartella, spec);
      totale += righe.length;
      return { spec, righe };
    });
    log(`validazione superata: ${totale.toLocaleString('it-IT')} record`);

    if (soloValidazione) {
      log('--dry-run: il database non e\' stato toccato');
      return;
    }

    await withClient(async (client) => {
      const { rows } = await client.query(
        'select id from import_runs where zip_sha256 = $1 and esito = $2 limit 1',
        [impronta, 'completato'],
      );
      if (rows.length > 0) {
        log(`archivio identico al caricamento ${rows[0].id}, niente da fare`);
        return;
      }

      const avvio = await client.query(
        'insert into import_runs (zip_sha256, zip_bytes, righe_totali) values ($1, $2, $3) returning id',
        [impronta, zip.length, totale],
      );
      const idCorsa = avvio.rows[0].id;

      try {
        // Truncate e copy nella stessa transazione: se qualcosa fallisce il
        // registro resta quello precedente invece di restare a meta'.
        await client.query('begin');
        await client.query(
          `truncate ${TABELLE.map((t) => t.tabella).join(', ')} restart identity`,
        );
        for (const { spec, righe } of dati) {
          const inizio = Date.now();
          await caricaTabella(client, spec, righe);
          log(`${spec.tabella.padEnd(30)} caricata in ${Date.now() - inizio} ms`);
        }
        await client.query('commit');
      } catch (errore) {
        await client.query('rollback');
        await client.query(
          'update import_runs set esito = $1, concluso_il = now(), errore = $2 where id = $3',
          ['fallito', String(errore.message).slice(0, 2000), idCorsa],
        );
        throw errore;
      }

      const rete = await ricostruisciRete(client);
      log(
        `rete A/B/E salvata: ${Number(rete.archi).toLocaleString('it-IT')} archi, ` +
          `${Number(rete.soggetti).toLocaleString('it-IT')} iscritti`,
      );

      await client.query(
        'update import_runs set esito = $1, concluso_il = now() where id = $2',
        ['completato', idCorsa],
      );
      log(`caricamento ${idCorsa} completato`);
    });
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}

main()
  .catch((errore) => {
    console.error(`\nCaricamento fallito: ${errore.message}`);
    process.exitCode = 1;
  })
  .finally(closePool);
