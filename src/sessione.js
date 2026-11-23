// Token di sessione firmati (HMAC-SHA256), senza stato sul server.
// Formato: base64url(payload JSON) + "." + base64url(firma).
// Il payload porta email, ruolo ("admin" | "cliente") e, per i clienti, il RUI:
// le API si fidano solo di questo, mai del RUI scritto dal browser.
// `pv` = impronta della password attuale: cambiarla (o reimpostarla) rende scaduti i token emessi prima.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import './config.js';

const DURATA_ORE = 12;
// "Ricordami" sul login: il token dura 30 giorni (resta revocabile cambiando la password).
const DURATA_RICORDAMI_ORE = 30 * 24;

function segreto() {
  const s = (process.env.SESSION_SECRET || '').trim();
  if (s.length < 32) {
    const errore = new Error('accesso non configurato sul server (SESSION_SECRET mancante).');
    errore.statusCode = 503;
    throw errore;
  }
  return s;
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Impronta corta di una password (admin: quella del .env; cliente: il suo hash salvato). Firmata col segreto
 * delle sessioni: dal token, che il browser puo' leggere, non si risale alla password.
 */
export function improntaPassword(valore) {
  return createHmac('sha256', segreto()).update(`pv:${String(valore || '')}`).digest('base64url').slice(0, 22);
}

function firma(testo) {
  return createHmac('sha256', segreto()).update(testo).digest('base64url');
}

/** Crea il token per un utente appena autenticato. */
export function creaToken({ email, ruolo, cliente, pv }, { ricordami = false } = {}) {
  const payload = {
    email,
    ruolo,
    rui: ruolo === 'cliente' ? cliente?.rui ?? null : null,
    pv,
    scade: Date.now() + (ricordami ? DURATA_RICORDAMI_ORE : DURATA_ORE) * 3600_000,
  };
  const corpo = b64(JSON.stringify(payload));
  return `${corpo}.${firma(corpo)}`;
}

function nonAutorizzato(messaggio = 'sessione scaduta o non valida: accedi di nuovo.') {
  const errore = new Error(messaggio);
  errore.statusCode = 401;
  return errore;
}

/** Verifica il token e restituisce la sessione, o lancia 401. */
export function leggiToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) throw nonAutorizzato('accesso richiesto.');
  const [corpo, firmaData] = token.split('.');
  const attesa = Buffer.from(firma(corpo));
  const data = Buffer.from(String(firmaData || ''));
  if (attesa.length !== data.length || !timingSafeEqual(attesa, data)) throw nonAutorizzato();
  let payload;
  try {
    payload = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
  } catch {
    throw nonAutorizzato();
  }
  if (!payload?.scade || payload.scade < Date.now()) throw nonAutorizzato();
  if (payload.ruolo !== 'admin' && payload.ruolo !== 'cliente') throw nonAutorizzato();
  if (!payload.pv) throw nonAutorizzato();
  // Admin: password nel .env, si controlla qui. Cliente: la controlla verificaSessioneCliente sul database.
  if (payload.ruolo === 'admin' && payload.pv !== improntaPassword(process.env.ADMIN_PASSWORD)) throw nonAutorizzato();
  return payload;
}
