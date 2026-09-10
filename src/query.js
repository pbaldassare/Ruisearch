// Lettura del registro gia' importato. Solo SELECT.
// Teniamo A, B, E. Un arco di rete resta solo se entrambi gli estremi sono A/B/E.

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

function anagCte() {
  return `
    anag as (
      select distinct on (numero_iscrizione_rui)
        numero_iscrizione_rui, oss, sezione, denominazione,
        data_iscrizione, inoperativo, persona_giuridica,
        comune_nascita, provincia_nascita
      from intermediari
      where sezione = any($1::text[])
      order by numero_iscrizione_rui, inoperativo, oss
    )`;
}

/** KPI + ultimo import. I conteggi rispettano il filtro A/B/E. */
export async function overview(client, { sezione } = {}) {
  const sezioni = sezioniRichieste(sezione);
  const { rows } = await client.query(
    `
    select
      (select count(*)::bigint from intermediari
        where sezione = any($1::text[])) as intermediari,
      (select count(*)::bigint from collaboratori c
        where exists (
          select 1 from intermediari p
          where p.numero_iscrizione_rui = c.num_iscr_intermediario
            and p.sezione = any($1::text[])
        )
        and exists (
          select 1 from intermediari e
          where e.numero_iscrizione_rui = c.num_iscr_collaboratori_i_liv
            and e.sezione = any($1::text[])
        )) as collaborazioni,
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
  return { ...rows[0], ultimo_import: ultimo };
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

/**
 * Elenco / ricerca. RUI esatto, oppure ilike + trigram sul nome.
 * Paginazione keyset su (denominazione, oss).
 */
export async function cercaIntermediari(client, {
  q, sezione, dopoNome, dopoOss, limite,
} = {}) {
  const sezioni = sezioniRichieste(sezione);
  const limit = clamp(limite, 40, 80);
  const testo = (q || '').trim();
  const params = [sezioni];
  const where = ['i.sezione = any($1::text[])'];
  let indiceTesto = null;

  if (testo) {
    params.push(sembraRui(testo) ? normalizzaRui(testo) : testo);
    indiceTesto = params.length;
    if (sembraRui(testo)) {
      where.push(`i.numero_iscrizione_rui = $${indiceTesto}`);
    } else {
      where.push(`(
        i.numero_iscrizione_rui = upper($${indiceTesto})
        or i.denominazione ilike '%' || $${indiceTesto} || '%'
        or i.denominazione % $${indiceTesto}
      )`);
    }
  }

  if (dopoNome != null && dopoNome !== '' && dopoOss != null && dopoOss !== '') {
    params.push(dopoNome, Number(dopoOss));
    where.push(`(i.denominazione, i.oss) > ($${params.length - 1}, $${params.length}::bigint)`);
  }

  params.push(limit + 1);
  const order = indiceTesto && !sembraRui(testo)
    ? `similarity(i.denominazione, $${indiceTesto}) desc, i.denominazione, i.oss`
    : 'i.denominazione, i.oss';

  const { rows } = await client.query(
    `
    select
      i.oss,
      i.numero_iscrizione_rui,
      i.sezione,
      i.denominazione,
      i.data_iscrizione,
      i.inoperativo,
      i.persona_giuridica,
      i.comune_nascita,
      i.provincia_nascita
    from intermediari i
    where ${where.join('\n      and ')}
    order by ${order}
    limit $${params.length}
    `,
    params,
  );

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const ultimo = items[items.length - 1];
  return {
    items,
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
  const soggetti = await anagrafica(client, numero, { sezione });
  if (soggetti.length === 0) manca(numero);

  const principali = await client.query(
    `
    with ${anagCte()}
    select distinct on (c.num_iscr_intermediario, trim(c.qualifica_rapporto), c.livello)
      c.livello,
      trim(c.qualifica_rapporto) as qualifica,
      c.num_iscr_intermediario as rui_collegato,
      i.denominazione,
      i.sezione,
      i.inoperativo
    from collaboratori c
    join anag i on i.numero_iscrizione_rui = c.num_iscr_intermediario
    where c.num_iscr_collaboratori_i_liv = $2
       or c.num_iscr_collaboratori_ii_liv = $2
    order by c.num_iscr_intermediario, trim(c.qualifica_rapporto), c.livello, i.denominazione
    `,
    [sezioni, numero],
  );

  const collaboratori = await client.query(
    `
    with ${anagCte()},
    collegati as (
      select
        c.livello,
        trim(c.qualifica_rapporto) as qualifica,
        c.num_iscr_collaboratori_i_liv as rui_collegato
      from collaboratori c
      where c.num_iscr_intermediario = $2
        and c.livello = 'I'
        and c.num_iscr_collaboratori_i_liv is not null
      union all
      select
        c.livello,
        trim(c.qualifica_rapporto) as qualifica,
        c.num_iscr_collaboratori_ii_liv
      from collaboratori c
      where c.num_iscr_intermediario = $2
        and c.num_iscr_collaboratori_ii_liv is not null
    )
    select distinct on (collegati.rui_collegato)
      collegati.livello,
      collegati.qualifica,
      collegati.rui_collegato,
      i.denominazione,
      i.sezione,
      i.inoperativo
    from collegati
    join anag i on i.numero_iscrizione_rui = collegati.rui_collegato
    order by collegati.rui_collegato, collegati.livello, collegati.qualifica, i.denominazione
    `,
    [sezioni, numero],
  );

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
  const soggetti = await anagrafica(client, numero, { sezione });
  if (soggetti.length === 0) manca(numero);

  const sedi = await client.query(
    `
    select oss, tipo_sede, comune_sede, provincia_sede, cap_sede, indirizzo_sede
    from sedi
    where numero_iscrizione_int = $1
    order by tipo_sede, comune_sede
    `,
    [numero],
  );
  const siti = await client.query(
    `select web_url from siti_internet where numero_iscrizione = $1 order by web_url`,
    [numero],
  );
  const mandati = await client.query(
    `
    select codice_compagnia, ragione_sociale
    from mandati
    where matricola = $1
    order by ragione_sociale
    `,
    [numero],
  );
  const cariche = await client.query(
    `
    with ${anagCte()}
    select
      c.qualifica_intermediario as qualifica,
      c.responsabile,
      c.numero_iscrizione_rui_pf as persona_rui,
      pf.denominazione as persona,
      c.numero_iscrizione_rui_pg as societa_rui,
      pg.denominazione as societa
    from cariche c
    left join anag pf on pf.numero_iscrizione_rui = c.numero_iscrizione_rui_pf
    left join anag pg on pg.numero_iscrizione_rui = c.numero_iscrizione_rui_pg
    where c.numero_iscrizione_rui_pg = $2
       or c.numero_iscrizione_rui_pf = $2
    order by pg.denominazione, pf.denominazione
    `,
    [sezioni, numero],
  );
  const contatti = await client.query(
    `
    select tipo, valore, etichetta, affidabilita, fonte, fonte_url
    from contatti
    where numero_iscrizione_rui = $1
    order by tipo, valore
    `,
    [numero],
  );
  const reteSoggetto = await rete(client, numero, { sezione });
  const numeri = await numeriDi(client, numero);
  const soggetto = soggetti[0];
  const mandatiEreditati = soggetto.sezione === 'E' || !soggetto.persona_giuridica
    ? await mandatiViaPrincipali(client, numero)
    : [];

  let mappa = [];
  if (geocodifica && soggetto.persona_giuridica && sedi.rows.length > 0) {
    const { puntiSedi } = await import('./geo.js');
    mappa = await puntiSedi(client, numero, sedi.rows, { geocodifica: true });
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
      (select count(distinct x.rui)::bigint from (
          select c.num_iscr_collaboratori_i_liv as rui
            from collaboratori c
            join intermediari i on i.numero_iscrizione_rui = c.num_iscr_collaboratori_i_liv
           where c.num_iscr_intermediario = $1
             and c.livello = 'I'
             and i.sezione = any($2::text[])
          union
          select c.num_iscr_collaboratori_ii_liv
            from collaboratori c
            join intermediari i on i.numero_iscrizione_rui = c.num_iscr_collaboratori_ii_liv
           where c.num_iscr_intermediario = $1
             and c.num_iscr_collaboratori_ii_liv is not null
             and i.sezione = any($2::text[])
        ) x) as intermediari,
      (select count(*)::bigint
         from collaboratori c
         join intermediari i on i.numero_iscrizione_rui = c.num_iscr_collaboratori_i_liv
        where c.num_iscr_intermediario = $1
          and i.sezione = any($2::text[])) as collaborazioni,
      (select count(*)::bigint from mandati where matricola = $1) as mandati,
      (select count(*)::bigint from sedi where numero_iscrizione_int = $1) as sedi
    `,
    [n, SEZIONI_ATTIVE],
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

export async function elencoSedi(client, {
  q, provincia, sezione, dopoOss, limite,
} = {}) {
  const sezioni = sezioniRichieste(sezione);
  const limit = clamp(limite, 40, 80);
  const params = [sezioni];
  const where = ['i.sezione = any($1::text[])'];

  if (provincia) {
    params.push(String(provincia).trim().toUpperCase());
    where.push(`s.provincia_sede = $${params.length}`);
  }
  if (q) {
    params.push(String(q).trim());
    where.push(`(
      s.comune_sede ilike '%' || $${params.length} || '%'
      or s.indirizzo_sede ilike '%' || $${params.length} || '%'
      or i.denominazione ilike '%' || $${params.length} || '%'
      or s.numero_iscrizione_int = upper($${params.length})
    )`);
  }
  if (dopoOss != null && dopoOss !== '') {
    params.push(Number(dopoOss));
    where.push(`s.oss > $${params.length}::bigint`);
  }
  params.push(limit + 1);

  const { rows } = await client.query(
    `
    select distinct on (s.oss)
      s.oss,
      s.numero_iscrizione_int as rui,
      i.denominazione,
      i.sezione,
      s.tipo_sede,
      s.comune_sede,
      s.provincia_sede,
      s.indirizzo_sede
    from sedi s
    join intermediari i on i.numero_iscrizione_rui = s.numero_iscrizione_int
    where ${where.join('\n      and ')}
    order by s.oss, i.inoperativo
    limit $${params.length}
    `,
    params,
  );
  return pagina(rows, limit, (r) => ({ dopo_oss: String(r.oss) }));
}

export async function elencoMandati(client, { q, sezione, dopoOss, limite } = {}) {
  const sezioni = sezioniRichieste(sezione);
  const limit = clamp(limite, 40, 80);
  const params = [sezioni];
  const where = ['i.sezione = any($1::text[])'];

  if (q) {
    params.push(String(q).trim());
    where.push(`(
      m.ragione_sociale ilike '%' || $${params.length} || '%'
      or m.codice_compagnia ilike '%' || $${params.length} || '%'
      or i.denominazione ilike '%' || $${params.length} || '%'
      or m.matricola = upper($${params.length})
    )`);
  }
  if (dopoOss != null && dopoOss !== '') {
    params.push(Number(dopoOss));
    where.push(`m.oss > $${params.length}::bigint`);
  }
  params.push(limit + 1);

  const { rows } = await client.query(
    `
    select distinct on (m.oss)
      m.oss,
      m.matricola as rui,
      i.denominazione,
      i.sezione,
      m.codice_compagnia,
      m.ragione_sociale
    from mandati m
    join intermediari i on i.numero_iscrizione_rui = m.matricola
    where ${where.join('\n      and ')}
    order by m.oss, i.inoperativo
    limit $${params.length}
    `,
    params,
  );
  return pagina(rows, limit, (r) => ({ dopo_oss: String(r.oss) }));
}

export async function elencoCariche(client, { q, sezione, dopoOss, limite } = {}) {
  const sezioni = sezioniRichieste(sezione);
  const limit = clamp(limite, 40, 80);
  const params = [sezioni];
  const where = ['true'];

  if (q) {
    params.push(String(q).trim());
    where.push(`(
      pf.denominazione ilike '%' || $${params.length} || '%'
      or pg.denominazione ilike '%' || $${params.length} || '%'
      or c.qualifica_intermediario ilike '%' || $${params.length} || '%'
      or c.numero_iscrizione_rui_pf = upper($${params.length})
      or c.numero_iscrizione_rui_pg = upper($${params.length})
    )`);
  }
  if (dopoOss != null && dopoOss !== '') {
    params.push(Number(dopoOss));
    where.push(`c.oss > $${params.length}::bigint`);
  }
  params.push(limit + 1);

  const { rows } = await client.query(
    `
    select distinct on (c.oss)
      c.oss,
      c.numero_iscrizione_rui_pf as persona_rui,
      pf.denominazione as persona,
      c.numero_iscrizione_rui_pg as societa_rui,
      pg.denominazione as societa,
      c.qualifica_intermediario as qualifica,
      c.responsabile
    from cariche c
    left join intermediari pf
      on pf.numero_iscrizione_rui = c.numero_iscrizione_rui_pf
     and pf.sezione = any($1::text[])
    left join intermediari pg
      on pg.numero_iscrizione_rui = c.numero_iscrizione_rui_pg
     and pg.sezione = any($1::text[])
    where ${where.join('\n      and ')}
    order by c.oss, pf.inoperativo, pg.inoperativo
    limit $${params.length}
    `,
    params,
  );
  return pagina(rows, limit, (r) => ({ dopo_oss: String(r.oss) }));
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
