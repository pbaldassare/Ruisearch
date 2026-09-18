// Caratteristiche interrogabili. Servono alla pagina Query e all'API esterna.

export const DIMENSIONI = [
  {
    id: 'sezione',
    etichetta: 'Sezione RUI',
    valori: ['A', 'B', 'E'],
    esempio: 'solo agenti sezione A',
  },
  {
    id: 'natura',
    etichetta: 'Natura giuridica',
    valori: ['azienda', 'persona'],
    esempio: 'quante aziende ha la rete',
  },
  {
    id: 'stato_operativo',
    etichetta: 'Stato',
    valori: ['operativo', 'inoperativo'],
    esempio: 'solo operativi',
  },
  {
    id: 'compagnia',
    etichetta: 'Compagnia / mandato',
    valori: ['AXA', 'Generali', 'Unipol', 'Allianz', '...'],
    esempio: 'lavora con AXA',
  },
  {
    id: 'ruolo_rete',
    etichetta: 'Ruolo in rete',
    valori: ['principale', 'collaboratore', 'agente'],
    esempio: 'agenti con cui collabora',
  },
  {
    id: 'provincia_sede',
    etichetta: 'Provincia sede',
    valori: ['BS', 'MI', 'RM', '...'],
    esempio: 'sedi in provincia di BS',
  },
  {
    id: 'denominazione',
    etichetta: 'Nome o ragione sociale',
    valori: ['testo libero'],
    esempio: 'quanti intermediari ha Consulbrokers',
  },
  {
    id: 'rui',
    etichetta: 'Numero iscrizione',
    valori: ['A…', 'B…', 'E…'],
    esempio: 'scheda E000188700',
  },
];

export const ESEMPI_DOMANDA = [
  'quanti intermediari ha consulbrokers',
  'quanti mandati ha consulbrokers spa',
  'paolo baldassare lavora con gli agenti con axa',
  'paolo baldassare lavora con axa',
  'cerca baldassare',
];
