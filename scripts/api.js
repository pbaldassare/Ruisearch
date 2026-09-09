#!/usr/bin/env node
// API di sola lettura per la dashboard. Stesse query di `npm run cerca`.
// In ascolto su 127.0.0.1:8787 (niente chiavi nel browser).

import http from 'node:http';
import { closePool, withClient } from '../src/db.js';
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

function jsonDate(_chiave, valore) {
  return valore instanceof Date ? valore.toISOString() : valore;
}

function invia(res, status, corpo) {
  const body = JSON.stringify(corpo, jsonDate);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
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

async function gestisci(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    invia(res, 405, { errore: 'solo GET' });
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const q = queryDi(url);
  const path = url.pathname.replace(/\/$/, '') || '/';

  if (path === '/health') {
    invia(res, 200, { ok: true });
    return;
  }

  const risultato = await withClient(async (client) => {
    if (path === '/overview') return overview(client, { sezione: q.sezione });
    if (path === '/intermediari') {
      return cercaIntermediari(client, {
        q: q.q,
        sezione: q.sezione,
        dopoNome: q.dopo_nome,
        dopoOss: q.dopo_oss,
        limite: q.limit,
      });
    }
    const schedaMatch = path.match(/^\/intermediari\/([^/]+)$/);
    if (schedaMatch) return scheda(client, decodeURIComponent(schedaMatch[1]), { sezione: q.sezione });
    const reteMatch = path.match(/^\/rete\/([^/]+)$/);
    if (reteMatch) return rete(client, decodeURIComponent(reteMatch[1]), { sezione: q.sezione });
    if (path === '/sedi') {
      return elencoSedi(client, {
        q: q.q,
        provincia: q.provincia,
        sezione: q.sezione,
        dopoOss: q.dopo_oss,
        limite: q.limit,
      });
    }
    if (path === '/mandati') {
      return elencoMandati(client, {
        q: q.q,
        sezione: q.sezione,
        dopoOss: q.dopo_oss,
        limite: q.limit,
      });
    }
    if (path === '/cariche') {
      return elencoCariche(client, {
        q: q.q,
        sezione: q.sezione,
        dopoOss: q.dopo_oss,
        limite: q.limit,
      });
    }
    if (path === '/import-runs') return storicoImport(client, { limite: q.limit });
    const errore = new Error('non trovato');
    errore.statusCode = 404;
    throw errore;
  });

  invia(res, 200, risultato);
}

const server = http.createServer((req, res) => {
  gestisci(req, res).catch((errore) => {
    const status = errore.statusCode || 500;
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
