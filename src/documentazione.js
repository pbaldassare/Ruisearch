import { DIMENSIONI, ESEMPI_DOMANDA } from './dimensioni.js';

const PARAMETRI_ELENCO = [
  { name: 'q', in: 'query', schema: { type: 'string' } },
  { name: 'sezione', in: 'query', schema: { type: 'string', enum: ['A', 'B', 'E'] } },
  { name: 'limit', in: 'query', schema: { type: 'integer' } },
  { name: 'dopo_oss', in: 'query', description: 'cursore della pagina successiva (campo prossimo)', schema: { type: 'string' } },
  { name: 'formato', in: 'query', description: 'csv per scaricare fino a 5.000 righe', schema: { type: 'string', enum: ['csv'] } },
];

function elenco(summary) {
  return {
    get: {
      summary,
      parameters: PARAMETRI_ELENCO,
      responses: { 200: { description: 'lista paginata (items, prossimo, totale) o CSV' } },
    },
  };
}

/**
 * baseUrl e' l'origine del sito (https://host). Le API stanno sotto /api: e'
 * il percorso del proxy di Cloudflare Pages e anche il server locale lo accetta.
 */
export function specificaOpenApi(baseUrl) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Ruisearch API',
      version: '0.2.0',
      description:
        'Lettura del Registro Unico Intermediari (sezioni A, B, E) già importato. Nessun aggiornamento da questi endpoint.',
    },
    servers: [{ url: `${String(baseUrl).replace(/\/+$/, '')}/api/v1` }],
    security: [{ ApiKey: [] }],
    paths: {
      '/overview': {
        get: {
          summary: 'KPI A/B/E e ultimo import',
          responses: { 200: { description: 'conteggi' } },
        },
      },
      '/intermediari': {
        get: {
          summary: 'Cerca intermediari',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'sezione', in: 'query', schema: { type: 'string', enum: ['A', 'B', 'E'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'lista paginata' } },
        },
      },
      '/intermediari/{rui}': {
        get: {
          summary: 'Scheda, numeri, rete, mandati, mappa se azienda',
          parameters: [{ name: 'rui', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'scheda' }, 404: { description: 'non trovato' } },
        },
      },
      '/query': {
        get: {
          summary: 'Domanda in italiano',
          parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'interpretazione + risultato' } },
        },
      },
      '/recapiti/{rui}': {
        post: {
          summary: 'Recapiti pubblici di un intermediario (ricerca web con Mistral o cache di 90 giorni)',
          description:
            'Corpo JSON facoltativo { "agenzia": "codice del chiamante" }. Risponde con tipo ' +
            '(nuova_con_risultati, nuova_senza_risultati, cache_con_risultati, cache_senza_risultati), ' +
            'costo_eur reale del fornitore (0 dalla cache) e recapiti con riferito_a (persona o societa_collegata). ' +
            '409 se la stessa ricerca è già in corso, 502 se la ricerca web non riesce (niente costo).',
          parameters: [{ name: 'rui', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'recapiti, tipo e costo' }, 409: { description: 'già in corso' } },
        },
      },
      '/rete/{rui}': {
        get: {
          summary: 'Rete a un salto',
          parameters: [{ name: 'rui', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'principali e collaboratori' } },
        },
      },
      '/sedi': elenco('Sedi: comune, sigla provincia, indirizzo o RUI'),
      '/mandati': elenco('Mandati: compagnia, intermediario o RUI'),
      '/cariche': elenco('Cariche societarie: persona, società, qualifica o RUI'),
      '/dimensioni': {
        get: { summary: 'Caratteristiche interrogabili', responses: { 200: { description: 'catalogo' } } },
      },
      '/openapi.json': {
        get: { summary: 'Questa specifica', responses: { 200: { description: 'OpenAPI 3' } } },
      },
    },
    components: {
      securitySchemes: {
        ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
    },
  };
}

export function documentazionePubblica() {
  return {
    titolo: 'Ruisearch API',
    sezioni_ammesse: ['A', 'B', 'E'],
    autenticazione: {
      header: 'X-API-Key',
      nota: 'Obbligatoria su /v1. Le chiavi si generano e si revocano in questa pagina. La dashboard interna non la chiede.',
    },
    dimensioni: DIMENSIONI,
    esempi_domanda: ESEMPI_DOMANDA,
    endpoint: [
      { metodo: 'GET', path: '/v1/overview', uso: 'KPI del registro' },
      { metodo: 'GET', path: '/v1/intermediari?q=', uso: 'cerca per nome o RUI' },
      { metodo: 'GET', path: '/v1/intermediari/{rui}', uso: 'scheda + numeri + mappa azienda' },
      { metodo: 'GET', path: '/v1/query?q=', uso: 'domanda in italiano' },
      { metodo: 'GET', path: '/v1/rete/{rui}', uso: 'grafo 1 salto (livello I diretto, II tramite una società di I livello)' },
      { metodo: 'POST', path: '/v1/recapiti/{rui}', uso: 'recapiti dal web (o dalla cache 90 giorni): tipo di ricerca e costo reale' },
      { metodo: 'GET', path: '/v1/sedi?q=', uso: 'sedi' },
      { metodo: 'GET', path: '/v1/mandati?q=', uso: 'mandati' },
      { metodo: 'GET', path: '/v1/cariche?q=', uso: 'cariche' },
      { metodo: 'GET', path: '/v1/dimensioni', uso: 'catalogo caratteristiche' },
      { metodo: 'GET', path: '/v1/openapi.json', uso: 'specifica OpenAPI' },
    ],
  };
}
