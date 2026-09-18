#!/usr/bin/env node
// Materializza la rete A/B/E unica da collaboratori. Da lanciare dopo un import
// o quando si vuole riallineare le tabelle rete_collegati / rete_numeri.

import { readFileSync } from 'node:fs';
import { closePool, withClient } from '../src/db.js';
import { ricostruisciRete } from '../src/rete-materializzata.js';

async function main() {
  const out = await withClient(async (client) => {
    await client.query(readFileSync('db/migrations/006_rete_collegati.sql', 'utf8'));
    return ricostruisciRete(client);
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
