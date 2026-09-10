#!/usr/bin/env node
// API di lettura per dashboard e software esterni.
// Dashboard: /overview …  Esterni: /v1/… con X-API-Key.

import http from 'node:http';
import { verificaAdmin } from '../src/auth-login.js';
import { closePool, withClient } from '../src/db.js';
import { interpretaDomanda } from '../src/domanda.js';
import { approfondisciConKimi, kimiPronta } from '../src/kimi-approfondisci.js';
import { DIMENSIONI, ESEMPI_DOMANDA } from '../src/dimensioni.js';
import { documentazionePubblica, specificaOpenApi } from '../src/documentazione.js';
import {
  cercaIntermediari,
  elencoCariche,
  elencoMandati,
  elencoSedi,
  overview,
  rete,
  scheda,
  storicoImport,
} from '../src/query.js';

const HOST = process.env.RUI_API_HOST || '127.0.0.1';
const PORT = Number(process.env.RUI_API_PORT || 8787);
const API_KEY = (process.env.RUI_API_KEY || '').trim();

function jsonDate(_chiave, valore) {
  return valore instanceof Date ? valore.toISOString() : valore;
}

function cors(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-api-key, authorization',
    ...extra,
  };
}

function invia(res, status, corpo) {
  const body = JSON.stringify(corpo, jsonDate);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...cors(),
  });
  res.end(body);
}

function queryDi(url) {
  const out = {};
  url.searchParams.forEach((valore, chiave) => {
    out[chiave] = valore;
  });
  return out;
}

function bearer(req) {
  const raw = req.headers.authorization || '';
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function chiaveOk(req, path) {
  if (!path.startsWith('/v1')) return true;
  if (!API_KEY) return true;
  const offerta = String(req.headers['x-api-key'] || bearer(req) || '').trim();
  return offerta === API_KEY;
}

async function corpoJson(req) {
  const pezzi = [];
  for await (const chunk of req) pezzi.push(chunk);
  if (pezzi.length === 0) return {};
  return JSON.parse(Buffer.concat(pezzi).toString('utf8') || '{}');
}

async function esegui(path, q, client, req) {
  if (path === '/overview' || path === '/v1/overview') return overview(client, { sezione: q.sezione });
  if (path === '/intermediari' || path === '/v1/intermediari') {
    return cercaIntermediari(client, {
      q: q.q, sezione: q.sezione, dopoNome: q.dopo_nome, dopoOss: q.dopo_oss, limite: q.limit,
    });
  }
  const schedaMatch = path.match(/^(?:\/v1)?\/intermediari\/([^/]+)$/);
  if (schedaMatch) return scheda(client, decodeURIComponent(schedaMatch[1]), { sezione: q.sezione });
  const reteMatch = path.match(/^(?:\/v1)?\/rete\/([^/]+)$/);
  if (reteMatch) return rete(client, decodeURIComponent(reteMatch[1]), { sezione: q.sezione });
  if (path === '/sedi' || path === '/v1/sedi') {
    return elencoSedi(client, {
      q: q.q, provincia: q.provincia, sezione: q.sezione, dopoOss: q.dopo_oss, limite: q.limit,
    });
  }
  if (path === '/mandati' || path === '/v1/mandati') {
    return elencoMandati(client, {
      q: q.q, sezione: q.sezione, dopoOss: q.dopo_oss, limite: q.limit,
    });
  }
  if (path === '/cariche' || path === '/v1/cariche') {
    return elencoCariche(client, {
      q: q.q, sezione: q.sezione, dopoOss: q.dopo_oss, limite: q.limit,
    });
  }
  if (path === '/import-runs' || path === '/v1/import-runs') return storicoImport(client, { limite: q.limit });
  if (path === '/query' || path === '/v1/query') {
    const testo = q.q || q.testo || '';
    if (req.method === 'POST' && !testo) {
      const corpo = await corpoJson(req);
      return interpretaDomanda(client, corpo.q || corpo.testo || '');
    }
    return interpretaDomanda(client, testo);
  }
  if (path === '/dimensioni' || path === '/v1/dimensioni') {
    return { dimensioni: DIMENSIONI, esempi: ESEMPI_DOMANDA };
  }
  const errore = new Error('non trovato');
  errore.statusCode = 404;
  throw errore;
}

async function gestisci(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors());
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const q = queryDi(url);
  const path = url.pathname.replace(/\/$/, '') || '/';

  if (path === '/health') {
    invia(res, 200, { ok: true });
    return;
  }
  if (path === '/auth/login' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    invia(res, 200, verificaAdmin(corpo.email, corpo.password));
    return;
  }
  if (path === '/query/ai' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    const out = await withClient((client) => approfondisciConKimi(client, corpo));
    invia(res, 200, out);
    return;
  }
  if (path === '/config') {
    invia(res, 200, {
      maps_key: (process.env.GOOGLE_MAPS_API_KEY || '').trim(),
      api_key_richiesta: Boolean(API_KEY),
      kimi_pronta: kimiPronta(),
    });
    return;
  }
  if (path === '/documentazione' || path === '/v1/documentazione') {
    invia(res, 200, documentazionePubblica());
    return;
  }
  if (path === '/openapi.json' || path === '/v1/openapi.json') {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || `${HOST}:${PORT}`;
    invia(res, 200, specificaOpenApi(`${proto}://${host}`));
    return;
  }

  if (
    req.method !== 'GET'
    && !(req.method === 'POST' && (path === '/query' || path === '/v1/query' || path === '/query/ai' || path === '/auth/login'))
  ) {
    invia(res, 405, { errore: 'metodo non ammesso' });
    return;
  }

  if (!chiaveOk(req, path)) {
    invia(res, 401, { errore: 'manca o non è valida X-API-Key' });
    return;
  }

  const risultato = await withClient((client) => esegui(path, q, client, req));
  invia(res, 200, risultato);
}

const server = http.createServer((req, res) => {
  gestisci(req, res).catch((errore) => {
    const status = errore.statusCode || (errore instanceof SyntaxError ? 400 : 500);
    invia(res, status, { errore: errore.message || 'errore interno' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Ruisearch API http://${HOST}:${PORT}`);
});

function chiudi() {
  server.close(() => {
    closePool().finally(() => process.exit(0));
  });
}

process.on('SIGINT', chiudi);
process.on('SIGTERM', chiudi);
