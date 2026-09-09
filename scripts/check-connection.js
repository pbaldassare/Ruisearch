#!/usr/bin/env node
import { buildConnectionString, redact } from '../src/config.js';
import { withClient, closePool } from '../src/db.js';

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
    const tables = await client.query(`
      select count(*)::int as n
      from information_schema.tables
      where table_schema = 'public'
    `);
    const canWrite = await client.query(`
      select has_schema_privilege(current_user, 'public', 'CREATE') as ok
    `);
    return { ...rows[0], tabelle: tables.rows[0].n, scrittura: canWrite.rows[0].ok };
  });

  console.log(`Connesso in ${Date.now() - started} ms`);
  console.log(`  database        ${info.database}`);
  console.log(`  utente          ${info.utente}`);
  console.log(`  postgres        ${info.postgres}`);
  console.log(`  server          ${info.server}`);
  console.log(`  tabelle public  ${info.tabelle}`);
  console.log(`  CREATE su public ${info.scrittura ? 'consentito' : 'NEGATO'}`);

  if (!info.scrittura) {
    console.error('\nL\'utente non puo\' creare tabelle: il loader non potrebbe scrivere.');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`\nConnessione fallita: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closePool);
