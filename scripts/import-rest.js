#!/usr/bin/env node
// Carica l'export IVASS su Supabase via Data API (service role).
// Serve quando non c'e' la password Postgres ma si ha la service role key.
//
//   node scripts/import-rest.js
//   node scripts/import-rest.js --zip FILE

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TABELLE } from '../src/tables.js';
import { leggiCsv } from '../src/parse.js';
import { restConfig } from '../src/config.js';
import { restFetch, restInsertaLotti, rigaComeOggetto } from '../src/rest.js';

const URL_EXPORT =
  'https://ruipubblico.ivass.it/inquiry-public-manager/inquiry-public/esporta-registro';

const zipIndicato = process.argv.includes('--zip')
  ? process.argv[process.argv.indexOf('--zip') + 1]
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
  const cartella = mkdtempSync(join(tmpdir(), 'rui-rest-'));
  writeFileSync(join(cartella, 'registro.zip'), zip);
  execFileSync('unzip', ['-o', '-q', join(cartella, 'registro.zip'), '-d', cartella]);
  return cartella;
}

async function main() {
  const { url } = restConfig();
  log(`Data API ${url}`);

  const zip = zipIndicato ? readFileSync(zipIndicato) : await scaricaArchivio();
  const impronta = createHash('sha256').update(zip).digest('hex');
  log(`archivio di ${(zip.length / 1024 / 1024).toFixed(1)} MB, sha256 ${impronta.slice(0, 16)}`);

  const gia = await restFetch(
    `import_runs?zip_sha256=eq.${impronta}&esito=eq.completato&select=id&limit=1`,
  );
  if (Array.isArray(gia) && gia.length > 0) {
    log(`archivio identico al caricamento ${gia[0].id}, niente da fare`);
    return;
  }

  const cartella = estrai(zip);
  try {
    const dati = TABELLE.map((spec) => {
      const contenuto = readFileSync(join(cartella, spec.file), 'utf8');
      const { righe, anomalie } = leggiCsv(contenuto, spec);
      if (anomalie.length > 0) {
        log(`${spec.file}: ignoro ${anomalie.length} righe malformate`);
      }
      if (righe.length < spec.righeAttese) {
        throw new Error(
          `${spec.file}: solo ${righe.length} righe, ne attendevo almeno ${spec.righeAttese}`,
        );
      }
      log(`${spec.file.padEnd(35)} ${String(righe.length).padStart(7)} righe`);
      return { spec, oggetti: righe.map((r) => rigaComeOggetto(spec, r)) };
    });
    const totale = dati.reduce((n, d) => n + d.oggetti.length, 0);

    const avvio = await restFetch('import_runs', {
      method: 'POST',
      body: {
        zip_sha256: impronta,
        zip_bytes: zip.length,
        righe_totali: totale,
        esito: 'in corso',
      },
      prefer: 'return=representation',
    });
    const idCorsa = Array.isArray(avvio) ? avvio[0]?.id : avvio?.id;

    try {
      for (const { spec, oggetti } of dati) {
        const inizio = Date.now();
        await restInsertaLotti(spec.tabella, oggetti, {
          lotto: spec.tabella === 'collaboratori' || spec.tabella === 'intermediari' ? 300 : 500,
        });
        log(`${spec.tabella.padEnd(30)} ${oggetti.length} righe in ${Date.now() - inizio} ms`);
      }
    } catch (errore) {
      if (idCorsa) {
        await restFetch(`import_runs?id=eq.${idCorsa}`, {
          method: 'PATCH',
          body: { esito: 'fallito', concluso_il: new Date().toISOString(), errore: String(errore.message).slice(0, 2000) },
        }).catch(() => {});
      }
      throw errore;
    }

    if (idCorsa) {
      await restFetch(`import_runs?id=eq.${idCorsa}`, {
        method: 'PATCH',
        body: { esito: 'completato', concluso_il: new Date().toISOString() },
      });
    }
    log(`caricamento ${idCorsa ?? ''} completato, ${totale.toLocaleString('it-IT')} record`);
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}

main().catch((errore) => {
  console.error(`\nCaricamento REST fallito: ${errore.message}`);
  process.exitCode = 1;
});
