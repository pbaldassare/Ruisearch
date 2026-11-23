#!/usr/bin/env node
// Materializza la rete A/B/E unica da collaboratori. Da lanciare dopo un import
// o quando si vuole riallineare le tabelle rete_collegati / rete_numeri.

// La funzione ricostruisci_rete_collegati() esiste gia' nello schema
// (db/supabase/ruisearch_schema.sql): qui la si chiama soltanto.
import { closePool, withClientSenzaLimite } from '../src/db.js';
import { LOCK_IMPORT, prendiLock } from '../src/importa.js';
import { ricostruisciRete } from '../src/rete-materializzata.js';

async function main() {
  // Stesso lock dell'import: mai due ricostruzioni insieme, ne' durante un aggiornamento del registro.
  const out = await withClientSenzaLimite(async (client) => {
    await prendiLock(client);
    try {
      return await ricostruisciRete(client);
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_IMPORT]).catch(() => {});
    }
  });
  console.log(
    `rete salvata: ${Number(out.archi).toLocaleString('it-IT')} archi, ` +
      `${Number(out.soggetti).toLocaleString('it-IT')} iscritti con rete`,
  );
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(closePool);
