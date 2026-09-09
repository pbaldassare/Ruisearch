import { existsSync } from 'node:fs';

// Node 22 legge il .env solo con --env-file; lo carichiamo a mano cosi' gli
// script funzionano anche se invocati direttamente con `node`.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const REQUIRED_HINT =
  'Copia .env.example in .env e valorizza SUPABASE_DB_PASSWORD (oppure DATABASE_URL).';

/**
 * Costruisce la connection string verso il database Supabase.
 * DATABASE_URL, se presente, vince su tutto il resto.
 */
export function buildConnectionString() {
  const explicit = process.env.DATABASE_URL?.trim();
  if (explicit) return explicit;

  const ref = process.env.SUPABASE_PROJECT_REF?.trim();
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const mode = (process.env.SUPABASE_DB_MODE || 'direct').trim();

  if (!ref) throw new Error(`SUPABASE_PROJECT_REF non impostata. ${REQUIRED_HINT}`);
  if (!password) throw new Error(`SUPABASE_DB_PASSWORD non impostata. ${REQUIRED_HINT}`);

  const secret = encodeURIComponent(password);

  if (mode === 'pooler') {
    const region = (process.env.SUPABASE_REGION || 'eu-west-1').trim();
    // Session mode sulla 5432: a differenza della 6543 supporta COPY e
    // transazioni lunghe, che servono al caricamento massivo.
    return `postgresql://postgres.${ref}:${secret}@aws-0-${region}.pooler.supabase.com:5432/postgres`;
  }

  if (mode !== 'direct') {
    throw new Error(`SUPABASE_DB_MODE non valida: "${mode}". Usa "direct" o "pooler".`);
  }

  return `postgresql://postgres:${secret}@db.${ref}.supabase.co:5432/postgres`;
}

/** La stessa stringa con la password oscurata, per log e messaggi d'errore. */
export function redact(connectionString) {
  return connectionString.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@');
}
