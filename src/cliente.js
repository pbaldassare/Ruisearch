// Estratto e viste operative di un cliente (oggi: un intermediario A/B e la sua rete).

import { scheda, rete, normalizzaRui } from './query.js';

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
  const { rete: r } = await caricaReteCliente(client, rui);
  const voci = (r.collaboratori || []).map((i) => ({
    ...i,
    indice: i.inoperativo ? 20 : 60,
    stato_relazione: i.inoperativo ? 'da_riattivare' : 'da_impostare',
    nota: 'Struttura iniziale: i punteggi si calibreranno dopo.',
  }));
  return {
    sintesi: {
      in_rete: voci.length,
      da_impostare: voci.filter((v) => v.stato_relazione === 'da_impostare').length,
      da_riattivare: voci.filter((v) => v.stato_relazione === 'da_riattivare').length,
    },
    voci,
  };
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
