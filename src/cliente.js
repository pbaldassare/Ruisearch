// Estratto e viste operative di un cliente (oggi: un intermediario A/B e la sua rete).

import { anagrafica, scheda, rete, normalizzaRui, SEZIONI_ATTIVE } from './query.js';

const CHUNK = 400;

function erroreHttp(messaggio, status) {
  const errore = new Error(messaggio);
  errore.statusCode = status;
  return errore;
}

async function clienteDaRui(client, rui) {
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

function mancaCliente(rui) {
  const errore = new Error(`nessun cliente A/B/E con RUI ${rui}`);
  errore.statusCode = 404;
  throw errore;
}

export async function caricaReteCliente(client, rui) {
  const numero = normalizzaRui(rui);
  if (!numero) mancaCliente(rui);
  const [schedaSoggetto, reteSoggetto] = await Promise.all([
    scheda(client, numero, { geocodifica: false }),
    rete(client, numero),
  ]);
  return { numero, scheda: schedaSoggetto, rete: reteSoggetto };
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
  return {
    soggetto: s.soggetto,
    profilo: s.profilo,
    numeri: {
      ...s.numeri,
      rete: intermediari.length,
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
  for (const p of altri) {
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

  const ruiAltri = [...new Set(altri.map((p) => p.rui_principale).filter(Boolean))];
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

  let sorveglianza = { sorvegliati: [], alert: [] };
  try {
    const cliente = await clienteDaRui(client, numero);
    if (cliente) sorveglianza = await sincronizzaSorveglianza(client, cliente);
  } catch (errore) {
    console.error('sorveglianza fidelizzazione', errore);
  }

  return {
    sintesi: {
      in_rete: voci.length,
      da_impostare: voci.filter((v) => v.stato_relazione === 'da_impostare').length,
      da_riattivare: voci.filter((v) => v.stato_relazione === 'da_riattivare').length,
      lavorano_altrove: voci.filter((v) => v.altri_principali.length > 0).length,
      compagnie_distinte: conteggioCompagnie.size,
      alert_non_letti: sorveglianza.alert.filter((a) => !a.letto).length,
    },
    grafici: {
      compagnie: aggregaConteggi(conteggioCompagnie),
      principali: aggregaConteggi(conteggioPrincipali),
    },
    voci,
    sorvegliati: sorveglianza.sorvegliati,
    alert: sorveglianza.alert,
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

async function caricaAltriPrincipali(client, ruis, ruiCliente) {
  if (ruis.length === 0) return [];
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
      `,
      [pezzo, ruiCliente, SEZIONI_ATTIVE],
    );
    return rows;
  });
}

async function collaboratoriSottoBroker(client, ruiBroker) {
  const { rows } = await client.query(
    `
    select distinct on (i.numero_iscrizione_rui)
      i.numero_iscrizione_rui as rui,
      i.denominazione,
      i.sezione,
      i.inoperativo
    from rete_collegati r
    join intermediari i on i.numero_iscrizione_rui = r.collegato
    where r.principale = $1
      and r.sezione_collegato = any($2::text[])
    order by i.numero_iscrizione_rui, i.inoperativo, i.oss
    `,
    [ruiBroker, SEZIONI_ATTIVE],
  );
  return rows;
}

async function inserisciSnapshot(client, clienteId, ruiBroker, ruis) {
  for (let i = 0; i < ruis.length; i += CHUNK) {
    const pezzo = ruis.slice(i, i + CHUNK);
    await client.query(
      `
      insert into cliente_rete_snapshot (cliente_id, rui_broker, rui_sotto)
      select $1, $2, unnest($3::text[])
      on conflict do nothing
      `,
      [clienteId, ruiBroker, pezzo],
    );
  }
}

async function sincronizzaSorveglianza(client, cliente) {
  const sorvegliati = await client.query(
    `
    select id, rui_broker, denominazione, sezione, creato_il
    from cliente_broker_sorvegliati
    where cliente_id = $1
    order by denominazione, rui_broker
    `,
    [cliente.id],
  );

  const elenco = [];
  for (const broker of sorvegliati.rows) {
    try {
      const attuali = await collaboratoriSottoBroker(client, broker.rui_broker);
      const snapshot = await client.query(
        `
        select rui_sotto
        from cliente_rete_snapshot
        where cliente_id = $1 and rui_broker = $2
        `,
        [cliente.id, broker.rui_broker],
      );
      const noti = new Set(snapshot.rows.map((r) => r.rui_sotto));
      const nuovi = attuali.filter((p) => !noti.has(p.rui));

      for (const n of nuovi) {
        await client.query(
          `
          insert into cliente_alert (
            cliente_id, rui_broker, broker_denominazione,
            rui_nuovo, nuovo_denominazione, sezione
          )
          values ($1, $2, $3, $4, $5, $6)
          on conflict (cliente_id, rui_broker, rui_nuovo) do nothing
          `,
          [
            cliente.id,
            broker.rui_broker,
            broker.denominazione,
            n.rui,
            n.denominazione,
            n.sezione,
          ],
        );
      }
      if (nuovi.length) {
        await inserisciSnapshot(client, cliente.id, broker.rui_broker, nuovi.map((n) => n.rui));
      }

      elenco.push({
        id: broker.id,
        rui_broker: broker.rui_broker,
        denominazione: broker.denominazione,
        sezione: broker.sezione,
        in_rete: attuali.length,
        creato_il: broker.creato_il,
      });
    } catch (errore) {
      console.error(`sorveglianza ${broker.rui_broker}`, errore);
      elenco.push({
        id: broker.id,
        rui_broker: broker.rui_broker,
        denominazione: broker.denominazione,
        sezione: broker.sezione,
        in_rete: null,
        creato_il: broker.creato_il,
      });
    }
  }

  const alert = await client.query(
    `
    select id, rui_broker, broker_denominazione, rui_nuovo, nuovo_denominazione,
           sezione, letto, creato_il
    from cliente_alert
    where cliente_id = $1
    order by letto, creato_il desc
    limit 80
    `,
    [cliente.id],
  );

  return { sorvegliati: elenco, alert: alert.rows };
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

  const inserito = await client.query(
    `
    insert into cliente_broker_sorvegliati (cliente_id, rui_broker, denominazione, sezione)
    values ($1, $2, $3, $4)
    on conflict (cliente_id, rui_broker) do nothing
    returning id
    `,
    [cliente.id, brokerRui, broker.denominazione, broker.sezione],
  );

  if (inserito.rowCount > 0) {
    const sotto = await collaboratoriSottoBroker(client, brokerRui);
    await inserisciSnapshot(client, cliente.id, brokerRui, sotto.map((s) => s.rui));
    return {
      ok: true,
      gia_presente: false,
      broker: {
        rui_broker: brokerRui,
        denominazione: broker.denominazione,
        sezione: broker.sezione,
        in_rete: sotto.length,
      },
      baseline: sotto.length,
    };
  }

  const sotto = await collaboratoriSottoBroker(client, brokerRui);
  return {
    ok: true,
    gia_presente: true,
    broker: {
      rui_broker: brokerRui,
      denominazione: broker.denominazione,
      sezione: broker.sezione,
      in_rete: sotto.length,
    },
    baseline: sotto.length,
  };
}

export async function rimuoviBrokerSorvegliato(client, ruiCliente, ruiBroker) {
  const cliente = await clienteDaRui(client, ruiCliente);
  if (!cliente) throw erroreHttp(`nessun cliente attivo con RUI ${ruiCliente}`, 404);
  const brokerRui = normalizzaRui(ruiBroker);
  if (!brokerRui) throw erroreHttp('indica il RUI del broker da togliere', 400);

  await client.query(
    `delete from cliente_rete_snapshot where cliente_id = $1 and rui_broker = $2`,
    [cliente.id, brokerRui],
  );
  const del = await client.query(
    `delete from cliente_broker_sorvegliati where cliente_id = $1 and rui_broker = $2`,
    [cliente.id, brokerRui],
  );
  return { ok: true, rimosso: del.rowCount > 0 };
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
  if (!(s.mandati || []).length) {
    segnalazioni.push({
      id: 'mandati',
      gravita: 'media',
      titolo: 'Nessun mandato diretto',
      testo: 'In registro non ci sono mandati intestati a questa iscrizione.',
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
      testo: 'La rete A/B/E di questo estratto non mostra i controlli base in rosso.',
      voci: [],
    });
  }
  return {
    soggetto: s.soggetto,
    numeri: { rete: intermediari.length, inoperativi: inoperativi.length },
    segnalazioni,
  };
}

export async function opportunityCliente(client, rui) {
  const { scheda: s, rete: r } = await caricaReteCliente(client, rui);
  const intermediari = r.collaboratori || [];
  const inoperativi = intermediari.filter((i) => i.inoperativo);
  const eAttivi = intermediari.filter((i) => i.sezione === 'E' && !i.inoperativo);
  const idee = [
    {
      id: 'mandati',
      titolo: 'Sviluppo mandati',
      stato: (s.mandati || []).length ? 'monitorare' : 'aperta',
      testo: (s.mandati || []).length
        ? 'Ci sono già mandati in registro. Si potranno incrociare con la rete.'
        : 'Nessun mandato diretto in RUI: possibile area di sviluppo commerciale.',
    },
    {
      id: 'rete-e',
      titolo: 'Crescita collaboratori E',
      stato: 'aperta',
      testo: `${eAttivi.length} collaboratori E operativi in rete. Base per fidelizzazione e formazione.`,
    },
    {
      id: 'riattivazione',
      titolo: 'Riattivazione',
      stato: inoperativi.length ? 'aperta' : 'in_attesa',
      testo: inoperativi.length
        ? `${inoperativi.length} nominativi inoperativi da rivalutare.`
        : 'Nessun inoperativo in rete da riattivare.',
    },
    {
      id: 'altro',
      titolo: 'Altre opportunity',
      stato: 'in_attesa',
      testo: 'Struttura pronta: qui entreranno segnali da CRM, campagne e confronti di mercato.',
    },
  ];
  return { soggetto: s.soggetto, idee };
}
