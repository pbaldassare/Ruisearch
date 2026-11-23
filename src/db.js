import pg from 'pg';
import { buildConnectionString } from './config.js';

const { Pool, types } = pg;

// DATE resta 'YYYY-MM-DD': il driver altrimenti fa un Date a mezzanotte locale
// che in JSON diventa il giorno prima (UTC).
types.setTypeParser(types.builtins.DATE, (valore) => valore);

let pool;
let suEdge = false;

/**
 * Da chiamare all'avvio della Edge Function, prima della prima query:
 * connessioni inattive chiuse dopo 30 s (il ruolo ruisearch_api ne ha 20 in
 * tutto, da dividere fra le istanze) e solo DATABASE_URL, senza ripiegare
 * sull'utente postgres di SUPABASE_DB_URL.
 */
export function modalitaEdge() {
  suEdge = true;
}

const DB_SCHEMA = /^[a-z_][a-z0-9_]*$/.test(process.env.DB_SCHEMA || '')
  ? process.env.DB_SCHEMA
  : 'ruisearch';

// Certificato radice di Supabase ("Supabase Root 2021 CA", scade il 26/04/2031), lo stesso di
// Dashboard > Database > SSL: firma sia il database diretto sia il pooler. Con questo il client
// verifica di parlare davvero con Supabase invece di accettare qualunque certificato.
const SUPABASE_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;

/** Pool condiviso verso Supabase, in TLS con verifica del certificato. */
export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: buildConnectionString({ edge: suEdge }),
      ssl: { ca: SUPABASE_CA, rejectUnauthorized: true },
      // Il pooler Supabase in session mode ammette 15 connessioni per TUTTO il
      // progetto, condiviso con altre app (dealercrm, etideal): ne teniamo
      // poche. Le query in parallelo si mettono in coda sulle 4 disponibili.
      max: Number(process.env.DB_POOL_MAX || 4),
      // Aprire una connessione verso Supabase costa ~650 ms (TLS + pooler):
      // le teniamo aperte a lungo invece di chiuderle dopo 10 s di inattivita'.
      // 3 minuti: abbastanza per una sessione di lavoro, senza occupare a
      // lungo posti del pooler condiviso quando nessuno usa l'app. Sulla Edge
      // 30 s: ogni istanza ha il suo pool e i posti del ruolo sono 20.
      idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_MS || (suEdge ? 30_000 : 3 * 60_000)),
      keepAlive: true,
      // Il pooler e' condiviso con altre app (15 connessioni per tutto il progetto): una query non puo'
      // occuparne una per piu' di 30 s. L'import e la ricostruzione della rete tolgono il limite solo sulla
      // loro connessione (withClientSenzaLimite).
      statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30_000),
      // Mentre l'import sostituisce le tabelle (TRUNCATE + COPY, circa mezzo minuto) una lettura
      // aspetterebbe fino al limite di 30 s tenendo occupata la connessione: dopo 3 s si arrende con
      // l'errore 55P03, che l'API trasforma in "Registro in aggiornamento, riprova tra un minuto".
      lock_timeout: Number(process.env.DB_LOCK_TIMEOUT_MS || 3_000),
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

/**
 * Come withClient, ma senza limite di tempo sulle query e senza lock_timeout
 * (il TRUNCATE dell'import aspetta che finiscano le letture in corso): per
 * l'import del registro e la ricostruzione della rete.
 */
export async function withClientSenzaLimite(fn) {
  const client = await getPool().connect();
  let rotta;
  try {
    await client.query('set statement_timeout = 0');
    await client.query('set lock_timeout = 0');
    return await fn(client);
  } finally {
    // La connessione torna al pool coi limiti normali. Se non risponde piu' la
    // si scarta, e con lei un eventuale lock rimasto (vedi importa.js).
    await client
      .query('reset statement_timeout; reset lock_timeout')
      .catch((errore) => {
        rotta = errore;
      });
    client.release(rotta);
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
