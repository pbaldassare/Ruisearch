// Ricerche sul web con Mistral (Conversations API con lo strumento web_search), al posto di Kimi.
// Due usi: i recapiti di un intermediario ("Cerca recapiti" e /v1/recapiti) e l'approfondimento
// della pagina Query dell'admin. Ogni chiamata restituisce anche il costo reale.

import './config.js';

const URL_CONVERSAZIONI = 'https://api.mistral.ai/v1/conversations';
// Modello fissato (non "-latest"): il costo dipende dal listino del modello.
const MODELLO = 'mistral-medium-3-5';
// Listino Mistral in euro: token per milione, ricerca web a chiamata. Le pagine lette dalla ricerca
// (connector_tokens) le contiamo come token in entrata.
// ponytail: listino scritto qui; se Mistral lo cambia va aggiornato, il conto vero resta quello della console Mistral.
const PREZZI = { entrata: 1.5, uscita: 7.5, ricerca_web: 0.03 };
const TIMEOUT_MS = 90_000;

function erroreHttp(messaggio, statusCode) {
  const errore = new Error(messaggio);
  errore.statusCode = statusCode;
  return errore;
}

const chiave = () => (process.env.MISTRAL_API_KEY || '').trim();

/** true se la chiave Mistral è impostata (che sia valida lo dice mistral_pronta in /config). */
export function aiPronta() {
  return Boolean(chiave());
}

/** Costo in euro di una conversazione, dai numeri che restituisce Mistral. */
export function costoMistral(usage = {}) {
  const entrata = Number(usage.prompt_tokens || 0) + Number(usage.connector_tokens || 0);
  const uscita = Number(usage.completion_tokens || 0);
  const ricerche = Number(usage.connectors?.web_search || 0) + Number(usage.connectors?.web_search_premium || 0);
  const costo = (entrata * PREZZI.entrata + uscita * PREZZI.uscita) / 1e6 + ricerche * PREZZI.ricerca_web;
  return Math.round(costo * 1e6) / 1e6;
}

/** Il primo oggetto JSON nel testo del modello (anche dentro ```json ... ```), o un errore 502. */
export function estraiJson(testo) {
  const t = String(testo || '');
  const inizio = t.indexOf('{');
  const fine = t.lastIndexOf('}');
  if (inizio >= 0 && fine > inizio) {
    try {
      return JSON.parse(t.slice(inizio, fine + 1));
    } catch {
      // sotto: errore unico
    }
  }
  throw erroreHttp('la ricerca web ha dato una risposta non leggibile: riprova tra poco.', 502);
}

async function conversa(istruzioni, testo) {
  if (!aiPronta()) throw erroreHttp('ricerca web non configurata (manca MISTRAL_API_KEY).', 503);
  let risposta;
  try {
    risposta = await fetch(URL_CONVERSAZIONI, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${chiave()}` },
      body: JSON.stringify({
        model: MODELLO,
        instructions: istruzioni,
        inputs: testo,
        tools: [{ type: 'web_search' }],
        completion_args: { temperature: 0.2 },
        store: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw erroreHttp('la ricerca web non risponde: riprova tra poco.', 502);
  }
  const corpo = await risposta.json().catch(() => null);
  if (!risposta.ok || !corpo) {
    const stato = risposta.status === 429 ? 'troppe richieste o credito esaurito' : `errore ${risposta.status}`;
    throw erroreHttp(`la ricerca web non è riuscita (${stato}): riprova tra poco.`, 502);
  }
  const uscite = corpo.outputs || [];
  const testoModello = uscite
    .filter((o) => o.type === 'message.output')
    .flatMap((o) => (Array.isArray(o.content) ? o.content : [{ type: 'text', text: o.content }]))
    .filter((c) => c?.type === 'text')
    .map((c) => c.text)
    .join('');
  const ricerche = uscite
    .filter((o) => o.type === 'tool.execution')
    .map((o) => {
      try {
        return JSON.parse(o.arguments || '{}').query || o.name;
      } catch {
        return o.name;
      }
    });
  return { testo: testoModello, usage: corpo.usage || {}, ricerche, costo_eur: costoMistral(corpo.usage) };
}

const testoBreve = (v, max) => String(v ?? '').trim().slice(0, max);
const TIPI = new Set(['email', 'pec', 'cellulare', 'telefono', 'linkedin', 'facebook', 'instagram', 'sito', 'indirizzo']);

const ISTRUZIONI_RECAPITI = [
  'Trovi i recapiti pubblici di intermediari assicurativi italiani iscritti al RUI (registro IVASS).',
  'Hai già la scheda del registro: non cercarla. Fai al massimo 3 ricerche web.',
  'Cerca sul web, su LinkedIn e sui social: email, cellulare, telefono, LinkedIn, Facebook, Instagram, sito, indirizzo.',
  'Riporta solo dati letti in una fonte, con il link della fonte. Non inventare: se un dato non è pubblico, omettilo.',
  'Attenzione agli omonimi: tieni solo dati riferibili a questo soggetto (stesso nome, attività assicurativa, stessa zona o',
  'stessa agenzia per cui lavora). Nel dubbio, ometti.',
  'Per ogni recapito indica di chi è: "persona" se è del soggetto stesso (la persona o la società iscritta),',
  '"societa_collegata" se è di un\'agenzia o società per cui lavora (in quel caso scrivi il nome in "societa").',
  'Rispondi SOLO con un JSON, senza altro testo:',
  '{"sintesi": "2-3 frasi su chi è e cosa hai trovato", "recapiti": [{"tipo": "email|pec|cellulare|telefono|linkedin|facebook|instagram|sito|indirizzo", "valore": "...", "url": "link della fonte", "di_chi": "persona|societa_collegata", "societa": "nome se societa_collegata"}]}',
].join('\n');

/**
 * Recapiti pubblici di un intermediario. `s` è la scheda di query.js (soggetto, sedi, siti, rete).
 * Lancia un errore (502/503) se la ricerca non riesce: chi la chiama non deve salvarla come fatta.
 */
export async function cercaRecapiti(s) {
  const soggetto = s?.soggetto || {};
  const scheda = {
    rui: soggetto.numero_iscrizione_rui,
    denominazione: soggetto.denominazione,
    sezione: soggetto.sezione,
    natura: soggetto.persona_giuridica ? 'società' : 'persona fisica',
    sedi: (s?.sedi || []).slice(0, 3).map((x) =>
      [x.tipo_sede, x.indirizzo_sede, x.cap_sede, x.comune_sede, x.provincia_sede].filter(Boolean).join(' ')),
    siti: (s?.siti_internet || []).slice(0, 5),
    lavora_per: (s?.rete?.principali || []).slice(0, 5).map((p) => p.denominazione).filter(Boolean),
  };
  const r = await conversa(
    ISTRUZIONI_RECAPITI,
    `Trova i recapiti pubblici di ${scheda.denominazione} (RUI ${scheda.rui}).\nScheda del registro:\n${JSON.stringify(scheda)}`,
  );
  const dati = estraiJson(r.testo);
  const recapiti = (Array.isArray(dati.recapiti) ? dati.recapiti : [])
    .filter((x) => x && typeof x.valore === 'string' && x.valore.trim())
    .map((x) => {
      const tipo = TIPI.has(String(x.tipo).toLowerCase()) ? String(x.tipo).toLowerCase() : null;
      const collegata = x.di_chi === 'societa_collegata';
      const url = /^https?:\/\//i.test(String(x.url || '')) ? testoBreve(x.url, 500) : null;
      // Social scritto come nome della pagina ("GiungoAuto"): il recapito vero e' il link del profilo
      const social = ['linkedin', 'facebook', 'instagram'].includes(tipo) && !/[./]/.test(x.valore) && url
        && new RegExp(tipo === 'linkedin' ? 'linkedin\\.com' : `${tipo}\\.com`, 'i').test(url);
      return {
        tipo,
        valore: social ? url : testoBreve(x.valore, 300),
        url,
        riferito_a: collegata ? 'societa_collegata' : 'persona',
        etichetta: collegata && x.societa ? testoBreve(`${x.societa}`, 120) : null,
      };
    });
  return {
    sintesi: testoBreve(dati.sintesi, 1500) || null,
    recapiti,
    ricerche: r.ricerche,
    costo_eur: r.costo_eur,
    modello: MODELLO,
  };
}

const ISTRUZIONI_APPROFONDIMENTO = [
  'Approfondisci una domanda sul registro italiano degli intermediari assicurativi (RUI) già eseguita da uno script.',
  'Hai il risultato dello script: usalo come base e completalo con al massimo 3 ricerche web.',
  'Riporta solo dati letti in una fonte, con il link. Non inventare numeri RUI, mandati, email, telefoni o indirizzi.',
  'Italiano, concreto, niente markdown. Rispondi SOLO con un JSON, senza altro testo:',
  '{"sintesi": "risposta in poche frasi", "categorie": [{"id": "recapiti|sede|societa|web|governance|altro", "titolo": "...", "voci": [{"etichetta": "...", "valore": "...", "url": "link della fonte o null"}]}]}',
].join('\n');

/** Approfondimento AI della pagina Query (solo admin). */
export async function approfondisci({ q, domanda, risultato } = {}) {
  const testoDomanda = testoBreve(q || domanda, 500);
  if (!testoDomanda) throw erroreHttp('manca la domanda da approfondire.', 400);
  if (!risultato || typeof risultato !== 'object') {
    throw erroreHttp('esegui prima una ricerca dallo script, poi chiedi l\'approfondimento AI.', 400);
  }
  const r = await conversa(
    ISTRUZIONI_APPROFONDIMENTO,
    `Domanda: ${testoDomanda}\nRisultato dello script:\n${JSON.stringify(risultato).slice(0, 6000)}`,
  );
  const dati = estraiJson(r.testo);
  const categorie = (Array.isArray(dati.categorie) ? dati.categorie : [])
    .filter((c) => c && Array.isArray(c.voci))
    .map((c) => ({
      id: testoBreve(c.id, 30) || 'altro',
      titolo: testoBreve(c.titolo, 80) || 'Altro',
      voci: c.voci
        .filter((v) => v && v.valore != null && String(v.valore).trim())
        .map((v) => ({
          etichetta: testoBreve(v.etichetta, 80),
          valore: testoBreve(v.valore, 500),
          url: /^https?:\/\//i.test(String(v.url || '')) ? testoBreve(v.url, 500) : null,
        })),
    }));
  const sintesi = testoBreve(dati.sintesi, 2000);
  return {
    domanda: testoDomanda,
    modello: MODELLO,
    sintesi,
    risposta: sintesi,
    categorie,
    ricerche: r.ricerche,
    costo_eur: r.costo_eur,
  };
}
