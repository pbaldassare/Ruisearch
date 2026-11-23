#!/usr/bin/env node
// Aggiorna il Registro Unico degli Intermediari da terminale.
// La stessa operazione si lancia dall'area admin, pagina Aggiornamento.
//
//   node scripts/import.js              scarica e carica
//   node scripts/import.js --dry-run    scarica e valida, senza toccare il db
//   node scripts/import.js --zip FILE   usa un archivio gia' scaricato
//   node scripts/import.js --forza      ricarica anche se l'export e' identico
//
// Con RUI_ID_CORSA_FILE (GitHub Actions) scrive li' l'id della riga di
// import_runs: se il job viene ucciso, il passo finale la chiude come fallita.

import { readFileSync, writeFileSync } from 'node:fs';
import { closePool } from '../src/db.js';
import { eseguiImport } from '../src/importa.js';

const argomenti = process.argv.slice(2);
const zipIndicato = argomenti.includes('--zip')
  ? argomenti[argomenti.indexOf('--zip') + 1]
  : null;

function log(messaggio) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${messaggio}`);
}

let ultimoDownload = 0;

eseguiImport({
  zip: zipIndicato ? readFileSync(zipIndicato) : undefined,
  soloValidazione: argomenti.includes('--dry-run'),
  forza: argomenti.includes('--forza'),
  log,
  alAvvio: (id) => {
    log(`aggiornamento #${id} avviato`);
    if (process.env.RUI_ID_CORSA_FILE) writeFileSync(process.env.RUI_ID_CORSA_FILE, String(id));
  },
  avanzamento: ({ fase, percentuale, messaggio }) => {
    // Il download aggiorna spesso: a terminale basta una riga ogni 10%.
    if (fase === 'download' && percentuale != null && percentuale >= ultimoDownload + 10) {
      ultimoDownload = percentuale - (percentuale % 10);
      log(messaggio);
    }
  },
})
  .catch((errore) => {
    console.error(`\nCaricamento fallito: ${errore.message}`);
    process.exitCode = 1;
  })
  .finally(closePool);
