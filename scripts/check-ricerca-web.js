#!/usr/bin/env node
// Controllo della ricerca web con Mistral senza chiamare Mistral: costo, lettura del JSON, recapiti.
// node scripts/check-ricerca-web.js

import assert from 'node:assert/strict';

process.env.MISTRAL_API_KEY = 'finta';
const { costoMistral, estraiJson, cercaRecapiti, approfondisci } = await import('../src/ricerca-web.js');

// Costo: (1.000 + 9.000 token in entrata) * 1,5 + 500 in uscita * 7,5 per milione + 3 ricerche * 0,03
assert.equal(
  costoMistral({ prompt_tokens: 1000, connector_tokens: 9000, completion_tokens: 500, connectors: { web_search: 3 } }),
  0.10875,
);
assert.equal(costoMistral({}), 0);

// JSON dentro ```json ... ``` e testo intorno; risposta illeggibile = errore 502 (la ricerca non si salva)
assert.deepEqual(estraiJson('```json\n{"a": 1}\n```'), { a: 1 });
assert.throws(() => estraiJson('nessun dato'), (e) => e.statusCode === 502);

// Risposta finta di Mistral
let risposta;
globalThis.fetch = async () => ({ ok: risposta.ok, status: risposta.status, json: async () => risposta.corpo });
const conTesto = (testo, extra = {}) => ({
  ok: true,
  status: 200,
  corpo: {
    outputs: [
      { type: 'tool.execution', name: 'web_search', arguments: '{"query":"giungoauto contatti"}' },
      { type: 'message.output', content: [{ type: 'text', text: testo }] },
    ],
    usage: { prompt_tokens: 1000, connector_tokens: 5000, completion_tokens: 400, connectors: { web_search: 2 } },
    ...extra,
  },
});
const scheda = { soggetto: { numero_iscrizione_rui: 'E000593246', denominazione: 'GIUNGOAUTO SAS', sezione: 'E', persona_giuridica: true } };

risposta = conTesto(JSON.stringify({
  sintesi: 'Concessionaria a Cutro.',
  recapiti: [
    { tipo: 'email', valore: 'info@giungoauto.it', url: 'https://www.giungoauto.it/contattaci/', di_chi: 'persona' },
    { tipo: 'facebook', valore: 'GiungoAuto', url: 'https://www.facebook.com/giungoauto/', di_chi: 'persona' },
    { tipo: 'telefono', valore: '0863 453927', url: 'nessun link', di_chi: 'societa_collegata', societa: 'Agenzia X' },
    { tipo: 'sito', valore: '   ', url: null },
    { tipo: 'email', valore: { a: 1 } },
  ],
}));
const r = await cercaRecapiti(scheda);
assert.equal(r.recapiti.length, 3, 'scartati valori vuoti e non stringa');
assert.equal(r.recapiti[1].valore, 'https://www.facebook.com/giungoauto/', 'nome della pagina social -> link del profilo');
assert.equal(r.recapiti[2].riferito_a, 'societa_collegata');
assert.equal(r.recapiti[2].etichetta, 'Agenzia X');
assert.equal(r.recapiti[2].url, null, 'fonte non http scartata');
assert.deepEqual(r.ricerche, ['giungoauto contatti']);
assert.ok(r.costo_eur > 0);

// Errori di Mistral: risalgono (502) invece di diventare una ricerca "senza risultati"
risposta = { ok: false, status: 429, corpo: { message: 'credito' } };
await assert.rejects(cercaRecapiti(scheda), (e) => e.statusCode === 502 && /credito esaurito/.test(e.message));
risposta = conTesto('non ho trovato niente');
await assert.rejects(cercaRecapiti(scheda), (e) => e.statusCode === 502);

// Approfondimento della pagina Query
risposta = conTesto('{"sintesi":"ok","categorie":[{"id":"web","titolo":"Web","voci":[{"etichetta":"Sito","valore":"x.it","url":"https://x.it"}]}]}');
const a = await approfondisci({ q: 'chi è consulbrokers', risultato: { tipo: 'cerca' } });
assert.equal(a.sintesi, 'ok');
assert.equal(a.categorie[0].voci[0].url, 'https://x.it');
await assert.rejects(approfondisci({ q: 'x' }), (e) => e.statusCode === 400);

console.log('ricerca web: ok');
