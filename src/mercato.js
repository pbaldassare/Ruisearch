// Ricerca broker/agenti per zona e mandato, più scheda con sub-agenti.

import { clienteDaRui } from './cliente.js';
import { rete, scheda, sezioniRichieste, SEZIONI_ATTIVE } from './query.js';

const ZONE = {
  ag: ['AG', 'AGRIGENTO'], al: ['AL', 'ALESSANDRIA'], an: ['AN', 'ANCONA'],
  ao: ['AO', 'AOSTA'], ap: ['AP', 'ASCOLI'], aq: ['AQ', "L'AQUILA"],
  ar: ['AR', 'AREZZO'], at: ['AT', 'ASTI'], av: ['AV', 'AVELLINO'],
  ba: ['BA', 'BARI'], bg: ['BG', 'BERGAMO'], bi: ['BI', 'BIELLA'],
  bl: ['BL', 'BELLUNO'], bn: ['BN', 'BENEVENTO'], bo: ['BO', 'BOLOGNA'],
  br: ['BR', 'BRINDISI'], bs: ['BS', 'BRESCIA'], bt: ['BT', 'BARLETTA'],
  bz: ['BZ', 'BOLZANO'], ca: ['CA', 'CAGLIARI'], cb: ['CB', 'CAMPOBASSO'],
  ce: ['CE', 'CASERTA'], ch: ['CH', 'CHIETI'], cl: ['CL', 'CALTANISSETTA'],
  cn: ['CN', 'CUNEO'], co: ['CO', 'COMO'], cr: ['CR', 'CREMONA'],
  cs: ['CS', 'COSENZA'], ct: ['CT', 'CATANIA'], cz: ['CZ', 'CATANZARO'],
  en: ['EN', 'ENNA'], fc: ['FC', 'FORLI'], fe: ['FE', 'FERRARA'],
  fg: ['FG', 'FOGGIA'], fi: ['FI', 'FIRENZE'], fm: ['FM', 'FERMO'],
  fr: ['FR', 'FROSINONE'], ge: ['GE', 'GENOVA'], go: ['GO', 'GORIZIA'],
  gr: ['GR', 'GROSSETO'], im: ['IM', 'IMPERIA'], is: ['IS', 'ISERNIA'],
  kr: ['KR', 'CROTONE'], lc: ['LC', 'LECCO'], le: ['LE', 'LECCE'],
  li: ['LI', 'LIVORNO'], lo: ['LO', 'LODI'], lt: ['LT', 'LATINA'],
  lu: ['LU', 'LUCCA'], mb: ['MB', 'MONZA'], mc: ['MC', 'MACERATA'],
  me: ['ME', 'MESSINA'], mi: ['MI', 'MILANO'], mn: ['MN', 'MANTOVA'],
  mo: ['MO', 'MODENA'], ms: ['MS', 'MASSA'], mt: ['MT', 'MATERA'],
  na: ['NA', 'NAPOLI'], no: ['NO', 'NOVARA'], nu: ['NU', 'NUORO'],
  or: ['OR', 'ORISTANO'], pa: ['PA', 'PALERMO'], pc: ['PC', 'PIACENZA'],
  pd: ['PD', 'PADOVA'], pe: ['PE', 'PESCARA'], pg: ['PG', 'PERUGIA'],
  pi: ['PI', 'PISA'], pn: ['PN', 'PORDENONE'], po: ['PO', 'PRATO'],
  pr: ['PR', 'PARMA'], pt: ['PT', 'PISTOIA'], pu: ['PU', 'PESARO'],
  pv: ['PV', 'PAVIA'], pz: ['PZ', 'POTENZA'], ra: ['RA', 'RAVENNA'],
  rc: ['RC', 'REGGIO CALABRIA'], re: ['RE', 'REGGIO EMILIA'],
  rg: ['RG', 'RAGUSA'], ri: ['RI', 'RIETI'], rm: ['RM', 'ROMA'],
  roma: ['RM', 'ROMA'], rn: ['RN', 'RIMINI'], ro: ['RO', 'ROVIGO'],
  sa: ['SA', 'SALERNO'], si: ['SI', 'SIENA'], so: ['SO', 'SONDRIO'],
  sp: ['SP', 'LA SPEZIA'], sr: ['SR', 'SIRACUSA'], ss: ['SS', 'SASSARI'],
  su: ['SU', 'SUD SARDEGNA'], sv: ['SV', 'SAVONA'], ta: ['TA', 'TARANTO'],
  te: ['TE', 'TERAMO'], tn: ['TN', 'TRENTO'], to: ['TO', 'TORINO'],
  tp: ['TP', 'TRAPANI'], tr: ['TR', 'TERNI'], ts: ['TS', 'TRIESTE'],
  tv: ['TV', 'TREVISO'], ud: ['UD', 'UDINE'], va: ['VA', 'VARESE'],
  vb: ['VB', 'VERBANO'], vc: ['VC', 'VERCELLI'], ve: ['VE', 'VENEZIA'],
  vi: ['VI', 'VICENZA'], vr: ['VR', 'VERONA'], vt: ['VT', 'VITERBO'],
  vv: ['VV', 'VIBO'],
};

function erroreHttp(messaggio, status) {
  const errore = new Error(messaggio);
  errore.statusCode = status;
  return errore;
}

function senzaAccenti(valore) {
  return String(valore || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export function normalizzaZona(valore) {
  const grezzo = String(valore || '').trim();
  if (!grezzo) return { testo: '', provincia: null, comune: null };
  const chiave = senzaAccenti(grezzo);
  const nota = ZONE[chiave];
  if (nota) return { testo: grezzo, provincia: nota[0], comune: nota[1] };
  if (/^[a-z]{2}$/i.test(grezzo)) {
    return { testo: grezzo, provincia: grezzo.toUpperCase(), comune: null };
  }
  return { testo: grezzo, provincia: null, comune: grezzo };
}

/** "broker su Roma con Allianz" → zona/compagnia/sezione. */
export function interpretaQueryMercato(testo) {
  const grezzo = String(testo || '').trim();
  if (!grezzo) return { zona: '', compagnia: '', sezione: '' };

  let sezione = '';
  const haBroker = /\bbroker\b/i.test(grezzo);
  const haAgenti = /\bagent/i.test(grezzo);
  if (haBroker && !haAgenti) sezione = 'B';
  else if (haAgenti && !haBroker) sezione = 'A';

  let compagnia = '';
  const con = grezzo.match(/\bcon\s+([a-z0-9.&'’ -]+)/i);
  if (con) {
    compagnia = con[1].replace(/\s+(su|a|in|di|per)\s+.*/i, '').trim();
  }

  let zona = '';
  const lower = senzaAccenti(grezzo);
  const chiavi = Object.keys(ZONE).sort((a, b) => b.length - a.length);
  for (const chiave of chiavi) {
    if (chiave.length < 2) continue;
    const [prov, comune] = ZONE[chiave];
    const comuni = senzaAccenti(comune);
    if (new RegExp(`\\b${chiave}\\b`, 'i').test(lower) || lower.includes(comuni)) {
      zona = comune;
      break;
    }
    if (prov.length === 2 && new RegExp(`\\b${prov.toLowerCase()}\\b`).test(lower)) {
      zona = comune;
      break;
    }
  }
  if (!zona) {
    const su = grezzo.match(/\b(?:su|a|in)\s+([a-zàèéìòù' ]+?)(?:\s+con\b|$)/i);
    if (su) zona = su[1].trim();
  }

  return { zona, compagnia, sezione };
}

function chiaveRicerca(zona, compagnia, sezioni) {
  const z = senzaAccenti(zona || '').replace(/\s+/g, ' ').trim();
  const c = senzaAccenti(compagnia || '').replace(/\s+/g, ' ').trim();
  const s = [...(sezioni || [])].map((x) => String(x).toUpperCase()).sort().join(',');
  return `${z}|${c}|${s}`;
}

async function persistRicerca(client, ruiCliente, { frase, zona, compagnia, sezioni, nota, items }) {
  const cliente = await clienteDaRui(client, ruiCliente);
  if (!cliente) return null;
  const chiave = chiaveRicerca(zona, compagnia, sezioni);
  const ins = await client.query(
    `
    insert into cliente_ricerca_mercato (
      cliente_id, chiave, frase, zona, compagnia, sezione, nota, aggiornato_il
    )
    values ($1, $2, $3, $4, $5, $6, $7, now())
    on conflict (cliente_id, chiave) do update
      set frase = coalesce(excluded.frase, cliente_ricerca_mercato.frase),
          zona = excluded.zona,
          compagnia = excluded.compagnia,
          sezione = excluded.sezione,
          nota = excluded.nota,
          aggiornato_il = now()
    returning id
    `,
    [
      cliente.id, chiave, frase || null, zona || null, compagnia || null,
      [...sezioni].sort().join(','), nota || null,
    ],
  );
  const ricercaId = ins.rows[0].id;
  for (const r of items) {
    await client.query(
      `
      insert into cliente_ricerca_risultati (
        ricerca_id, rui, denominazione, sezione, inoperativo, subagenti, comuni, province
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (ricerca_id, rui) do update
        set denominazione = excluded.denominazione,
            sezione = excluded.sezione,
            inoperativo = excluded.inoperativo,
            subagenti = excluded.subagenti,
            comuni = excluded.comuni,
            province = excluded.province
      `,
      [
        ricercaId, r.rui, r.denominazione, r.sezione, r.inoperativo,
        Number(r.subagenti) || 0, r.comuni, r.province,
      ],
    );
  }
  return ricercaId;
}

async function leggiRisultati(client, ricercaId) {
  const { rows } = await client.query(
    `
    select rui, denominazione, sezione, inoperativo, subagenti, comuni, province
    from cliente_ricerca_risultati
    where ricerca_id = $1
    order by denominazione, rui
    `,
    [ricercaId],
  );
  return rows;
}

export async function storicoMercato(client, ruiCliente, ricercaId) {
  const cliente = await clienteDaRui(client, ruiCliente);
  if (!cliente) throw erroreHttp(`nessun cliente attivo con RUI ${ruiCliente}`, 404);
  const { rows: ricerche } = await client.query(
    `
    select
      r.id,
      r.frase,
      r.zona,
      r.compagnia,
      r.sezione,
      r.nota,
      r.aggiornato_il,
      (select count(*)::int from cliente_ricerca_risultati x where x.ricerca_id = r.id) as n
    from cliente_ricerca_mercato r
    where r.cliente_id = $1
    order by r.aggiornato_il desc
    limit 20
    `,
    [cliente.id],
  );
  let scelta = ricerche[0] || null;
  if (ricercaId) {
    const id = Number(ricercaId);
    scelta = ricerche.find((r) => Number(r.id) === id) || null;
    if (!scelta) {
      const una = await client.query(
        `
        select id, frase, zona, compagnia, sezione, nota, aggiornato_il
        from cliente_ricerca_mercato
        where cliente_id = $1 and id = $2
        `,
        [cliente.id, id],
      );
      scelta = una.rows[0] || null;
    }
  }
  const items = scelta ? await leggiRisultati(client, scelta.id) : [];
  return {
    ricerche,
    ricerca: scelta,
    items,
  };
}

export async function cercaMercato(client, { zona, compagnia, sezione, limite, q, rui_cliente } = {}) {
  const parsed = interpretaQueryMercato(q);
  const usaFrase = Boolean(String(q || '').trim());
  const sezScelta = usaFrase ? (parsed.sezione || sezione) : sezione;
  const sezioni = sezScelta ? sezioniRichieste(sezScelta) : ['A', 'B'];
  const z = normalizzaZona(usaFrase ? (parsed.zona || zona) : zona);
  const mand = String((usaFrase ? (parsed.compagnia || compagnia) : compagnia) || '').trim();
  if (!z.testo && !mand) {
    throw erroreHttp('indica una zona (es. Roma) o una compagnia (es. Allianz)', 400);
  }

  const limit = Math.min(Math.max(Number(limite) || 40, 1), 80);
  const params = [sezioni];
  const where = ['i.sezione = any($1::text[])', 'i.inoperativo is not true'];

  if (z.provincia || z.comune) {
    const parti = [];
    if (z.provincia) {
      params.push(z.provincia);
      parti.push(`s.provincia_sede = $${params.length}`);
    }
    if (z.comune) {
      params.push(z.comune);
      parti.push(`s.comune_sede ilike '%' || $${params.length} || '%'`);
    }
    if (z.testo && z.testo !== z.comune && z.testo !== z.provincia) {
      params.push(z.testo);
      parti.push(`s.comune_sede ilike '%' || $${params.length} || '%'`);
    }
    where.push(`exists (
      select 1 from sedi s
      where s.numero_iscrizione_int = i.numero_iscrizione_rui
        and (${parti.join(' or ')})
    )`);
  }

  if (mand) {
    params.push(mand);
    where.push(`exists (
      select 1 from mandati m
      where m.matricola = i.numero_iscrizione_rui
        and (
          m.ragione_sociale ilike '%' || $${params.length} || '%'
          or m.codice_compagnia ilike '%' || $${params.length} || '%'
        )
    )`);
  }

  const sql = `
    select distinct on (i.numero_iscrizione_rui)
      i.numero_iscrizione_rui as rui,
      i.denominazione,
      i.sezione,
      i.inoperativo,
      coalesce(n.collaboratori, 0) as subagenti,
      (
        select string_agg(distinct s.comune_sede, ', ')
        from sedi s
        where s.numero_iscrizione_int = i.numero_iscrizione_rui
          and s.comune_sede is not null
      ) as comuni,
      (
        select string_agg(distinct s.provincia_sede, ', ')
        from sedi s
        where s.numero_iscrizione_int = i.numero_iscrizione_rui
          and s.provincia_sede is not null
      ) as province
    from intermediari i
    left join rete_numeri n on n.rui = i.numero_iscrizione_rui
    where ${where.join('\n      and ')}
    order by i.numero_iscrizione_rui, i.inoperativo, i.oss
    limit $${params.length + 1}
  `;
  params.push(limit);
  let { rows } = await client.query(sql, params);

  let nota = null;
  if (rows.length === 0 && mand && sezioni.length === 1 && sezioni[0] === 'B') {
    nota = 'I mandati di compagnia in RUI sono quasi sempre sugli agenti A, non sui broker B. Mostro A e B.';
    params[0] = ['A', 'B'];
    ({ rows } = await client.query(sql, params));
  }

  let ricercaId = null;
  if (rui_cliente) {
    ricercaId = await persistRicerca(client, rui_cliente, {
      frase: String(q || '').trim() || null,
      zona: z.testo,
      compagnia: mand,
      sezioni: params[0],
      nota,
      items: rows,
    });
  }

  return {
    filtri: { zona: z.testo || null, compagnia: mand || null, sezione: params[0] },
    nota,
    items: rows,
    ricerca_id: ricercaId,
    da_archivio: false,
  };
}

export async function schedaMercato(client, rui) {
  const [s, r] = await Promise.all([
    scheda(client, rui, { geocodifica: false }),
    rete(client, rui),
  ]);
  return {
    soggetto: s.soggetto,
    sedi: s.sedi,
    mandati: s.mandati,
    siti_internet: s.siti_internet,
    numeri: s.numeri,
    collaboratori: r.collaboratori || [],
    principali: r.principali || [],
  };
}

export { SEZIONI_ATTIVE };
