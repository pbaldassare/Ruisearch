import pg from 'pg';
import { buildConnectionString } from './config.js';

const { Pool, types } = pg;

// DATE resta 'YYYY-MM-DD': il driver altrimenti fa un Date a mezzanotte locale
// che in JSON diventa il giorno prima (UTC).
types.setTypeParser(types.builtins.DATE, (valore) => valore);

let pool;

const DB_SCHEMA = /^[a-z_][a-z0-9_]*$/.test(process.env.DB_SCHEMA || '')
  ? process.env.DB_SCHEMA
  : 'ruisearch';

/**
 * Pool condiviso verso Supabase. Supabase impone TLS ma presenta un
 * certificato firmato da una CA che il client non ha in store, quindi il
 * canale resta cifrato senza verifica del certificato.
 */
export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: buildConnectionString(),
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX || 8),
      // Aprire una connessione verso Supabase costa ~650 ms (TLS + pooler):
      // le teniamo aperte a lungo invece di chiuderle dopo 10 s di inattivita'.
      idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_MS || 10 * 60_000),
      keepAlive: true,
      // Il caricamento massivo tiene la connessione occupata a lungo.
      statement_timeout: 0,
      idle_in_transaction_session_timeout: 0,
      // Le tabelle vivono nello schema "ruisearch" del progetto Supabase
      // condiviso; pg_trgm sta in "extensions". Il codice usa nomi senza
      // prefisso: lo schema si fissa all'apertura della connessione.
      options: `-c search_path=${DB_SCHEMA},extensions,public`,
    });
  }
  return pool;
}

/**
 * Apre in anticipo alcune connessioni, cosi' le prime richieste dopo
 * l'avvio del server non pagano l'apertura.
 */
export async function riscaldaPool(quante = 4) {
  const p = getPool();
  const client = await Promise.all(Array.from({ length: quante }, () => p.connect()));
  await Promise.all(client.map((c) => c.query('select 1')));
  for (const c of client) c.release();
}

/** Esegue fn con un client dedicato e lo restituisce sempre al pool. */
export async function withClient(fn) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Esegue fn dentro una transazione, con rollback su errore. */
export async function withTransaction(fn) {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
