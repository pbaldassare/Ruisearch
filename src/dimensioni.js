// Caratteristiche interrogabili. Servono alla pagina Query e all'API esterna.

export const DIMENSIONI = [
  {
    id: 'sezione',
    etichetta: 'Sezione RUI',
    valori: ['A', 'B', 'E'],
    esempio: 'agenti in provincia di BS',
  },
  {
    id: 'natura',
    etichetta: 'Natura giuridica',
    valori: ['azienda', 'persona'],
    esempio: 'aziende con mandato generali',
  },
  {
    id: 'stato_operativo',
    etichetta: 'Stato',
    valori: ['operativo', 'inoperativo'],
    esempio: 'agenti inoperativi in provincia di TO',
  },
  {
    id: 'compagnia',
    etichetta: 'Compagnia / mandato',
    valori: ['AXA', 'Generali', 'Unipol', 'Allianz', '...'],
    esempio: 'agenti con mandato axa in provincia di MI',
  },
  {
    id: 'ruolo_rete',
    etichetta: 'Ruolo in rete',
    valori: ['principale', 'collaboratore', 'agente'],
    esempio: 'quanti collaboratori ha consulbrokers spa',
  },
  {
    id: 'provincia_sede',
    etichetta: 'Provincia sede',
    valori: ['BS', 'MI', 'RM', '...'],
    esempio: 'broker in provincia di RM',
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
  'agenti con mandato axa in provincia di BS',
  'broker a Milano',
  'agenti inoperativi in provincia di TO',
];
