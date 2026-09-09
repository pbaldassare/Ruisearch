import { restConfig } from './config.js';

const GENERATED = new Set(['sezione', 'denominazione', 'persona_giuridica']);

export function rigaComeOggetto(spec, valori) {
  const out = {};
  for (let i = 0; i < spec.colonne.length; i++) {
    const [nome] = spec.colonne[i];
    if (GENERATED.has(nome) || nome === 'id') continue;
    const v = valori[i];
    if (v === null || v === undefined) continue;
    out[nome] = nome === 'oss' ? Number(v) : v;
  }
  return out;
}

export function restHeaders(extra = {}) {
  const { serviceRoleKey } = restConfig();
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
    ...extra,
  };
}

export async function restFetch(path, { method = 'GET', body, headers, prefer } = {}) {
  const { url } = restConfig();
  const extra = { ...headers };
  if (prefer) extra.Prefer = prefer;
  const risposta = await fetch(`${url}/rest/v1/${path.replace(/^\//, '')}`, {
    method,
    headers: restHeaders(extra),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await risposta.text();
  if (!risposta.ok) {
    throw new Error(`${method} ${path} → ${risposta.status}: ${text.slice(0, 500)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function restInsert(tabella, righe, { upsert = false } = {}) {
  if (righe.length === 0) return;
  const prefer = upsert
    ? 'resolution=merge-duplicates,return=minimal'
    : 'return=minimal';
  await restFetch(tabella, { method: 'POST', body: righe, prefer });
}

export async function restInsertaLotti(tabella, oggetti, { lotto = 400, upsert = false } = {}) {
  for (let i = 0; i < oggetti.length; i += lotto) {
    const pezzo = oggetti.slice(i, i + lotto);
    let tentativi = 0;
    for (;;) {
      try {
        await restInsert(tabella, pezzo, { upsert });
        break;
      } catch (errore) {
        tentativi += 1;
        if (tentativi >= 4) throw errore;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** tentativi));
      }
    }
    if ((i / lotto) % 10 === 0 || i + lotto >= oggetti.length) {
      const fatti = Math.min(i + lotto, oggetti.length);
      console.log(`  ${tabella.padEnd(30)} ${fatti}/${oggetti.length}`);
    }
  }
}
