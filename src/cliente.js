// Estratto e viste operative di un cliente (oggi: un intermediario A/B e la sua rete).

import { anagrafica, scheda, normalizzaRui, SEZIONI_ATTIVE } from './query.js';

const CHUNK = 400;

function erroreHttp(messaggio, status) {
  const errore = new Error(messaggio);
  errore.statusCode = status;
  return errore;
}

export async function clienteDaRui(client, rui) {
  const numero = normalizzaRui(rui);
  if (!numero) throw erroreHttp(`RUI cliente non valido: ${rui}`, 400);
  const { rows } = await client.query(
    `
    select id, numero_iscrizione_rui, denominazione, sezione
    from clienti
    where numero_iscrizione_rui = $1 and attivo = true
    `,
    [numero],
  );
  return rows[0] || null;
}

function ruisUnici(voci) {
  return [...new Set(voci.map((v) => v.rui_collegato).filter(Boolean))];
}

async function aPezzi(elenco, fn) {
  const out = [];
  for (let i = 0; i < elenco.length; i += CHUNK) {
    out.push(...await fn(elenco.slice(i, i + CHUNK)));
  }
  return out;
}

function aggregaConteggi(mappa, limite = 12) {
  return [...mappa.entries()]
    .map(([etichetta, valore]) => ({ etichetta, valore }))
    .sort((a, b) => b.valore - a.valore || a.etichetta.localeCompare(b.etichetta, 'it'))
    .slice(0, limite);
}

// rete_collegati: livello 'I' = collaboratore diretto, 'II' = indiretto (tramite un collaboratore di I livello).
function eDiretto(voce) {
  return voce.livello === 'I';
}

function mancaCliente(rui) {
  const errore = new Error(`nessun cliente A/B/E con RUI ${rui}`);
  errore.statusCode = 404;
  throw errore;
}

export async function caricaReteCliente(client, rui) {
  const numero = normalizzaRui(rui);
  if (!numero) mancaCliente(rui);
  // La scheda contiene gia' la rete: ricalcolarla a parte raddoppiava le query.
  const schedaSoggetto = await scheda(client, numero, { geocodifica: false });
  return { numero, scheda: schedaSoggetto, rete: schedaSoggetto.rete };
}

export async function estrattoCliente(client, rui) {
  const { scheda: s, rete: r } = await caricaReteCliente(client, rui);
  const intermediari = r.collaboratori || [];
  const perSezione = { A: 0, B: 0, E: 0 };
  let operativi = 0;
  let inoperativi = 0;
  for (const i of intermediari) {
    if (perSezione[i.sezione] != null) perSezione[i.sezione] += 1;
    if (i.inoperativo) inoperativi += 1;
    else operativi += 1;
  }
  const diretti = intermediari.filter(eDiretto).length;
  return {
    soggetto: s.soggetto,
    profilo: s.profilo,
    numeri: {
      ...s.numeri,
      rete: intermediari.length,
      diretti,
      indiretti: intermediari.length - diretti,
      operativi,
      inoperativi,
      sezione_a: perSezione.A,
      sezione_b: perSezione.B,
      sezione_e: perSezione.E,
    },
    sedi: s.sedi,
    siti_internet: s.siti_internet,
    mandati: s.mandati,
    cariche: s.cariche,
    intermediari,
    principali: r.principali,
  };
}

export async function fidelizzazioneCliente(client, rui) {
  const { numero, rete: r } = await caricaReteCliente(client, rui);
  const base = r.collaboratori || [];
  const ruis = ruisUnici(base);

  const [mandati, altri] = await Promise.all([
    caricaMandatiRete(client, ruis),
    caricaAltriPrincipali(client, ruis, numero),
  ]);

  const compagniePerRui = new Map();
  for (const m of mandati) {
    const nome = (m.ragione_sociale || m.codice_compagnia || '').trim();
    if (!nome) continue;
    if (!compagniePerRui.has(m.rui)) compagniePerRui.set(m.rui, []);
    const lista = compagniePerRui.get(m.rui);
    if (!lista.includes(nome)) lista.push(nome);
  }

  const principaliPerRui = new Map();
  const conteggioPrincipali = new Map();
  // Chi sta anche sotto un tuo collaboratore (il "tramite" degli indiretti) non lavora altrove.
  const inRete = new Set([numero, ...ruis]);
  for (const p of altri) {
    if (inRete.has(p.rui_principale)) continue;
    if (!principaliPerRui.has(p.rui_mio)) principaliPerRui.set(p.rui_mio, []);
    const lista = principaliPerRui.get(p.rui_mio);
    if (lista.some((x) => x.rui === p.rui_principale)) continue;
    lista.push({
      rui: p.rui_principale,
      denominazione: p.denominazione,
      sezione: p.sezione,
    });
    const etichetta = p.denominazione || p.rui_principale;
    conteggioPrincipali.set(etichetta, (conteggioPrincipali.get(etichetta) || 0) + 1);
  }

  const ruiAltri = [...new Set(altri.map((p) => p.rui_principale).filter((x) => x && !inRete.has(x)))];
  const mandatiAltri = await caricaMandatiRete(client, ruiAltri);
  const compagniePerPrincipale = new Map();
  for (const m of mandatiAltri) {
    const nome = (m.ragione_sociale || m.codice_compagnia || '').trim();
    if (!nome) continue;
    if (!compagniePerPrincipale.has(m.rui)) compagniePerPrincipale.set(m.rui, []);
    const lista = compagniePerPrincipale.get(m.rui);
    if (!lista.includes(nome)) lista.push(nome);
  }

  const conteggioCompagnie = new Map();

  const voci = base.map((i) => {
    const compagnieProprie = (compagniePerRui.get(i.rui_collegato) || []).slice();
    const altriPrincipali = (principaliPerRui.get(i.rui_collegato) || [])
      .slice()
      .sort((a, b) => (a.denominazione || a.rui).localeCompare(b.denominazione || b.rui, 'it'));
    const viaAltri = [];
    for (const p of altriPrincipali) {
      for (const nome of compagniePerPrincipale.get(p.rui) || []) {
        if (!compagnieProprie.includes(nome) && !viaAltri.includes(nome)) viaAltri.push(nome);
      }
    }
    const compagnie = [...compagnieProprie, ...viaAltri].sort((a, b) => a.localeCompare(b, 'it'));
    for (const nome of compagnie) {
      conteggioCompagnie.set(nome, (conteggioCompagnie.get(nome) || 0) + 1);
    }
    return {
      ...i,
      indice: i.inoperativo ? 20 : 60,
      stato_relazione: i.inoperativo ? 'da_riattivare' : 'da_impostare',
      nota: 'Struttura iniziale: i punteggi si calibreranno dopo.',
      compagnie,
      altri_principali: altriPrincipali,
    };
  });

  let sorveglianza = { sorvegliati: [], alert: [], non_letti: 0, letti: 0 };
  let erroreSorveglianza = null;
  try {
    const cliente = await clienteDaRui(client, numero);
    if (cliente) sorveglianza = await sincronizzaSorveglianza(client, cliente);
  } catch (errore) {
    // Non si finge "nessun broker": la pagina mostra che la sorveglianza non si è potuta leggere.
    console.error('sorveglianza fidelizzazione', errore);
    erroreSorveglianza = 'Non riesco a leggere i broker sorvegliati e i loro avvisi: riprova tra poco.';
  }

  const diretti = voci.filter(eDiretto).length;
  return {
    sintesi: {
      in_rete: voci.length,
      diretti,
      indiretti: voci.length - diretti,
      da_impostare: voci.filter((v) => v.stato_relazione === 'da_impostare').length,
      da_riattivare: voci.filter((v) => v.stato_relazione === 'da_riattivare').length,
      lavorano_altrove: voci.filter((v) => v.altri_principali.length > 0).length,
      compagnie_distinte: conteggioCompagnie.size,
      alert_non_letti: erroreSorveglianza ? null : sorveglianza.non_letti,
      alert_letti: erroreSorveglianza ? null : sorveglianza.letti,
    },
    grafici: {
      compagnie: aggregaConteggi(conteggioCompagnie),
      principali: aggregaConteggi(conteggioPrincipali),
    },
    voci,
    sorvegliati: sorveglianza.sorvegliati,
    alert: sorveglianza.alert,
    sorveglianza_errore: erroreSorveglianza,
  };
}

async function caricaMandatiRete(client, ruis) {
  if (ruis.length === 0) return [];
  return aPezzi(ruis, async (pezzo) => {
    const { rows } = await client.query(
      `
      select matricola as rui, codice_compagnia, ragione_sociale
      from mandati
      where matricola = any($1::text[])
      order by ragione_sociale
      `,
      [pezzo],
    );
    return rows;
  });
}

/**
 * Societa' del gruppo del cliente: intermediari con almeno una persona che ha una carica sia li' sia nel cliente.
 * ponytail: regola approssimata (cariche in comune); un amministratore condiviso con un vero concorrente lo esclude.
 */
async function societaDelGruppo(client, ruiCliente) {
  const { rows } = await client.query(
    `
    select distinct c2.numero_iscrizione_rui_pg as rui
    from cariche c1
    join cariche c2 on c2.numero_iscrizione_rui_pf = c1.numero_iscrizione_rui_pf
    where c1.numero_iscrizione_rui_pg = $1
      and c1.numero_iscrizione_rui_pf is not null
      and c2.numero_iscrizione_rui_pg <> $1
    `,
    [ruiCliente],
  );
  return rows.map((r) => r.rui);
}

async function caricaAltriPrincipali(client, ruis, ruiCliente) {
  if (ruis.length === 0) return [];
  // "Lavora anche altrove" non vale per le societa' del gruppo del cliente
  const gruppo = await societaDelGruppo(client, ruiCliente);
  return aPezzi(ruis, async (pezzo) => {
    const { rows } = await client.query(
      `
      select
        r.collegato as rui_mio,
        r.principale as rui_principale,
        i.denominazione,
        i.sezione
      from rete_collegati r
      join intermediari i on i.numero_iscrizione_rui = r.principale
      where r.collegato = any($1::text[])
        and r.principale <> $2
        and r.sezione_principale = any($3::text[])
        and r.principale <> all($4::text[])
      `,
      [pezzo, ruiCliente, SEZIONI_ATTIVE, gruppo],
    );
    return rows;
  });
}

// Avvisi solo dei broker ancora sorvegliati: quelli di un broker tolto non contano e non si vedono.
const ALERT_DI_SORVEGLIATI = `
  exists (
    select 1 from cliente_broker_sorvegliati b
    where b.cliente_id = a.cliente_id and b.rui_broker = a.rui_broker
  )`;

/**
 * Confronta la rete attuale di ogni broker sorvegliato con quella già vista e, in un'unica istruzione
 * (atomica): crea gli avvisi dei nuovi iscritti e li aggiunge allo snapshot. Due richieste insieme non
 * raddoppiano niente (vincoli unici + on conflict do nothing).
 */
export async function sincronizzaSorveglianza(client, cliente) {
  const sorvegliati = await client.query(
    `
    select id, rui_broker, denominazione, sezione, creato_il
    from cliente_broker_sorvegliati
    where cliente_id = $1
    order by denominazione, rui_broker
    `,
    [cliente.id],
  );
  if (sorvegliati.rows.length === 0) return { sorvegliati: [], alert: [], non_letti: 0, letti: 0 };

  const conteggi = await client.query(
    `
    with attuali as (
      select b.rui_broker, b.denominazione as broker_denominazione, r.collegato
      from cliente_broker_sorvegliati b
      join rete_collegati r
        on r.principale = b.rui_broker
       and r.sezione_collegato = any($2::text[])
      where b.cliente_id = $1
    ),
    nuovi as (
      select a.*
      from attuali a
      where not exists (
        select 1 from cliente_rete_snapshot s
        where s.cliente_id = $1 and s.rui_broker = a.rui_broker and s.rui_sotto = a.collegato
      )
    ),
    avvisi as (
      insert into cliente_alert (
        cliente_id, rui_broker, broker_denominazione, rui_nuovo, nuovo_denominazione, sezione
      )
      select $1, n.rui_broker, n.broker_denominazione, n.collegato, i.denominazione, i.sezione
      from nuovi n
      left join lateral (
        select x.denominazione, x.sezione
        from intermediari x
        where x.numero_iscrizione_rui = n.collegato
        order by x.inoperativo, x.oss
        limit 1
      ) i on true
      on conflict (cliente_id, rui_broker, rui_nuovo) do nothing
    ),
    visti as (
      insert into cliente_rete_snapshot (cliente_id, rui_broker, rui_sotto)
      select $1, rui_broker, collegato from nuovi
      on conflict do nothing
    )
    select rui_broker, count(*)::int as in_rete
    from attuali
    group by rui_broker
    `,
    [cliente.id, SEZIONI_ATTIVE],
  );
  const inRete = new Map(conteggi.rows.map((r) => [r.rui_broker, r.in_rete]));

  const [alert, numeri] = await Promise.all([
    client.query(
      `
      select a.id, a.rui_broker, a.broker_denominazione, a.rui_nuovo, a.nuovo_denominazione,
             a.sezione, a.letto, a.creato_il
      from cliente_alert a
      where a.cliente_id = $1 and ${ALERT_DI_SORVEGLIATI}
      order by a.letto, a.creato_il desc
      limit 80
      `,
      [cliente.id],
    ),
    client.query(
      `
      select
        count(*) filter (where not a.letto)::int as non_letti,
        count(*) filter (where a.letto)::int as letti
      from cliente_alert a
      where a.cliente_id = $1 and ${ALERT_DI_SORVEGLIATI}
      `,
      [cliente.id],
    ),
  ]);

  return {
    sorvegliati: sorvegliati.rows.map((b) => ({
      id: b.id,
      rui_broker: b.rui_broker,
      denominazione: b.denominazione,
      sezione: b.sezione,
      in_rete: inRete.get(b.rui_broker) ?? 0,
      creato_il: b.creato_il,
    })),
    alert: alert.rows,
    non_letti: numeri.rows[0]?.non_letti ?? 0,
    letti: numeri.rows[0]?.letti ?? 0,
  };
}

export async function aggiungiBrokerSorvegliato(client, ruiCliente, ruiBroker) {
  const cliente = await clienteDaRui(client, ruiCliente);
  if (!cliente) throw erroreHttp(`nessun cliente attivo con RUI ${ruiCliente}`, 404);

  const brokerRui = normalizzaRui(ruiBroker);
  if (!brokerRui) throw erroreHttp('indica il RUI del broker da sorvegliare', 400);
  if (brokerRui === cliente.numero_iscrizione_rui) {
    throw erroreHttp('non puoi sorvegliare la tua stessa iscrizione', 400);
  }

  const soggetti = await anagrafica(client, brokerRui);
  const broker = soggetti[0];
  if (!broker) throw erroreHttp(`nessun intermediario A/B/E con RUI ${brokerRui}`, 404);

  // Broker e baseline (chi ha già sotto) nella stessa istruzione: o tutti e due o niente. Una lettura
  // della pagina nel frattempo non vede un broker senza baseline, che farebbe "nuovi" tutti i suoi iscritti.
  const { rows } = await client.query(
    `
    with nuovo as (
      insert into cliente_broker_sorvegliati (cliente_id, rui_broker, denominazione, sezione)
      values ($1, $2, $3, $4)
      on conflict (cliente_id, rui_broker) do nothing
      returning rui_broker
    ),
    baseline as (
      insert into cliente_rete_snapshot (cliente_id, rui_broker, rui_sotto)
      select $1, n.rui_broker, r.collegato
      from nuovo n
      join rete_collegati r
        on r.principale = n.rui_broker
       and r.sezione_collegato = any($5::text[])
      on conflict do nothing
    )
    select
      (select count(*) from nuovo)::int as inserito,
      (select count(*) from rete_collegati
        where principale = $2 and sezione_collegato = any($5::text[]))::int as in_rete
    `,
    [cliente.id, brokerRui, broker.denominazione, broker.sezione, SEZIONI_ATTIVE],
  );
  const { inserito, in_rete: inReteBroker } = rows[0];

  return {
    ok: true,
    gia_presente: inserito === 0,
    broker: {
      rui_broker: brokerRui,
      denominazione: broker.denominazione,
      sezione: broker.sezione,
      in_rete: inReteBroker,
    },
    baseline: inReteBroker,
  };
}

export async function rimuoviBrokerSorvegliato(client, ruiCliente, ruiBroker) {
  const cliente = await clienteDaRui(client, ruiCliente);
  if (!cliente) throw erroreHttp(`nessun cliente attivo con RUI ${ruiCliente}`, 404);
  const brokerRui = normalizzaRui(ruiBroker);
  if (!brokerRui) throw erroreHttp('indica il RUI del broker da togliere', 400);

  // Via broker, snapshot e avvisi insieme: se lo rimetti riparte da una baseline nuova.
  const { rows } = await client.query(
    `
    with avvisi as (
      delete from cliente_alert where cliente_id = $1 and rui_broker = $2
    ),
    visti as (
      delete from cliente_rete_snapshot where cliente_id = $1 and rui_broker = $2
    ),
    tolto as (
      delete from cliente_broker_sorvegliati where cliente_id = $1 and rui_broker = $2
      returning 1
    )
    select count(*)::int as n from tolto
    `,
    [cliente.id, brokerRui],
  );
  return { ok: true, rimosso: rows[0].n > 0 };
}

export async function marcaAlertLetto(client, ruiCliente, { id, tutti } = {}) {
  const cliente = await clienteDaRui(client, ruiCliente);
  if (!cliente) throw erroreHttp(`nessun cliente attivo con RUI ${ruiCliente}`, 404);

  if (tutti) {
    const upd = await client.query(
      `update cliente_alert set letto = true where cliente_id = $1 and letto = false`,
      [cliente.id],
    );
    return { ok: true, aggiornati: upd.rowCount };
  }

  const alertId = Number(id);
  if (!Number.isFinite(alertId) || alertId <= 0) {
    throw erroreHttp('indica l\'avviso da segnare come letto', 400);
  }
  const upd = await client.query(
    `update cliente_alert set letto = true where cliente_id = $1 and id = $2`,
    [cliente.id, alertId],
  );
  return { ok: true, aggiornati: upd.rowCount };
}

export async function controlloRuiCliente(client, rui) {
  const { scheda: s, rete: r } = await caricaReteCliente(client, rui);
  const intermediari = r.collaboratori || [];
  const inoperativi = intermediari.filter((i) => i.inoperativo);
  const senzaQualifica = intermediari.filter((i) => !i.qualifica);
  const segnalazioni = [];
  if (!s.sedi?.length) {
    segnalazioni.push({
      id: 'sede',
      gravita: 'alta',
      titolo: 'Nessuna sede in registro',
      testo: 'Nel RUI non risulta una sede per questa iscrizione.',
      voci: [],
    });
  }
  // Solo gli agenti (sezione A) hanno mandati intestati: per un broker (B)
  // e' normale non averne, e segnalarlo sarebbe un falso allarme.
  if (s.soggetto?.sezione === 'A' && !(s.mandati || []).length) {
    segnalazioni.push({
      id: 'mandati',
      gravita: 'media',
      titolo: 'Nessun mandato diretto',
      testo: 'Per un agente ci si aspetta almeno un mandato: in registro non ce ne sono intestati a questa iscrizione.',
      voci: [],
    });
  }
  if (inoperativi.length) {
    segnalazioni.push({
      id: 'inoperativi',
      gravita: 'alta',
      titolo: `${inoperativi.length} intermediari inoperativi in rete`,
      testo: 'Iscritti collegati risultano inoperativi nel RUI.',
      voci: inoperativi.slice(0, 40),
    });
  }
  if (senzaQualifica.length) {
    segnalazioni.push({
      id: 'qualifica',
      gravita: 'bassa',
      titolo: `${senzaQualifica.length} rapporti senza qualifica`,
      testo: 'Manca la qualifica del rapporto sul tracciato collaboratori.',
      voci: senzaQualifica.slice(0, 40),
    });
  }
  if (segnalazioni.length === 0) {
    segnalazioni.push({
      id: 'ok',
      gravita: 'info',
      titolo: 'Nessuna anomalia evidente',
      testo: 'Sedi, mandati e collaboratori della tua rete non mostrano problemi nel registro.',
      voci: [],
    });
  }
  return {
    soggetto: s.soggetto,
    numeri: { rete: intermediari.length, inoperativi: inoperativi.length },
    segnalazioni,
  };
}
