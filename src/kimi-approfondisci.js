// Approfondimento AI dopo una query script: prima il RUI, poi il web via Kimi (Moonshot).

import './config.js';
import { cercaIntermediari, rete, scheda } from './query.js';

const BASE = (process.env.KIMI_BASE_URL || process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1')
  .trim()
  .replace(/\/$/, '');
const MODELLO = (process.env.KIMI_MODEL || 'kimi-k2.6').trim();
const MAX_GIRI = 10;
const MAX_WEB = 5;

const FONDAMENTALI = ['email', 'cellulare', 'sede'];

const STRUMENTI_RUI = [
  {
    type: 'function',
    function: {
      name: 'cerca_rui',
      description:
        'Cerca intermediari A/B/E nel registro già importato, per nome o numero RUI. Usalo per prima cosa.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Nome, ragione sociale o numero RUI' },
        },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scheda_rui',
      description:
        'Scheda completa dal RUI: anagrafica, numeri, sedi, siti in registro, mandati, cariche, contatti, rete. Senza geocoding.',
      parameters: {
        type: 'object',
        properties: {
          rui: { type: 'string', description: 'Numero di iscrizione RUI, es. A000123456' },
        },
        required: ['rui'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rete_rui',
      description: 'Principali e collaboratori a un salto. Entrambi gli estremi sono A/B/E.',
      parameters: {
        type: 'object',
        properties: {
          rui: { type: 'string', description: 'Numero di iscrizione RUI' },
        },
        required: ['rui'],
      },
    },
  },
];

const SYSTEM_PROMPT = `Sei Kimi, usato da RUI Search per approfondire una domanda già eseguita da uno script SQL (niente AI).

Ordine obbligatorio:
1. Usa prima i tool del registro (cerca_rui, scheda_rui, rete_rui).
2. Poi vai sul web SOLO per i campi fondamentali che il registro (e i contatti già salvati) non hanno.

Campi fondamentali — cerca sul web se e solo se risultano mancanti:
- email
- cellulare (numero mobile, non un fisso da solo)
- sede / residenza lavorativa (indirizzo operativo o di lavoro)

Se un fondamentale è già presente, NON cercarlo sul web. Segnalo solo come già in registro.
Dopo i fondamentali mancanti, puoi arricchire con altro di utile (sito, LinkedIn, P.IVA, news, gruppo), senza inventare.

Regole:
- Non inventare numeri RUI, sezioni, mandati, email, telefoni o indirizzi.
- Se non lo trovi, scrivi «non trovato». Il web non sostituisce il registro.
- Non raschiare il portale IVASS.
- Italiano, concreto.
- Struttura: «Nel registro», «Fondamentali», «Sul web» (altri dati).
- Cita gli URL delle fonti web.
- Un soggetto alla volta.

Alla fine della risposta, dopo il testo, aggiungi ESATTAMENTE un blocco:

---fondamentali---
{"email":{"stato":"gia_in_rui|trovata|non_trovata","valore":null,"url":null},"cellulare":{"stato":"gia_in_rui|trovata|non_trovata","valore":null,"url":null},"sede":{"stato":"gia_in_rui|trovata|non_trovata","valore":null,"url":null}}
---`;

export function chiaveKimi() {
  return (process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || '').trim();
}

export function kimiPronta() {
  return Boolean(chiaveKimi());
}

function erroreHttp(status, messaggio) {
  const errore = new Error(messaggio);
  errore.statusCode = status;
  return errore;
}

function jsonBreve(valore, massimo = 14000) {
  const testo = JSON.stringify(valore, (_k, v) => (
    typeof v === 'string' && v.length > 500 ? `${v.slice(0, 500)}…` : v
  ));
  if (!testo) return 'null';
  return testo.length <= massimo ? testo : `${testo.slice(0, massimo)}…`;
}

function prendiArgomenti(grezzo) {
  if (grezzo && typeof grezzo === 'object') return grezzo;
  try {
    return JSON.parse(String(grezzo || '{}'));
  } catch {
    return {};
  }
}

function testoPieno(valore) {
  return String(valore || '').trim();
}

function eCellulare(valore) {
  const n = testoPieno(valore).replace(/\D/g, '');
  if (/^393\d{8,10}$/.test(n)) return true;
  if (/^3\d{8,10}$/.test(n)) return true;
  return false;
}

export function valutaMancanti(schedaSoggetto) {
  const contatti = schedaSoggetto?.contatti || [];
  const sedi = schedaSoggetto?.sedi || [];
  const email = contatti
    .filter((c) => (c.tipo === 'email' || c.tipo === 'pec') && testoPieno(c.valore).includes('@'))
    .map((c) => testoPieno(c.valore));
  const cellulari = contatti
    .filter((c) => (c.tipo === 'telefono' || c.tipo === 'altro') && eCellulare(c.valore))
    .map((c) => testoPieno(c.valore));
  const sediTesto = sedi
    .map((s) => [s.indirizzo_sede, s.cap_sede, s.comune_sede, s.provincia_sede].filter(Boolean).join(', '))
    .map((t) => t.trim())
    .filter(Boolean);
  const coperti = {
    email: { presente: email.length > 0, valori: email },
    cellulare: { presente: cellulari.length > 0, valori: cellulari },
    sede: { presente: sediTesto.length > 0, valori: sediTesto },
  };
  return {
    ...coperti,
    da_cercare: FONDAMENTALI.filter((id) => !coperti[id].presente),
  };
}

function estraiRui(risultato) {
  return testoPieno(
    risultato?.scelto?.numero_iscrizione_rui
    || risultato?.risultati?.[0]?.numero_iscrizione_rui
    || '',
  );
}

function compattaScheda(s) {
  const base = {
    soggetto: s.soggetto,
    profilo: s.profilo,
    numeri: s.numeri,
    siti_internet: s.siti_internet,
    sedi: (s.sedi || []).slice(0, 12),
    mandati: (s.mandati || []).slice(0, 25),
    mandati_via_principali: (s.mandati_via_principali || []).slice(0, 20),
    cariche: (s.cariche || []).slice(0, 15),
    contatti: (s.contatti || []).slice(0, 20),
    rete: {
      principali: (s.rete?.principali || []).slice(0, 15),
      collaboratori: (s.rete?.collaboratori || []).slice(0, 15),
    },
  };
  return { ...base, mancanti: valutaMancanti(base) };
}

function parseFondamentali(testo) {
  const grezzo = String(testo || '');
  const marca = '---fondamentali---';
  const idx = grezzo.lastIndexOf(marca);
  if (idx < 0) return { testo: grezzo.trim(), dalModello: null };
  const dopo = grezzo.slice(idx + marca.length).replace(/^\s*|\s*---\s*$/g, '').trim();
  let dalModello = null;
  try {
    dalModello = JSON.parse(dopo);
  } catch {
    dalModello = null;
  }
  return { testo: grezzo.slice(0, idx).trim(), dalModello };
}

function fondiFondamentali(copertura, dalModello) {
  const out = {};
  for (const id of FONDAMENTALI) {
    const gia = copertura?.[id];
    const modello = dalModello?.[id] || {};
    if (gia?.presente) {
      out[id] = {
        stato: 'gia_in_rui',
        valore: gia.valori[0] || null,
        url: null,
        origine: 'rui',
      };
      continue;
    }
    const stato = ['trovata', 'non_trovata'].includes(modello.stato) ? modello.stato : 'non_trovata';
    out[id] = {
      stato,
      valore: stato === 'trovata' ? (modello.valore || null) : null,
      url: modello.url || null,
      origine: stato === 'trovata' ? 'web' : null,
    };
  }
  return out;
}

function compattaRete(r) {
  return {
    soggetto: r.soggetto,
    principali: (r.principali || []).slice(0, 20),
    collaboratori: (r.collaboratori || []).slice(0, 20),
  };
}

function messaggioAssistente(message) {
  const out = { role: 'assistant' };
  if (message.content != null) out.content = message.content;
  if (message.tool_calls) out.tool_calls = message.tool_calls;
  if (message.reasoning_content) out.reasoning_content = message.reasoning_content;
  return out;
}

async function kimiFetch(percorso, { method = 'GET', body } = {}) {
  const chiave = chiaveKimi();
  const risposta = await fetch(`${BASE}${percorso}`, {
    method,
    headers: {
      authorization: `Bearer ${chiave}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const testo = await risposta.text();
  let corpo = null;
  try {
    corpo = testo ? JSON.parse(testo) : null;
  } catch {
    corpo = { error: { message: testo } };
  }
  if (!risposta.ok) {
    const msg = corpo?.error?.message || corpo?.message || testo || `errore Kimi ${risposta.status}`;
    const status = risposta.status === 401 ? 502
      : risposta.status === 429 ? 429
        : risposta.status >= 400 && risposta.status < 500 ? 502
          : 502;
    throw erroreHttp(
      status,
      risposta.status === 401
        ? 'chiave Kimi (Moonshot) non valida. Controlla MOONSHOT_API_KEY nel .env.'
        : `Kimi: ${msg}`,
    );
  }
  return corpo;
}

let cacheFormule = null;

async function caricaFormule() {
  if (cacheFormule) return cacheFormule;
  const uri = {
    web_search: 'moonshot/web-search:latest',
    web_search_plus: 'moonshot/web-search:latest',
    fetch: 'moonshot/fetch:latest',
  };
  const tools = [];
  const nomeVersoUri = { ...uri };

  for (const formula of ['moonshot/web-search:latest', 'moonshot/fetch:latest']) {
    try {
      const out = await kimiFetch(`/formulas/${formula}/tools`);
      for (const tool of out.tools || []) {
        const nome = tool?.function?.name;
        if (!nome) continue;
        tools.push(tool);
        nomeVersoUri[nome] = formula;
      }
    } catch {
      // Se le Formula non rispondono, resta il fallback $web_search.
    }
  }

  if (tools.length === 0) {
    tools.push({
      type: 'builtin_function',
      function: { name: '$web_search' },
    });
    nomeVersoUri.$web_search = 'moonshot/web-search:latest';
    nomeVersoUri.web_search = 'moonshot/web-search:latest';
  }

  cacheFormule = { tools, nomeVersoUri };
  return cacheFormule;
}

function eToolWeb(nome) {
  return nome === 'web_search' || nome === 'web_search_plus' || nome === '$web_search' || nome === 'fetch';
}

async function eseguiRui(client, nome, args) {
  if (nome === 'cerca_rui') {
    const q = String(args.q || '').trim();
    if (!q) return { errore: 'manca q' };
    const { items } = await cercaIntermediari(client, { q, limite: 8 });
    return { items };
  }
  if (nome === 'scheda_rui') {
    const rui = String(args.rui || '').trim();
    if (!rui) return { errore: 'manca rui' };
    const out = compattaScheda(await scheda(client, rui, { geocodifica: false }));
    return {
      ...out,
      istruzione: out.mancanti.da_cercare.length
        ? `Cerca sul web SOLO questi fondamentali mancanti: ${out.mancanti.da_cercare.join(', ')}.`
        : 'Email, cellulare e sede sono già in registro: non cercarli sul web. Puoi solo arricchire altro.',
    };
  }
  if (nome === 'rete_rui') {
    const rui = String(args.rui || '').trim();
    if (!rui) return { errore: 'manca rui' };
    return compattaRete(await rete(client, rui));
  }
  return { errore: `tool RUI sconosciuto: ${nome}` };
}

async function eseguiWeb(nome, argsGrezzi, nomeVersoUri) {
  const argomenti = typeof argsGrezzi === 'string' ? argsGrezzi : JSON.stringify(argsGrezzi || {});
  // $web_search builtin: Kimi esegue la ricerca se gli rimandi gli argomenti.
  if (nome === '$web_search') return argomenti;
  const formula = nomeVersoUri[nome];
  if (!formula) return { errore: `formula web assente per ${nome}` };
  const fiber = await kimiFetch(`/formulas/${formula}/fibers`, {
    method: 'POST',
    body: { name: nome, arguments: argomenti },
  });
  const ctx = fiber?.context || {};
  return ctx.output || ctx.encrypted_output || jsonBreve({ stato: fiber?.status, formula });
}

export async function approfondisciConKimi(client, corpo) {
  const domanda = String(corpo?.q || corpo?.domanda || '').trim();
  const risultato = corpo?.risultato;
  if (!domanda) throw erroreHttp(400, 'manca la domanda da approfondire.');
  if (!risultato || typeof risultato !== 'object') {
    throw erroreHttp(400, 'esegui prima una ricerca dallo script, poi chiedi l\'approfondimento AI.');
  }
  if (!chiaveKimi()) {
    throw erroreHttp(
      503,
      'manca MOONSHOT_API_KEY nel .env. Incolla la chiave API di Kimi (Moonshot) e riavvia l\'API.',
    );
  }

  const formule = await caricaFormule();
  const tools = [...STRUMENTI_RUI, ...formule.tools];

  const passi = [];
  let ruiUsato = 0;
  let webUsato = 0;
  let copertura = {
    email: { presente: false, valori: [] },
    cellulare: { presente: false, valori: [] },
    sede: { presente: false, valori: [] },
    da_cercare: [...FONDAMENTALI],
  };

  const ruiNoto = estraiRui(risultato);
  if (ruiNoto) {
    try {
      const gia = compattaScheda(await scheda(client, ruiNoto, { geocodifica: false }));
      copertura = gia.mancanti;
      ruiUsato = 1;
      passi.push({ origine: 'rui', strumento: 'scheda_rui', dettaglio: ruiNoto });
    } catch {
      // Lo script ha un RUI ma la scheda può fallire: Kimi riproverà con i tool.
    }
  }

  const istruzioneBuchi = copertura.da_cercare.length
    ? `Fondamentali MANCANTI — cercali per forza sul web: ${copertura.da_cercare.join(', ')}.`
    : 'Email, cellulare e sede/residenza sono già presenti: non cercarli sul web.';
  const giaPresenti = FONDAMENTALI
    .filter((id) => copertura[id].presente)
    .map((id) => `${id}: ${copertura[id].valori[0]}`)
    .join(' · ');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `Domanda originale: ${domanda}`,
        'Risultato dello script (non AI):',
        jsonBreve(risultato, 8000),
        ruiNoto ? `Soggetto RUI: ${ruiNoto}` : 'Soggetto da risolvere con cerca_rui.',
        giaPresenti ? `Già in registro/contatti (NON cercare sul web): ${giaPresenti}` : 'Nessun fondamentale già in registro.',
        istruzioneBuchi,
        'Poi, se serve, arricchisci con altri dati interessanti.',
      ].join('\n\n'),
    },
  ];
  const corpoChat = { model: MODELLO, messages, tools };
  if (/k3/i.test(MODELLO)) corpoChat.reasoning_effort = 'low';

  for (let giro = 0; giro < MAX_GIRI; giro += 1) {
    const resp = await kimiFetch('/chat/completions', { method: 'POST', body: corpoChat });
    const message = resp?.choices?.[0]?.message;
    if (!message) throw erroreHttp(502, 'Kimi non ha restituito una risposta.');
    const chiamate = message.tool_calls || [];
    if (chiamate.length === 0) {
      const grezzo = String(message.content || '').trim() || 'Nessun approfondimento.';
      const { testo, dalModello } = parseFondamentali(grezzo);
      return {
        domanda,
        modello: MODELLO,
        risposta: testo,
        passi,
        fondamentali: fondiFondamentali(copertura, dalModello),
        da_cercare: copertura.da_cercare,
      };
    }

    messages.push(messaggioAssistente(message));

    for (const tc of chiamate) {
      const nome = tc.function?.name || '';
      const args = prendiArgomenti(tc.function?.arguments);
      const dettaglio = args.q || args.rui || args.query || args.url || nome;
      let contenuto;

      if (STRUMENTI_RUI.some((t) => t.function.name === nome)) {
        ruiUsato += 1;
        passi.push({ origine: 'rui', strumento: nome, dettaglio: String(dettaglio) });
        try {
          const outRui = await eseguiRui(client, nome, args);
          if (outRui?.mancanti) copertura = outRui.mancanti;
          contenuto = jsonBreve(outRui);
        } catch (err) {
          contenuto = jsonBreve({ errore: err.message || 'errore RUI' });
        }
      } else if (eToolWeb(nome)) {
        if (ruiUsato === 0) {
          contenuto = jsonBreve({
            errore: 'Prima interroga il RUI con cerca_rui, scheda_rui o rete_rui. Poi puoi cercare sul web.',
          });
        } else if (webUsato >= MAX_WEB) {
          contenuto = jsonBreve({ errore: `limite di ${MAX_WEB} ricerche web raggiunto` });
        } else {
          webUsato += 1;
          passi.push({ origine: 'web', strumento: nome, dettaglio: String(dettaglio) });
          try {
            const out = await eseguiWeb(nome, tc.function?.arguments, formule.nomeVersoUri);
            contenuto = typeof out === 'string' ? out : jsonBreve(out);
          } catch (err) {
            contenuto = jsonBreve({ errore: err.message || 'errore web' });
          }
        }
      } else {
        contenuto = jsonBreve({ errore: `tool sconosciuto: ${nome}` });
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: contenuto,
      });
    }
  }

  throw erroreHttp(504, 'Kimi ha superato il numero di passi. Riprova con una domanda più stretta.');
}
