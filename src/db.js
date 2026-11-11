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
      // Il pooler Supabase in session mode ammette 15 connessioni per TUTTO il
      // progetto, condiviso con altre app (dealercrm, etideal): ne teniamo
      // poche. Le query in parallelo si mettono in coda sulle 4 disponibili.
      max: Number(process.env.DB_POOL_MAX || 4),
      // Aprire una connessione verso Supabase costa ~650 ms (TLS + pooler):
      // le teniamo aperte a lungo invece di chiuderle dopo 10 s di inattivita'.
      // 3 minuti: abbastanza per una sessione di lavoro, senza occupare a
      // lungo posti del pooler condiviso quando nessuno usa l'app.
      idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_MS || 3 * 60_000),
      keepAlive: true,
      // Il caricamento massivo tiene la connessione occupata a lungo.
      statement_timeout: 0,
      idle_in_transaction_session_timeout: 0,
      // Le tabelle vivono nello schema "ruisearch" del progetto Supabase
      // condiviso; pg_trgm sta in "extensions". Il codice usa nomi senza
      // prefisso: lo schema si fissa all'apertura della connessione.
      options: `-c search_path=${DB_SCHEMA},extensions,public`,
    });
    // Un client che cade (rete, pooler riavviato) non deve far crollare il server.
    pool.on('error', (errore) => console.error('connessione al database persa:', errore.message));
    conRiprova(pool);
  }
  return pool;
}

// Errori di rete passeggeri: DNS che non risponde, connessione rifiutata o
// interrotta. Su queste riproviamo invece di mostrare un errore all'utente.
const ERRORI_PASSEGGERI = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH',
]);
const TENTATIVI = 4;

function passeggero(errore) {
  const messaggio = errore?.message || '';
  return ERRORI_PASSEGGERI.has(errore?.code)
    || /Connection terminated unexpectedly/i.test(messaggio)
    // Pooler pieno per un attimo (altre app del progetto): si libera presto.
    || /EMAXCONNSESSION|max clients reached/i.test(messaggio);
}

/**
 * Riprova l'apertura di una connessione fino a 4 volte (0,3 s, 0,6 s, 1,2 s).
 * Quando l'app apre piu' connessioni insieme, il DNS di alcune reti ne fa
 * fallire qualcuna con ENOTFOUND anche se il nome esiste: il secondo
 * tentativo passa. Vale sia per pool.connect() sia per pool.query().
 */
function conRiprova(p) {
  const connettiOriginale = p.connect.bind(p);
  const prova = async (n = 1) => {
    try {
      return await connettiOriginale();
    } catch (errore) {
      if (n >= TENTATIVI || !passeggero(errore)) throw errore;
      await new Promise((ok) => setTimeout(ok, 300 * 2 ** (n - 1)));
      return prova(n + 1);
    }
  };
  p.connect = (callback) => {
    if (typeof callback !== 'function') return prova();
    // pool.query() usa la forma con callback: (errore, client, rilascia).
    prova().then(
      (client) => callback(undefined, client, (err) => client.release(err)),
      (errore) => callback(errore),
    );
    return undefined;
  };
}

/**
 * Apre in anticipo alcune connessioni, cosi' le prime richieste dopo
 * l'avvio del server non pagano l'apertura.
 */
export async function riscaldaPool(quante = 2) {
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
