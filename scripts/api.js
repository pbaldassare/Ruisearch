#!/usr/bin/env node
// Server Node delle API per lo sviluppo locale (online le API sono la Edge
// Function di Supabase). La logica sta in src/app.js, la stessa della Edge;
// qui c'e' solo l'adattamento a node:http e l'aggiornamento eseguito in locale.
//
// Attenzione: il database e' uno solo, quello di produzione. Tutto quello che
// si fa da qui (utenti, chiavi API, aggiornamento del registro) vale online.

import http from 'node:http';
import { Readable } from 'node:stream';
import { creaApp } from '../src/app.js';
import { closePool, riscaldaPool, withClient } from '../src/db.js';
import { chiudiCorseScadute, eseguiImport } from '../src/importa.js';

// Solo questo computer: Vite inoltra /api qui. Online le API non passano da questo server.
const HOST = process.env.RUI_API_HOST || '127.0.0.1';
const PORT = Number(process.env.RUI_API_PORT || 8787);

// Aggiornamento del registro: parte solo su richiesta dell'admin, uno alla
// volta, dentro questo processo. Lo stato vive in memoria.
const aggiornamento = {
  id: null,
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

const statoAggiornamento = () => ({ ...aggiornamento, remoto: false, log: aggiornamento.log.slice(-30) });

function avviaAggiornamento({ forza = false } = {}) {
  if (aggiornamento.in_corso) {
    const errore = new Error('un aggiornamento è già in corso');
    errore.statusCode = 409;
    throw errore;
  }
  Object.assign(aggiornamento, {
    id: null,
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
    alAvvio: (id) => {
      aggiornamento.id = id;
    },
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
      // 'incompleto': il registro e' stato caricato, e' mancata solo la rete o le statistiche.
      aggiornamento.esito = errore.esito || 'fallito';
      aggiornamento.errore = errore.message || 'errore sconosciuto';
      annota(`errore: ${aggiornamento.errore}`);
    })
    .finally(() => {
      aggiornamento.in_corso = false;
      aggiornamento.concluso_il = new Date().toISOString();
    });
  return statoAggiornamento();
}

const app = creaApp({
  aggiornamento: {
    stato: async () => statoAggiornamento(),
    avvia: async (opzioni) => avviaAggiornamento(opzioni),
  },
});

/** node:http -> Request standard -> app -> Response -> node:http */
async function gestisci(req, res) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v != null) headers.set(k, v);
  }
  const conCorpo = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`), {
    method: req.method,
    headers,
    body: conCorpo ? Readable.toWeb(req) : undefined,
    duplex: conCorpo ? 'half' : undefined,
  });
  const response = await app(request);
  const uscita = {};
  response.headers.forEach((v, k) => {
    uscita[k] = v;
  });
  res.writeHead(response.status, uscita);
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = http.createServer((req, res) => {
  gestisci(req, res).catch((errore) => {
    console.error(req.method, req.url, errore);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ errore: 'errore interno' }));
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Ruisearch API http://${HOST}:${PORT}`);
  riscaldaPool().catch((errore) => console.error('apertura connessioni non riuscita:', errore.message));
  // Il database e' quello di produzione: un aggiornamento "in corso" puo' essere
  // quello di GitHub Actions che sta girando adesso. Si chiudono solo quelli
  // oltre i 45 minuti, che di sicuro non sono piu' vivi.
  withClient((client) => chiudiCorseScadute(client, 'interrotto: nessuna notizia da oltre 45 minuti')).catch(
    (errore) => console.error('pulizia import_runs non riuscita:', errore.message),
  );
});

async function chiudi() {
  // Un aggiornamento avviato da questo processo e non finito: la sua riga si chiude qui.
  if (aggiornamento.in_corso && aggiornamento.id) {
    await withClient((client) =>
      client.query(
        `update import_runs set esito = 'fallito', concluso_il = now(),
           errore = coalesce(errore, 'interrotto dalla chiusura del server locale')
         where id = $1 and esito = 'in corso'`,
        [aggiornamento.id],
      ),
    ).catch((errore) => console.error('chiusura import_runs non riuscita:', errore.message));
    // closePool aspetterebbe la connessione dell'import ancora aperta.
    process.exit(0);
  }
  server.close(() => {
    closePool().finally(() => process.exit(0));
  });
}

process.on('SIGINT', chiudi);
process.on('SIGTERM', chiudi);
