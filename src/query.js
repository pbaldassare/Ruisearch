// Lettura del registro gia' importato. Solo SELECT.
// Teniamo A, B, E. Un arco di rete resta solo se entrambi gli estremi sono A/B/E.
//
// Ogni query verso Supabase costa un viaggio di rete (~65 ms): le query
// indipendenti partono insieme sul pool invece che una dopo l'altra.

import { getPool } from './db.js';

export const SEZIONI_ATTIVE = Object.freeze(['A', 'B', 'E']);

export function normalizzaRui(valore) {
  return String(valore || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function sembraRui(valore) {
  return /^[ABE][0-9]{5,}$/.test(normalizzaRui(valore));
}

export function sezioniRichieste(sezione) {
  if (sezione == null || String(sezione).trim() === '') {
    return [...SEZIONI_ATTIVE];
  }
  const s = String(sezione).trim().toUpperCase();
  if (!SEZIONI_ATTIVE.includes(s)) {
    const errore = new Error(`sezione non ammessa: ${sezione}. Solo A, B, E.`);
    errore.statusCode = 400;
    throw errore;
  }
  return [s];
}

function clamp(valore, fallback, massimo) {
  const n = Number(valore);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), massimo);
}

function manca(rui) {
  const errore = new Error(`nessun intermediario A/B/E con RUI ${rui}`);
  errore.statusCode = 404;
  throw errore;
}

/**
 * Anagrafica di un RUI collegato, una riga sola (il numero non e' univoco
 * nella fonte: vince l'iscrizione operativa). Va usata con LATERAL: cerca
 * solo i RUI che servono invece di rileggere tutti i 226.000 iscritti.
 */
function anagLaterale(alias, colonnaRui, { obbligatoria = true } = {}) {
  return `
    ${obbligatoria ? 'join' : 'left join'} lateral (
      select x.numero_iscrizione_rui, x.sezione, x.denominazione, x.inoperativo
      from intermediari x
      where x.numero_iscrizione_rui = ${colonnaRui}
        and x.sezione = any($1::text[])
      order by x.inoperativo, x.oss
      limit 1
    ) ${alias} on true`;
}

/** KPI + ultimo import. I conteggi rispettano il filtro A/B/E. */
export async function overview(client, { sezione } = {}) {
  const sezioni = sezioniRichieste(sezione);
  const { rows } = await client.query(
    `
    select
      (select count(*)::bigint from intermediari
        where sezione = any($1::text[])) as intermediari,
      (select count(*)::bigint from rete_collegati r
        where r.sezione_principale = any($1::text[])
          and r.sezione_collegato = any($1::text[])) as collaborazioni,
      (select count(*)::bigint from sedi s
        where exists (
          select 1 from intermediari i
          where i.numero_iscrizione_rui = s.numero_iscrizione_int
            and i.sezione = any($1::text[])
        )) as sedi,
      (select count(*)::bigint from mandati m
        where exists (
          select 1 from intermediari i
          where i.numero_iscrizione_rui = m.matricola
            and i.sezione = any($1::text[])
        )) as mandati
    `,
    [sezioni],
  );
  const ultimo = await ultimoImport(client);
  const rete = await client.query(
    `select ricostruita_il, archi, soggetti from rete_stato where id = 1`,
  );
  return { ...rows[0], ultimo_import: ultimo, rete: rete.rows[0] || null };
}

export async function ultimoImport(client) {
  const { rows } = await client.query(
    `
    select id, iniziato_il, concluso_il, esito, zip_sha256, zip_bytes, righe_totali, errore
    from import_runs
    order by id desc
    limit 1
    `,
  );
  return rows[0] ?? null;
}

export async function storicoImport(client, { limite } = {}) {
  const limit = clamp(limite, 20, 50);
  const { rows } = await client.query(
    `
    select id, iniziato_il, concluso_il, esito, zip_sha256, zip_bytes, righe_totali, errore
    from import_runs
    order by id desc
    limit $1
    `,
    [limit],
  );
  return rows;
}

// Righe massime di un export CSV: abbastanza per una provincia, non per tutto il registro.
export const MASSIMO_EXPORT = 5000;

function limitePagina(limite, esporta) {
  return esporta ? MASSIMO_EXPORT : clamp(limite, 40, 80);
}

/**
 * Esegue la pagina e, solo sulla prima, il conteggio totale: le due query
 * partono insieme per non sommare i tempi di rete.
 */
async function paginaConTotale({ sql, conteggio, params, paramsConteggio, primaPagina }) {
  const db = getPool();
  const [righe, totale] = await Promise.all([
    db.query(sql, params),
    primaPagina ? db.query(conteggio, paramsConteggio) : Promise.resolve(null),
  ]);
  return { rows: righe.rows, totale: totale ? Number(totale.rows[0].n) : null };
}

/**
 * Elenco / ricerca. RUI esatto, oppure nome: prima chi inizia con il testo,
 * poi chi lo contiene, poi i nomi simili. Senza testo: ordine alfabetico con
 * paginazione keyset su (denominazione, oss).
 */
export async function cercaIntermediari(client, {
  q, sezione, dopoNome, dopoOss, limite, esporta = false,
} = {}) {
  const sezioni = sezioniRichieste(sezione);
  const limit = limitePagina(limite, esporta);
  const testo = (q || '').trim();
  const params = [sezioni];
  const where = ['i.sezione = any($1::text[])'];
  let indiceTesto = null;
  const rui = sembraRui(testo);

  if (testo) {
    params.push(rui ? normalizzaRui(testo) : testo);
    indiceTesto = params.length;
    if (rui) {
      where.push(`i.numero_iscrizione_rui = $${indiceTesto}`);
    } else {
      where.push(`(
        i.numero_iscrizione_rui = upper($${indiceTesto})
        or i.denominazione ilike '%' || $${indiceTesto} || '%'
        or i.denominazione % $${indiceTesto}
      )`);
    }
  }
  const whereConteggio = [...where];
  const paramsConteggio = [...params];
  const perPertinenza = Boolean(indiceTesto && !rui);

  const cursore = dopoNome != null && dopoNome !== '' && dopoOss != null && dopoOss !== '';
  if (cursore) {
    params.push(dopoNome, Number(dopoOss));
    where.push(`(i.denominazione, i.oss) > ($${params.length - 1}, $${params.length}::bigint)`);
  }

  params.push(limit + 1);
  const order = perPertinenza && !cursore
    ? `(i.denominazione ilike $${indiceTesto} || '%') desc,
       (i.denominazione ilike '%' || $${indiceTesto} || '%') desc,
       similarity(i.denominazione, $${indiceTesto}) desc, i.denominazione, i.oss`
    : 'i.denominazione, i.oss';

  const { rows, totale } = await paginaConTotale({
    sql: `
      select
        i.oss, i.numero_iscrizione_rui, i.sezione, i.denominazione, i.data_iscrizione,
        i.inoperativo, i.persona_giuridica, i.comune_nascita, i.provincia_nascita
      from intermediari i
      where ${where.join('\n        and ')}
      order by ${order}
      limit $${params.length}
    `,
    params,
    conteggio: `select count(*) as n from intermediari i where ${whereConteggio.join(' and ')}`,
    paramsConteggio,
    primaPagina: !cursore,
  });

  // Con un testo l'ordine e' per pertinenza: si mostrano i migliori risultati
  // e il totale; per vederli tutti c'e' l'export. Niente pagine successive.
  const hasMore = rows.length > limit && !perPertinenza;
  const items = rows.slice(0, limit);
  const ultimo = items[items.length - 1];
  return {
    items,
    totale,
    prossimo: hasMore && ultimo
      ? { dopo_nome: ultimo.denominazione, dopo_oss: String(ultimo.oss) }
      : null,
  };
}

export async function anagrafica(client, rui, { sezione } = {}) {
  const numero = normalizzaRui(rui);
  if (!numero) manca(rui);
  const sezioni = sezioniRichieste(sezione);
  const { rows } = await client.query(
    `
    select *
    from intermediari
    where numero_iscrizione_rui = $2
      and sezione = any($1::text[])
    order by inoperativo, oss
    `,
    [sezioni, numero],
  );
  return rows;
}

export async function rete(client, rui, { sezione } = {}) {
  const numero = normalizzaRui(rui);
  const sezioni = sezioniRichieste(sezione);
  const db = getPool();
  const soggetti = await anagrafica(db, numero, { sezione });
  if (soggetti.length === 0) manca(numero);

  const [principali, collaboratori] = await Promise.all([db.query(
    `
    select
      r.livello,
      r.qualifica,
      r.principale as rui_collegato,
      i.denominazione,
      i.sezione,
      i.inoperativo
    from rete_collegati r
    ${anagLaterale('i', 'r.principale')}
    where r.collegato = $2
      and r.sezione_principale = any($1::text[])
    order by i.denominazione, r.principale
    `,
    [sezioni, numero],
  ), db.query(
    `
    select
      r.livello,
      r.qualifica,
      r.collegato as rui_collegato,
      i.denominazione,
      i.sezione,
      i.inoperativo
    from rete_collegati r
    ${anagLaterale('i', 'r.collegato')}
    where r.principale = $2
      and r.sezione_collegato = any($1::text[])
    order by i.denominazione, r.collegato
    `,
    [sezioni, numero],
  )]);

  const nodiMap = new Map();
  const centro = soggetti[0];
  nodiMap.set(numero, {
    rui: numero,
    denominazione: centro.denominazione,
    sezione: centro.sezione,
    ruolo: 'centro',
    inoperativo: centro.inoperativo,
  });

  const archi = [];
  for (const r of principali.rows) {
    nodiMap.set(r.rui_collegato, {
      rui: r.rui_collegato,
      denominazione: r.denominazione,
      sezione: r.sezione,
      ruolo: 'principale',
      inoperativo: r.inoperativo,
    });
    archi.push({
      da: r.rui_collegato,
      a: numero,
      qualifica: r.qualifica,
      livello: r.livello,
    });
  }
  for (const r of collaboratori.rows) {
    if (!nodiMap.has(r.rui_collegato)) {
      nodiMap.set(r.rui_collegato, {
        rui: r.rui_collegato,
        denominazione: r.denominazione,
        sezione: r.sezione,
        ruolo: 'collaboratore',
        inoperativo: r.inoperativo,
      });
    }
    archi.push({
      da: numero,
      a: r.rui_collegato,
      qualifica: r.qualifica,
      livello: r.livello,
    });
  }

  return {
    soggetto: {
      numero_iscrizione_rui: numero,
      denominazione: centro.denominazione,
      sezione: centro.sezione,
      inoperativo: centro.inoperativo,
    },
    principali: principali.rows,
    collaboratori: collaboratori.rows,
    grafo: { nodi: [...nodiMap.values()], archi },
  };
}

export async function scheda(client, rui, { sezione, geocodifica = true } = {}) {
  const numero = normalizzaRui(rui);
  const sezioni = sezioniRichieste(sezione);
  const db = getPool();
  const soggetti = await anagrafica(db, numero, { sezione });
  if (soggetti.length === 0) manca(numero);
  const soggetto = soggetti[0];
  const conEreditati = soggetto.sezione === 'E' || !soggetto.persona_giuridica;

  const [sedi, siti, mandati, cariche, contatti, reteSoggetto, numeri, mandatiEreditati] = await Promise.all([
    db.query(
      `
      select oss, tipo_sede, comune_sede, provincia_sede, cap_sede, indirizzo_sede
      from sedi
      where numero_iscrizione_int = $1
      order by tipo_sede, comune_sede
      `,
      [numero],
    ),
    db.query(`select web_url from siti_internet where numero_iscrizione = $1 order by web_url`, [numero]),
    db.query(
      `
      select codice_compagnia, ragione_sociale
      from mandati
      where matricola = $1
      order by ragione_sociale
      `,
      [numero],
    ),
    db.query(
      `
      select
        c.qualifica_intermediario as qualifica,
        c.responsabile,
        c.numero_iscrizione_rui_pf as persona_rui,
        pf.denominazione as persona,
        c.numero_iscrizione_rui_pg as societa_rui,
        pg.denominazione as societa
      from cariche c
      ${anagLaterale('pf', 'c.numero_iscrizione_rui_pf', { obbligatoria: false })}
      ${anagLaterale('pg', 'c.numero_iscrizione_rui_pg', { obbligatoria: false })}
      where c.numero_iscrizione_rui_pg = $2
         or c.numero_iscrizione_rui_pf = $2
      order by pg.denominazione, pf.denominazione
      `,
      [sezioni, numero],
    ),
    db.query(
      `
      select tipo, valore, etichetta, affidabilita, fonte, fonte_url
      from contatti
      where numero_iscrizione_rui = $1
      order by tipo, valore
      `,
      [numero],
    ),
    rete(db, numero, { sezione }),
    numeriDi(db, numero),
    conEreditati ? mandatiViaPrincipali(db, numero) : Promise.resolve([]),
  ]);

  let mappa = [];
  if (geocodifica && soggetto.persona_giuridica && sedi.rows.length > 0) {
    const { puntiSedi } = await import('./geo.js');
    mappa = await puntiSedi(db, numero, sedi.rows, { geocodifica: true });
  }

  return {
    soggetto,
    omonimi_rui: soggetti.slice(1),
    numeri,
    profilo: soggetto.persona_giuridica ? 'azienda' : soggetto.sezione === 'E' ? 'sezione_e' : 'persona',
    sedi: sedi.rows,
    mappa,
    siti_internet: siti.rows.map((r) => r.web_url),
    mandati: mandati.rows,
    mandati_via_principali: mandatiEreditati,
    cariche: cariche.rows,
    contatti: contatti.rows,
    rete: {
      principali: reteSoggetto.principali,
      collaboratori: reteSoggetto.collaboratori,
      grafo: reteSoggetto.grafo,
    },
  };
}

export async function numeriDi(client, rui) {
  const n = normalizzaRui(rui);
  const { rows } = await client.query(
    `
    select
      coalesce(n.collaboratori, 0)::bigint as intermediari,
      coalesce(n.rapporti, 0)::bigint as collaborazioni,
      (select count(*)::bigint from mandati where matricola = $1) as mandati,
      (select count(*)::bigint from sedi where numero_iscrizione_int = $1) as sedi
    from (select $1::text as rui) q
    left join rete_numeri n on n.rui = q.rui
    `,
    [n],
  );
  return rows[0];
}

export async function mandatiViaPrincipali(client, rui) {
  const n = normalizzaRui(rui);
  const { rows } = await client.query(
    `
    select distinct on (m.codice_compagnia, m.ragione_sociale, p.numero_iscrizione_rui)
      p.numero_iscrizione_rui as rui_principale,
      p.denominazione as principale,
      p.sezione as sezione_principale,
      m.codice_compagnia,
      m.ragione_sociale
    from collaboratori c
    join intermediari p on p.numero_iscrizione_rui = c.num_iscr_intermediario
    join mandati m on m.matricola = p.numero_iscrizione_rui
    where (c.num_iscr_collaboratori_i_liv = $1 or c.num_iscr_collaboratori_ii_liv = $1)
      and p.sezione = any($2::text[])
    order by m.codice_compagnia, m.ragione_sociale, p.numero_iscrizione_rui
    `,
    [n, SEZIONI_ATTIVE],
  );
  return rows;
}

function filtroElenco({ q, sezione, dopoOss, limite, esporta }, campi) {
  const sezioni = sezioniRichieste(sezione);
  const params = [sezioni];
  const where = [...campi.base];
  if (q) {
    params.push(String(q).trim());
    where.push(campi.testo(params.length));
  }
  const whereConteggio = [...where];
  const paramsConteggio = [...params];
  const cursore = dopoOss != null && dopoOss !== '';
  if (cursore) {
    params.push(Number(dopoOss));
    where.push(`${campi.oss} > $${params.length}::bigint`);
  }
  const limit = limitePagina(limite, esporta);
  params.push(limit + 1);
  return { params, where, whereConteggio, paramsConteggio, cursore, limit };
}

export async function elencoSedi(client, {
  q, sezione, dopoOss, limite, esporta = false,
} = {}) {
  const f = filtroElenco({ q, sezione, dopoOss, limite, esporta }, {
    base: ['i.sezione = any($1::text[])'],
    oss: 's.oss',
    testo: (n) => `(
      s.comune_sede ilike '%' || $${n} || '%'
      or s.indirizzo_sede ilike '%' || $${n} || '%'
      or i.denominazione ilike '%' || $${n} || '%'
      or s.numero_iscrizione_int = upper($${n})
      or s.provincia_sede = upper($${n})
    )`,
  });
  const daJoin = `
    from sedi s
    join intermediari i on i.numero_iscrizione_rui = s.numero_iscrizione_int`;
  const { rows, totale } = await paginaConTotale({
    sql: `
      select distinct on (s.oss)
        s.oss, s.numero_iscrizione_int as rui, i.denominazione, i.sezione,
        s.tipo_sede, s.comune_sede, s.provincia_sede, s.cap_sede, s.indirizzo_sede
      ${daJoin}
      where ${f.where.join(' and ')}
      order by s.oss, i.inoperativo
      limit $${f.params.length}
    `,
    params: f.params,
    conteggio: `select count(distinct s.oss) as n ${daJoin} where ${f.whereConteggio.join(' and ')}`,
    paramsConteggio: f.paramsConteggio,
    primaPagina: !f.cursore,
  });
  return { ...pagina(rows, f.limit, (r) => ({ dopo_oss: String(r.oss) })), totale };
}

export async function elencoMandati(client, {
  q, sezione, dopoOss, limite, esporta = false,
} = {}) {
  const f = filtroElenco({ q, sezione, dopoOss, limite, esporta }, {
    base: ['i.sezione = any($1::text[])'],
    oss: 'm.oss',
    testo: (n) => `(
      m.ragione_sociale ilike '%' || $${n} || '%'
      or m.codice_compagnia ilike '%' || $${n} || '%'
      or i.denominazione ilike '%' || $${n} || '%'
      or m.matricola = upper($${n})
    )`,
  });
  const daJoin = `
    from mandati m
    join intermediari i on i.numero_iscrizione_rui = m.matricola`;
  const { rows, totale } = await paginaConTotale({
    sql: `
      select distinct on (m.oss)
        m.oss, m.matricola as rui, i.denominazione, i.sezione,
        m.codice_compagnia, m.ragione_sociale
      ${daJoin}
      where ${f.where.join(' and ')}
      order by m.oss, i.inoperativo
      limit $${f.params.length}
    `,
    params: f.params,
    conteggio: `select count(distinct m.oss) as n ${daJoin} where ${f.whereConteggio.join(' and ')}`,
    paramsConteggio: f.paramsConteggio,
    primaPagina: !f.cursore,
  });
  return { ...pagina(rows, f.limit, (r) => ({ dopo_oss: String(r.oss) })), totale };
}

export async function elencoCariche(client, {
  q, sezione, dopoOss, limite, esporta = false,
} = {}) {
  const f = filtroElenco({ q, sezione, dopoOss, limite, esporta }, {
    base: ['true'],
    oss: 'c.oss',
    testo: (n) => `(
      pf.denominazione ilike '%' || $${n} || '%'
      or pg.denominazione ilike '%' || $${n} || '%'
      or c.qualifica_intermediario ilike '%' || $${n} || '%'
      or c.numero_iscrizione_rui_pf = upper($${n})
      or c.numero_iscrizione_rui_pg = upper($${n})
    )`,
  });
  const daJoin = `
    from cariche c
    left join intermediari pf
      on pf.numero_iscrizione_rui = c.numero_iscrizione_rui_pf
     and pf.sezione = any($1::text[])
    left join intermediari pg
      on pg.numero_iscrizione_rui = c.numero_iscrizione_rui_pg
     and pg.sezione = any($1::text[])`;
  const { rows, totale } = await paginaConTotale({
    sql: `
      select distinct on (c.oss)
        c.oss,
        c.numero_iscrizione_rui_pf as persona_rui, pf.denominazione as persona,
        c.numero_iscrizione_rui_pg as societa_rui, pg.denominazione as societa,
        c.qualifica_intermediario as qualifica, c.responsabile
      ${daJoin}
      where ${f.where.join(' and ')}
      order by c.oss, pf.inoperativo, pg.inoperativo
      limit $${f.params.length}
    `,
    params: f.params,
    conteggio: `select count(distinct c.oss) as n ${daJoin} where ${f.whereConteggio.join(' and ')}`,
    paramsConteggio: f.paramsConteggio,
    primaPagina: !f.cursore,
  });
  return { ...pagina(rows, f.limit, (r) => ({ dopo_oss: String(r.oss) })), totale };
}

function pagina(rows, limit, cursore) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const ultimo = items[items.length - 1];
  return {
    items,
    prossimo: hasMore && ultimo ? cursore(ultimo) : null,
  };
}
