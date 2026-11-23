// Ricostruisce il sotto-grafo di un intermediario dall'export IVASS gia' parsato.
// Lo usa solo scripts/lookup-intermediario.js, per controllare la fonte senza
// database. Stesse regole di query.js e di ricostruisci_rete_collegati():
// solo A/B/E, RUI a 10 caratteri, livello I = diretto, II = indiretto "tramite"
// la societa' di I livello.

import { normalizzaRui, SEZIONI_ATTIVE, variantiAccenti } from './query.js';

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

function sezioneAttiva(numero) {
  return Boolean(numero) && SEZIONI_ATTIVE.includes(numero.slice(0, 1));
}

/** Candidati A/B/E per RUI (anche senza zeri: A49819) o per nome (FORLÌ trova FORLI'). */
export function cercaNellExport(intermediari, { rui, nome }) {
  const ruiNorm = rui ? normalizzaRui(rui) : null;
  const varianti = nome ? variantiAccenti(nome) : [];
  return intermediari.filter((riga) => {
    if (!sezioneAttiva(riga.numero_iscrizione_rui)) return false;
    if (ruiNorm && riga.numero_iscrizione_rui === ruiNorm) return true;
    if (!varianti.length) return false;
    const etichetta = (denominazione(riga) || '').toLowerCase();
    return varianti.some((v) => etichetta.includes(v));
  });
}

/**
 * Archi di rete da una riga di ELENCO_COLLABORATORI, come in
 * ricostruisci_rete_collegati(): principale → I livello (diretto),
 * societa' di I livello → II livello (diretto), principale → II livello
 * (indiretto, tramite la societa').
 */
function archiDaRiga(r) {
  const qualifica = (r.qualifica_rapporto || '').trim() || null;
  const p = r.num_iscr_intermediario;
  const i = r.num_iscr_collaboratori_i_liv;
  const ii = r.num_iscr_collaboratori_ii_liv;
  const archi = [];
  if (r.livello === 'I' && i) archi.push({ principale: p, collegato: i, livello: 'I', tramite: null, qualifica });
  if (i && ii) archi.push({ principale: i, collegato: ii, livello: 'I', tramite: null, qualifica });
  if (ii) archi.push({ principale: p, collegato: ii, livello: 'II', tramite: i || null, qualifica });
  return archi;
}

/** Un arco per coppia: vince il diretto, poi il primo tramite e la prima qualifica. */
function senzaDoppioni(archi) {
  const ordinati = [...archi].sort((a, b) => a.livello.localeCompare(b.livello)
    || String(a.tramite ?? '').localeCompare(String(b.tramite ?? ''))
    || String(a.qualifica ?? '').localeCompare(String(b.qualifica ?? '')));
  const visti = new Map();
  for (const a of ordinati) {
    const chiave = `${a.principale}|${a.collegato}`;
    if (!visti.has(chiave)) visti.set(chiave, a);
  }
  return [...visti.values()];
}

/**
 * Dato un numero RUI, restituisce anagrafica, sedi, siti, mandati, cariche
 * e i rapporti di collaborazione (come collaboratore e come principale).
 */
export function sottoGrafo(tabelle, rui) {
  const numero = normalizzaRui(rui);
  if (!sezioneAttiva(numero)) return null;
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

  // Solo gli archi che toccano il soggetto, con entrambi gli estremi A/B/E in registro.
  const valido = (n) => sezioneAttiva(n) && perNumero.has(n);
  const archi = senzaDoppioni(
    tabelle.collaboratori
      .map((r) => oggetto(COLONNE.collaboratori, r))
      .filter((r) => r.num_iscr_intermediario === numero
        || r.num_iscr_collaboratori_i_liv === numero
        || r.num_iscr_collaboratori_ii_liv === numero)
      .flatMap(archiDaRiga)
      .filter((a) => (a.principale === numero || a.collegato === numero)
        && a.principale !== a.collegato
        && valido(a.principale) && valido(a.collegato)),
  );
  const comeCollaboratore = archi.filter((a) => a.collegato === numero);
  const comePrincipale = archi.filter((a) => a.principale === numero);
  const numeriCollegati = new Set();
  for (const a of archi) {
    numeriCollegati.add(a.principale === numero ? a.collegato : a.principale);
    if (a.tramite) numeriCollegati.add(a.tramite);
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
