// API di Ruisearch, indipendenti dal runtime: riceve una Request standard e
// restituisce una Response. La usano sia il server Node (scripts/api.js) sia
// la Edge Function di Supabase (supabase/functions/ruisearch-api).
//
// Accessi:
//   pubblico  /health, /auth/login, /overview, /pubblico/cerca, /documentazione, /openapi.json
//   chiave    /v1/*  con X-API-Key (RUI_API_KEY), per software esterni
//   cliente   /cliente/*  con token; il RUI del cliente viene SOLO dal token
//   utente    /intermediari, /config  con token (admin o cliente)
//   admin     tutto il resto, solo con token admin

import './config.js';
import { cambiaPasswordCliente, verificaAccesso, verificaSessioneCliente } from './auth-login.js';
import { chiaveValida, creaChiave, elencoChiavi, revocaChiave } from './api-keys.js';
import {
  elencoArchivio, eliminaVoce, inserisciManuale, modificaVoce, registraRicerca, registraScheda,
} from './archivio.js';
import { creaToken, leggiToken } from './sessione.js';
import {
  aggiungiBrokerSorvegliato,
  controlloRuiCliente,
  estrattoCliente,
  fidelizzazioneCliente,
  marcaAlertLetto,
  rimuoviBrokerSorvegliato,
} from './cliente.js';
import { cercaMercato, schedaMercato, storicoMercato } from './mercato.js';
import {
  aggiornaStatoOpportunity,
  arricchisciOpportunity,
  elencoOpportunity,
  recapitiPerApi,
  salvaOpportunity,
} from './opportunity.js';
import { getPool } from './db.js';
import { interpretaDomanda } from './domanda.js';
import { aiPronta, approfondisci } from './ricerca-web.js';
import { DIMENSIONI, ESEMPI_DOMANDA } from './dimensioni.js';
import { documentazionePubblica, specificaOpenApi } from './documentazione.js';
import { cercaPubblica, overviewPubblica } from './pubblico.js';
import {
  cercaIntermediari,
  elencoCariche,
  elencoMandati,
  elencoSedi,
  rete,
  scheda,
  storicoImport,
} from './query.js';
import {
  creaUtenteCliente,
  eliminaOperatore,
  elencoUtentiCliente,
  impostaAttivoOperatore,
  reimpostaPasswordUtente,
} from './utenti.js';

const PUBBLICI = new Set(['/health', '/auth/login', '/overview', '/pubblico/cerca', '/documentazione', '/openapi.json']);

function livelloAccesso(path) {
  if (path === '/v1' || path.startsWith('/v1/')) return 'chiave';
  if (PUBBLICI.has(path)) return 'pubblico';
  if (path.startsWith('/cliente/')) return 'cliente';
  if (path === '/intermediari' || path === '/config') return 'utente';
  return 'admin';
}

function errore(messaggio, status) {
  const e = new Error(messaggio);
  e.statusCode = status;
  return e;
}

// CORS solo per /v1 (chiave API) e per le letture pubbliche: login, area cliente e admin li usa solo il sito
// stesso, che chiama /api dalla stessa origine e non ne ha bisogno.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, x-api-key, authorization',
};

function jsonDate(_chiave, valore) {
  return valore instanceof Date ? valore.toISOString() : valore;
}

function risposta(status, corpo) {
  return new Response(JSON.stringify(corpo, jsonDate), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });
}

// CSV per Excel in italiano: separatore punto e virgola e BOM UTF-8.
function cellaCsv(valore) {
  if (valore == null) return '';
  let testo = valore instanceof Date ? valore.toISOString() : String(valore);
  // Excel esegue come formula un testo che inizia con = + - @ (o tab/a capo): con l'apostrofo davanti resta testo.
  if (typeof valore === 'string' && /^[=+\-@\t\r]/.test(testo)) testo = `'${testo}`;
  return /[";\n\r]/.test(testo) ? `"${testo.replaceAll('"', '""')}"` : testo;
}

function rispostaCsv(nome, righe) {
  const colonne = righe.length ? Object.keys(righe[0]) : [];
  const corpo = [colonne.join(';'), ...righe.map((r) => colonne.map((c) => cellaCsv(r[c])).join(';'))].join('\r\n');
  const data = new Date().toISOString().slice(0, 10);
  return new Response('﻿' + corpo, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ruisearch-${nome}-${data}.csv"`,
      'cache-control': 'no-store',
      ...CORS,
    },
  });
}

/** Percorso senza i prefissi di Pages (/api) e di Supabase (/functions/v1/ruisearch-api). */
export function percorsoApi(pathname) {
  let path = pathname.replace(/\/+$/, '') || '/';
  path = path.replace(/^\/functions\/v1/, '').replace(/^\/ruisearch-api/, '');
  if (path === '/api') return '/';
  if (path.startsWith('/api/')) path = path.slice(4);
  return path || '/';
}

function bearer(request) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

async function corpoJson(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return {};
  const testo = await request.text();
  if (!testo) return {};
  try {
    return JSON.parse(testo);
  } catch {
    throw errore('corpo della richiesta non valido', 400);
  }
}

// Chiave Mistral presente e accettata da Mistral: verificata al massimo ogni 10 minuti per istanza.
let mistralVerifica = { ok: false, il: 0 };
async function mistralPronta() {
  const chiave = (process.env.MISTRAL_API_KEY || '').trim();
  if (!chiave) return false;
  if (Date.now() - mistralVerifica.il < 600_000) return mistralVerifica.ok;
  const r = await fetch('https://api.mistral.ai/v1/models', {
    headers: { authorization: `Bearer ${chiave}` },
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  mistralVerifica = { ok: Boolean(r?.ok), il: Date.now() };
  return mistralVerifica.ok;
}

/**
 * @param {object} opzioni
 * @param {{ stato: () => Promise<object>, avvia: (o: {forza: boolean}) => Promise<object> }} opzioni.aggiornamento
 */
export function creaApp({ aggiornamento }) {
  const db = () => getPool();

  async function gestisci(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const path = percorsoApi(url.pathname);
    const q = Object.fromEntries(url.searchParams.entries());
    const metodo = request.method;

    // --- controllo accessi ------------------------------------------------
    const livello = livelloAccesso(path);
    let sessione = null;
    let chiaveId = null;
    if (livello === 'chiave') {
      // Chiavi generate dalla pagina Documentazione; RUI_API_KEY resta valida se impostata.
      const offerta = (request.headers.get('x-api-key') || bearer(request)).trim();
      const daEnv = (process.env.RUI_API_KEY || '').trim();
      const daEnvOk = Boolean(offerta) && Boolean(daEnv) && offerta === daEnv;
      chiaveId = !daEnvOk && offerta ? await chiaveValida(db(), offerta) : null;
      if (!daEnvOk && !chiaveId) throw errore('manca o non è valida X-API-Key', 401);
    } else if (livello !== 'pubblico') {
      sessione = leggiToken(bearer(request));
      if (sessione.ruolo === 'cliente') await verificaSessioneCliente(db(), sessione);
      if (livello === 'admin' && sessione.ruolo !== 'admin') throw errore('riservato agli amministratori.', 403);
      if (livello === 'cliente' && sessione.ruolo !== 'cliente' && sessione.ruolo !== 'admin') {
        throw errore('accesso non consentito.', 403);
      }
    }

    const corpo = await corpoJson(request);

    // Un cliente agisce solo sul proprio RUI, qualunque cosa mandi il browser.
    // Eccezione: la scheda mercato, dove "rui" e' l'intermediario consultato.
    if (sessione?.ruolo === 'cliente' && path.startsWith('/cliente/') && path !== '/cliente/mercato/scheda') {
      q.rui = sessione.rui;
      corpo.rui = sessione.rui;
      corpo.rui_cliente = sessione.rui;
    }

    // --- endpoint ----------------------------------------------------------
    const p = path.replace(/^\/v1(?=\/)/, '');
    const esporta = q.formato === 'csv';

    if (path === '/health') return risposta(200, { ok: true });
    if (path === '/pubblico/cerca' && metodo === 'GET') return risposta(200, await cercaPubblica(db(), q.q));

    if (path === '/auth/login' && metodo === 'POST') {
      const esito = await verificaAccesso(db(), corpo.email, corpo.password);
      const { pv: _pv, ...pubblico } = esito;
      return risposta(200, { ...pubblico, token: creaToken(esito, { ricordami: corpo.ricordami === true }) });
    }

    if (p === '/overview') return risposta(200, await overviewPubblica(db(), { sezione: q.sezione }));
    if (p === '/documentazione') return risposta(200, documentazionePubblica());
    if (p === '/openapi.json') {
      const base = `${request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')}://${
        request.headers.get('x-forwarded-host') || url.host}`;
      return risposta(200, specificaOpenApi(base));
    }

    if (path === '/config') {
      return risposta(200, {
        // Serve solo alla mappa della scheda nell'area admin: ai clienti non si manda.
        maps_key: sessione?.ruolo === 'admin' ? (process.env.GOOGLE_MAPS_API_KEY || '').trim() : '',
        api_key_richiesta: true,
        ai_pronta: aiPronta(),
        mistral_pronta: await mistralPronta(),
      });
    }

    // Admin: aggiornamento e utenti
    if (path === '/admin/aggiornamento' && metodo === 'GET') return risposta(200, await aggiornamento.stato());
    if (path === '/admin/aggiornamento' && metodo === 'POST') {
      return risposta(202, await aggiornamento.avvia({ forza: corpo.forza === true }));
    }
    if (path === '/admin/utenti' && metodo === 'GET') return risposta(200, await elencoUtentiCliente(db()));
    if (path === '/admin/utenti' && metodo === 'POST') return risposta(200, await creaUtenteCliente(db(), corpo));
    if (path === '/admin/utenti/stato' && metodo === 'POST') return risposta(200, await impostaAttivoOperatore(db(), corpo));
    if (path === '/admin/utenti/elimina' && metodo === 'POST') return risposta(200, await eliminaOperatore(db(), corpo));
    if (path === '/admin/utenti/password' && metodo === 'POST') {
      return risposta(200, await reimpostaPasswordUtente(db(), corpo.email));
    }

    if (path === '/admin/api-keys' && metodo === 'GET') return risposta(200, await elencoChiavi(db()));
    if (path === '/admin/api-keys' && metodo === 'POST') return risposta(200, await creaChiave(db(), corpo));
    if (path === '/admin/api-keys/revoca' && metodo === 'POST') return risposta(200, await revocaChiave(db(), corpo));

    // Cliente
    if (path === '/cliente/sorveglianza' && metodo === 'POST') {
      return risposta(200, await aggiungiBrokerSorvegliato(db(), corpo.rui, corpo.rui_broker || corpo.broker));
    }
    if (path === '/cliente/sorveglianza' && metodo === 'DELETE') {
      return risposta(200, await rimuoviBrokerSorvegliato(db(), q.rui, q.broker || q.rui_broker));
    }
    if (path === '/cliente/alert' && metodo === 'POST') {
      return risposta(200, await marcaAlertLetto(db(), corpo.rui, { id: corpo.id, tutti: corpo.tutti }));
    }
    if (path === '/cliente/password' && metodo === 'POST') {
      const esito = await cambiaPasswordCliente(db(), sessione, corpo);
      const { pv: _pv, ...pubblico } = esito;
      return risposta(200, { ...pubblico, token: creaToken(esito, { ricordami: corpo.ricordami === true }) });
    }
    if (path === '/cliente/opportunity' && metodo === 'POST') return risposta(200, await salvaOpportunity(db(), corpo));
    if (path === '/cliente/opportunity/stato' && metodo === 'POST') {
      return risposta(200, await aggiornaStatoOpportunity(db(), corpo));
    }
    if (path === '/cliente/opportunity/arricchisci' && metodo === 'POST') {
      return risposta(200, await arricchisciOpportunity(db(), corpo));
    }
    if (metodo === 'GET') {
      if (path === '/cliente/estratto') return risposta(200, await estrattoCliente(db(), q.rui));
      if (path === '/cliente/fidelizzazione') return risposta(200, await fidelizzazioneCliente(db(), q.rui));
      if (path === '/cliente/controllo') return risposta(200, await controlloRuiCliente(db(), q.rui));
      if (path === '/cliente/opportunity') return risposta(200, await elencoOpportunity(db(), q.rui));
      if (path === '/cliente/mercato') {
        return risposta(200, await cercaMercato(db(), {
          zona: q.zona, compagnia: q.compagnia, sezione: q.sezione, limite: q.limit, q: q.q, rui_cliente: q.rui,
        }));
      }
      if (path === '/cliente/mercato/storico') return risposta(200, await storicoMercato(db(), q.rui, q.id));
      if (path === '/cliente/mercato/scheda') return risposta(200, await schedaMercato(db(), q.rui));
    }

    // Recapiti via chiave API (es. Assicurapp): ricerca web o cache, con tipo di ricerca e costo reale.
    const recapiti_ = livello === 'chiave' ? p.match(/^\/recapiti\/([^/]+)$/) : null;
    if (recapiti_ && metodo === 'POST') {
      const esito = await recapitiPerApi(db(), decodeURIComponent(recapiti_[1]), {
        agenzia: corpo.agenzia, chiaveId, forza: corpo.forza === true,
      });
      // La ricerca e' gia' fatta (e pagata): un errore dell'archivio non deve far perdere la risposta.
      await registraRicerca(db(), { chiaveId, agenzia: corpo.agenzia, esito })
        .catch((e) => console.error('archivio agenzia non aggiornato', esito.rui, e));
      return risposta(200, esito);
    }

    // Archivio personale dell'agenzia del software chiamante (chiave API + codice agenzia).
    if (livello === 'chiave' && (p === '/archivio' || p.startsWith('/archivio/'))) {
      const chi = { chiaveId, agenzia: metodo === 'GET' ? q.agenzia : corpo.agenzia };
      const voce_ = p.match(/^\/archivio\/(\d+)(\/elimina)?$/);
      if (p === '/archivio' && metodo === 'GET') {
        return risposta(200, await elencoArchivio(db(), {
          ...chi, q: q.q, provincia: q.provincia, concorrente: q.concorrente, stato: q.stato, pagina: q.pagina,
        }));
      }
      if (p === '/archivio' && metodo === 'POST') return risposta(200, await inserisciManuale(db(), { ...corpo, ...chi }));
      if (p === '/archivio/scheda' && metodo === 'POST') {
        return risposta(200, await registraScheda(db(), { ...chi, rui: corpo.rui }));
      }
      if (voce_ && metodo === 'POST') {
        return risposta(200, voce_[2]
          ? await eliminaVoce(db(), voce_[1], chi)
          : await modificaVoce(db(), voce_[1], { ...corpo, ...chi }));
      }
    }

    // Query e AI (admin)
    if (path === '/query/ai' && metodo === 'POST') return risposta(200, await approfondisci(corpo));
    if (p === '/query') {
      return risposta(200, await interpretaDomanda(db(), q.q || q.testo || corpo.q || corpo.testo || ''));
    }
    if (p === '/dimensioni') return risposta(200, { dimensioni: DIMENSIONI, esempi: ESEMPI_DOMANDA });

    // Registro (lettura)
    if (metodo === 'GET') {
      let risultato = null;
      const scheda_ = p.match(/^\/intermediari\/([^/]+)$/);
      const rete_ = p.match(/^\/rete\/([^/]+)$/);
      if (p === '/intermediari') {
        risultato = await cercaIntermediari(db(), {
          q: q.q, sezione: q.sezione, dopoNome: q.dopo_nome, dopoOss: q.dopo_oss, limite: q.limit, esporta,
        });
      } else if (scheda_) {
        risultato = await scheda(db(), decodeURIComponent(scheda_[1]), {
          sezione: q.sezione,
          // /v1 (chiave API): niente recapiti trovati fuori dal registro.
          contatti: livello !== 'chiave',
        });
      } else if (rete_) {
        risultato = await rete(db(), decodeURIComponent(rete_[1]), { sezione: q.sezione });
      } else if (p === '/sedi') {
        risultato = await elencoSedi(db(), {
          q: q.q || q.provincia, sezione: q.sezione, dopoOss: q.dopo_oss, limite: q.limit, esporta,
        });
      } else if (p === '/mandati') {
        risultato = await elencoMandati(db(), { q: q.q, sezione: q.sezione, dopoOss: q.dopo_oss, limite: q.limit, esporta });
      } else if (p === '/cariche') {
        risultato = await elencoCariche(db(), { q: q.q, sezione: q.sezione, dopoOss: q.dopo_oss, limite: q.limit, esporta });
      } else if (p === '/import-runs') {
        risultato = await storicoImport(db(), { limite: q.limit });
      }
      if (risultato) {
        if (esporta && Array.isArray(risultato.items)) return rispostaCsv(p.split('/').filter(Boolean).pop(), risultato.items);
        return risposta(200, risultato);
      }
    }

    throw errore(metodo === 'GET' ? 'non trovato' : 'metodo non ammesso', metodo === 'GET' ? 404 : 405);
  }

  return async function app(request) {
    let r;
    try {
      r = await gestisci(request);
    } catch (e) {
      // 55P03 = lock_timeout: l'import sta sostituendo le tabelle del registro (circa un minuto).
      const occupato = e?.code === '55P03';
      const status = occupato ? 503 : e.statusCode || 500;
      if (status >= 500 && !occupato) console.error(request.method, request.url, e);
      r = risposta(status, {
        errore: occupato
          ? 'Registro in aggiornamento, riprova tra un minuto.'
          : status >= 500 && !e.statusCode ? 'errore interno, riprova tra poco.' : e.message,
      });
      if (occupato) r.headers.set('retry-after', '60');
    }
    const path = percorsoApi(new URL(request.url).pathname);
    const livello = livelloAccesso(path);
    const conCors = livello === 'chiave' || (livello === 'pubblico' && path !== '/auth/login');
    if (!conCors) for (const h of Object.keys(CORS)) r.headers.delete(h);
    return r;
  };
}
