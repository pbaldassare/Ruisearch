#!/usr/bin/env node
// Passo finale del workflow "Aggiorna registro IVASS" quando l'import fallisce,
// scade o viene annullato: la sua riga di import_runs non deve restare
// "in corso" per sempre (la pagina Aggiornamento la seguirebbe all'infinito).
//
//   RUI_ID_CORSA_FILE  file in cui scripts/import.js ha scritto l'id della riga

import { existsSync, readFileSync } from 'node:fs';
import { closePool, withClient } from '../src/db.js';
import { chiudiCorseInterrotte } from '../src/importa.js';

const MOTIVO = 'interrotto: job GitHub Actions fallito, annullato o scaduto';
const file = process.env.RUI_ID_CORSA_FILE;
const id = file && existsSync(file) ? Number(readFileSync(file, 'utf8').trim()) || null : null;

withClient(async (client) => {
  if (id) {
    // Il processo dell'import e' morto: la sua riga si chiude anche se il lock risultasse ancora preso.
    const { rowCount } = await client.query(
      `update import_runs set esito = 'fallito', concluso_il = now(), errore = coalesce(errore, $2)
       where id = $1 and esito = 'in corso'`,
      [id, MOTIVO],
    );
    console.log(rowCount ? `aggiornamento #${id} segnato come fallito` : `aggiornamento #${id} gia' chiuso`);
    return;
  }
  // L'import non ha fatto in tempo a creare la riga: si chiudono solo quelle orfane.
  const { lockLibero, chiuse } = await chiudiCorseInterrotte(client, MOTIVO);
  console.log(
    `${chiuse} aggiornamenti "in corso" chiusi` +
      (lockLibero ? '' : ' (un altro import tiene il lock: toccati solo quelli oltre 45 minuti)'),
  );
})
  .catch((errore) => {
    console.error(`pulizia non riuscita: ${errore.message}`);
    process.exitCode = 1;
  })
  .finally(closePool);
