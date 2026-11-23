// Opportunity di mercato: salva prospect e recapiti trovati sul web (oggi via Kimi).

import { clienteDaRui } from './cliente.js';
import { approfondisciConKimi, kimiPronta } from './kimi-approfondisci.js';
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
  return { kimi_pronta: kimiPronta(), voci: rows };
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

// Etichette dell'anagrafica RUI che l'AI ripete: non sono recapiti.
const ETICHETTE_REGISTRO = new Set([
  'denominazione', 'rui', 'sezione', 'iscrizione', 'stato', 'sedi', 'mandati', 'intermediari', 'collaborazioni',
]);

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
export async function salvaContatto(client, rui, tipo, valore, { etichetta, fonte, url, ricercaId } = {}) {
  const r = validaRecapito(valore, { tipo, etichetta });
  if (!r) return null;
  const sorgente = fonte || 'kimi_web';

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
      numero_iscrizione_rui, tipo, valore, etichetta, fonte, fonte_url, affidabilita, raccolto_il, ricerca_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, (now() at time zone 'Europe/Rome')::date, $8)
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
          ricerca_id = coalesce(contatti.ricerca_id, excluded.ricerca_id)
    returning (xmax = 0) as nuovo
    `,
    [
      rui, r.tipo, v, r.etichetta, sorgente, urlFonte(url),
      sorgente === 'rui' ? 'ufficiale' : 'pubblico_recente', ricercaId || null,
    ],
  );
  return { tipo: r.tipo, valore: v, nuovo: rows[0]?.nuovo === true };
}

function sintesiOpportunity(kimi, s) {
  const testoKimi = String(kimi?.sintesi || '').trim();
  const rui = s?.soggetto?.numero_iscrizione_rui || '';
  const nome = s?.soggetto?.denominazione || rui;
  const eSoloNome = !testoKimi || (testoKimi.includes(rui) && testoKimi.length < 80);
  if (kimi && !eSoloNome) return testoKimi;
  const sede = (s?.sedi || [])[0];
  const pezzi = [
    `${nome}${rui ? ` (${rui})` : ''}`,
    sede
      ? `Sede RUI: ${[sede.indirizzo_sede, sede.comune_sede, sede.provincia_sede].filter(Boolean).join(', ')}`
      : null,
    kimi
      ? 'Ricerca web senza recapiti extra pubblici.'
      : 'Kimi non configurata: salvati solo sede e sito del registro.',
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
export async function prenotaRicerca(client, clienteId, target, { nuova = true } = {}) {
  try {
    return await inTransazione(client, async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1), $2::int)', ['ricerche_web', clienteId]);
      await c.query(
        `update ricerche_web set stato = 'errore', fatta_il = now()
         where rui_target = $1 and stato = 'in_corso'
           and iniziata_il < now() - make_interval(mins => $2)`,
        [target, MINUTI_IN_CORSO],
      );

      const fonte = await c.query(
        `select id, tipo, sintesi, to_char(fatta_il at time zone 'Europe/Rome', 'YYYY-MM-DD') as giorno
         from ricerche_web
         where rui_target = $1 and stato = 'ok'
           and tipo in ('nuova_con_risultati', 'nuova_senza_risultati')
           and fatta_il > now() - make_interval(days => $2)
         order by fatta_il desc
         limit 1`,
        [target, GIORNI_RIUSO],
      );
      if (fonte.rows[0]) {
        const tipo = fonte.rows[0].tipo === 'nuova_con_risultati' ? 'cache_con_risultati' : 'cache_senza_risultati';
        const ins = await c.query(
          `insert into ricerche_web (cliente_id, rui_target, stato, tipo, iniziata_il, fatta_il)
           values ($1, $2, 'ok', $3, now(), now())
           returning id, costo_eur`,
          [clienteId, target, tipo],
        );
        return { ...ins.rows[0], tipo, cache: fonte.rows[0] };
      }
      if (!nuova) return null;

      const inCorso = await c.query(
        `select 1 from ricerche_web where rui_target = $1 and stato = 'in_corso' limit 1`,
        [target],
      );
      if (inCorso.rows.length) throw giaInCorso();

      const oggi = await c.query(
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
        `insert into ricerche_web (cliente_id, rui_target, stato, iniziata_il, fatta_il)
         values ($1, $2, 'in_corso', now(), null)
         returning id, costo_eur`,
        [clienteId, target],
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
export async function chiudiRicerca(client, id, { stato, tipo = null, sintesi = null }) {
  const { rows } = await client.query(
    `update ricerche_web
     set stato = $2, tipo = $3, sintesi = $4, fatta_il = now()
     where id = $1
     returning costo_eur`,
    [id, stato, tipo, sintesi],
  );
  return rows[0] || null;
}

export async function arricchisciOpportunity(client, {
  rui, rui_target, rui_broker, zona, compagnia,
} = {}) {
  const salvata = await salvaOpportunity(client, {
    rui, rui_target, rui_broker, zona, compagnia,
  });
  const clienteId = salvata.voce.cliente_id;
  const target = salvata.voce.rui_target;
  const s = await scheda(client, target, { geocodifica: false });

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

  const ricerca = await prenotaRicerca(client, clienteId, target, { nuova: kimiPronta() });
  let kimi = null;
  let costo = ricerca?.costo_eur ?? null;
  let tipo = ricerca?.tipo ?? null;
  if (ricerca && !ricerca.cache) {
    try {
      kimi = await approfondisciConKimi(client, {
        q: [
          `Trova i recapiti pubblici di ${s.soggetto.denominazione} (RUI ${target}, intermediario assicurativo Italia).`,
          'Cerca sul web, su LinkedIn e sui social: indirizzo di sede, email, cellulare, LinkedIn, Facebook, Instagram e sito.',
          'Usa le ricerche web anche per LinkedIn e i canali social, non solo per email e telefono.',
          'Non inventare. Se un dato non è pubblico, omettilo.',
        ].join(' '),
        max_web: 3,
        solo_web: true,
        budget_ms: 150_000,
        risultato: {
          scelto: {
            numero_iscrizione_rui: target,
            denominazione: s.soggetto.denominazione,
          },
        },
      });

      // Conta solo i recapiti che prima non c'erano: rifare la sede del registro non è un risultato.
      let nuovi = 0;
      const salva = async (tipoDichiarato, valore, opzioni) => {
        const out = await salvaContatto(client, target, tipoDichiarato, valore, { ...opzioni, ricercaId: ricerca.id });
        if (out?.nuovo) nuovi += 1;
      };
      const fondi = kimi.fondamentali || {};
      if (fondi.email?.valore) {
        await salva('email', fondi.email.valore, { url: fondi.email.url });
      }
      if (fondi.cellulare?.valore) {
        await salva('telefono', fondi.cellulare.valore, { etichetta: 'Cellulare', url: fondi.cellulare.url });
      }
      if (fondi.sede?.valore) {
        await salva('indirizzo', fondi.sede.valore, { etichetta: 'Sede web', url: fondi.sede.url });
      }
      const skipCat = new Set(['anagrafica', 'rete']);
      for (const cat of kimi.categorie || []) {
        if (skipCat.has(cat.id)) continue;
        for (const voce of cat.voci || []) {
          if (ETICHETTE_REGISTRO.has(String(voce.etichetta || '').trim().toLowerCase())) continue;
          await salva(null, voce.valore, { etichetta: voce.etichetta, url: voce.url });
        }
      }

      tipo = nuovi > 0 ? 'nuova_con_risultati' : 'nuova_senza_risultati';
      const chiusa = await chiudiRicerca(client, ricerca.id, {
        stato: 'ok', tipo, sintesi: sintesiOpportunity(kimi, s),
      });
      costo = chiusa?.costo_eur ?? null;
    } catch (errore) {
      await chiudiRicerca(client, ricerca.id, { stato: 'errore' }).catch(() => {});
      throw errore;
    }
  }

  const sintesi = ricerca?.cache
    ? (ricerca.cache.sintesi || sintesiOpportunity(null, s))
    : sintesiOpportunity(kimi, s);

  // Lo stato resta quello scelto dal cliente: 'nuova' finché non la sposta lui.
  const upd = await client.query(
    `
    update cliente_opportunity
    set sintesi = $3,
        arricchito_il = now()
    where cliente_id = $1 and rui_target = $2
    returning *
    `,
    [clienteId, target, sintesi],
  );

  const recapiti = await client.query(
    `
    select tipo, valore, etichetta, fonte, fonte_url, affidabilita
    from contatti
    where numero_iscrizione_rui = $1
    order by tipo, valore
    `,
    [target],
  );

  return {
    ok: true,
    kimi_usata: Boolean(kimi),
    ricerca_id: ricerca?.id ?? null,
    // 'nuova_con_risultati' | 'nuova_senza_risultati' | 'cache_con_risultati' | 'cache_senza_risultati' | null
    tipo,
    // Costo reale del fornitore AI (lo registrerà il lavoro su Mistral); null per ora
    costo_eur: costo == null ? null : Number(costo),
    // Giorno (ora italiana, YYYY-MM-DD) della ricerca web riusata, altrimenti null
    riusata_il: ricerca?.cache?.giorno ?? null,
    voce: upd.rows[0],
    recapiti: recapiti.rows,
    sintesi: upd.rows[0].sintesi,
    passi: kimi?.passi || [],
  };
}
