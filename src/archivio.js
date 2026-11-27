// Archivio personale di intermediari per agenzia dei software /v1 (es. Assicurapp): tabella agenzia_archivio.
// Identità dell'agenzia = (chiave API, codice agenzia mandato dal software): ognuna vede solo le sue voci.
// Le voci entrano quando l'agenzia apre una scheda, fa una ricerca recapiti o le scrive a mano.
// Telefoni ed email sono SOLO quelli che l'agenzia ha ricevuto dalle sue ricerche (copiati al momento della
// ricerca) o scritto a mano: mai letti dal vivo da `contatti`, che è condivisa da tutti.

import { codiceProvincia } from './mercato.js';
import { chiaveRecapito, validaRecapito } from './opportunity.js';
import { anagrafica, normalizzaRui, patternContiene, sqlInoperativo } from './query.js';

export const STATI = ['archivio', 'da_lavorare', 'contattato', 'scartato'];
export const PER_PAGINA = 50;
const PESO_ORIGINE = { scheda: 0, ricerca: 1, manuale: 2 };

function erroreHttp(messaggio, status) {
  const errore = new Error(messaggio);
  errore.statusCode = status;
  return errore;
}

function testo(valore, massimo = 300) {
  return String(valore ?? '').trim().slice(0, massimo);
}

/** (chiave, agenzia): 0 = chiave RUI_API_KEY del .env. Senza codice agenzia niente archivio. */
function identita(chiaveId, agenzia) {
  const codice = testo(agenzia, 100);
  if (!codice) throw erroreHttp('indica il codice agenzia (campo agenzia)', 400);
  return { chiave: Number(chiaveId) || 0, agenzia: codice };
}

/** Valori di telefono o email (stringa o elenco) validati come in contatti; 400 se uno non lo è. */
function recapitiScritti(valore, tipo) {
  if (valore == null) return [];
  const elenco = (Array.isArray(valore) ? valore : [valore]).map((v) => testo(v)).filter(Boolean);
  return elenco.map((v) => {
    const r = validaRecapito(v, { tipo });
    if (!r || (tipo === 'telefono' ? r.tipo !== 'telefono' : !['email', 'pec'].includes(r.tipo))) {
      throw erroreHttp(`${tipo} non valido: ${v}`, 400);
    }
    return r.valore;
  });
}

/** Aggiunge i nuovi senza doppioni (stesso recapito scritto in altro modo = uguale). */
function unisci(esistenti, nuovi, tipo) {
  const out = [...esistenti];
  for (const n of nuovi) {
    if (!out.some((x) => chiaveRecapito(tipo, x) === chiaveRecapito(tipo, n))) out.push(n);
  }
  return out;
}

// Nome, sezione e sede dal registro per le voci con RUI; per i manuali senza RUI (o RUI uscito dal registro)
// quelli salvati. $1 chiave, $2 agenzia, $3 id, $4 pattern nome, $5 RUI cercato, $6 provincia, $7 concorrente,
// $8 stati.
const FILTRATE = `
  select a.*,
    coalesce(i.denominazione, a.nome) as nome_vivo,
    coalesce(i.sezione, a.sezione) as sezione_viva,
    coalesce(s.provincia_sede, a.provincia) as provincia_viva,
    coalesce(s.comune_sede, a.comune) as comune_vivo,
    coalesce(s.indirizzo_sede, a.indirizzo) as indirizzo_vivo
  from agenzia_archivio a
  left join lateral (
    select x.denominazione, x.sezione
    from intermediari x
    where x.numero_iscrizione_rui = a.rui and x.sezione in ('A', 'B', 'E')
    order by ${sqlInoperativo('x')}, x.oss
    limit 1
  ) i on a.rui is not null
  left join lateral (
    select provincia_sede, comune_sede, indirizzo_sede
    from sedi
    where numero_iscrizione_int = a.rui
    order by tipo_sede, comune_sede
    limit 1
  ) s on a.rui is not null
  where a.chiave_id = $1 and a.agenzia = $2
    and ($3::bigint is null or a.id = $3)
    and ($4::text[] is null or coalesce(i.denominazione, a.nome) ilike any($4) or a.rui = $5::text)
    and ($6::text is null or upper(coalesce(s.provincia_sede, a.provincia)) = $6)
    and ($7::text is null or exists (
      select 1 from rete_collegati r where r.principale = $7 and r.collegato = a.rui))
    and ($8::text[] is null or a.stato = any($8))`;

/**
 * Voci dell'archivio di un'agenzia, 50 per pagina, le più recenti prima.
 * stato: uno o più stati separati da virgola (la sezione "da lavorare" = da_lavorare,contattato,scartato).
 */
export async function elencoArchivio(client, {
  chiaveId, agenzia, q, provincia, concorrente, stato, pagina, id = null,
} = {}) {
  const chi = identita(chiaveId, agenzia);
  const cerca = testo(q, 100);
  let sigla = null;
  if (testo(provincia)) {
    sigla = codiceProvincia(provincia);
    if (!sigla) throw erroreHttp(`provincia non riconosciuta: ${provincia}`, 400);
  }
  const stati = testo(stato) ? testo(stato).split(',').map((x) => x.trim()).filter(Boolean) : null;
  if (stati?.some((x) => !STATI.includes(x))) throw erroreHttp(`stato non valido: ammessi ${STATI.join(', ')}`, 400);
  const n = Math.max(1, Math.trunc(Number(pagina)) || 1);

  const parametri = [
    chi.chiave, chi.agenzia, id, cerca ? patternContiene(cerca) : null, cerca ? normalizzaRui(cerca) : null,
    sigla, testo(concorrente) ? normalizzaRui(concorrente) : null, stati,
  ];
  const [conta, righe] = await Promise.all([
    client.query(`with f as (${FILTRATE}) select count(*)::int as totale from f`, parametri),
    client.query(
      `with f as (${FILTRATE})
       select f.id, f.rui, f.nome_vivo as nome, f.sezione_viva as sezione, f.provincia_viva as provincia,
         f.comune_vivo as comune, f.indirizzo_vivo as indirizzo, f.telefoni, f.email,
         coalesce((
           select json_agg(json_build_object('rui', r.principale, 'denominazione', p.denominazione)
                           order by p.denominazione, r.principale)
           from rete_collegati r
           left join lateral (
             select x.denominazione from intermediari x
             where x.numero_iscrizione_rui = r.principale and x.sezione in ('A', 'B', 'E')
             order by x.inoperativo, x.oss limit 1
           ) p on true
           where r.collegato = f.rui
         ), '[]'::json) as per_chi_lavora,
         f.stato, f.note, f.origine, f.creato_il, f.aggiornato_il, f.recapiti_il
       from f
       order by f.aggiornato_il desc, f.id desc
       limit ${PER_PAGINA} offset $9`,
      [...parametri, (n - 1) * PER_PAGINA],
    ),
  ]);
  return { voci: righe.rows.map((r) => ({ ...r, id: Number(r.id) })), totale: conta.rows[0].totale, pagina: n, per_pagina: PER_PAGINA };
}

async function voce(client, chi, id) {
  const { voci } = await elencoArchivio(client, { chiaveId: chi.chiave, agenzia: chi.agenzia, id });
  return voci[0] || null;
}

/**
 * Crea o aggiorna la voce di un RUI del registro. L'origine sale e non scende (scheda < ricerca < manuale);
 * telefoni ed email si aggiungono a quelli già in archivio. recapitiIl: true = copia di una ricerca recapiti.
 */
async function salvaVoceRui(client, chi, soggetto, {
  origine, telefoni = [], email = [], note = null, recapitiIl = false,
}) {
  const rui = soggetto.numero_iscrizione_rui;
  await client.query(
    `insert into agenzia_archivio (chiave_id, agenzia, rui, nome, sezione, provincia, comune, indirizzo, origine)
     select $1, $2, $3, $4, $5, s.provincia_sede, s.comune_sede, s.indirizzo_sede, $6
     from (select 1) uno
     left join lateral (
       select provincia_sede, comune_sede, indirizzo_sede from sedi
       where numero_iscrizione_int = $3 order by tipo_sede, comune_sede limit 1
     ) s on true
     on conflict (chiave_id, agenzia, rui) where rui is not null do nothing`,
    [chi.chiave, chi.agenzia, rui, soggetto.denominazione || rui, soggetto.sezione || null, origine],
  );
  // ponytail: leggi-poi-scrivi senza lock; due ricerche contemporanee della stessa agenzia sullo stesso RUI
  // possono perdere i recapiti di una (la prima resta in ricerche_web/contatti).
  const { rows: [v] } = await client.query(
    'select id, origine, telefoni, email from agenzia_archivio where chiave_id = $1 and agenzia = $2 and rui = $3',
    [chi.chiave, chi.agenzia, rui],
  );
  await client.query(
    `update agenzia_archivio
     set nome = $2, sezione = coalesce($3, sezione), origine = $4, telefoni = $5, email = $6,
         note = coalesce($7, note), recapiti_il = case when $8 then now() else recapiti_il end, aggiornato_il = now()
     where id = $1`,
    [
      v.id, soggetto.denominazione || rui, soggetto.sezione || null,
      PESO_ORIGINE[origine] > PESO_ORIGINE[v.origine] ? origine : v.origine,
      unisci(v.telefoni, telefoni, 'telefono'), unisci(v.email, email, 'email'), note, recapitiIl,
    ],
  );
  return voce(client, chi, v.id);
}

async function soggettoDelRegistro(client, rui) {
  const numero = normalizzaRui(rui);
  if (!numero) throw erroreHttp('numero RUI non valido', 400);
  const s = (await anagrafica(client, numero))[0];
  if (!s) throw erroreHttp(`nessun intermediario A/B/E con RUI ${numero}`, 404);
  return s;
}

/** POST /v1/archivio/scheda: l'agenzia ha aperto la scheda di un intermediario. Idempotente. */
export async function registraScheda(client, { chiaveId, agenzia, rui } = {}) {
  const chi = identita(chiaveId, agenzia);
  const s = await soggettoDelRegistro(client, rui);
  return { ok: true, voce: await salvaVoceRui(client, chi, s, { origine: 'scheda' }) };
}

/**
 * Dopo POST /v1/recapiti/{rui}: copia nell'archivio dell'agenzia telefoni ed email della risposta appena data.
 * 'gia_richiesta' (gratis) non aggiunge recapiti a una voce che ne ha già da una ricerca: altrimenti ripetendo
 * la richiesta l'agenzia riceverebbe gratis anche quelli trovati dopo da altri. Senza agenzia non fa niente.
 */
export async function registraRicerca(client, { chiaveId, agenzia, esito }) {
  if (!testo(agenzia, 100) || !esito?.rui) return null;
  const chi = identita(chiaveId, agenzia);
  if (esito.tipo === 'gia_richiesta') {
    const { rows } = await client.query(
      `select 1 from agenzia_archivio
       where chiave_id = $1 and agenzia = $2 and rui = $3 and recapiti_il is not null`,
      [chi.chiave, chi.agenzia, esito.rui],
    );
    if (rows.length) {
      await client.query(
        `update agenzia_archivio set aggiornato_il = now()
         where chiave_id = $1 and agenzia = $2 and rui = $3`,
        [chi.chiave, chi.agenzia, esito.rui],
      );
      return null;
    }
  }
  const recapiti = esito.recapiti || [];
  return salvaVoceRui(client, chi, {
    numero_iscrizione_rui: esito.rui, denominazione: esito.denominazione, sezione: esito.sezione,
  }, {
    origine: 'ricerca',
    telefoni: recapiti.filter((r) => r.tipo === 'telefono').map((r) => r.valore),
    email: recapiti.filter((r) => r.tipo === 'email' || r.tipo === 'pec').map((r) => r.valore),
    recapitiIl: true,
  });
}

/**
 * POST /v1/archivio: intermediario scritto a mano. Con un RUI del registro la voce si collega al registro
 * (nome, sezione e sede da lì; se il RUI è già in archivio si aggiungono recapiti e note); senza RUI nome obbligatorio.
 */
export async function inserisciManuale(client, {
  chiaveId, agenzia, rui, nome, telefono, email, provincia, comune, indirizzo, note,
} = {}) {
  const chi = identita(chiaveId, agenzia);
  const telefoni = recapitiScritti(telefono, 'telefono');
  const mail = recapitiScritti(email, 'email');
  const nota = testo(note, 2000) || null;
  if (testo(rui)) {
    const s = await soggettoDelRegistro(client, rui);
    return { ok: true, voce: await salvaVoceRui(client, chi, s, { origine: 'manuale', telefoni, email: mail, note: nota }) };
  }
  if (!testo(nome)) throw erroreHttp('indica il nome', 400);
  const { rows } = await client.query(
    `insert into agenzia_archivio (chiave_id, agenzia, nome, provincia, comune, indirizzo, telefoni, email, note, origine)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manuale')
     returning id`,
    [
      chi.chiave, chi.agenzia, testo(nome, 200), testo(provincia) ? codiceProvincia(provincia) || testo(provincia, 50) : null,
      testo(comune, 100) || null, testo(indirizzo) || null, unisci([], telefoni, 'telefono'), unisci([], mail, 'email'), nota,
    ],
  );
  return { ok: true, voce: await voce(client, chi, rows[0].id) };
}

function idVoce(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw erroreHttp('voce non valida', 400);
  return n;
}

/**
 * POST /v1/archivio/{id}: stato e note sempre. Voci con RUI: telefono/email si aggiungono (i dati anagrafici
 * vengono dal registro). Voci manuali senza RUI: si modifica tutto, telefono/email sostituiscono quelli di prima.
 */
export async function modificaVoce(client, id, { chiaveId, agenzia, ...campi } = {}) {
  const chi = identita(chiaveId, agenzia);
  const voceId = idVoce(id);
  if (campi.stato !== undefined && !STATI.includes(campi.stato)) {
    throw erroreHttp(`stato non valido: ammessi ${STATI.join(', ')}`, 400);
  }
  const { rows: [v] } = await client.query(
    'select id, rui, telefoni, email from agenzia_archivio where id = $1 and chiave_id = $2 and agenzia = $3',
    [voceId, chi.chiave, chi.agenzia],
  );
  if (!v) throw erroreHttp('voce non trovata', 404);
  const anagrafici = ['nome', 'provincia', 'comune', 'indirizzo'].filter((c) => campi[c] !== undefined);
  if (v.rui && anagrafici.length) {
    throw erroreHttp(`intermediario del registro: ${anagrafici.join(', ')} vengono dal registro, si modificano solo stato, note e recapiti`, 400);
  }
  if (campi.nome !== undefined && !testo(campi.nome)) throw erroreHttp('indica il nome', 400);

  const tel = campi.telefono === undefined ? null : recapitiScritti(campi.telefono, 'telefono');
  const mail = campi.email === undefined ? null : recapitiScritti(campi.email, 'email');
  const base = (esistenti) => (v.rui ? esistenti : []);
  await client.query(
    `update agenzia_archivio
     set stato = coalesce($2, stato),
         note = case when $3 then $4 else note end,
         telefoni = coalesce($5, telefoni),
         email = coalesce($6, email),
         nome = coalesce($7, nome),
         provincia = case when $8 then $9 else provincia end,
         comune = case when $10 then $11 else comune end,
         indirizzo = case when $12 then $13 else indirizzo end,
         aggiornato_il = now()
     where id = $1`,
    [
      voceId, campi.stato ?? null,
      campi.note !== undefined, testo(campi.note, 2000) || null,
      tel && unisci(base(v.telefoni), tel, 'telefono'), mail && unisci(base(v.email), mail, 'email'),
      campi.nome === undefined ? null : testo(campi.nome, 200),
      campi.provincia !== undefined, testo(campi.provincia) ? codiceProvincia(campi.provincia) || testo(campi.provincia, 50) : null,
      campi.comune !== undefined, testo(campi.comune, 100) || null,
      campi.indirizzo !== undefined, testo(campi.indirizzo) || null,
    ],
  );
  return { ok: true, voce: await voce(client, chi, voceId) };
}

/** POST /v1/archivio/{id}/elimina: solo voci dell'agenzia. */
export async function eliminaVoce(client, id, { chiaveId, agenzia } = {}) {
  const chi = identita(chiaveId, agenzia);
  const { rowCount } = await client.query(
    'delete from agenzia_archivio where id = $1 and chiave_id = $2 and agenzia = $3',
    [idVoce(id), chi.chiave, chi.agenzia],
  );
  if (!rowCount) throw erroreHttp('voce non trovata', 404);
  return { ok: true };
}
