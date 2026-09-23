#!/usr/bin/env node
// Produzione: statico da web/dist + proxy /api verso l'API Node.

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'web/dist');
const API = process.env.RUI_API_URL || 'http://127.0.0.1:8787';
const HOST = process.env.RUI_WEB_HOST || '0.0.0.0';
const PORT = Number(process.env.RUI_WEB_PORT || 80);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function inviaFile(res, file, status = 200) {
  const tipo = MIME[extname(file)] || 'application/octet-stream';
  res.writeHead(status, { 'content-type': tipo, 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}

async function proxyApi(req, res) {
  const dest = new URL(req.url.replace(/^\/api/, '') || '/', API);
  const headers = { ...req.headers, host: dest.host };
  delete headers.connection;
  const inoltro = await fetch(dest, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
    duplex: 'half',
    redirect: 'manual',
  });
  const out = { 'cache-control': 'no-store' };
  inoltro.headers.forEach((valore, chiave) => {
    if (chiave === 'transfer-encoding' || chiave === 'connection') return;
    out[chiave] = valore;
  });
  res.writeHead(inoltro.status, out);
  const buf = Buffer.from(await inoltro.arrayBuffer());
  res.end(buf);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      proxyApi(req, res).catch((err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ errore: err.message || 'API non raggiungibile' }));
        }
      });
      return;
    }
    let pulito = url.pathname;
    try {
      pulito = decodeURIComponent(pulito);
    } catch {
      pulito = '/';
    }
    pulito = pulito.replace(/\.\./g, '');
    const candidato = join(dist, pulito === '/' ? 'index.html' : pulito.replace(/^\//, ''));
    if (existsSync(candidato) && statSync(candidato).isFile()) {
      inviaFile(res, candidato);
      return;
    }
    inviaFile(res, join(dist, 'index.html'));
  } catch {
    if (!res.headersSent) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('bad request');
    }
  }
});

if (!existsSync(join(dist, 'index.html'))) {
  console.error('Manca web/dist. Esegui npm run build.');
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`Ruisearch web http://${HOST}:${PORT} → API ${API}`);
});
