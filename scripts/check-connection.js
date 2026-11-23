#!/usr/bin/env node
import { buildConnectionString, redact } from '../src/config.js';
import { withClient, closePool } from '../src/db.js';

// Lo stesso schema che usa src/db.js per il search_path.
const SCHEMA = /^[a-z_][a-z0-9_]*$/.test(process.env.DB_SCHEMA || '') ? process.env.DB_SCHEMA : 'ruisearch';

async function main() {
  const target = redact(buildConnectionString());
  console.log(`Connessione a ${target}`);

  const started = Date.now();
  const info = await withClient(async (client) => {
    const { rows } = await client.query(`
      select current_database()               as database,
             current_user                     as utente,
             version()                        as versione,
             inet_server_addr()::text         as server,
             current_setting('server_version') as postgres
    `);
    const tables = await client.query(
      `select count(*)::int as n from information_schema.tables where table_schema = $1`,
      [SCHEMA],
    );
    // L'import svuota e ricarica le tabelle del registro: servono TRUNCATE e INSERT.
    const carica = await client.query(
      `select case when to_regclass(format('%I.intermediari', $1::text)) is null then false
              else has_table_privilege(format('%I.intermediari', $1::text), 'TRUNCATE')
               and has_table_privilege(format('%I.intermediari', $1::text), 'INSERT') end as ok`,
      [SCHEMA],
    );
    return { ...rows[0], tabelle: tables.rows[0].n, caricamento: carica.rows[0].ok };
  });

  console.log(`Connesso in ${Date.now() - started} ms`);
  console.log(`  database        ${info.database}`);
  console.log(`  utente          ${info.utente}`);
  console.log(`  postgres        ${info.postgres}`);
  console.log(`  server          ${info.server}`);
  console.log(`  tabelle ${SCHEMA}  ${info.tabelle}`);
  console.log(`  import registro ${info.caricamento ? 'consentito' : 'NEGATO'}`);

  if (!info.caricamento) {
    console.error(
      `\nL'utente non puo' svuotare e ricaricare ${SCHEMA}.intermediari: l'import non potrebbe scrivere. ` +
        "(E' normale col ruolo ruisearch_api delle API: l'import usa l'utente postgres.)",
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`\nConnessione fallita: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closePool);
