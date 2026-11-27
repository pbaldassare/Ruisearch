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
        'Lettura del Registro Unico Intermediari (sezioni A, B, E) già importato, ricerca recapiti e archivio ' +
        'personale di ogni agenzia del software chiamante (/archivio). Il registro non si modifica da questi endpoint.',
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
          summary: 'Recapiti pubblici di un intermediario (ricerca web con Mistral o cache di 180 giorni)',
          description:
            'Corpo JSON facoltativo { "agenzia": "codice del chiamante", "forza": true }. forza = ricerca nuova ' +
            'con l\'AI anche se c\'è già (niente cache né gia_richiesta, prezzo pieno). Con agenzia la ricerca ' +
            'entra nell\'archivio dell\'agenzia (origine ricerca, telefoni ed email della risposta). Risponde con tipo ' +
            '(nuova_con_risultati, nuova_senza_risultati, cache_con_risultati, cache_senza_risultati, ' +
            'gia_richiesta = stessa agenzia e stesso RUI entro 180 giorni, con gia_richiesta_il), ' +
            'costo_eur reale del fornitore (0 dalla cache) e recapiti con riferito_a (persona o societa_collegata). ' +
            '409 se la stessa ricerca è già in corso, 502 se la ricerca web non riesce (niente costo).',
          parameters: [{ name: 'rui', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'recapiti, tipo e costo' }, 409: { description: 'già in corso' } },
        },
      },
      '/archivio': {
        get: {
          summary: 'Archivio personale dell\'agenzia (solo le voci di questa chiave API e di questo codice agenzia)',
          description:
            '50 voci per pagina, le più recenti prima: { voci, totale, pagina, per_pagina }. Ogni voce: id, rui (null ' +
            'per i manuali senza RUI), nome, sezione, provincia, comune, indirizzo (sede del registro; per i manuali ' +
            'quelli scritti), telefoni e email (solo dalle ricerche recapiti dell\'agenzia o scritti a mano), ' +
            'per_chi_lavora [{ rui, denominazione }] dalla rete del registro, stato, note, origine (scheda, ricerca, ' +
            'manuale), creato_il, aggiornato_il, recapiti_il (ultima ricerca recapiti dell\'agenzia o null).',
          parameters: [
            { name: 'agenzia', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'q', in: 'query', description: 'nome o RUI', schema: { type: 'string' } },
            { name: 'provincia', in: 'query', description: 'sigla o nome, sulla sede del registro', schema: { type: 'string' } },
            { name: 'concorrente', in: 'query', description: 'RUI: solo i suoi collaboratori (rete del registro)', schema: { type: 'string' } },
            { name: 'stato', in: 'query', description: 'uno o più separati da virgola: archivio, da_lavorare, contattato, scartato', schema: { type: 'string' } },
            { name: 'pagina', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'voci e totale' }, 400: { description: 'agenzia mancante o filtro non valido' } },
        },
        post: {
          summary: 'Inserimento manuale',
          description:
            'Corpo { agenzia, nome, rui?, telefono?, email?, provincia?, comune?, indirizzo?, note? } (telefono ed ' +
            'email anche come elenco). Con un RUI del registro la voce si collega (nome, sezione e sede dal registro; ' +
            'se è già in archivio si aggiungono recapiti e note); senza RUI il nome è obbligatorio. Risponde { ok, voce }.',
          responses: { 200: { description: 'voce' }, 400: { description: 'dati non validi' }, 404: { description: 'RUI non nel registro' } },
        },
      },
      '/archivio/scheda': {
        post: {
          summary: 'L\'agenzia ha aperto una scheda: entra o si aggiorna nell\'archivio (idempotente)',
          description: 'Corpo { agenzia, rui }. Risponde { ok, voce }.',
          responses: { 200: { description: 'voce' }, 404: { description: 'RUI non nel registro' } },
        },
      },
      '/archivio/{id}': {
        post: {
          summary: 'Modifica una voce dell\'agenzia',
          description:
            'Corpo { agenzia, stato?, note?, telefono?, email?, nome?, provincia?, comune?, indirizzo? }. Voci con RUI: ' +
            'solo stato e note, telefono/email si aggiungono. Voci manuali senza RUI: tutto, telefono/email sostituiscono.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'voce' }, 404: { description: 'non è una voce di questa agenzia' } },
        },
      },
      '/archivio/{id}/elimina': {
        post: {
          summary: 'Elimina una voce dell\'agenzia',
          description: 'Corpo { agenzia }. Risponde { ok }.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'eliminata' }, 404: { description: 'non è una voce di questa agenzia' } },
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
      { metodo: 'POST', path: '/v1/recapiti/{rui}', uso: 'recapiti dal web (o dalla cache 180 giorni, forza = ricerca nuova): tipo di ricerca e costo reale' },
      { metodo: 'GET', path: '/v1/archivio?agenzia=', uso: 'archivio personale dell\'agenzia (filtri q, provincia, concorrente, stato, pagina)' },
      { metodo: 'POST', path: '/v1/archivio', uso: 'intermediario inserito a mano' },
      { metodo: 'POST', path: '/v1/archivio/scheda', uso: 'scheda aperta dall\'agenzia: entra nell\'archivio' },
      { metodo: 'POST', path: '/v1/archivio/{id}', uso: 'stato, note e recapiti di una voce' },
      { metodo: 'POST', path: '/v1/archivio/{id}/elimina', uso: 'toglie una voce dall\'archivio' },
      { metodo: 'GET', path: '/v1/sedi?q=', uso: 'sedi' },
      { metodo: 'GET', path: '/v1/mandati?q=', uso: 'mandati' },
      { metodo: 'GET', path: '/v1/cariche?q=', uso: 'cariche' },
      { metodo: 'GET', path: '/v1/dimensioni', uso: 'catalogo caratteristiche' },
      { metodo: 'GET', path: '/v1/openapi.json', uso: 'specifica OpenAPI' },
    ],
  };
}
