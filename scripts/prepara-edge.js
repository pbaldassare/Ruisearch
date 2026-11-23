#!/usr/bin/env node
// Copia il codice delle API (src/) nella Edge Function di Supabase.
// La copia in supabase/functions/ruisearch-api/lib e' generata: non va modificata
// a mano ne' committata. La usa `npm run deploy:api`.
//
// Si pubblica solo codice committato: con modifiche non committate in src/ o
// nella funzione il deploy si ferma, cosi' in produzione c'e' sempre un commit preciso.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const radice = join(fileURLToPath(new URL('..', import.meta.url)));
const sorgente = join(radice, 'src');
const destinazione = join(radice, 'supabase/functions/ruisearch-api/lib');

const git = (...argomenti) => execFileSync('git', argomenti, { cwd: radice, encoding: 'utf8' }).trimEnd();

const sporchi = git('status', '--porcelain', '--', 'src', 'supabase/functions/ruisearch-api');
if (sporchi) {
  console.error('Deploy fermato: ci sono modifiche non committate in src/ o nella Edge Function.');
  console.error(sporchi);
  console.error('Committa (o metti da parte) le modifiche e rilancia `npm run deploy:api`.');
  process.exit(1);
}

// Solo l'import del registro resta fuori: usa unzip e COPY, gira su GitHub Actions.
const ESCLUSI = new Set(['importa.js', 'parse.js', 'tables.js']);

rmSync(destinazione, { recursive: true, force: true });
mkdirSync(destinazione, { recursive: true });
const copiati = [];
for (const file of readdirSync(sorgente)) {
  if (!file.endsWith('.js') || ESCLUSI.has(file)) continue;
  cpSync(join(sorgente, file), join(destinazione, file));
  copiati.push(file);
}
console.log(`Edge Function: copiati ${copiati.length} moduli in ${destinazione}`);
console.log(`Pubblico il commit ${git('log', '-1', '--format=%h %ad %s', '--date=format:%d/%m/%Y %H:%M')}`);
