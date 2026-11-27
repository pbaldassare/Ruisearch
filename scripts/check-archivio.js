#!/usr/bin/env node
// Controllo dell'archivio delle agenzie /v1 (src/archivio.js) su un Postgres vero ma in memoria (PGlite):
// schema db/supabase/ruisearch_schema.sql + migrazione ruisearch_15 + rollback, chiamate HTTP vere a creaApp,
// Mistral finto. Niente database di produzione, niente rete.
// Isolamento fra agenzie e fra chiavi, recapiti solo propri, filtri, forza, modifica ed eliminazione.
//
//   npm i --no-save @electric-sql/pglite   (oppure PGLITE_MODULES=<cartella node_modules con pglite>)
//   node scripts/check-archivio.js

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const radice = new URL('..', import.meta.url).pathname;
const modulo = (nome, file) => (process.env.PGLITE_MODULES
  ? pathToFileURL(join(process.env.PGLITE_MODULES, '@electric-sql/pglite/dist', file)).href
  : nome);
const { PGlite } = await import(modulo('@electric-sql/pglite', 'index.js'));
const { pg_trgm } = await import(modulo('@electric-sql/pglite/contrib/pg_trgm', 'contrib/pg_trgm.js'));

// Nessuna connessione vera: il pool esiste ma le query vanno a PGlite.
process.env.DATABASE_URL = 'postgresql://finto:finto@127.0.0.1:1/finto';
process.env.MISTRAL_API_KEY = 'finta';
delete process.env.RUI_API_KEY;

const pg = await PGlite.create({ extensions: { pg_trgm } });
await pg.exec('create schema extensions; create role anon; create role authenticated; create role service_role; create role ruisearch_api;');
await pg.exec(readFileSync(join(radice, 'db/supabase/ruisearch_schema.sql'), 'utf8'));
await pg.exec(readFileSync(join(radice, 'db/supabase/ruisearch_15_archivio_agenzie.sql'), 'utf8'));
await pg.exec('set search_path = ruisearch, extensions, public');

const client = {
  async query(sql, params = []) {
    const r = await pg.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
};
const { getPool } = await import('../src/db.js');
getPool().query = client.query;
getPool().connect = async () => ({ query: client.query, release() {} });
const { creaChiave } = await import('../src/api-keys.js');
const { creaApp } = await import('../src/app.js');
const app = creaApp({ aggiornamento: {} });

// --- registro finto: due agenzie (principali) con un collaboratore ciascuna -------------------------------
await pg.exec(`
  insert into intermediari (oss, numero_iscrizione_rui, ragione_sociale, cognome_nome) values
    (1, 'A000000010', 'AGENZIA ROSSI SRL', null),
    (2, 'A000000020', 'AGENZIA VERDI SAS', null),
    (3, 'E000000001', null, 'NERI PAOLO'),
    (4, 'E000000002', null, 'BLU ANNA');
  insert into sedi (oss, numero_iscrizione_int, tipo_sede, comune_sede, provincia_sede, indirizzo_sede) values
    (1, 'E000000001', 'Sede legale', 'MILANO', 'MI', 'VIA ROMA 1'),
    (2, 'E000000002', 'Sede legale', 'ROMA', 'RM', 'VIA MILANO 2');
  insert into rete_collegati (principale, collegato, livello, sezione_principale, sezione_collegato) values
    ('A000000010', 'E000000001', 'I', 'A', 'E'),
    ('A000000020', 'E000000002', 'I', 'A', 'E');
`);

// --- Mistral finto: restituisce l'email scritta in `trovata`, conta le chiamate -------------------------
let trovata = 'neri@primaricerca.it';
let chiamateAi = 0;
globalThis.fetch = async () => {
  chiamateAi += 1;
  const testo = JSON.stringify({
    sintesi: 'Collaboratore a Milano.',
    recapiti: [{ tipo: 'email', valore: trovata, url: 'https://esempio.it', di_chi: 'persona' }],
  });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      outputs: [{ type: 'message.output', content: [{ type: 'text', text: testo }] }],
      usage: { prompt_tokens: 1000, completion_tokens: 100, connectors: { web_search: 1 } },
    }),
  };
};

const k1 = (await creaChiave(client, { nome: 'Assicurapp' })).chiave;
const k2 = (await creaChiave(client, { nome: 'Assiquot' })).chiave;

async function chiama(chiave, metodo, percorso, corpo) {
  const r = await app(new Request(`http://localhost/api/v1${percorso}`, {
    method: metodo,
    headers: { 'x-api-key': chiave, 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  }));
  return { status: r.status, corpo: await r.json() };
}
const ok = async (...a) => {
  const r = await chiama(...a);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  return r.corpo;
};
const archivio = (chiave, agenzia, filtri = '') => ok(chiave, 'GET', `/archivio?agenzia=${agenzia}${filtri}`);
const emailDi = async (chiave, agenzia, rui) => (await archivio(chiave, agenzia, `&q=${rui}`)).voci[0]?.email;

// --- agenzia obbligatoria -------------------------------------------------------------------------------
assert.equal((await chiama(k1, 'GET', '/archivio')).status, 400);
assert.equal((await chiama(k1, 'POST', '/archivio/scheda', { rui: 'E1' })).status, 400);

// --- scheda: idempotente, nome/sede/per chi lavora dal registro -----------------------------------------
const s1 = await ok(k1, 'POST', '/archivio/scheda', { agenzia: 'AG1', rui: 'e1' });
await ok(k1, 'POST', '/archivio/scheda', { agenzia: 'AG1', rui: 'E000000001' });
let a = await archivio(k1, 'AG1');
assert.equal(a.totale, 1, 'la stessa scheda due volte = una voce');
assert.deepEqual(
  (({ rui, nome, sezione, provincia, comune, indirizzo, telefoni, email, stato, origine, recapiti_il }) => ({
    rui, nome, sezione, provincia, comune, indirizzo, telefoni, email, stato, origine, recapiti_il,
  }))(a.voci[0]),
  {
    rui: 'E000000001', nome: 'NERI PAOLO', sezione: 'E', provincia: 'MI', comune: 'MILANO', indirizzo: 'VIA ROMA 1',
    telefoni: [], email: [], stato: 'archivio', origine: 'scheda', recapiti_il: null,
  },
);
assert.deepEqual(a.voci[0].per_chi_lavora, [{ rui: 'A000000010', denominazione: 'AGENZIA ROSSI SRL' }]);
assert.equal(s1.voce.id, a.voci[0].id);
assert.equal((await chiama(k1, 'POST', '/archivio/scheda', { agenzia: 'AG1', rui: 'E000000099' })).status, 404);

// --- ricerca di AG2: nuova, entra nell'archivio di AG2 e non in quello di AG1 -----------------------------
let r = await ok(k1, 'POST', '/recapiti/E000000001', { agenzia: 'AG2' });
assert.equal(r.tipo, 'nuova_con_risultati');
assert.equal(chiamateAi, 1);
assert.deepEqual(await emailDi(k1, 'AG2', 'E000000001'), ['neri@primaricerca.it']);
a = await archivio(k1, 'AG2');
assert.equal(a.voci[0].origine, 'ricerca');
assert.ok(a.voci[0].recapiti_il);
assert.deepEqual(await emailDi(k1, 'AG1', 'E000000001'), [], 'AG1 non vede i recapiti pagati da AG2');

// --- isolamento fra chiavi: stesso codice agenzia, chiave diversa = un'altra agenzia ------------------------
assert.equal((await archivio(k2, 'AG1')).totale, 0);
assert.equal((await chiama(k2, 'POST', `/archivio/${s1.voce.id}`, { agenzia: 'AG1', stato: 'scartato' })).status, 404);
assert.equal((await chiama(k1, 'POST', `/archivio/${s1.voce.id}`, { agenzia: 'AG2', stato: 'scartato' })).status, 404);

// --- ricerca di AG1: dalla cache (niente AI), ora AG1 ha i recapiti che ha ricevuto --------------------------
r = await ok(k1, 'POST', '/recapiti/E000000001', { agenzia: 'AG1' });
assert.equal(r.tipo, 'cache_con_risultati');
assert.equal(chiamateAi, 1);
assert.deepEqual(await emailDi(k1, 'AG1', 'E000000001'), ['neri@primaricerca.it']);
assert.equal((await archivio(k1, 'AG1')).voci[0].origine, 'ricerca');

// --- AG2 ripete: gia_richiesta, niente AI; con forza: ricerca nuova a prezzo pieno -------------------------
trovata = 'neri@secondaricerca.it';
r = await ok(k1, 'POST', '/recapiti/E000000001', { agenzia: 'AG2' });
assert.equal(r.tipo, 'gia_richiesta');
assert.equal(chiamateAi, 1);
r = await ok(k1, 'POST', '/recapiti/E000000001', { agenzia: 'AG2', forza: true });
assert.match(r.tipo, /^nuova_/);
assert.equal(chiamateAi, 2, 'forza salta gia_richiesta e cache');
assert.ok(r.costo_eur > 0);
assert.deepEqual(await emailDi(k1, 'AG2', 'E000000001'), ['neri@primaricerca.it', 'neri@secondaricerca.it']);

// --- recapiti solo propri: la ricerca nuova di AG2 non arriva nell'archivio di AG1, nemmeno con gia_richiesta ---
assert.deepEqual(await emailDi(k1, 'AG1', 'E000000001'), ['neri@primaricerca.it']);
r = await ok(k1, 'POST', '/recapiti/E000000001', { agenzia: 'AG1' });
assert.equal(r.tipo, 'gia_richiesta');
assert.deepEqual(await emailDi(k1, 'AG1', 'E000000001'), ['neri@primaricerca.it']);
assert.ok(!r.recapiti.some((x) => x.valore === 'neri@secondaricerca.it'), 'gia_richiesta: niente recapiti trovati dopo da altri');
assert.ok(r.recapiti.some((x) => x.valore === 'neri@primaricerca.it'), 'gia_richiesta: i propri restano');
// Senza agenzia la ricerca non tocca nessun archivio
const prima = (await pg.query('select count(*)::int as n from agenzia_archivio')).rows[0].n;
await ok(k1, 'POST', '/recapiti/E000000002', {});
assert.equal((await pg.query('select count(*)::int as n from agenzia_archivio')).rows[0].n, prima);

// --- inserimento manuale ----------------------------------------------------------------------------------
assert.equal((await chiama(k1, 'POST', '/archivio', { agenzia: 'AG1' })).status, 400, 'nome obbligatorio');
assert.equal((await chiama(k1, 'POST', '/archivio', { agenzia: 'AG1', nome: 'X', email: 'non-una-email' })).status, 400);
assert.equal((await chiama(k1, 'POST', '/archivio', { agenzia: 'AG1', nome: 'X', rui: 'E000000099' })).status, 404);
const m1 = (await ok(k1, 'POST', '/archivio', {
  agenzia: 'AG1', nome: 'Mario Bianchi', telefono: '333 1234567', provincia: 'Torino', comune: 'Torino',
  indirizzo: 'Corso Francia 3', note: 'conosciuto in fiera',
})).voce;
assert.deepEqual(
  (({ rui, nome, provincia, telefoni, origine, note }) => ({ rui, nome, provincia, telefoni, origine, note }))(m1),
  { rui: null, nome: 'Mario Bianchi', provincia: 'TO', telefoni: ['333 1234567'], origine: 'manuale', note: 'conosciuto in fiera' },
);
assert.deepEqual(m1.per_chi_lavora, []);
// Con RUI del registro: nome e sede dal registro, non quelli scritti
const m2 = (await ok(k1, 'POST', '/archivio', { agenzia: 'AG1', rui: 'E000000002', nome: 'scritto male', provincia: 'NA' })).voce;
assert.deepEqual([m2.nome, m2.provincia, m2.origine], ['BLU ANNA', 'RM', 'manuale']);
// Lo stesso RUI una seconda volta: stessa voce, recapiti aggiunti senza doppioni
await ok(k1, 'POST', '/archivio', { agenzia: 'AG1', rui: 'E000000002', telefono: ['+39 06 1234567', '06 1234567'] });
a = await archivio(k1, 'AG1');
assert.equal(a.totale, 3);
assert.deepEqual(a.voci.find((v) => v.id === m2.id).telefoni, ['+39 06 1234567']);
// Una scheda aperta dopo non abbassa l'origine
await ok(k1, 'POST', '/archivio/scheda', { agenzia: 'AG1', rui: 'E000000002' });
assert.equal((await archivio(k1, 'AG1', '&q=E2')).voci[0].origine, 'manuale');

// --- filtri -----------------------------------------------------------------------------------------------
const rui = async (filtri) => (await archivio(k1, 'AG1', filtri)).voci.map((v) => v.rui ?? v.nome).sort();
assert.deepEqual(await rui('&q=bianchi'), ['Mario Bianchi']);
assert.deepEqual(await rui('&q=neri'), ['E000000001']);
assert.deepEqual(await rui('&q=E000000002'), ['E000000002']);
assert.deepEqual(await rui('&provincia=MI'), ['E000000001']);
assert.deepEqual(await rui('&provincia=torino'), ['Mario Bianchi']);
assert.deepEqual(await rui('&concorrente=A10'), ['E000000001']);
assert.deepEqual(await rui('&concorrente=A000000020'), ['E000000002']);
assert.equal((await chiama(k1, 'GET', '/archivio?agenzia=AG1&provincia=Atlantide')).status, 400);
assert.equal((await chiama(k1, 'GET', '/archivio?agenzia=AG1&stato=boh')).status, 400);
assert.equal((await archivio(k1, 'AG1', '&pagina=2')).voci.length, 0);
assert.equal((await archivio(k1, 'AG1', '&pagina=2')).totale, 3, 'il totale non dipende dalla pagina');

// --- modifica -----------------------------------------------------------------------------------------------
const v1 = (await ok(k1, 'POST', `/archivio/${s1.voce.id}`, {
  agenzia: 'AG1', stato: 'da_lavorare', note: 'richiamare', telefono: '02 7654321',
})).voce;
assert.deepEqual([v1.stato, v1.note, v1.telefoni, v1.email], ['da_lavorare', 'richiamare', ['02 7654321'], ['neri@primaricerca.it']]);
assert.equal((await chiama(k1, 'POST', `/archivio/${s1.voce.id}`, { agenzia: 'AG1', nome: 'Altro' })).status, 400);
assert.equal((await chiama(k1, 'POST', `/archivio/${s1.voce.id}`, { agenzia: 'AG1', stato: 'boh' })).status, 400);
// Manuale senza RUI: si modifica tutto, telefono sostituisce
const vm = (await ok(k1, 'POST', `/archivio/${m1.id}`, {
  agenzia: 'AG1', nome: 'Mario Bianchi jr', telefono: '347 0000001', provincia: 'MI', stato: 'contattato',
})).voce;
assert.deepEqual([vm.nome, vm.telefoni, vm.provincia, vm.note], ['Mario Bianchi jr', ['347 0000001'], 'MI', 'conosciuto in fiera']);
assert.deepEqual(await rui('&stato=da_lavorare,contattato,scartato'), ['E000000001', 'Mario Bianchi jr']);
assert.deepEqual(await rui('&stato=archivio'), ['E000000002']);

// --- eliminazione -------------------------------------------------------------------------------------------
assert.equal((await chiama(k1, 'POST', `/archivio/${m1.id}/elimina`, { agenzia: 'AG2' })).status, 404);
assert.equal((await chiama(k2, 'POST', `/archivio/${m1.id}/elimina`, { agenzia: 'AG1' })).status, 404);
await ok(k1, 'POST', `/archivio/${m1.id}/elimina`, { agenzia: 'AG1' });
assert.equal((await archivio(k1, 'AG1')).totale, 2);
assert.equal((await archivio(k1, 'AG2')).totale, 1, 'AG2 non toccata');

// --- rollback della migrazione --------------------------------------------------------------------------------
await pg.exec(readFileSync(join(radice, 'db/supabase/ruisearch_15_archivio_agenzie_rollback.sql'), 'utf8'));
assert.equal((await pg.query("select to_regclass('ruisearch.agenzia_archivio') as t")).rows[0].t, null);

await pg.close();
console.log('check-archivio: ok');
