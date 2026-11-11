#!/usr/bin/env node
// API di lettura per dashboard e software esterni.
// Dashboard: /overview …  Esterni: /v1/… con X-API-Key.

import http from 'node:http';
import { verificaAccesso } from '../src/auth-login.js';
import {
  aggiungiBrokerSorvegliato,
  controlloRuiCliente,
  estrattoCliente,
  fidelizzazioneCliente,
  marcaAlertLetto,
  rimuoviBrokerSorvegliato,
} from '../src/cliente.js';
import { cercaMercato, schedaMercato, storicoMercato } from '../src/mercato.js';
import {
  aggiornaStatoOpportunity,
  arricchisciOpportunity,
  elencoOpportunity,
  salvaOpportunity,
} from '../src/opportunity.js';
import { closePool, getPool, riscaldaPool, withClient } from '../src/db.js';

// Le richieste usano il pool: ogni query prende una connessione solo per il
// tempo che le serve. Tenerne una fissa per tutta la richiesta bloccava il
// server quando le query interne in parallelo chiedevano altre connessioni
// (e le chiamate all'AI la occupavano per decine di secondi).
const conDb = (fn) => fn(getPool());
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
import {
  creaUtenteCliente,
  eliminaOperatore,
  elencoUtentiCliente,
  impostaAttivoOperatore,
  reimpostaPasswordUtente,
} from '../src/utenti.js';
import { eseguiImport } from '../src/importa.js';

const HOST = process.env.RUI_API_HOST || '0.0.0.0';
const PORT = Number(process.env.RUI_API_PORT || 8787);
const API_KEY = (process.env.RUI_API_KEY || '').trim();

// Aggiornamento del registro: parte solo su richiesta dell'admin, uno alla
// volta. Lo stato vive in memoria e la pagina lo legge a intervalli.
const aggiornamento = {
  in_corso: false,
  fase: null,
  percentuale: null,
  messaggio: null,
  iniziato_il: null,
  concluso_il: null,
  esito: null,
  errore: null,
  log: [],
};

function statoAggiornamento() {
  return { ...aggiornamento, log: aggiornamento.log.slice(-30) };
}

function avviaAggiornamento({ forza = false } = {}) {
  if (aggiornamento.in_corso) {
    const errore = new Error('un aggiornamento è già in corso');
    errore.statusCode = 409;
    throw errore;
  }
  Object.assign(aggiornamento, {
    in_corso: true,
    fase: 'download',
    percentuale: 0,
    messaggio: 'avvio',
    iniziato_il: new Date().toISOString(),
    concluso_il: null,
    esito: null,
    errore: null,
    log: [],
  });
  const annota = (riga) => {
    aggiornamento.log.push(`${new Date().toISOString().slice(11, 19)} ${riga}`);
    if (aggiornamento.log.length > 200) aggiornamento.log.shift();
  };
  eseguiImport({
    forza,
    log: annota,
    avanzamento: ({ fase, percentuale, messaggio }) => {
      aggiornamento.fase = fase;
      aggiornamento.percentuale = percentuale;
      if (messaggio) aggiornamento.messaggio = messaggio;
    },
  })
    .then((esito) => {
      aggiornamento.esito = esito.esito;
    })
    .catch((errore) => {
      console.error('aggiornamento registro fallito:', errore);
      aggiornamento.esito = 'fallito';
      aggiornamento.errore = errore.message || 'errore sconosciuto';
      annota(`errore: ${aggiornamento.errore}`);
    })
    .finally(() => {
      aggiornamento.in_corso = false;
      aggiornamento.concluso_il = new Date().toISOString();
    });
  return statoAggiornamento();
}

function jsonDate(_chiave, valore) {
  return valore instanceof Date ? valore.toISOString() : valore;
}

function cors(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
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

// CSV per Excel in italiano: separatore punto e virgola e BOM UTF-8.
function cellaCsv(valore) {
  if (valore == null) return '';
  const testo = valore instanceof Date ? valore.toISOString() : String(valore);
  return /[";\n\r]/.test(testo) ? `"${testo.replaceAll('"', '""')}"` : testo;
}

function inviaCsv(res, nome, righe) {
  const colonne = righe.length ? Object.keys(righe[0]) : [];
  const corpo = [colonne.join(';'), ...righe.map((r) => colonne.map((c) => cellaCsv(r[c])).join(';'))].join('\r\n');
  const data = new Date().toISOString().slice(0, 10);
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="ruisearch-${nome}-${data}.csv"`,
    'cache-control': 'no-store',
    ...cors(),
  });
  res.end('\ufeff' + corpo);
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
  const esporta = q.formato === 'csv';
  if (path === '/intermediari' || path === '/v1/intermediari') {
    return cercaIntermediari(client, {
      q: q.q, sezione: q.sezione, dopoNome: q.dopo_nome, dopoOss: q.dopo_oss, limite: q.limit, esporta,
    });
  }
  const schedaMatch = path.match(/^(?:\/v1)?\/intermediari\/([^/]+)$/);
  if (schedaMatch) return scheda(client, decodeURIComponent(schedaMatch[1]), { sezione: q.sezione });
  const reteMatch = path.match(/^(?:\/v1)?\/rete\/([^/]+)$/);
  if (reteMatch) return rete(client, decodeURIComponent(reteMatch[1]), { sezione: q.sezione });
  if (path === '/sedi' || path === '/v1/sedi') {
    return elencoSedi(client, {
      q: q.q || q.provincia, sezione: q.sezione, dopoOss: q.dopo_oss, limite: q.limit, esporta,
    });
  }
  if (path === '/mandati' || path === '/v1/mandati') {
    return elencoMandati(client, {
      q: q.q, sezione: q.sezione, dopoOss: q.dopo_oss, limite: q.limit, esporta,
    });
  }
  if (path === '/cariche' || path === '/v1/cariche') {
    return elencoCariche(client, {
      q: q.q, sezione: q.sezione, dopoOss: q.dopo_oss, limite: q.limit, esporta,
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
  if (path === '/cliente/estratto') return estrattoCliente(client, q.rui);
  if (path === '/cliente/fidelizzazione') return fidelizzazioneCliente(client, q.rui);
  if (path === '/cliente/controllo') return controlloRuiCliente(client, q.rui);
  if (path === '/cliente/opportunity') return elencoOpportunity(client, q.rui);
  if (path === '/cliente/mercato') {
    return cercaMercato(client, {
      zona: q.zona, compagnia: q.compagnia, sezione: q.sezione, limite: q.limit, q: q.q,
      rui_cliente: q.rui,
    });
  }
  if (path === '/cliente/mercato/storico') return storicoMercato(client, q.rui, q.id);
  if (path === '/cliente/mercato/scheda') return schedaMercato(client, q.rui);
  if (path === '/admin/utenti') return elencoUtentiCliente(client);
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
  let path = url.pathname.replace(/\/$/, '') || '/';
  if (path === '/api') path = '/';
  else if (path.startsWith('/api/')) path = path.slice(4) || '/';

  if (path === '/health') {
    invia(res, 200, { ok: true });
    return;
  }
  if (path === '/auth/login' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    const esito = await conDb((client) => verificaAccesso(client, corpo.email, corpo.password));
    invia(res, 200, esito);
    return;
  }
  if (path === '/cliente/sorveglianza' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    const out = await conDb((client) =>
      aggiungiBrokerSorvegliato(client, corpo.rui || corpo.rui_cliente, corpo.rui_broker || corpo.broker),
    );
    invia(res, 200, out);
    return;
  }
  if (path === '/cliente/sorveglianza' && req.method === 'DELETE') {
    const out = await conDb((client) =>
      rimuoviBrokerSorvegliato(client, q.rui, q.broker || q.rui_broker),
    );
    invia(res, 200, out);
    return;
  }
  if (path === '/admin/utenti' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    const out = await conDb((client) => creaUtenteCliente(client, corpo));
    invia(res, 200, out);
    return;
  }
  if (path === '/admin/aggiornamento' && req.method === 'GET') {
    invia(res, 200, statoAggiornamento());
    return;
  }
  if (path === '/admin/aggiornamento' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    invia(res, 202, avviaAggiornamento({ forza: corpo.forza === true }));
    return;
  }
  if (path === '/admin/utenti/stato' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    const out = await conDb((client) => impostaAttivoOperatore(client, corpo));
    invia(res, 200, out);
    return;
  }
  if (path === '/admin/utenti/elimina' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    const out = await conDb((client) => eliminaOperatore(client, corpo));
    invia(res, 200, out);
    return;
  }
  if (path === '/admin/utenti/password' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    const out = await conDb((client) => reimpostaPasswordUtente(client, corpo.email));
    invia(res, 200, out);
    return;
  }
  if (path === '/cliente/opportunity' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    const out = await conDb((client) => salvaOpportunity(client, corpo));
    invia(res, 200, out);
    return;
  }
  if (path === '/cliente/opportunity/stato' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    const out = await conDb((client) => aggiornaStatoOpportunity(client, corpo));
    invia(res, 200, out);
    return;
  }
  if (path === '/cliente/opportunity/arricchisci' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    const out = await conDb((client) => arricchisciOpportunity(client, corpo));
    invia(res, 200, out);
    return;
  }
  if (path === '/cliente/alert' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    const out = await conDb((client) =>
      marcaAlertLetto(client, corpo.rui || corpo.rui_cliente, { id: corpo.id, tutti: corpo.tutti }),
    );
    invia(res, 200, out);
    return;
  }
  if (path === '/query/ai' && req.method === 'POST') {
    const corpo = await corpoJson(req);
    const out = await conDb((client) => approfondisciConKimi(client, corpo));
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
    && !(req.method === 'POST' && (
      path === '/query'
      || path === '/v1/query'
      || path === '/query/ai'
      || path === '/auth/login'
      || path === '/cliente/sorveglianza'
      || path === '/cliente/alert'
      || path === '/admin/utenti'
      || path === '/admin/utenti/password'
      || path === '/cliente/opportunity'
      || path === '/cliente/opportunity/stato'
      || path === '/cliente/opportunity/arricchisci'
    ))
    && !(req.method === 'DELETE' && path === '/cliente/sorveglianza')
  ) {
    invia(res, 405, { errore: 'metodo non ammesso' });
    return;
  }

  if (!chiaveOk(req, path)) {
    invia(res, 401, { errore: 'manca o non è valida X-API-Key' });
    return;
  }

  const risultato = await conDb((client) => esegui(path, q, client, req));
  if (q.formato === 'csv' && Array.isArray(risultato?.items)) {
    inviaCsv(res, path.split('/').filter(Boolean).pop() || 'export', risultato.items);
    return;
  }
  invia(res, 200, risultato);
}

const server = http.createServer((req, res) => {
  gestisci(req, res).catch((errore) => {
    const status = errore.statusCode || (errore instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error(req.method, req.url, errore);
    invia(res, status, { errore: errore.message || 'errore interno' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Ruisearch API http://${HOST}:${PORT}`);
  riscaldaPool().catch((errore) => console.error('apertura connessioni non riuscita:', errore.message));
  // Un aggiornamento "in corso" all'avvio e' rimasto orfano di un riavvio.
  withClient((client) =>
    client.query(
      `update import_runs
       set esito = 'fallito', concluso_il = now(),
           errore = coalesce(errore, 'interrotto dal riavvio del server')
       where esito = 'in corso'`,
    ),
  ).catch((errore) => console.error('pulizia import_runs non riuscita:', errore.message));
});

function chiudi() {
  server.close(() => {
    closePool().finally(() => process.exit(0));
  });
}

process.on('SIGINT', chiudi);
process.on('SIGTERM', chiudi);
