#!/usr/bin/env node
// Controllo rapido di password casuali, token e sessioni cliente, senza database (finto client in memoria).
// node scripts/check-sicurezza.js

import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.ADMIN_EMAIL = 'admin@prova.it';
process.env.ADMIN_PASSWORD = 'vecchia-password';

const { nuovaPassword } = await import('../src/utenti.js');
const { creaToken, leggiToken, improntaPassword } = await import('../src/sessione.js');
const { verificaAdmin, verificaSessioneCliente } = await import('../src/auth-login.js');
const { hashPassword } = await import('../src/password.js');

// Password casuali: formato e niente ripetizioni
const p = nuovaPassword();
assert.match(p, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{2}$/);
assert.notEqual(p, nuovaPassword());

// Admin: il token vale finché la password del .env non cambia; l'impronta non contiene la password
const admin = verificaAdmin('admin@prova.it', 'vecchia-password');
assert.ok(!String(admin.pv).includes('vecchia'));
const tokenAdmin = creaToken(admin);
assert.equal(leggiToken(tokenAdmin).ruolo, 'admin');
process.env.ADMIN_PASSWORD = 'nuova-password';
assert.throws(() => leggiToken(tokenAdmin), /sessione scaduta/);
process.env.ADMIN_PASSWORD = 'vecchia-password';

// "Ricordami": 30 giorni invece di 12 ore
const durata = (t) => JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString()).scade - Date.now();
assert.ok(durata(creaToken(admin)) <= 12 * 3600_000);
assert.ok(durata(creaToken(admin, { ricordami: true })) > 29 * 24 * 3600_000);

// Token senza impronta (emessi prima di questa versione): non valgono più
const [corpo] = tokenAdmin.split('.');
const vecchio = JSON.parse(Buffer.from(corpo, 'base64url').toString());
delete vecchio.pv;
const { createHmac } = await import('node:crypto');
const corpoVecchio = Buffer.from(JSON.stringify(vecchio)).toString('base64url');
const firmaVecchia = createHmac('sha256', process.env.SESSION_SECRET).update(corpoVecchio).digest('base64url');
assert.throws(() => leggiToken(`${corpoVecchio}.${firmaVecchia}`), /sessione scaduta/);

// Cliente: la sessione cade se la password viene reimpostata o l'operatore disattivato
let riga = { password_hash: hashPassword('a') };
const finto = { query: async () => ({ rows: riga ? [riga] : [] }) };
const sessione = { email: 'op@cliente.it', ruolo: 'cliente', rui: 'B000000001', pv: improntaPassword(riga.password_hash) };
await verificaSessioneCliente(finto, sessione);
riga = { password_hash: hashPassword('b') };
await assert.rejects(verificaSessioneCliente(finto, sessione), /sessione scaduta/);
riga = null;
await assert.rejects(verificaSessioneCliente(finto, sessione), /sessione scaduta/);

// Cambio password del cliente: serve quella attuale, la sbagliata non fa uscire (400, non 401), poi il vecchio token cade
const { cambiaPasswordCliente } = await import('../src/auth-login.js');
const { verificaPassword } = await import('../src/password.js');
const operatore = { email: 'op@cliente.it', password_hash: hashPassword('vecchia-1234'), cliente_id: 1, numero_iscrizione_rui: 'B000000001', denominazione: 'X', sezione: 'B' };
const db = {
  async query(sql, p = []) {
    if (sql.includes('from accessi_falliti')) return { rows: [] };
    if (sql.includes('accessi_falliti')) return { rows: [], rowCount: 0 };
    if (sql.includes('update operatori_cliente')) {
      operatore.password_hash = p[0];
      return { rowCount: 1 };
    }
    return { rows: [operatore] };
  },
};
const sessioneOp = { email: 'op@cliente.it', ruolo: 'cliente', rui: 'B000000001', pv: improntaPassword(operatore.password_hash) };
await assert.rejects(cambiaPasswordCliente(db, sessioneOp, { attuale: 'sbagliata', nuova: 'nuova-12345' }), (e) => e.statusCode === 400 && /attuale/.test(e.message));
await assert.rejects(cambiaPasswordCliente(db, sessioneOp, { attuale: 'vecchia-1234', nuova: 'corta' }), /almeno 10/);
await assert.rejects(cambiaPasswordCliente(db, { ...sessioneOp, ruolo: 'admin' }, { attuale: 'x', nuova: 'nuova-12345' }), (e) => e.statusCode === 403);
const cambiata = await cambiaPasswordCliente(db, sessioneOp, { attuale: 'vecchia-1234', nuova: 'nuova-12345' });
assert.ok(verificaPassword('nuova-12345', operatore.password_hash));
assert.equal(cambiata.pv, improntaPassword(operatore.password_hash));
await assert.rejects(verificaSessioneCliente(db, sessioneOp), /sessione scaduta/);

// CORS: si' su /v1 e pagine pubbliche, no su area cliente e admin
const { creaApp } = await import('../src/app.js');
const app = creaApp({ aggiornamento: {} });
const cors = async (path) => (await app(new Request(`https://x.test/api${path}`, { method: 'OPTIONS' }))).headers.get('access-control-allow-origin');
assert.equal(await cors('/v1/intermediari'), '*');
assert.equal(await cors('/documentazione'), '*');
assert.equal(await cors('/cliente/estratto'), null);
assert.equal(await cors('/admin/utenti'), null);
assert.equal(await cors('/auth/login'), null);

console.log('sicurezza: ok');
