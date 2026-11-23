// Ricerca broker/agenti per zona e mandato, più scheda con sub-agenti.

import { clienteDaRui } from './cliente.js';
import { patternContiene, scheda, sezioniRichieste, sqlInoperativo, SEZIONI_ATTIVE } from './query.js';

// Province: sigla, capoluogo scritto come in sedi.comune_sede, altri nomi con
// cui si indica la stessa zona (co-capoluoghi, nome della provincia).
const PROVINCE = [
  ['AG', 'AGRIGENTO'], ['AL', 'ALESSANDRIA'], ['AN', 'ANCONA'], ['AO', 'AOSTA'],
  ['AP', 'ASCOLI PICENO', 'ASCOLI'], ['AQ', "L'AQUILA", 'AQUILA'], ['AR', 'AREZZO'],
  ['AT', 'ASTI'], ['AV', 'AVELLINO'], ['BA', 'BARI'], ['BG', 'BERGAMO'], ['BI', 'BIELLA'],
  ['BL', 'BELLUNO'], ['BN', 'BENEVENTO'], ['BO', 'BOLOGNA'], ['BR', 'BRINDISI'],
  ['BS', 'BRESCIA'], ['BT', 'BARLETTA', 'ANDRIA', 'TRANI', 'BARLETTA-ANDRIA-TRANI'],
  ['BZ', 'BOLZANO - BOZEN', 'BOLZANO', 'BOZEN'], ['CA', 'CAGLIARI'], ['CB', 'CAMPOBASSO'],
  ['CE', 'CASERTA'], ['CH', 'CHIETI'], ['CL', 'CALTANISSETTA'], ['CN', 'CUNEO'],
  ['CO', 'COMO'], ['CR', 'CREMONA'], ['CS', 'COSENZA'], ['CT', 'CATANIA'], ['CZ', 'CATANZARO'],
  ['EN', 'ENNA'], ['FC', "FORLI'", 'CESENA', 'FORLI-CESENA'], ['FE', 'FERRARA'],
  ['FG', 'FOGGIA'], ['FI', 'FIRENZE'], ['FM', 'FERMO'], ['FR', 'FROSINONE'], ['GE', 'GENOVA'],
  ['GO', 'GORIZIA'], ['GR', 'GROSSETO'], ['IM', 'IMPERIA'], ['IS', 'ISERNIA'], ['KR', 'CROTONE'],
  ['LC', 'LECCO'], ['LE', 'LECCE'], ['LI', 'LIVORNO'], ['LO', 'LODI'], ['LT', 'LATINA'],
  ['LU', 'LUCCA'], ['MB', 'MONZA', 'MONZA E BRIANZA', 'MONZA BRIANZA'], ['MC', 'MACERATA'],
  ['ME', 'MESSINA'], ['MI', 'MILANO'], ['MN', 'MANTOVA'], ['MO', 'MODENA'],
  ['MS', 'MASSA', 'CARRARA', 'MASSA CARRARA'], ['MT', 'MATERA'], ['NA', 'NAPOLI'],
  ['NO', 'NOVARA'], ['NU', 'NUORO'], ['OR', 'ORISTANO'], ['PA', 'PALERMO'], ['PC', 'PIACENZA'],
  ['PD', 'PADOVA'], ['PE', 'PESCARA'], ['PG', 'PERUGIA'], ['PI', 'PISA'], ['PN', 'PORDENONE'],
  ['PO', 'PRATO'], ['PR', 'PARMA'], ['PT', 'PISTOIA'], ['PU', 'PESARO', 'URBINO', 'PESARO URBINO'],
  ['PV', 'PAVIA'], ['PZ', 'POTENZA'], ['RA', 'RAVENNA'],
  ['RC', 'REGGIO DI CALABRIA', 'REGGIO CALABRIA'], ['RE', "REGGIO NELL'EMILIA", 'REGGIO EMILIA'],
  ['RG', 'RAGUSA'], ['RI', 'RIETI'], ['RM', 'ROMA'], ['RN', 'RIMINI'], ['RO', 'ROVIGO'],
  ['SA', 'SALERNO'], ['SI', 'SIENA'], ['SO', 'SONDRIO'], ['SP', 'LA SPEZIA', 'SPEZIA'],
  ['SR', 'SIRACUSA'], ['SS', 'SASSARI'], ['SU', 'CARBONIA', 'IGLESIAS', 'SUD SARDEGNA'],
  ['SV', 'SAVONA'], ['TA', 'TARANTO'], ['TE', 'TERAMO'], ['TN', 'TRENTO'], ['TO', 'TORINO'],
  ['TP', 'TRAPANI'], ['TR', 'TERNI'], ['TS', 'TRIESTE'], ['TV', 'TREVISO'], ['UD', 'UDINE'],
  ['VA', 'VARESE'], ['VB', 'VERBANIA', 'VERBANO CUSIO OSSOLA', 'VERBANO'], ['VC', 'VERCELLI'],
  ['VE', 'VENEZIA'], ['VI', 'VICENZA'], ['VR', 'VERONA'], ['VT', 'VITERBO'],
  ['VV', 'VIBO VALENTIA', 'VIBO'],
];

function erroreHttp(messaggio, status) {
  const errore = new Error(messaggio);
  errore.statusCode = status;
  return errore;
}

function senzaAccenti(valore) {
  return String(valore || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/** "Forlì", "FORLI'", "forli-cesena" → "forli", "forli cesena": per confrontare i nomi. */
function nomeNormalizzato(valore) {
  return senzaAccenti(valore).replace(/[^a-z0-9]+/g, ' ').trim();
}

const CODICI = new Set(PROVINCE.map(([codice]) => codice));
const CAPOLUOGHI = new Map(PROVINCE.map(([codice, capoluogo]) => [codice, capoluogo]));
const NOMI = new Map(); // nome normalizzato → sigla
for (const [codice, ...nomi] of PROVINCE) {
  for (const nome of nomi) NOMI.set(nomeNormalizzato(nome), codice);
}
// I nomi piu' lunghi prima: "reggio emilia" non deve fermarsi a un nome piu' corto.
const NOMI_PER_LUNGHEZZA = [...NOMI.keys()].sort((a, b) => b.length - a.length);

/** Sigla di provincia da una sigla valida o da un nome (capoluogo o provincia). */
export function codiceProvincia(valore) {
  const grezzo = String(valore || '').trim();
  if (/^[a-z]{2}$/i.test(grezzo)) return CODICI.has(grezzo.toUpperCase()) ? grezzo.toUpperCase() : null;
  return NOMI.get(nomeNormalizzato(grezzo)) || null;
}

/**
 * Zona scritta dall'utente → filtro sulle sedi.
 * Un capoluogo (o il nome della provincia) cerca in TUTTA la provincia: chi
 * scrive "Brescia" cerca la zona, non solo il comune (353 sedi nel comune,
 * 1.097 in provincia). Un altro comune cerca il comune.
 */
export function normalizzaZona(valore) {
  const grezzo = String(valore || '').trim();
  if (!grezzo) return { testo: '', provincia: null, comune: null };
  if (/^[a-z]{2}$/i.test(grezzo)) {
    return { testo: grezzo, provincia: grezzo.toUpperCase(), comune: null };
  }
  const codice = NOMI.get(nomeNormalizzato(grezzo));
  if (codice) return { testo: grezzo, provincia: codice, comune: null, capoluogo: true };
  return { testo: grezzo, provincia: null, comune: grezzo };
}

/**
 * Zona dentro una frase. Una sigla vale solo se e' chiaramente una provincia:
 * dopo "provincia di", da sola dopo "a/su/in", oppure scritta in maiuscolo
 * ("broker TO"). Mai parole italiane come su, le, al, in minuscolo.
 */
function trovaZona(testo) {
  const t = ` ${testo} `;
  const fine = String.raw`(?=\s*(?:[,.;:?!]|\bcon\b|\be\s+(?:provincia|dintorni|hinterland)\b|$))`;

  const prov = t.match(new RegExp(String.raw`\bprov(?:incia|\.)?\s+(?:di\s+)?([a-zà-ù' -]+?)${fine}`, 'i'));
  if (prov) return prov[1].trim();

  const prep = t.match(new RegExp(
    String.raw`\s(?:su|a|ad|in|nel|nella|nei|zona|presso)\s+(?:zona\s+)?([a-zà-ù' -]+?)${fine}`, 'i',
  ));
  if (prep && prep[1].trim()) {
    const zona = prep[1].trim();
    if (/^[a-z]{2}$/i.test(zona)) return CODICI.has(zona.toUpperCase()) ? zona.toUpperCase() : '';
    return zona;
  }

  // Nessuna preposizione: un capoluogo citato ovunque ("broker al centro di Torino").
  const norm = ` ${nomeNormalizzato(testo)} `;
  const nome = NOMI_PER_LUNGHEZZA.find((n) => norm.includes(` ${n} `));
  if (nome) return CAPOLUOGHI.get(NOMI.get(nome));

  // Sigla in maiuscolo, solo se la frase non e' tutta in maiuscolo.
  if (/[a-zà-ù]/.test(testo)) {
    const sigla = (testo.match(/\b[A-Z]{2}\b/g) || []).find((s) => CODICI.has(s));
    if (sigla) return sigla;
  }
  return '';
}

/** "broker su Roma con Allianz" → zona/compagnia/sezione. */
export function interpretaQueryMercato(testo) {
  const grezzo = String(testo || '').trim().replace(/[’`]/g, "'");
  if (!grezzo) return { zona: '', compagnia: '', sezione: '' };

  let sezione = '';
  const haBroker = /\bbroker\b/i.test(grezzo);
  const haAgenti = /\bagent/i.test(grezzo);
  if (haBroker && !haAgenti) sezione = 'B';
  else if (haAgenti && !haBroker) sezione = 'A';

  // "con sede a Torino" indica la zona, non una compagnia.
  let resto = grezzo.replace(/\bcon\s+sede(?:\s+(?:legale|operativa|secondaria))?(?=\s|$)/gi, ' ');
  let compagnia = '';
  // "con Allianz", "con le Generali", "con mandato Generali", "con mandato di Unipol".
  const con = resto.match(
    /\bcon\s+(?:(?:il|lo|la|le|gli|i|un|una)\s+)?(?:mandat[oi]\s+(?:(?:con|di|del|della|per)\s+)?)?(?:(?:il|lo|la|le|gli|i)\s+)?(?:compagni[ae]\s+)?([a-z0-9à-ù.&' -]+)/i,
  );
  if (con) {
    const coda = con[1].match(/\s+(?:su|a|ad|in|di|per|nel|nella|nei|zona|presso|provincia)\s.*$/i);
    compagnia = (coda ? con[1].slice(0, coda.index) : con[1]).trim();
    // La zona si cerca nel resto della frase, senza il nome della compagnia.
    resto = `${resto.slice(0, con.index)} ${coda ? coda[0] : ''} ${resto.slice(con.index + con[0].length)}`;
  }

  return { zona: trovaZona(resto.replace(/\s+/g, ' ').trim()), compagnia, sezione };
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
  if (items.length === 0) return ricercaId;
  // Un solo insert per tutti i risultati: uno per riga costava un viaggio di
  // rete ciascuno (40 righe = oltre 2 secondi).
  await client.query(
    `
    insert into cliente_ricerca_risultati (
      ricerca_id, rui, denominazione, sezione, inoperativo, subagenti, comuni, province
    )
    select $1, r.rui, r.denominazione, r.sezione, r.inoperativo, r.subagenti, r.comuni, r.province
    from jsonb_to_recordset($2::jsonb) as r(
      rui text, denominazione text, sezione text, inoperativo boolean,
      subagenti integer, comuni text, province text
    )
    on conflict (ricerca_id, rui) do update
      set denominazione = excluded.denominazione,
          sezione = excluded.sezione,
          inoperativo = excluded.inoperativo,
          subagenti = excluded.subagenti,
          comuni = excluded.comuni,
          province = excluded.province
    `,
    [
      ricercaId,
      JSON.stringify(items.map((r) => ({
        rui: r.rui,
        denominazione: r.denominazione,
        sezione: r.sezione,
        inoperativo: r.inoperativo,
        subagenti: Number(r.subagenti) || 0,
        comuni: r.comuni,
        province: r.province,
      }))),
    ],
  );
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
  const where = ['i.sezione = any($1::text[])', `not ${sqlInoperativo('i')}`];

  if (z.provincia || z.comune) {
    const parti = [];
    if (z.provincia) {
      params.push(z.provincia);
      parti.push(`s.provincia_sede = $${params.length}`);
    }
    if (z.comune) {
      // Con l'accento, con l'apostrofo (FORLI', CANTU') e senza; % e _ non sono jolly.
      params.push(patternContiene(z.comune));
      parti.push(`s.comune_sede ilike any($${params.length}::text[])`);
    }
    where.push(`exists (
      select 1 from sedi s
      where s.numero_iscrizione_int = i.numero_iscrizione_rui
        and (${parti.join(' or ')})
    )`);
  }

  if (mand) {
    params.push(patternContiene(mand));
    where.push(`exists (
      select 1 from mandati m
      where m.matricola = i.numero_iscrizione_rui
        and (
          m.ragione_sociale ilike any($${params.length}::text[])
          or m.codice_compagnia ilike any($${params.length}::text[])
        )
    )`);
  }

  // Prima gli operativi, poi per nome: non i RUI piu' vecchi. Il totale e'
  // contato prima del limit.
  const sql = `
    with trovati as (
      select distinct on (i.numero_iscrizione_rui)
        i.numero_iscrizione_rui as rui,
        i.denominazione,
        i.sezione,
        ${sqlInoperativo('i')} as inoperativo
      from intermediari i
      where ${where.join('\n        and ')}
      order by i.numero_iscrizione_rui, 4, i.oss
    )
    select
      t.rui,
      t.denominazione,
      t.sezione,
      t.inoperativo,
      coalesce(n.collaboratori, 0) as subagenti,
      (
        select string_agg(distinct s.comune_sede, ', ')
        from sedi s
        where s.numero_iscrizione_int = t.rui
          and s.comune_sede is not null
      ) as comuni,
      (
        select string_agg(distinct s.provincia_sede, ', ')
        from sedi s
        where s.numero_iscrizione_int = t.rui
          and s.provincia_sede is not null
      ) as province,
      count(*) over () as totale
    from trovati t
    left join rete_numeri n on n.rui = t.rui
    order by t.inoperativo, t.denominazione, t.rui
    limit $${params.length + 1}
  `;
  params.push(limit);
  let { rows } = await client.query(sql, params);

  const note = [];
  if (rows.length === 0 && mand && sezioni.length === 1 && sezioni[0] === 'B') {
    note.push('I mandati di compagnia in RUI sono quasi sempre sugli agenti A, non sui broker B. Mostro A e B.');
    params[0] = ['A', 'B'];
    ({ rows } = await client.query(sql, params));
  }

  // count(*) over () conta le righe prima del limit: e' il totale vero.
  const totale = rows.length ? Number(rows[0].totale) : 0;
  rows = rows.map(({ totale: _t, ...r }) => r);
  if (z.capoluogo) {
    note.push(`${z.testo}: cerco in tutta la provincia (${z.provincia}), non solo nel comune.`);
  }
  const troncato = totale > rows.length;
  if (troncato) {
    note.push(`Mostro i primi ${rows.length} di ${totale.toLocaleString('it-IT')} in ordine alfabetico: `
      + 'aggiungi una compagnia o un comune per restringere.');
  }
  const nota = note.length ? note.join(' ') : null;

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
    filtri: {
      zona: z.testo || null,
      compagnia: mand || null,
      sezione: params[0],
      provincia: z.provincia || null,
      comune: z.comune || null,
    },
    nota,
    items: rows,
    totale,
    troncato,
    ricerca_id: ricercaId,
    da_archivio: false,
  };
}

export async function schedaMercato(client, rui) {
  // La scheda contiene gia' la rete: niente seconda lettura.
  const s = await scheda(client, rui, { geocodifica: false, contatti: false });
  return {
    soggetto: s.soggetto,
    sedi: s.sedi,
    mandati: s.mandati,
    siti_internet: s.siti_internet,
    numeri: s.numeri,
    collaboratori: s.rete.collaboratori || [],
    principali: s.rete.principali || [],
  };
}

export { SEZIONI_ATTIVE };
