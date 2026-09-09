#!/usr/bin/env node
// Lettura del registro su Supabase. Solo A, B, E. Nessun import.
//
//   npm run cerca -- overview
//   npm run cerca -- cerca --q "baldassare"
//   npm run cerca -- scheda --rui E000188700
//   npm run cerca -- rete --rui E000188700
//   npm run cerca -- sedi --provincia BS
//   npm run cerca -- mandati --q "generali"
//   npm run cerca -- cariche --q "zirano"
//   npm run cerca -- import
//
// Scorciatoie: --rui / --nome senza comando fanno scheda o cerca.

import { closePool, withClient } from '../src/db.js';
import {
  cercaIntermediari,
  elencoCariche,
  elencoMandati,
  elencoSedi,
  overview,
  rete,
  scheda,
  sembraRui,
  storicoImport,
} from '../src/query.js';

const argomenti = process.argv.slice(2);

function flag(nome) {
  const i = argomenti.indexOf(nome);
  return i >= 0 ? argomenti[i + 1] : null;
}

function haFlag(nome) {
  return argomenti.includes(nome);
}

const COMANDI = new Set([
  'overview', 'cerca', 'scheda', 'rete', 'sedi', 'mandati', 'cariche', 'import',
]);

function comando() {
  const positional = [];
  for (let i = 0; i < argomenti.length; i += 1) {
    const a = argomenti[i];
    if (a === '--help' || a === '-h') continue;
    if (a.startsWith('--')) {
      i += 1;
      continue;
    }
    positional.push(a);
  }
  if (COMANDI.has(positional[0])) return positional[0];
  if (flag('--rui')) return 'scheda';
  if (flag('--nome') || flag('--q')) return 'cerca';
  return null;
}

function aiuto() {
  console.error(`Uso:
  npm run cerca -- overview
  npm run cerca -- cerca --q "baldassare" [--sezione A|B|E]
  npm run cerca -- scheda --rui E000188700
  npm run cerca -- rete --rui E000188700
  npm run cerca -- sedi [--q TEXT] [--provincia BS]
  npm run cerca -- mandati [--q TEXT]
  npm run cerca -- cariche [--q TEXT]
  npm run cerca -- import

Solo sezioni A, B, E. Nessun aggiornamento da qui.`);
}

const azione = comando();
if (!azione || haFlag('--help') || haFlag('-h')) {
  aiuto();
  process.exitCode = azione ? 0 : 1;
} else {
  main(azione)
    .catch((errore) => {
      console.error(errore.message);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}

async function main(azioneScelta) {
  const q = flag('--q') || flag('--nome');
  const rui = flag('--rui') || (q && sembraRui(q) ? q : null);
  const sezione = flag('--sezione');
  const limite = flag('--limit');
  const dopoNome = flag('--dopo-nome');
  const dopoOss = flag('--dopo-oss');
  const provincia = flag('--provincia');

  const risultato = await withClient(async (client) => {
    switch (azioneScelta) {
      case 'overview':
        return overview(client, { sezione });
      case 'cerca':
        return cercaIntermediari(client, { q, sezione, dopoNome, dopoOss, limite });
      case 'scheda':
        if (!rui) throw new Error('indica --rui NUMERO');
        return scheda(client, rui, { sezione });
      case 'rete':
        if (!rui) throw new Error('indica --rui NUMERO');
        return rete(client, rui, { sezione });
      case 'sedi':
        return elencoSedi(client, { q, provincia, sezione, dopoOss, limite });
      case 'mandati':
        return elencoMandati(client, { q, sezione, dopoOss, limite });
      case 'cariche':
        return elencoCariche(client, { q, sezione, dopoOss, limite });
      case 'import':
        return storicoImport(client, { limite });
      default:
        throw new Error(`comando sconosciuto: ${azioneScelta}`);
    }
  });

  process.stdout.write(`${JSON.stringify(risultato, jsonDate, 2)}\n`);
}

function jsonDate(_chiave, valore) {
  return valore instanceof Date ? valore.toISOString() : valore;
}
