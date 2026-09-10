#!/usr/bin/env node
// Estrae il sotto-grafo di un intermediario dall'export ufficiale IVASS.
//
//   node scripts/lookup-intermediario.js --rui E000188700
//   node scripts/lookup-intermediario.js --nome "BALDASSARE PAOLO"
//   node scripts/lookup-intermediario.js --zip FILE --rui E000188700

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TABELLE } from '../src/tables.js';
import { leggiCsv } from '../src/parse.js';
import { cercaIntermediari, sottoGrafo } from '../src/lookup.js';

const URL_EXPORT =
  'https://ruipubblico.ivass.it/inquiry-public-manager/inquiry-public/esporta-registro';

const argomenti = process.argv.slice(2);
function flag(nome) {
  const i = argomenti.indexOf(nome);
  return i >= 0 ? argomenti[i + 1] : null;
}

const rui = flag('--rui');
const nome = flag('--nome');
const zipIndicato = flag('--zip');

if (!rui && !nome) {
  console.error('indica --rui NUMERO oppure --nome "COGNOME NOME"');
  process.exitCode = 1;
} else {
  main().catch((errore) => {
    console.error(errore.message);
    process.exitCode = 1;
  });
}

async function scarica() {
  const risposta = await fetch(URL_EXPORT, { signal: AbortSignal.timeout(300_000) });
  if (!risposta.ok) {
    throw new Error(`l'export ha risposto ${risposta.status} ${risposta.statusText}`);
  }
  return Buffer.from(await risposta.arrayBuffer());
}

function estrai(zip) {
  const cartella = mkdtempSync(join(tmpdir(), 'rui-lookup-'));
  writeFileSync(join(cartella, 'registro.zip'), zip);
  execFileSync('unzip', ['-o', '-q', join(cartella, 'registro.zip'), '-d', cartella]);
  return cartella;
}

function caricaTabelle(cartella) {
  const tabelle = {};
  for (const spec of TABELLE) {
    const contenuto = readFileSync(join(cartella, spec.file), 'utf8');
    const { righe, anomalie } = leggiCsv(contenuto, spec);
    if (anomalie.length > 0) {
      console.error(`${spec.file}: ignoro ${anomalie.length} righe malformate`);
    }
    tabelle[spec.tabella] = righe;
  }
  return tabelle;
}

async function main() {
  const zip = zipIndicato ? readFileSync(zipIndicato) : await scarica();
  const cartella = estrai(zip);
  try {
    const tabelle = caricaTabelle(cartella);
    const intermediari = tabelle.intermediari.map((riga) => {
      const out = {};
      specIntermediari().forEach(([nomeColonna], i) => {
        out[nomeColonna] = riga[i];
      });
      return out;
    });
    const candidati = cercaIntermediari(intermediari, { rui, nome });
    if (candidati.length === 0) {
      throw new Error('nessun intermediario trovato');
    }
    const risultati = candidati.map((c) => sottoGrafo(tabelle, c.numero_iscrizione_rui));
    process.stdout.write(JSON.stringify(risultati, null, 2) + '\n');
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}

function specIntermediari() {
  return TABELLE.find((t) => t.tabella === 'intermediari').colonne;
}
