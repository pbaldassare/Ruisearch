// Ricostruisce il sotto-grafo di un intermediario dall'export IVASS gia' parsato.

const COLONNE = {
  intermediari: [
    'oss', 'inoperativo', 'data_inizio_inoperativita', 'numero_iscrizione_rui',
    'data_iscrizione', 'cognome_nome', 'stato', 'comune_nascita', 'data_nascita',
    'ragione_sociale', 'provincia_nascita', 'titolo_individuale_sez_a',
    'attivita_esercitata_sez_a', 'titolo_individuale_sez_b', 'attivita_esercitata_sez_b',
    'autorita_vigilanza_estera', 'stato_estero', 'numero_iscrizione_estero',
    'data_iscrizione_estero', 'regime_operativo',
  ],
  collaboratori: [
    'oss', 'livello', 'num_iscr_intermediario',
    'num_iscr_collaboratori_i_liv', 'num_iscr_collaboratori_ii_liv', 'qualifica_rapporto',
  ],
  sedi: [
    'oss', 'numero_iscrizione_int', 'tipo_sede', 'comune_sede',
    'provincia_sede', 'cap_sede', 'indirizzo_sede',
  ],
  mandati: ['oss', 'matricola', 'codice_compagnia', 'ragione_sociale'],
  cariche: [
    'oss', 'numero_iscrizione_rui_pf', 'numero_iscrizione_rui_pg',
    'qualifica_intermediario', 'responsabile',
  ],
  siti_internet: ['numero_iscrizione', 'web_url'],
};

function oggetto(colonne, riga) {
  const out = {};
  for (let i = 0; i < colonne.length; i++) out[colonne[i]] = riga[i];
  return out;
}

function denominazione(riga) {
  return riga.cognome_nome || riga.ragione_sociale || null;
}

function indicePerNumero(righe) {
  const mappa = new Map();
  for (const riga of righe) {
    const n = riga.numero_iscrizione_rui;
    if (!mappa.has(n)) mappa.set(n, []);
    mappa.get(n).push(riga);
  }
  return mappa;
}

export function cercaIntermediari(intermediari, { rui, nome }) {
  const ruiNorm = rui?.trim().toUpperCase() || null;
  const nomeNorm = nome?.trim().toUpperCase() || null;
  return intermediari.filter((riga) => {
    if (ruiNorm && riga.numero_iscrizione_rui === ruiNorm) return true;
    if (!nomeNorm) return false;
    const etichetta = (denominazione(riga) || '').toUpperCase();
    return etichetta.includes(nomeNorm);
  });
}

/**
 * Dato un numero RUI, restituisce anagrafica, sedi, siti, mandati, cariche
 * e i rapporti di collaborazione (come collaboratore e come principale).
 */
export function sottoGrafo(tabelle, numero) {
  const intermediari = tabelle.intermediari.map((r) => oggetto(COLONNE.intermediari, r));
  const perNumero = indicePerNumero(intermediari);
  const soggetto = (perNumero.get(numero) || [])[0];
  if (!soggetto) return null;

  const sedi = tabelle.sedi
    .map((r) => oggetto(COLONNE.sedi, r))
    .filter((r) => r.numero_iscrizione_int === numero);
  const siti = tabelle.siti_internet
    .map((r) => oggetto(COLONNE.siti_internet, r))
    .filter((r) => r.numero_iscrizione === numero)
    .map((r) => r.web_url);
  const mandati = tabelle.mandati
    .map((r) => oggetto(COLONNE.mandati, r))
    .filter((r) => r.matricola === numero)
    .map((r) => ({ codice_compagnia: r.codice_compagnia, ragione_sociale: r.ragione_sociale }));
  const caricheFonte = tabelle.cariche.map((r) => oggetto(COLONNE.cariche, r));
  const cariche = caricheFonte
    .filter((r) => r.numero_iscrizione_rui_pg === numero || r.numero_iscrizione_rui_pf === numero)
    .map((r) => ({
      qualifica: r.qualifica_intermediario,
      responsabile: r.responsabile,
      persona_rui: r.numero_iscrizione_rui_pf,
      societa_rui: r.numero_iscrizione_rui_pg,
      persona: denominazione((perNumero.get(r.numero_iscrizione_rui_pf) || [])[0] || {}),
      societa: denominazione((perNumero.get(r.numero_iscrizione_rui_pg) || [])[0] || {}),
    }));

  const collaboratori = tabelle.collaboratori.map((r) => oggetto(COLONNE.collaboratori, r));
  const comeCollaboratore = [];
  const comePrincipale = [];
  const numeriCollegati = new Set();

  for (const r of collaboratori) {
    const eCollaboratore =
      r.num_iscr_collaboratori_i_liv === numero ||
      r.num_iscr_collaboratori_ii_liv === numero;
    const ePrincipale = r.num_iscr_intermediario === numero;
    if (!eCollaboratore && !ePrincipale) continue;

    const collegato = eCollaboratore ? r.num_iscr_intermediario : r.num_iscr_collaboratori_i_liv;
    if (collegato) numeriCollegati.add(collegato);
    if (r.num_iscr_collaboratori_ii_liv) numeriCollegati.add(r.num_iscr_collaboratori_ii_liv);

    const arco = {
      livello: r.livello,
      qualifica: (r.qualifica_rapporto || '').trim(),
      intermediario: r.num_iscr_intermediario,
      collaboratore_i: r.num_iscr_collaboratori_i_liv,
      collaboratore_ii: r.num_iscr_collaboratori_ii_liv,
    };
    if (eCollaboratore) comeCollaboratore.push(arco);
    if (ePrincipale) comePrincipale.push(arco);
  }

  const collegati = [...numeriCollegati]
    .filter((n) => n && n !== numero)
    .sort()
    .map((n) => {
      const anag = (perNumero.get(n) || [])[0];
      return anag
        ? {
            numero_iscrizione_rui: n,
            sezione: n.slice(0, 1),
            denominazione: denominazione(anag),
            data_iscrizione: anag.data_iscrizione,
            inoperativo: anag.inoperativo,
          }
        : { numero_iscrizione_rui: n };
    });

  return {
    soggetto: {
      ...soggetto,
      sezione: numero.slice(0, 1),
      denominazione: denominazione(soggetto),
    },
    sedi,
    siti_internet: siti,
    mandati,
    cariche,
    rapporti: {
      come_collaboratore: comeCollaboratore,
      come_principale: comePrincipale,
    },
    collegati,
  };
}
