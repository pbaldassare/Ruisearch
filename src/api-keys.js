// Chiavi API per software esterni su /v1. Si generano dalla pagina
// Documentazione (admin); nel database resta solo l'hash SHA-256, la chiave
// in chiaro si vede una volta sola, alla creazione.

import { createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';

const hash = (chiave) => createHash('sha256').update(chiave).digest('hex');

function erroreHttp(messaggio, status) {
  const errore = new Error(messaggio);
  errore.statusCode = status;
  return errore;
}

export async function elencoChiavi(client) {
  const { rows } = await client.query(
    `select id, nome, prefisso, creata_il, ultimo_uso, revocata_il
     from api_keys
     order by revocata_il nulls first, id desc`,
  );
  return { chiavi: rows };
}

export async function creaChiave(client, { nome } = {}) {
  const etichetta = String(nome || '').trim().slice(0, 80);
  if (!etichetta) throw erroreHttp('indica un nome per la chiave (es. il software che la usa)', 400);
  const chiave = `rui_${randomBytes(32).toString('base64url')}`;
  const { rows } = await client.query(
    `insert into api_keys (nome, prefisso, hash) values ($1, $2, $3)
     returning id, nome, prefisso, creata_il, ultimo_uso, revocata_il`,
    [etichetta, chiave.slice(0, 10), hash(chiave)],
  );
  return { ok: true, chiave, voce: rows[0] };
}

export async function revocaChiave(client, { id } = {}) {
  const numero = Number(id);
  if (!Number.isInteger(numero) || numero <= 0) throw erroreHttp('chiave non valida', 400);
  const { rows } = await client.query(
    `update api_keys set revocata_il = now()
     where id = $1 and revocata_il is null
     returning id, nome`,
    [numero],
  );
  if (!rows[0]) throw erroreHttp('chiave non trovata o già revocata', 404);
  return { ok: true, voce: rows[0] };
}

// Oltre questo numero di chiamate nello stesso minuto una chiave riceve 429: un software che va in loop
// o una chiave finita in mani sbagliate non possono martellare il database condiviso.
export const RICHIESTE_MINUTO = 120;

/** L'id della chiave se esiste e non è revocata (e ne aggiorna l'ultimo uso), altrimenti false; 429 oltre il limite al minuto. */
export async function chiaveValida(client, offerta) {
  // Le chiavi generate sono lunghe 47 caratteri: niente query per input assurdi.
  if (!offerta || Buffer.byteLength(offerta) > 200) return false;
  // ponytail: una UPDATE per ogni chiamata /v1 (ultimo uso + contatore del minuto); basta finché il traffico è da gestionale.
  const { rows } = await client.query(
    `update api_keys set
       ultimo_uso = now(),
       finestra_il = case when finestra_il > now() - interval '1 minute' then finestra_il else now() end,
       richieste_finestra = case when finestra_il > now() - interval '1 minute' then richieste_finestra + 1 else 1 end
     where hash = $1 and revocata_il is null
     returning id, richieste_finestra`,
    [hash(offerta)],
  );
  if (!rows[0]) return false;
  if (rows[0].richieste_finestra > RICHIESTE_MINUTO) {
    throw erroreHttp(`troppe richieste: al massimo ${RICHIESTE_MINUTO} al minuto per chiave, riprova tra poco.`, 429);
  }
  return Number(rows[0].id);
}
