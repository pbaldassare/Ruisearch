// Mappa fra i CSV dell'export IVASS e le tabelle del database.
//
// `colonne` elenca le colonne di destinazione nell'ordine in cui compaiono nel
// CSV; le colonne generate (sezione, denominazione, persona_giuridica) non
// compaiono perche' Postgres le calcola da solo.
//
// L'intestazione di ELENCO_INTERMEDIARI dichiara 15 colonne ma le righe ne
// hanno 20: le ultime cinque, prive di nome nella fonte, riguardano gli
// intermediari comunitari e sono ricostruite dai valori osservati.

const T = 'testo';
const D = 'data';
const B = 'booleano';

export const TABELLE = [
  {
    file: 'ELENCO_INTERMEDIARI.csv',
    tabella: 'intermediari',
    righeAttese: 200000,
    colonne: [
      ['oss', T],
      ['inoperativo', B],
      ['data_inizio_inoperativita', D],
      ['numero_iscrizione_rui', T],
      ['data_iscrizione', D],
      ['cognome_nome', T],
      ['stato', T],
      ['comune_nascita', T],
      ['data_nascita', D],
      ['ragione_sociale', T],
      ['provincia_nascita', T],
      ['titolo_individuale_sez_a', B],
      ['attivita_esercitata_sez_a', T],
      ['titolo_individuale_sez_b', B],
      ['attivita_esercitata_sez_b', T],
      ['autorita_vigilanza_estera', T],
      ['stato_estero', T],
      ['numero_iscrizione_estero', T],
      ['data_iscrizione_estero', D],
      ['regime_operativo', T],
    ],
  },
  {
    file: 'ELENCO_COLLABORATORI.csv',
    tabella: 'collaboratori',
    righeAttese: 280000,
    colonne: [
      ['oss', T],
      ['livello', T],
      ['num_iscr_intermediario', T],
      ['num_iscr_collaboratori_i_liv', T],
      ['num_iscr_collaboratori_ii_liv', T],
      ['qualifica_rapporto', T],
    ],
  },
  {
    file: 'ELENCO_SEDI.csv',
    tabella: 'sedi',
    righeAttese: 40000,
    // Un indirizzo spagnolo contiene un punto e virgola: i campi in eccesso
    // vanno riuniti nell'ultima colonna invece di sfasare la riga.
    riunisciCodaIn: 6,
    colonne: [
      ['oss', T],
      ['numero_iscrizione_int', T],
      ['tipo_sede', T],
      ['comune_sede', T],
      ['provincia_sede', T],
      ['cap_sede', T],
      ['indirizzo_sede', T],
    ],
  },
  {
    file: 'ELENCO_MANDATI.csv',
    tabella: 'mandati',
    righeAttese: 30000,
    colonne: [
      ['oss', T],
      ['matricola', T],
      ['codice_compagnia', T],
      ['ragione_sociale', T],
    ],
  },
  {
    file: 'ELENCO_CARICHE.csv',
    tabella: 'cariche',
    righeAttese: 17000,
    colonne: [
      ['oss', T],
      ['numero_iscrizione_rui_pf', T],
      ['numero_iscrizione_rui_pg', T],
      ['qualifica_intermediario', T],
      ['responsabile', T],
    ],
  },
  {
    file: 'ELENCO_COLLABACCESSORI.csv',
    tabella: 'collaboratori_accessori',
    righeAttese: 13000,
    colonne: [
      ['numero_iscrizione_e', T],
      ['ragione_sociale', T],
      ['cognome_nome', T],
      ['sede_legale', T],
      ['data_nascita', D],
      ['luogo_nascita', T],
    ],
  },
  {
    file: 'ELENCO_SITO_INTERNET.csv',
    tabella: 'siti_internet',
    righeAttese: 10000,
    colonne: [
      ['numero_iscrizione', T],
      ['web_url', T],
    ],
  },
  {
    file: 'ELENCO_RESP_DISTRIB_SEZ_D.csv',
    tabella: 'responsabili_distribuzione_d',
    righeAttese: 300,
    colonne: [
      ['numero_iscrizione_d', T],
      ['ragione_sociale', T],
      ['cognome_nome_responsabile', T],
    ],
  },
  {
    file: 'ELENCO_AG_VEN_PROD_NONST_ISCR_S.csv',
    tabella: 'ag_ven_prod_nonst_iscr_s',
    righeAttese: 80,
    colonne: [
      ['numero_iscrizione_d', T],
      ['numero_iscrizione_a', T],
      ['data_conferimento', D],
      ['codice_compagnia', T],
      ['ragione_sociale', T],
    ],
  },
];
