// Un solo operatore admin, da .env. Niente registrazione pubblica.

import { timingSafeEqual } from 'node:crypto';
import './config.js';

function stessoTesto(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function verificaAdmin(email, password) {
  const attesaEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const attesaPass = process.env.ADMIN_PASSWORD || '';
  if (!attesaEmail || !attesaPass) {
    const errore = new Error('accesso admin non configurato sul server.');
    errore.statusCode = 503;
    throw errore;
  }
  const propostaEmail = String(email || '').trim().toLowerCase();
  const propostaPass = String(password || '');
  const ok = stessoTesto(propostaEmail, attesaEmail) && stessoTesto(propostaPass, attesaPass);
  if (!ok) {
    const errore = new Error('email o password non corrette.');
    errore.statusCode = 401;
    throw errore;
  }
  return { email: attesaEmail, ruolo: 'admin' };
}
