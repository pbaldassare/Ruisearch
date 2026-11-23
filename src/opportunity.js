// Opportunity di mercato: salva prospect e recapiti trovati sul web (Mistral, src/ricerca-web.js).

import { clienteDaRui } from './cliente.js';
import { aiPronta, cercaRecapiti } from './ricerca-web.js';
import { anagrafica, normalizzaRui, scheda } from './query.js';

// Una ricerca web per lo stesso intermediario vale GIORNI_RIUSO giorni per tutti i clienti: i recapiti trovati
// restano in `contatti`, ogni richiesta in `ricerche_web` (anche quelle servite dalla cache, con tipo 'cache_*').
// Ogni cliente avvia al massimo TETTO_GIORNO ricerche nuove al giorno (ora italiana); le letture dalla cache
// non contano.
const GIORNI_RIUSO = 90;
export const TETTO_GIORNO = 20;
// Una ricerca 'in_corso' più vecchia di così è morta (funzione interrotta): non blocca più quel RUI.
const MINUTI_IN_CORSO = 5;

function erroreHttp(messaggio, status) {
  const errore = new Error(messaggio);
  errore.statusCode = status;
  return errore;
}

function testo(valore) {
  return String(valore || '').trim();
}

async function richiediCliente(client, rui) {
  const row = await clienteDaRui(client, rui);
  if (!row) throw erroreHttp(`nessun cliente attivo con RUI ${rui}`, 404);
  return row;
}

/**
 * Esegue fn in una transazione. Il pool non tiene BEGIN/COMMIT sulla stessa connessione:
 * se arriva il pool si prende una connessione dedicata e la si restituisce sempre.
 */
export async function inTransazione(db, fn) {
  const dalPool = typeof db.connect === 'function' && typeof db.release !== 'function' && 'idleCount' in db;
  const c = dalPool ? await db.connect() : db;
  try {
    await c.query('begin');
    try {
      const esito = await fn(c);
      await c.query('commit');
      return esito;
    } catch (errore) {
      await c.query('rollback').catch(() => {});
      throw errore;
    }
  } finally {
    if (dalPool) c.release();
  }
}

export async function elencoOpportunity(client, ruiCliente) {
  const cliente = await richiediCliente(client, ruiCliente);
  const { rows } = await client.query(
    `
    select
      o.id,
      o.rui_target,
      o.denominazione,
      o.sezione,
      o.rui_broker,
      o.broker_denominazione,
      o.zona,
      o.compagnia,
      o.stato,
      o.note,
      o.sintesi,
      o.arricchito_il,
      o.creato_il,
      coalesce(
        (
          select json_agg(c order by c.tipo, c.valore)
          from (
            select ct.tipo, ct.valore, ct.etichetta, ct.fonte, ct.fonte_url, ct.affidabilita
            from contatti ct
            where ct.numero_iscrizione_rui = o.rui_target
          ) c
        ),
        '[]'::json
      ) as recapiti
    from cliente_opportunity o
    where o.cliente_id = $1
    order by
      case o.stato
        when 'nuova' then 0
        when 'in_lavorazione' then 1
        when 'contattata' then 2
        else 3
      end,
      o.creato_il desc
    `,
    [cliente.id],
  );
  return { ai_pronta: aiPronta(), voci: rows };
}

export async function salvaOpportunity(client, {
  rui, rui_target, rui_broker, zona, compagnia, note,
} = {}) {
  const cliente = await richiediCliente(client, rui);
  const target = normalizzaRui(rui_target);
  if (!target) throw erroreHttp('indica il RUI da salvare', 400);
  const soggetti = await anagrafica(client, target);
  const s = soggetti[0];
  if (!s) throw erroreHttp(`nessun intermediario A/B/E con RUI ${target}`, 404);

  let brokerNome = null;
  const broker = normalizzaRui(rui_broker);
  if (broker) {
    const b = (await anagrafica(client, broker))[0];
    brokerNome = b?.denominazione || null;
  }

  const ins = await client.query(
    `
    insert into cliente_opportunity (
      cliente_id, rui_target, denominazione, sezione,
      rui_broker, broker_denominazione, zona, compagnia, note, stato
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'nuova')
    on conflict (cliente_id, rui_target) do update
      set denominazione = excluded.denominazione,
          sezione = excluded.sezione,
          rui_broker = coalesce(excluded.rui_broker, cliente_opportunity.rui_broker),
          broker_denominazione = coalesce(excluded.broker_denominazione, cliente_opportunity.broker_denominazione),
          zona = coalesce(excluded.zona, cliente_opportunity.zona),
          compagnia = coalesce(excluded.compagnia, cliente_opportunity.compagnia),
          note = coalesce(excluded.note, cliente_opportunity.note)
    returning *
    `,
    [
      cliente.id, target, s.denominazione, s.sezione,
      broker || null, brokerNome, testo(zona) || null, testo(compagnia) || null,
      testo(note) || null,
    ],
  );
  return { ok: true, voce: ins.rows[0] };
}

export async function aggiornaStatoOpportunity(client, { rui, id, stato, note } = {}) {
  const cliente = await richiediCliente(client, rui);
  const ammessi = ['nuova', 'in_lavorazione', 'contattata', 'scartata'];
  if (stato && !ammessi.includes(stato)) throw erroreHttp('stato non valido', 400);
  const voceId = Number(id);
  if (!Number.isFinite(voceId) || voceId <= 0) throw erroreHttp('indica l\'opportunity', 400);

  const upd = await client.query(
    `
    update cliente_opportunity
    set stato = coalesce($3, stato),
        note = coalesce($4, note)
    where cliente_id = $1 and id = $2
    returning id, rui_target, stato, note
    `,
    [cliente.id, voceId, stato || null, note === undefined ? null : testo(note)],
  );
  if (upd.rowCount === 0) throw erroreHttp('opportunity non trovata', 404);
  return { ok: true, voce: upd.rows[0] };
}

// --- Recapiti: il tipo si decide dal valore, l'etichetta serve solo a disambiguare ------------------

// Parola di strada, come parola intera (anche abbreviata) o come finale tedesco (Bahnhofstr., Hauptweg).
const STRADA = new RegExp(
  "(^|[^\\p{L}])(via|viale|v\\.le|vle|v\\.|piazza|p\\.zza|p\\.za|pza|pzza|p\\.tta|piazzale|p\\.le|ple|piazzetta|"
  + "corso|c\\.so|c/so|cso|largo|l\\.go|vicolo|vico|strada|stradone|str\\.|contrada|contra'|c\\.da|c/da|cda|"
  + "località|localita'?|loc\\.|loc|frazione|fraz\\.|borgo|lungomare|lungotevere|lungarno|lungadige|lungo|"
  + "galleria|traversa|trav\\.|salita|rione|sestiere|circonvallazione|circ\\.ne|regione|calle|corte|passaggio|"
  + "riviera|s\\.s\\.|ss\\.?|s\\.p\\.|sp|statale|provinciale|zona industriale|rue|avenue|avenida|boulevard|"
  + "route|place|rua|paseo|street|road|ul\\.|platz|weg|gasse)(?=[^\\p{L}]|$)"
  + "|\\p{L}(str\\.|strasse|straße|weg|gasse|platz|ring)(?=[^\\p{L}]|$)",
  'iu',
);

// Senza schema si accettano solo domini con un suffisso comune: "dott.rossi" non è un sito.
const TLD_SENZA_SCHEMA = new Set([
  'it', 'com', 'net', 'org', 'eu', 'info', 'biz', 'io', 'co', 'me', 'online', 'site', 'store', 'shop', 'pro',
  'cloud', 'app', 'tech', 'srl', 'insurance', 'ch', 'sm', 'va', 'de', 'fr', 'es', 'uk', 'at', 'be', 'nl', 'lu',
  'mt', 'si', 'hr', 'al', 'ro', 'gr', 'pt', 'us',
]);

const SOCIAL = [
  [/(^|\.)linkedin\.com$/, 'linkedin', 'LinkedIn'],
  [/(^|\.)(facebook\.com|fb\.com)$/, 'altro', 'Facebook'],
  [/(^|\.)instagram\.com$/, 'altro', 'Instagram'],
  [/(^|\.)(twitter\.com|x\.com)$/, 'altro', 'X'],
];

function etichettaPulita(etichetta) {
  if (typeof etichetta !== 'string') return null;
  const e = etichetta.trim().replace(/\s+/g, ' ');
  return e && e.length <= 80 ? e : null;
}

function emailValida(v) {
  const e = v.replace(/^mailto:/i, '').trim().toLowerCase();
  return /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e) ? e : null;
}

/** Numero italiano: 9-13 cifre tolti spazi, punti, trattini, barre, parentesi e +39; mai date o anni. */
function cifreTelefono(v) {
  if (!/^[+\d][\d\s./()-]*$/.test(v)) return null;
  if (/^\d{1,2}[/.-]\d{1,2}[/.-](\d{2}|\d{4})$/.test(v) || /^\d{4}[/.-]\d{1,2}[/.-]\d{1,2}$/.test(v)) return null;
  if (/^(19|20)\d{2}\s*[-/]\s*(19|20)?\d{2}$/.test(v)) return null;
  let cifre = v.replace(/[\s./()-]/g, '');
  if (cifre.startsWith('+39')) cifre = cifre.slice(3);
  else if (cifre.startsWith('0039')) cifre = cifre.slice(4);
  if (!/^[0138]\d{8,12}$/.test(cifre) || /^(\d)\1+$/.test(cifre)) return null;
  return cifre;
}

/** Host di un URL http(s) o di un dominio nudo ("www.agenzia.it/chi-siamo"), altrimenti null. */
function hostUrl(v) {
  if (/\s/.test(v)) return null;
  const conSchema = /^https?:\/\//i.test(v);
  if (!conSchema && /^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  let u;
  try {
    u = new URL(conSchema ? v : `https://${v}`);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const m = host.match(/^(?:[a-z0-9-]+\.)+([a-z]{2,})$/);
  if (!m) return null;
  if (!conSchema && !host.startsWith('www.') && !TLD_SENZA_SCHEMA.has(m[1])) return null;
  return { host: host.replace(/^www\./, ''), percorso: u.pathname.replace(/\/+$/, '') };
}

/**
 * Valida un recapito e ne decide il tipo dal valore. `tipo` ed `etichetta` dichiarati dalla fonte servono
 * solo a disambiguare (P.IVA/codice fiscale contro telefono, PEC). Restituisce { tipo, valore, etichetta }
 * o null se il valore non è un recapito (date, "non disponibile", oggetti, elenchi...).
 */
export function validaRecapito(valore, { tipo = null, etichetta = null } = {}) {
  if (typeof valore !== 'string') return null;
  const v = valore.trim().replace(/\s+/g, ' ');
  if (!v || v.length > 300) return null;
  const etich = etichettaPulita(etichetta);
  const e = `${String(tipo || '')} ${etich || ''}`.toLowerCase();

  if (v.includes('@')) {
    const email = emailValida(v);
    if (!email) return null;
    const pec = /\bpec\b|legalmail|postacert|arubapec/.test(email) || /\bpec\b/.test(e);
    return { tipo: pec ? 'pec' : 'email', valore: email, etichetta: pec ? 'PEC' : 'Email' };
  }

  if (/partita_iva|\bp\.?\s?iva\b|partita/.test(e)) {
    const piva = v.toUpperCase().replace(/\s/g, '').replace(/^IT/, '');
    return /^\d{11}$/.test(piva) ? { tipo: 'partita_iva', valore: piva, etichetta: 'Partita IVA' } : null;
  }
  if (/codice_fiscale|codice fiscale|\bc\.?\s?f\.?(\s|$)/.test(e)) {
    const cf = v.toUpperCase().replace(/\s/g, '');
    return /^([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})$/.test(cf)
      ? { tipo: 'codice_fiscale', valore: cf, etichetta: 'Codice fiscale' }
      : null;
  }

  const cifre = cifreTelefono(v);
  if (cifre) {
    let et = 'Telefono';
    if (/\bfax\b/.test(e)) et = 'Fax';
    else if (cifre.startsWith('3')) et = 'Cellulare';
    else if (cifre.startsWith('0')) et = 'Telefono fisso';
    else if (cifre.startsWith('80')) et = 'Numero verde';
    return { tipo: 'telefono', valore: v, etichetta: et };
  }
  if (/^[+\d][\d\s./()-]*$/.test(v)) return null;

  const url = hostUrl(v);
  if (url) {
    const social = SOCIAL.find(([re]) => re.test(url.host));
    if (social) {
      // Il profilo, non la home del social: "linkedin.com/in/" da solo non serve
      if (!url.percorso || /^\/(in|company|pub|school|people|groups)$/i.test(url.percorso)) return null;
      return { tipo: social[1], valore: v, etichetta: social[2] };
    }
    return { tipo: 'sito', valore: v, etichetta: etich && /sito|web|www|portale/i.test(etich) ? etich : 'Sito' };
  }

  if (v.length <= 150 && STRADA.test(v) && /\d/.test(v)) {
    const ok = etich && /sede|indirizzo|ufficio|agenzia|residenza|domicilio/i.test(etich);
    return { tipo: 'indirizzo', valore: v, etichetta: ok ? etich : 'Indirizzo' };
  }
  return null;
}

/** Stesso recapito scritto in altro modo (maiuscole, punteggiatura, +39, http/www): stessa chiave. */
export function chiaveRecapito(tipo, valore) {
  const v = String(valore || '').toLowerCase();
  if (tipo === 'telefono') return cifreTelefono(String(valore || '')) || v;
  if (tipo === 'sito' || tipo === 'linkedin' || tipo === 'altro') {
    return v.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
  return v.replace(/[^\p{L}\p{N}@.]/gu, '');
}

function urlFonte(url) {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  return u.length <= 1000 && /^https?:\/\/\S+$/i.test(u) ? u : null;
}

/**
 * Salva un recapito in `contatti` (condivisa da tutti i clienti) se supera la validazione.
 * Non sovrascrive etichetta, fonte_url e ricerca di una riga esistente; un dato del registro la promuove
 * a fonte 'rui'. Restituisce { tipo, valore, nuovo } o null se scartato.
 */
export async function salvaContatto(client, rui, tipo, valore, {
  etichetta, fonte, url, ricercaId, riferitoA = null, societa = null,
} = {}) {
  const r = validaRecapito(valore, { tipo, etichetta });
  if (!r) return null;
  const sorgente = fonte || 'web';
  // Recapito di un'agenzia o societa' per cui lavora il soggetto: si dice di chi e' nell'etichetta
  const etichettaFinale = riferitoA === 'societa_collegata' && societa ? `${r.etichetta} · ${societa}` : r.etichetta;

  const esistenti = await client.query(
    'select valore from contatti where numero_iscrizione_rui = $1 and tipo = $2',
    [rui, r.tipo],
  );
  const chiave = chiaveRecapito(r.tipo, r.valore);
  const gemello = esistenti.rows.find((x) => chiaveRecapito(r.tipo, x.valore) === chiave);
  const v = gemello ? gemello.valore : r.valore;

  const { rows } = await client.query(
    `
    insert into contatti (
      numero_iscrizione_rui, tipo, valore, etichetta, fonte, fonte_url, affidabilita, raccolto_il, ricerca_id, riferito_a
    )
    values ($1, $2, $3, $4, $5, $6, $7, (now() at time zone 'Europe/Rome')::date, $8, $9)
    on conflict (numero_iscrizione_rui, tipo, valore) do update
      set etichetta = case
            when excluded.fonte = 'rui' and contatti.fonte is distinct from 'rui'
              then coalesce(excluded.etichetta, contatti.etichetta)
            else coalesce(contatti.etichetta, excluded.etichetta)
          end,
          fonte = case when excluded.fonte = 'rui' then 'rui' else coalesce(contatti.fonte, excluded.fonte) end,
          fonte_url = coalesce(contatti.fonte_url, excluded.fonte_url),
          affidabilita = case when excluded.fonte = 'rui' then 'ufficiale' else contatti.affidabilita end,
          raccolto_il = coalesce(contatti.raccolto_il, excluded.raccolto_il),
          ricerca_id = coalesce(contatti.ricerca_id, excluded.ricerca_id),
          riferito_a = case when excluded.fonte = 'rui' then 'persona' else coalesce(contatti.riferito_a, excluded.riferito_a) end
    returning (xmax = 0) as nuovo
    `,
    [
      rui, r.tipo, v, etichettaFinale, sorgente, urlFonte(url),
      sorgente === 'rui' ? 'ufficiale' : 'pubblico_recente', ricercaId || null,
      sorgente === 'rui' ? 'persona' : riferitoA,
    ],
  );
  return { tipo: r.tipo, valore: v, nuovo: rows[0]?.nuovo === true };
}

function sintesiOpportunity(web, s) {
  const testoWeb = String(web?.sintesi || '').trim();
  const rui = s?.soggetto?.numero_iscrizione_rui || '';
  const nome = s?.soggetto?.denominazione || rui;
  const eSoloNome = !testoWeb || (testoWeb.includes(rui) && testoWeb.length < 80);
  if (web && !eSoloNome) return testoWeb;
  const sede = (s?.sedi || [])[0];
  const pezzi = [
    `${nome}${rui ? ` (${rui})` : ''}`,
    sede
      ? `Sede RUI: ${[sede.indirizzo_sede, sede.comune_sede, sede.provincia_sede].filter(Boolean).join(', ')}`
      : null,
    web
      ? 'Ricerca web senza recapiti extra pubblici.'
      : 'Ricerca web non configurata: salvati solo sede e sito del registro.',
  ].filter(Boolean);
  return pezzi.join('. ');
}

function giaInCorso() {
  return erroreHttp('ricerca già in corso su questo intermediario: riprova fra qualche minuto.', 409);
}

/**
 * Prenota la ricerca web su un RUI PRIMA di chiamare l'AI, sotto lock per cliente: niente doppioni pagati.
 * - ricerca nuova riuscita negli ultimi GIORNI_RIUSO giorni (qualunque cliente): riga 'cache_*', niente AI;
 * - un'altra ricerca sullo stesso RUI in corso: 409 (l'indice unico parziale vale anche fra clienti diversi);
 * - TETTO_GIORNO ricerche nuove avviate oggi dal cliente (anche fallite o in corso): 429;
 * - altrimenti riga 'in_corso'.
 * Senza cache e con `nuova` false (AI non configurata) non registra niente e restituisce null.
 */
export async function prenotaRicerca(client, clienteId, target, { nuova = true, chiaveId = null, agenzia = null } = {}) {
  try {
    return await inTransazione(client, async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1), $2::int)', ['ricerche_web', clienteId ?? 0]);
      await c.query(
        `update ricerche_web set stato = 'errore', fatta_il = now()
         where rui_target = $1 and stato = 'in_corso'
           and iniziata_il < now() - make_interval(mins => $2)`,
        [target, MINUTI_IN_CORSO],
      );

      const fonte = await c.query(
        `select id, tipo, sintesi, to_char(fatta_il at time zone 'Europe/Rome', 'YYYY-MM-DD') as giorno
         from ricerche_web
         where rui_target = $1 and stato = 'ok' and fornitore = 'mistral'
           and tipo in ('nuova_con_risultati', 'nuova_senza_risultati')
           and fatta_il > now() - make_interval(days => $2)
         order by fatta_il desc
         limit 1`,
        [target, GIORNI_RIUSO],
      );
      if (fonte.rows[0]) {
        const tipo = fonte.rows[0].tipo === 'nuova_con_risultati' ? 'cache_con_risultati' : 'cache_senza_risultati';
        const ins = await c.query(
          `insert into ricerche_web (cliente_id, rui_target, stato, tipo, iniziata_il, fatta_il, costo_eur, chiave_id, agenzia)
           values ($1, $2, 'ok', $3, now(), now(), 0, $4, $5)
           returning id, costo_eur`,
          [clienteId, target, tipo, chiaveId, agenzia],
        );
        return { ...ins.rows[0], tipo, cache: fonte.rows[0] };
      }
      if (!nuova) return null;

      const inCorso = await c.query(
        `select 1 from ricerche_web where rui_target = $1 and stato = 'in_corso' limit 1`,
        [target],
      );
      if (inCorso.rows.length) throw giaInCorso();

      // Il tetto vale per i clienti dell'area riservata; per /v1 il limite lo fa il software chiamante (es. il wallet).
      const oggi = clienteId == null ? { rows: [{ fatte: 0 }] } : await c.query(
        `select count(*)::int as fatte
         from ricerche_web
         where cliente_id = $1
           and coalesce(tipo, '') not like 'cache%'
           and iniziata_il >= (date_trunc('day', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome')`,
        [clienteId],
      );
      if (oggi.rows[0].fatte >= TETTO_GIORNO) {
        throw erroreHttp(`hai già fatto le ${TETTO_GIORNO} ricerche web di oggi: riprova domani.`, 429);
      }

      const ins = await c.query(
        `insert into ricerche_web (cliente_id, rui_target, stato, iniziata_il, fatta_il, chiave_id, agenzia)
         values ($1, $2, 'in_corso', now(), null, $3, $4)
         returning id, costo_eur`,
        [clienteId, target, chiaveId, agenzia],
      );
      return { ...ins.rows[0], tipo: null, cache: null };
    });
  } catch (errore) {
    // Stesso RUI prenotato nello stesso istante da un altro cliente: indice unico su 'in_corso'
    if (errore.code === '23505') throw giaInCorso();
    throw errore;
  }
}

/** Chiude una ricerca prenotata: 'ok' con il tipo di esito, oppure 'errore' (non vale per il riuso). */
export async function chiudiRicerca(client, id, { stato, tipo = null, sintesi = null, costoEur = null }) {
  const { rows } = await client.query(
    `update ricerche_web
     set stato = $2, tipo = $3, sintesi = $4, fatta_il = now(), costo_eur = coalesce($5, costo_eur)
     where id = $1
     returning costo_eur`,
    [id, stato, tipo, sintesi, costoEur],
  );
  return rows[0] || null;
}

const RECAPITI_SQL = `
  select tipo, valore, etichetta, fonte, fonte_url, affidabilita, riferito_a, raccolto_il
  from contatti
  where numero_iscrizione_rui = $1
  order by (riferito_a = 'societa_collegata'), tipo, valore`;

/**
 * Recapiti di un intermediario: dalla cache se la stessa ricerca e' stata fatta negli ultimi GIORNI_RIUSO giorni,
 * altrimenti una ricerca web nuova (prenotata prima, chiusa con esito e costo reale). Comune all'area cliente
 * ("Cerca recapiti") e a /v1/recapiti. Se la ricerca web fallisce la prenotazione va in 'errore' e l'errore risale:
 * niente riga riusabile, niente costo addebitabile.
 */
async function recapitiDi(client, target, { clienteId = null, chiaveId = null, agenzia = null } = {}) {
  const s = await scheda(client, target, { geocodifica: false, contatti: false });

  for (const sede of s.sedi || []) {
    const riga = [sede.indirizzo_sede, sede.cap_sede, sede.comune_sede, sede.provincia_sede]
      .filter(Boolean)
      .join(', ');
    await salvaContatto(client, target, 'indirizzo', riga, {
      etichetta: sede.tipo_sede || 'Sede RUI',
      fonte: 'rui',
    });
  }
  for (const url of s.siti_internet || []) {
    await salvaContatto(client, target, 'sito', url, { etichetta: 'Sito RUI', fonte: 'rui' });
  }

  const ricerca = await prenotaRicerca(client, clienteId, target, { nuova: aiPronta(), chiaveId, agenzia });
  let web = null;
  let costo = ricerca?.costo_eur ?? null;
  let tipo = ricerca?.tipo ?? null;
  if (ricerca && !ricerca.cache) {
    try {
      web = await cercaRecapiti(s);
      // Conta solo i recapiti nuovi del soggetto stesso: la sede del registro rifatta o il centralino
      // dell'agenzia per cui lavora (societa_collegata) non sono un risultato da far pagare.
      let nuovi = 0;
      for (const x of web.recapiti) {
        const out = await salvaContatto(client, target, x.tipo, x.valore, {
          url: x.url,
          ricercaId: ricerca.id,
          fonte: 'mistral_web',
          riferitoA: x.riferito_a,
          societa: x.etichetta,
        });
        if (out?.nuovo && x.riferito_a === 'persona') nuovi += 1;
      }
      tipo = nuovi > 0 ? 'nuova_con_risultati' : 'nuova_senza_risultati';
      const chiusa = await chiudiRicerca(client, ricerca.id, {
        stato: 'ok', tipo, sintesi: sintesiOpportunity(web, s), costoEur: web.costo_eur,
      });
      costo = chiusa?.costo_eur ?? web.costo_eur;
    } catch (errore) {
      await chiudiRicerca(client, ricerca.id, { stato: 'errore' }).catch(() => {});
      throw errore;
    }
  }

  const recapiti = await client.query(RECAPITI_SQL, [target]);
  return {
    scheda: s,
    ricerca_id: ricerca?.id ?? null,
    // 'nuova_con_risultati' | 'nuova_senza_risultati' | 'cache_con_risultati' | 'cache_senza_risultati' | null
    tipo,
    // Costo reale del fornitore AI per questa richiesta: 0 se servita dalla cache, null se nessuna ricerca web
    costo_eur: costo == null ? null : Number(costo),
    // Giorno (ora italiana, YYYY-MM-DD) della ricerca web riusata, altrimenti null
    riusata_il: ricerca?.cache?.giorno ?? null,
    sintesi: ricerca?.cache ? (ricerca.cache.sintesi || sintesiOpportunity(null, s)) : sintesiOpportunity(web, s),
    recapiti: recapiti.rows,
    ricerche: web?.ricerche || [],
  };
}

export async function arricchisciOpportunity(client, {
  rui, rui_target, rui_broker, zona, compagnia,
} = {}) {
  const salvata = await salvaOpportunity(client, {
    rui, rui_target, rui_broker, zona, compagnia,
  });
  const clienteId = salvata.voce.cliente_id;
  const target = salvata.voce.rui_target;
  const esito = await recapitiDi(client, target, { clienteId });

  // Lo stato resta quello scelto dal cliente: 'nuova' finche' non la sposta lui.
  const upd = await client.query(
    `
    update cliente_opportunity
    set sintesi = $3,
        arricchito_il = now()
    where cliente_id = $1 and rui_target = $2
    returning *
    `,
    [clienteId, target, esito.sintesi],
  );

  return {
    ok: true,
    ricerca_id: esito.ricerca_id,
    tipo: esito.tipo,
    costo_eur: esito.costo_eur,
    riusata_il: esito.riusata_il,
    voce: upd.rows[0],
    recapiti: esito.recapiti,
    sintesi: upd.rows[0].sintesi,
    ricerche: esito.ricerche,
  };
}

/**
 * /v1/recapiti/{rui} (chiave API, es. Assicurapp): recapiti di un intermediario A/B/E con il tipo di ricerca
 * e il costo reale; il prezzo per l'utente finale lo decide il software chiamante.
 */
export async function recapitiPerApi(client, rui, { agenzia, chiaveId = null } = {}) {
  const target = normalizzaRui(rui);
  if (!target) throw erroreHttp('numero RUI non valido', 400);
  const soggetto = (await anagrafica(client, target))[0];
  if (!soggetto) throw erroreHttp(`nessun intermediario A/B/E con RUI ${target}`, 404);
  const esito = await recapitiDi(client, target, {
    chiaveId,
    agenzia: testo(agenzia).slice(0, 100) || null,
  });
  return {
    rui: target,
    denominazione: soggetto.denominazione,
    sezione: soggetto.sezione,
    ricerca_id: esito.ricerca_id,
    tipo: esito.tipo,
    costo_eur: esito.costo_eur,
    riusata_il: esito.riusata_il,
    sintesi: esito.sintesi,
    recapiti: esito.recapiti,
  };
}
