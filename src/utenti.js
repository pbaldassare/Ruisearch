// Utenti area cliente: società (RUI) + operatore. Password sempre quella di default.

import './config.js';
import { anagrafica, normalizzaRui } from './query.js';
import { hashPassword } from './password.js';

export function passwordClienteDefault() {
  const daEnv = (
    process.env.DEFAULT_CLIENTE_PASSWORD
    || process.env.CLIENTE_CONSULBROKERS_PASSWORD
    || 'Leone123!'
  ).trim();
  return daEnv || 'Leone123!';
}

function erroreHttp(messaggio, status) {
  const errore = new Error(messaggio);
  errore.statusCode = status;
  return errore;
}

function normalizzaEmail(valore) {
  return String(valore || '').trim().toLowerCase();
}

function emailValida(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function elencoUtentiCliente(client) {
  const { rows } = await client.query(
    `
    select
      c.id,
      c.numero_iscrizione_rui as rui,
      c.denominazione,
      c.sezione,
      c.attivo,
      c.creato_il,
      coalesce(
        (
          select json_agg(op order by op.email)
          from (
            select o.id, o.email, o.nome, o.attivo, o.creato_il
            from operatori_cliente o
            where o.cliente_id = c.id
          ) op
        ),
        '[]'::json
      ) as operatori
    from clienti c
    order by c.denominazione, c.numero_iscrizione_rui
    `,
  );
  return {
    password_default: passwordClienteDefault(),
    utenti: rows,
  };
}

export async function creaUtenteCliente(client, { rui, email, nome } = {}) {
  const numero = normalizzaRui(rui);
  if (!numero) throw erroreHttp('indica il RUI della società', 400);

  const indirizzo = normalizzaEmail(email);
  if (!emailValida(indirizzo)) throw erroreHttp('indica un indirizzo email valido', 400);

  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (adminEmail && indirizzo === adminEmail) {
    throw erroreHttp('questa email è già usata per l\'admin', 400);
  }

  const soggetti = await anagrafica(client, numero);
  const soggetto = soggetti[0];
  if (!soggetto) throw erroreHttp(`nessun intermediario A/B/E con RUI ${numero}`, 404);
  if (soggetto.sezione !== 'A' && soggetto.sezione !== 'B') {
    throw erroreHttp('il cliente deve essere una iscrizione A o B', 400);
  }

  const cliente = await client.query(
    `
    insert into clienti (numero_iscrizione_rui, denominazione, sezione, attivo)
    values ($1, $2, $3, true)
    on conflict (numero_iscrizione_rui) do update
      set denominazione = excluded.denominazione,
          sezione = excluded.sezione,
          attivo = true
    returning id, numero_iscrizione_rui, denominazione, sezione
    `,
    [soggetto.numero_iscrizione_rui, soggetto.denominazione, soggetto.sezione],
  );

  const password = passwordClienteDefault();
  const hash = hashPassword(password);
  const etichetta = String(nome || '').trim() || null;

  const operatore = await client.query(
    `
    insert into operatori_cliente (cliente_id, email, password_hash, nome, attivo)
    values ($1, $2, $3, $4, true)
    on conflict (email) do update
      set cliente_id = excluded.cliente_id,
          password_hash = excluded.password_hash,
          nome = excluded.nome,
          attivo = true
    returning id, email, nome, attivo
    `,
    [cliente.rows[0].id, indirizzo, hash, etichetta],
  );

  return {
    ok: true,
    password,
    cliente: {
      id: Number(cliente.rows[0].id),
      rui: cliente.rows[0].numero_iscrizione_rui,
      denominazione: cliente.rows[0].denominazione,
      sezione: cliente.rows[0].sezione,
    },
    operatore: operatore.rows[0],
  };
}

export async function reimpostaPasswordUtente(client, email) {
  const indirizzo = normalizzaEmail(email);
  if (!emailValida(indirizzo)) throw erroreHttp('indica un indirizzo email valido', 400);

  const password = passwordClienteDefault();
  const hash = hashPassword(password);
  const upd = await client.query(
    `
    update operatori_cliente
    set password_hash = $2, attivo = true
    where lower(email) = $1
    returning id, email, nome
    `,
    [indirizzo, hash],
  );
  if (upd.rowCount === 0) throw erroreHttp(`nessun operatore con email ${indirizzo}`, 404);
  return { ok: true, password, operatore: upd.rows[0] };
}
