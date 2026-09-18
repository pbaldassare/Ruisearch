import { DIMENSIONI, ESEMPI_DOMANDA } from './dimensioni.js';

export function specificaOpenApi(baseUrl) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Ruisearch API',
      version: '0.2.0',
      description:
        'Lettura del Registro Unico Intermediari (sezioni A, B, E) già importato. Nessun aggiornamento da questi endpoint.',
    },
    servers: [{ url: `${baseUrl}/v1` }],
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
      '/rete/{rui}': {
        get: {
          summary: 'Rete a un salto',
          parameters: [{ name: 'rui', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'principali e collaboratori' } },
        },
      },
      '/dimensioni': {
        get: { summary: 'Caratteristiche interrogabili', responses: { 200: { description: 'catalogo' } } },
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
      nota: 'Obbligatoria su /v1 se RUI_API_KEY è impostata nel .env. La dashboard interna non la chiede.',
    },
    dimensioni: DIMENSIONI,
    esempi_domanda: ESEMPI_DOMANDA,
    endpoint: [
      { metodo: 'GET', path: '/v1/overview', uso: 'KPI del registro' },
      { metodo: 'GET', path: '/v1/intermediari?q=', uso: 'cerca per nome o RUI' },
      { metodo: 'GET', path: '/v1/intermediari/{rui}', uso: 'scheda + numeri + mappa azienda' },
      { metodo: 'GET', path: '/v1/query?q=', uso: 'domanda in italiano' },
      { metodo: 'GET', path: '/v1/rete/{rui}', uso: 'grafo 1 salto' },
      { metodo: 'GET', path: '/v1/sedi?q=', uso: 'sedi' },
      { metodo: 'GET', path: '/v1/mandati?q=', uso: 'mandati' },
      { metodo: 'GET', path: '/v1/cariche?q=', uso: 'cariche' },
      { metodo: 'GET', path: '/v1/dimensioni', uso: 'catalogo caratteristiche' },
      { metodo: 'GET', path: '/v1/openapi.json', uso: 'specifica OpenAPI' },
    ],
  };
}
