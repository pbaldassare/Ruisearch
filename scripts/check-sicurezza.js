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

console.log('sicurezza: ok');
