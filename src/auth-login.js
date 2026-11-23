// Admin da .env, operatori cliente da Postgres. Niente registrazione pubblica.
// Dopo TENTATIVI_MAX password errate sulla stessa email in FINESTRA_MIN minuti l'accesso si blocca per
// FINESTRA_MIN minuti (tabella accessi_falliti), anche con la password giusta.

import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import './config.js';
import { hashPassword, verificaPassword } from './password.js';
import { improntaPassword } from './sessione.js';

const TENTATIVI_MAX = 5;
const FINESTRA_MIN = 15;
// Hash di confronto per le email che non esistono: stessi tempi di risposta di una password errata
const HASH_FINTO = hashPassword('nessun-utente');

function erroreHttp(messaggio, statusCode) {
  const errore = new Error(messaggio);
  errore.statusCode = statusCode;
  return errore;
}

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
  if (!attesaEmail || !attesaPass) throw erroreHttp('accesso admin non configurato sul server.', 503);
  const propostaEmail = String(email || '').trim().toLowerCase();
  const propostaPass = String(password || '');
  const ok = stessoTesto(propostaEmail, attesaEmail) && stessoTesto(propostaPass, attesaPass);
  if (!ok) throw erroreHttp('email o password non corrette.', 401);
  return { email: attesaEmail, ruolo: 'admin', pv: improntaPassword(attesaPass) };
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
  const ok = verificaPassword(password, riga ? riga.password_hash : HASH_FINTO);
  if (!riga || !ok) throw erroreHttp('email o password non corrette.', 401);
  return {
    email: riga.email,
    ruolo: 'cliente',
    pv: improntaPassword(riga.password_hash),
    cliente: {
      id: Number(riga.cliente_id),
      rui: riga.numero_iscrizione_rui,
      denominazione: riga.denominazione,
      sezione: riga.sezione,
    },
  };
}

async function controllaBlocco(client, email) {
  const { rows } = await client.query(
    `select ceil(extract(epoch from bloccato_fino - now()) / 60) as minuti
     from accessi_falliti where email = $1 and bloccato_fino > now()`,
    [email],
  );
  if (rows[0]) {
    throw erroreHttp(`troppi tentativi non riusciti: riprova tra ${Number(rows[0].minuti)} minuti.`, 429);
  }
}

async function registraFallimento(client, email) {
  const finestra = `${FINESTRA_MIN} minutes`;
  await client.query(
    `
    insert into accessi_falliti as a (email, tentativi, primo_il)
    values ($1, 1, now())
    on conflict (email) do update set
      tentativi = case when a.primo_il < now() - $2::interval then 1 else a.tentativi + 1 end,
      primo_il = case when a.primo_il < now() - $2::interval then now() else a.primo_il end,
      bloccato_fino = case
        when (case when a.primo_il < now() - $2::interval then 1 else a.tentativi + 1 end) >= $3
          then now() + $2::interval
        else a.bloccato_fino
      end
    `,
    [email, finestra, TENTATIVI_MAX],
  );
  // Le righe vecchie non servono piu' (email inventate comprese)
  await client.query(`delete from accessi_falliti where primo_il < now() - interval '1 day'`);
}

export async function verificaAccesso(client, email, password) {
  const chiave = String(email || '').trim().toLowerCase().slice(0, 200);
  if (!chiave) throw erroreHttp('email o password non corrette.', 401);
  await controllaBlocco(client, chiave);
  try {
    let esito;
    try {
      esito = verificaAdmin(email, password);
    } catch (errore) {
      if (errore.statusCode !== 401 && errore.statusCode !== 503) throw errore;
      esito = await verificaCliente(client, email, password);
    }
    await client.query('delete from accessi_falliti where email = $1', [chiave]);
    return esito;
  } catch (errore) {
    if (errore.statusCode === 401) await registraFallimento(client, chiave);
    throw errore;
  }
}

/**
 * Un token cliente vale solo se l'operatore e la societa' sono ancora attivi e la password e' la stessa
 * di quando e' stato emesso: disattivare, eliminare o reimpostare la password chiude subito le sessioni aperte.
 */
export async function verificaSessioneCliente(client, sessione) {
  const { rows } = await client.query(
    `
    select o.password_hash
    from operatori_cliente o
    join clienti c on c.id = o.cliente_id
    where lower(o.email) = lower($1) and o.attivo and c.attivo and c.numero_iscrizione_rui = $2
    `,
    [sessione.email, sessione.rui],
  );
  if (!rows[0] || improntaPassword(rows[0].password_hash) !== sessione.pv) {
    throw erroreHttp('sessione scaduta o non valida: accedi di nuovo.', 401);
  }
}
