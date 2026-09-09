import pg from 'pg';
import { buildConnectionString } from './config.js';

const { Pool } = pg;

let pool;

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
      max: Number(process.env.DB_POOL_MAX || 4),
      // Il caricamento massivo tiene la connessione occupata a lungo.
      statement_timeout: 0,
      idle_in_transaction_session_timeout: 0,
    });
  }
  return pool;
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
