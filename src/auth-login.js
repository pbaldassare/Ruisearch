// Admin da .env, operatori cliente da Postgres. Niente registrazione pubblica.

import { timingSafeEqual } from 'node:crypto';
import './config.js';
import { verificaPassword } from './password.js';

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

export async function verificaCliente(client, email, password) {
  const propostaEmail = String(email || '').trim().toLowerCase();
  const { rows } = await client.query(
    `
    select
      o.email,
      o.password_hash,
      o.nome,
      c.id as cliente_id,
      c.numero_iscrizione_rui,
      c.denominazione,
      c.sezione
    from operatori_cliente o
    join clienti c on c.id = o.cliente_id
    where lower(o.email) = $1
      and o.attivo
      and c.attivo
    `,
    [propostaEmail],
  );
  const riga = rows[0];
  if (!riga || !verificaPassword(password, riga.password_hash)) {
    const errore = new Error('email o password non corrette.');
    errore.statusCode = 401;
    throw errore;
  }
  return {
    email: riga.email,
    ruolo: 'cliente',
    cliente: {
      id: Number(riga.cliente_id),
      rui: riga.numero_iscrizione_rui,
      denominazione: riga.denominazione,
      sezione: riga.sezione,
    },
  };
}

export async function verificaAccesso(client, email, password) {
  try {
    return verificaAdmin(email, password);
  } catch (errore) {
    if (errore.statusCode !== 401 && errore.statusCode !== 503) throw errore;
  }
  return verificaCliente(client, email, password);
}
