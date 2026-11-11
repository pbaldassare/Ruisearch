#!/usr/bin/env node
// Copia il codice delle API (src/) nella Edge Function di Supabase.
// La copia in supabase/functions/ruisearch-api/lib e' generata: non va modificata
// a mano ne' committata. La usa `npm run deploy:api`.

import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const radice = join(fileURLToPath(new URL('..', import.meta.url)));
const sorgente = join(radice, 'src');
const destinazione = join(radice, 'supabase/functions/ruisearch-api/lib');

// Solo l'import del registro resta fuori: usa unzip e COPY, gira su GitHub Actions.
const ESCLUSI = new Set(['importa.js', 'parse.js', 'tables.js', 'rest.js']);

rmSync(destinazione, { recursive: true, force: true });
mkdirSync(destinazione, { recursive: true });
const copiati = [];
for (const file of readdirSync(sorgente)) {
  if (!file.endsWith('.js') || ESCLUSI.has(file)) continue;
  cpSync(join(sorgente, file), join(destinazione, file));
  copiati.push(file);
}
console.log(`Edge Function: copiati ${copiati.length} moduli in ${destinazione}`);
