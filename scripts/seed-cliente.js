#!/usr/bin/env node
// Crea/aggiorna il primo cliente: Consulbrokers SPA (sez. B) e il suo operatore.

import { readFileSync } from 'node:fs';
import { closePool, withClient } from '../src/db.js';
import { hashPassword } from '../src/password.js';

const RUI = 'B000778092';
const EMAIL = 'pbaldassare@consulbrokers.it';
const PASSWORD = process.env.CLIENTE_CONSULBROKERS_PASSWORD || 'Leone123!';

async function main() {
  await withClient(async (client) => {
    await client.query(readFileSync('db/migrations/004_clienti.sql', 'utf8'));
    const anag = await client.query(
      `
      select numero_iscrizione_rui, denominazione, sezione
      from intermediari
      where numero_iscrizione_rui = $1 and sezione = 'B'
      order by inoperativo, oss
      limit 1
      `,
      [RUI],
    );
    const soggetto = anag.rows[0];
    if (!soggetto) throw new Error(`manca ${RUI} nel registro importato`);

    const cliente = await client.query(
      `
      insert into clienti (numero_iscrizione_rui, denominazione, sezione, attivo)
      values ($1, $2, $3, true)
      on conflict (numero_iscrizione_rui) do update
        set denominazione = excluded.denominazione,
            sezione = excluded.sezione,
            attivo = true
      returning id, numero_iscrizione_rui, denominazione
      `,
      [soggetto.numero_iscrizione_rui, soggetto.denominazione, soggetto.sezione],
    );
    const hash = hashPassword(PASSWORD);
    await client.query(
      `
      insert into operatori_cliente (cliente_id, email, password_hash, nome, attivo)
      values ($1, $2, $3, $4, true)
      on conflict (email) do update
        set cliente_id = excluded.cliente_id,
            password_hash = excluded.password_hash,
            nome = excluded.nome,
            attivo = true
      `,
      [cliente.rows[0].id, EMAIL, hash, 'Paolo Baldassare'],
    );
    console.log(`cliente ${cliente.rows[0].denominazione} ${cliente.rows[0].numero_iscrizione_rui}`);
    console.log(`operatore ${EMAIL}`);
  });
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(closePool);
