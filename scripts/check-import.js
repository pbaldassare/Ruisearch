#!/usr/bin/env node
// Controllo rapido dell'import del registro, della ricerca pubblica e della
// configurazione del pool, senza database e senza rete (finto client in memoria).
// node scripts/check-import.js

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

// config.js legge .env all'import: dopo si possono togliere le variabili senza che tornino.
const { buildConnectionString } = await import('../src/config.js');
const { convertiData, leggiCsv, verificaIntestazione, intestazioneAttesa } = await import('../src/parse.js');
const { TABELLE } = await import('../src/tables.js');

// --- Intestazione dei CSV ------------------------------------------------------
const sedi = TABELLE.find((t) => t.file === 'ELENCO_SEDI.csv');
const intermediari = TABELLE.find((t) => t.file === 'ELENCO_INTERMEDIARI.csv');
const giusta = 'OSS;NUMERO_ISCRIZIONE_INT;TIPO_SEDE;COMUNE_SEDE;PROVINCIA_SEDE;CAP_SEDE;INDIRIZZO_SEDE';
verificaIntestazione(giusta, sedi);
verificaIntestazione(`﻿${giusta.toLowerCase()} `, sedi); // BOM, minuscole e spazi non contano
// Una colonna nuova in coda sarebbe finita incollata all'indirizzo (riunisciCodaIn)
assert.throws(() => verificaIntestazione(`${giusta};EMAIL`, sedi), /colonne nuove EMAIL; 8 colonne invece di 7/);
assert.throws(
  () => verificaIntestazione(giusta.replace('COMUNE_SEDE;PROVINCIA_SEDE', 'PROVINCIA_SEDE;COMUNE_SEDE'), sedi),
  /ordine diverso \(posizione 4: PROVINCIA_SEDE invece di COMUNE_SEDE; posizione 5: COMUNE_SEDE invece di PROVINCIA_SEDE\)/,
);
assert.throws(() => verificaIntestazione(giusta.replace(';CAP_SEDE', ''), sedi), /mancano CAP_SEDE/);
// ELENCO_INTERMEDIARI: 15 nomi nell'intestazione, 20 campi nelle righe
assert.equal(intestazioneAttesa(intermediari).length, 15);
assert.equal(intermediari.colonne.length, 20);
// leggiCsv si ferma prima di leggere le righe
assert.throws(() => leggiCsv(`${giusta};EMAIL\n1;A000000001;Sede;BS;BS;25100;VIA X;a@b.it\n`, sedi), /intestazione/);
const { righe } = leggiCsv(`${giusta}\n1;A000000001;Sede;BRESCIA;BS;25100;CALLE MAYOR; 5\n`, sedi);
assert.equal(righe[0][6], 'CALLE MAYOR; 5');

// --- Date vere ------------------------------------------------------------------
assert.equal(convertiData('28/01/2025', 'x'), '2025-01-28');
assert.equal(convertiData('2021-11-10 00:00:00', 'x'), '2021-11-10');
assert.equal(convertiData('29/02/2024', 'x'), '2024-02-29');
assert.equal(convertiData('30/05/0007', 'x'), '0007-05-30'); // c'e' davvero nella fonte e Postgres l'accetta
assert.throws(() => convertiData('31/02/2020', 'riga 5'), /data inesistente in riga 5/);
assert.throws(() => convertiData('29/02/2023', 'x'), /inesistente/);
assert.throws(() => convertiData('2020-13-01', 'x'), /inesistente/);
assert.throws(() => convertiData('0000-01-01', 'x'), /inesistente/);
assert.throws(() => convertiData('1/2/2020', 'x'), /non riconosciuta/);

// --- Pool: lock_timeout per l'API, Edge senza ripiego su SUPABASE_DB_URL ----------
delete process.env.DATABASE_URL;
process.env.SUPABASE_DB_URL = 'postgresql://postgres:segreta@db.prova.supabase.co:5432/postgres';
assert.equal(buildConnectionString(), process.env.SUPABASE_DB_URL); // in locale il ripiego resta
assert.throws(() => buildConnectionString({ edge: true }), /DATABASE_URL non impostata sulla Edge Function/);
process.env.DATABASE_URL = 'postgresql://ruisearch_api:x@127.0.0.1:1/postgres';
delete process.env.DB_POOL_IDLE_MS;
delete process.env.DB_LOCK_TIMEOUT_MS;
const db = await import('../src/db.js');
assert.equal(db.getPool().options.lock_timeout, 3000);
assert.equal(db.getPool().options.idleTimeoutMillis, 180_000);
await db.closePool();
db.modalitaEdge();
assert.equal(db.getPool().options.idleTimeoutMillis, 30_000);
assert.equal(db.getPool().options.connectionString, process.env.DATABASE_URL);
await db.closePool();

// --- Ricerca pubblica e cache dell'overview ----------------------------------------
const { cercaPubblica, overviewPubblica, svuotaCachePubblica } = await import('../src/pubblico.js');
const chiamate = [];
const fintoDb = {
  async query(sql, params = []) {
    chiamate.push({ sql, params });
    if (sql.includes('count(*)')) return { rows: [{ intermediari: '10', collaborazioni: '2', sedi: '3', mandati: '4' }] };
    if (sql.includes('from intermediari i')) {
      return {
        rows: [{ numero_iscrizione_rui: 'B000000001', denominazione: 'ROSSI SRL', sezione: 'B', inoperativo: false, oss: 9, data_nascita: '1970-01-01' }],
      };
    }
    if (sql.includes("esito in ('completato', 'incompleto')")) return { rows: [{ id: '4', esito: 'completato' }] };
    if (sql.includes('from import_runs')) return { rows: [{ id: '5', esito: 'fallito' }] };
    if (sql.includes('rete_stato')) return { rows: [] };
    return { rows: [] };
  },
};
await assert.rejects(cercaPubblica(fintoDb, ' ro '), (e) => e.statusCode === 400 && /almeno 3/.test(e.message));
assert.equal(chiamate.length, 0);
const trovati = await cercaPubblica(fintoDb, 'a%b_c\\');
assert.equal(chiamate[0].params[0], 'a\\%b\\_c\\\\'); // % _ e \ non fanno da jolly
assert.equal(chiamate[0].params[1], 8);
assert.match(chiamate[0].sql, /ilike '%' \|\| \$1 \|\| '%'/);
assert.deepEqual(Object.keys(trovati.items[0]).sort(), ['denominazione', 'inoperativo', 'numero_iscrizione_rui', 'sezione']);
await cercaPubblica(fintoDb, 'b000000001');
assert.equal(chiamate.at(-1).params[0], 'B000000001');
assert.match(chiamate.at(-1).sql, /numero_iscrizione_rui = \$1/);

svuotaCachePubblica();
chiamate.length = 0;
const primo = await overviewPubblica(fintoDb, {});
const conteggi = () => chiamate.filter((c) => c.sql.includes('count(*)')).length;
assert.equal(conteggi(), 1);
assert.equal(primo.intermediari, '10');
assert.equal(primo.dati_in_uso.id, '4');
assert.equal(primo.ultimo_import.id, '5');
await overviewPubblica(fintoDb, {});
assert.equal(conteggi(), 1); // dalla cache
await overviewPubblica(fintoDb, { sezione: 'a' });
assert.equal(conteggi(), 2); // un'altra sezione, un'altra voce
await assert.rejects(overviewPubblica(fintoDb, { sezione: 'Z' }), (e) => e.statusCode === 400);

// --- Import: lock, riga subito "in corso", esito sempre scritto ------------------------
const { eseguiImport, chiudiCorseInterrotte } = await import('../src/importa.js');

function fintoClient({ lockLibero = true, identico = false, reteRotta = false } = {}) {
  const log = [];
  return {
    log,
    query(sql, params = []) {
      if (typeof sql !== 'string') {
        // COPY: come pg, il flusso torna subito (non una promessa) e si consuma senza scriverlo.
        log.push({ sql: 'copy', params });
        return new Writable({ write: (_pezzo, _codifica, fatto) => fatto() });
      }
      return this.rispondi(sql, params);
    },
    async rispondi(sql, params) {
      log.push({ sql, params });
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ ok: lockLibero }] };
      if (sql.includes('from pg_locks')) return { rows: [{ pid: 4242, backend_start: new Date('2026-11-23T10:00:00Z'), state: 'active' }] };
      if (sql.includes('insert into import_runs')) return { rows: [{ id: '7' }] };
      if (sql.includes('where zip_sha256')) return { rows: identico ? [{ id: '3' }] : [] };
      if (sql.includes('ricostruisci_rete_collegati')) {
        if (reteRotta) throw new Error('rete rotta');
        return { rows: [{ archi: 10, soggetti: 5 }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}
const esitoScritto = (c) => c.log.filter((q) => /set esito = (\$1|'\w+')/.test(q.sql)).at(-1);
const sbloccato = (c) => c.log.some((q) => q.sql.includes('pg_advisory_unlock'));
const prova = (client, opzioni) =>
  eseguiImport({ conConnessione: (fn) => fn(client), log: () => {}, ...opzioni });

// Un altro import tiene il lock: errore chiaro, nessuna riga, nessun download
let scaricato = false;
let c = fintoClient({ lockLibero: false });
await assert.rejects(
  prova(c, { scarica: async () => { scaricato = true; } }),
  (e) => e.statusCode === 409 && /già in corso \(connessione 4242/.test(e.message),
);
assert.equal(scaricato, false);
assert.ok(!c.log.some((q) => q.sql.includes('insert into import_runs')));

// Download fallito: la riga c'e' gia' ed e' chiusa come fallita, il lock si rilascia
c = fintoClient();
let idAvvio = null;
await assert.rejects(
  prova(c, { alAvvio: (id) => { idAvvio = id; }, scarica: async () => { throw new Error('IVASS non risponde'); } }),
  /IVASS non risponde/,
);
assert.equal(idAvvio, 7);
const ordine = c.log.map((q) => q.sql);
assert.ok(ordine.findIndex((s) => s.includes('pg_try_advisory_lock')) < ordine.findIndex((s) => s.includes('insert into import_runs')));
assert.deepEqual(esitoScritto(c).params.slice(0, 2), ['fallito', 'IVASS non risponde']);
assert.ok(sbloccato(c));

// Archivio di prova: tutti i file con l'intestazione giusta e una riga
const cartella = mkdtempSync(join(tmpdir(), 'rui-prova-'));
function archivio({ intestazioneSedi = giusta } = {}) {
  for (const spec of TABELLE) {
    const testa = spec === sedi ? intestazioneSedi : intestazioneAttesa(spec).join(';');
    const riga = spec.colonne.map(([, tipo]) => (tipo === 'data' ? '01/02/2020' : tipo === 'booleano' ? '0' : 'X'));
    writeFileSync(join(cartella, spec.file), `${testa}\n${riga.join(';')}\n`);
  }
  rmSync(join(cartella, 'r.zip'), { force: true });
  execFileSync('zip', ['-q', '-j', join(cartella, 'r.zip'), ...TABELLE.map((t) => join(cartella, t.file))]);
  return readFileSync(join(cartella, 'r.zip'));
}
const soglie = TABELLE.map((t) => t.righeAttese);
for (const t of TABELLE) t.righeAttese = 1;
try {
  // Export identico all'ultimo completato: esito 'identico', niente caricamento
  c = fintoClient({ identico: true });
  const identico = await prova(c, { zip: archivio() });
  assert.equal(identico.esito, 'identico');
  assert.equal(esitoScritto(c).sql.includes("esito = 'identico'"), true);
  assert.ok(!c.log.some((q) => q.sql.startsWith('truncate')));

  // Intestazione cambiata: fallito con il motivo, il registro non si tocca
  c = fintoClient();
  await assert.rejects(prova(c, { zip: archivio({ intestazioneSedi: `${giusta};EMAIL` }) }), /ELENCO_SEDI.csv: l'intestazione/);
  assert.equal(esitoScritto(c).params[0], 'fallito');
  assert.ok(!c.log.some((q) => q.sql.startsWith('truncate')));

  // Rete rotta dopo il commit: i dati nuovi ci sono, l'esito e' 'incompleto'
  c = fintoClient({ reteRotta: true });
  await assert.rejects(prova(c, { zip: archivio() }), (e) => e.esito === 'incompleto' && /registro caricato, ma la ricostruzione della rete/.test(e.message));
  assert.equal(esitoScritto(c).params[0], 'incompleto');
  assert.ok(c.log.some((q) => q.sql === 'commit'));

  // Tutto bene
  c = fintoClient();
  const fatto = await prova(c, { zip: archivio() });
  assert.equal(fatto.esito, 'completato');
  assert.equal(c.log.filter((q) => q.sql === 'copy').length, TABELLE.length);
  assert.ok(esitoScritto(c).sql.includes("esito = 'completato'"));
  assert.ok(sbloccato(c));
} finally {
  TABELLE.forEach((t, i) => { t.righeAttese = soglie[i]; });
  rmSync(cartella, { recursive: true, force: true });
}

// Passo finale del workflow: con il lock libero si chiudono le righe orfane, se no solo quelle oltre 45 minuti
c = fintoClient({ lockLibero: true });
assert.equal((await chiudiCorseInterrotte(c, 'x')).lockLibero, true);
assert.ok(c.log.some((q) => q.sql.includes("where esito = 'in corso'\n") || /where esito = 'in corso'\s*$/.test(q.sql)));
assert.ok(sbloccato(c));
c = fintoClient({ lockLibero: false });
assert.equal((await chiudiCorseInterrotte(c, 'x')).lockLibero, false);
assert.ok(c.log.some((q) => q.sql.includes('make_interval(mins => $2)') && q.params[1] === 45));

// --- OpenAPI: dietro Pages le API stanno sotto /api ----------------------------------
const { specificaOpenApi } = await import('../src/documentazione.js');
const spec = specificaOpenApi('https://ruisearch.example/');
assert.equal(spec.servers[0].url, 'https://ruisearch.example/api/v1');
for (const p of ['/sedi', '/mandati', '/cariche']) assert.ok(spec.paths[p], p);

console.log('import, ricerca pubblica e pool: ok');
