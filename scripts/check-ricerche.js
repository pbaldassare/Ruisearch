#!/usr/bin/env node
// Controllo rapido delle ricerche senza database (finto pool in memoria):
// RUI senza zeri, accenti, % e _, pagina Query, ricerca mercato, rete diretta/indiretta,
// scheda senza contatti per /v1, cache geocoding per RUI + indirizzo.
// node scripts/check-ricerche.js

import assert from 'node:assert/strict';

// Nessuna connessione vera: il pool esiste ma le query passano dal finto qui sotto.
process.env.DATABASE_URL ||= 'postgresql://finto:finto@127.0.0.1:1/finto';

const { getPool } = await import('../src/db.js');
const q = await import('../src/query.js');
const { interpretaDomanda, leggiFiltri } = await import('../src/domanda.js');
const { codiceProvincia, interpretaQueryMercato, normalizzaZona } = await import('../src/mercato.js');
const { chiaveIndirizzo, puntiSedi } = await import('../src/geo.js');

// --- RUI ---------------------------------------------------------------------
assert.equal(q.normalizzaRui('a49819'), 'A000049819');
assert.equal(q.normalizzaRui(' E000188700 '), 'E000188700');
assert.equal(q.normalizzaRui('UE0001234X'), 'UE0001234X');
assert.equal(q.sembraRui('A49819'), true);
assert.equal(q.sembraRui('A4'), false);
assert.equal(q.sembraRui('49819'), false);
assert.equal(q.numeroSenzaSezione('000049819'), '000049819');
assert.equal(q.numeroSenzaSezione('49819'), '000049819');
assert.equal(q.numeroSenzaSezione('1234'), null);
assert.equal(q.numeroSenzaSezione('A49819'), null);

// --- % e _ non sono jolly, accenti come nel registro --------------------------
assert.equal(q.escapeLike('100%_a\\b'), '100\\%\\_a\\\\b');
assert.deepEqual(q.patternContiene('50%'), ['%50\\%%']);
assert.deepEqual(q.variantiAccenti('Forlì'), ['forlì', "forli'", 'forli']);
assert.ok(q.variantiAccenti("Cirie'").includes('ciriè'));
assert.ok(q.variantiAccenti('CANTÙ').includes("cantu'"));
assert.deepEqual(q.variantiAccenti("D'Angelo"), ["d'angelo"]);
assert.deepEqual(q.patternEsatto('Forlì'), ['forlì', "forli'", 'forli']);
assert.match(q.sqlInoperativo('i'), /i\.data_inizio_inoperativita <= current_date/);

// --- dopo_oss non numerico: 400, non 500 --------------------------------------
await assert.rejects(q.cercaIntermediari(null, { dopoNome: 'A', dopoOss: 'abc' }), (e) => e.statusCode === 400);
await assert.rejects(q.elencoSedi(null, { dopoOss: '1;drop' }), (e) => e.statusCode === 400);

// --- pagina Query ---------------------------------------------------------------
assert.deepEqual(leggiFiltri('agenti in provincia di Milano'), { sezioni: ['A'], provincia: 'MI' });
assert.deepEqual(leggiFiltri('agenti in provincia di BS'), { sezioni: ['A'], provincia: 'BS' });
assert.equal(leggiFiltri('broker in provincia di di').provincia, undefined);
assert.deepEqual(leggiFiltri('società a Roma'), { comune: 'roma', personaGiuridica: true });
assert.deepEqual(leggiFiltri('agenti con sede a Milano'), { sezioni: ['A'], comune: 'milano' });
assert.deepEqual(leggiFiltri('agenti con mandato axa in provincia di BS'), {
  sezioni: ['A'], provincia: 'BS', compagnia: 'axa',
});
assert.deepEqual(leggiFiltri('agenti con mandato Generali a Roma'), {
  sezioni: ['A'], comune: 'roma', compagnia: 'generali',
});
assert.equal(leggiFiltri('agenti in provincia di reggio emilia operativi').provincia, 'RE');

// --- ricerca mercato ------------------------------------------------------------
function zona(frase) {
  const p = interpretaQueryMercato(frase);
  return { ...normalizzaZona(p.zona), compagnia: p.compagnia, sezione: p.sezione };
}
assert.equal(zona('broker su Torino').provincia, 'TO');
assert.equal(zona('BROKER SU TORINO').provincia, 'TO');
assert.equal(zona('broker al centro di Torino').provincia, 'TO');
assert.deepEqual(
  (({ provincia, compagnia, sezione }) => ({ provincia, compagnia, sezione }))(zona('agenti con le Generali a Torino')),
  { provincia: 'TO', compagnia: 'Generali', sezione: 'A' },
);
assert.equal(zona('agenti con mandato Generali a Roma').compagnia, 'Generali');
assert.equal(zona('agenti con mandato Generali a Roma').provincia, 'RM');
assert.equal(zona('agenti con sede a Milano').compagnia, '');
// Un capoluogo cerca in tutta la provincia.
assert.deepEqual(normalizzaZona('Brescia'), { testo: 'Brescia', provincia: 'BS', comune: null, capoluogo: true });
assert.equal(normalizzaZona('Reggio Emilia').provincia, 'RE');
assert.equal(normalizzaZona("REGGIO NELL'EMILIA").provincia, 'RE');
assert.equal(normalizzaZona('Verbania').provincia, 'VB');
assert.equal(normalizzaZona('Sud Sardegna').provincia, 'SU');
assert.equal(normalizzaZona('Forlì').provincia, 'FC');
assert.equal(normalizzaZona('MI').provincia, 'MI');
// Un altro comune resta il comune.
assert.equal(zona('agenti a Cantù con Allianz').comune, 'Cantù');
assert.equal(zona('agenti a Villafranca di Verona').comune, 'Villafranca di Verona');
// Le sigle solo se sono chiaramente una provincia.
assert.equal(zona('broker TO').provincia, 'TO');
assert.equal(zona('broker in provincia di bs').provincia, 'BS');
assert.equal(zona('broker con Allianz').testo, '');
assert.equal(codiceProvincia('su'), 'SU');
assert.equal(codiceProvincia('xx'), null);
assert.equal(codiceProvincia('Monza e Brianza'), 'MB');

// --- finto pool: rete, scheda senza contatti, geocoding --------------------------
const eseguite = [];
let risposte = [];
const finto = async (sql, params = []) => {
  eseguite.push({ sql, params });
  const r = risposte.find(([re]) => re.test(sql));
  return { rows: r ? r[1](params) : [] };
};
getPool().query = finto;
const client = { query: finto };

risposte = [
  [/select \*, /, () => [{
    numero_iscrizione_rui: 'B000575758', denominazione: 'BROKER SPA', sezione: 'B',
    inoperativo: false, persona_giuridica: true,
  }]],
  [/where r\.principale = \$2/, () => [
    { livello: 'I', rui_collegato: 'E000228451', denominazione: 'KIRON', sezione: 'E', tramite: null },
    { livello: 'II', rui_collegato: 'E000000001', denominazione: 'ADDETTO', sezione: 'E', tramite: 'E000228451', tramite_denominazione: 'KIRON' },
  ]],
  [/from contatti/, () => [{ tipo: 'telefono', valore: '333' }]],
  [/rete_numeri/, () => [{ intermediari: 2, intermediari_diretti: 1, intermediari_indiretti: 1 }]],
];
const r = await q.rete(client, 'B575758');
assert.equal(r.soggetto.numero_iscrizione_rui, 'B000575758');
assert.deepEqual(r.conteggi, { principali: 0, collaboratori: 2, diretti: 1, indiretti: 1 });
assert.equal(r.collaboratori[1].tramite, 'E000228451');
assert.equal(r.grafo.archi[1].tramite, 'E000228451');
assert.ok(eseguite.some((e) => /r\.tramite/.test(e.sql)));

eseguite.length = 0;
const conContatti = await q.scheda(client, 'B000575758', { geocodifica: false });
assert.deepEqual(conContatti.contatti, [{ tipo: 'telefono', valore: '333' }]);
assert.equal(conContatti.rete.conteggi.indiretti, 1);
eseguite.length = 0;
const perV1 = await q.scheda(client, 'B000575758', { geocodifica: false, contatti: false });
assert.equal('contatti' in perV1, false);
assert.ok(!eseguite.some((e) => /from contatti/.test(e.sql)));

// "quanti agenti ha consulbrokers": la rete del soggetto, non tutti gli agenti del registro.
risposte = [
  [/\) as n /, () => [{ n: 1 }]],
  [/from intermediari i/, () => [{ numero_iscrizione_rui: 'B000778092', denominazione: 'CONSULBROKERS SPA', sezione: 'B' }]],
  [/group by 1/, () => [{ sezione: 'E', totale: 60, diretti: 50 }]],
  [/rete_numeri/, () => [{ intermediari: 60 }]],
];
eseguite.length = 0;
const quanti = await interpretaDomanda(client, 'quanti agenti ha consulbrokers');
assert.equal(quanti.tipo, 'conteggio');
assert.equal(quanti.scelto.numero_iscrizione_rui, 'B000778092');
assert.equal(quanti.metrica, 'agenti');
assert.equal(quanti.valore, 0);
assert.match(quanti.nota, /60 in rete \(50 diretti, 10 indiretti\)/);
assert.ok(eseguite.some((e) => /principale = \$1/.test(e.sql) && e.params[0] === 'B000778092'));

// "agenti in provincia di Milano": elenco filtrato per MI, non per "DI".
risposte = [];
eseguite.length = 0;
const elenco = await interpretaDomanda(client, 'agenti in provincia di Milano');
assert.equal(elenco.tipo, 'elenco');
assert.equal(elenco.filtri.provincia, 'MI');
assert.ok(eseguite.some((e) => e.params.includes('MI')));

// Cache geocoding: chiave = RUI + indirizzo, non oss.
assert.equal(chiaveIndirizzo('via  Roma 1,  Milano '), 'VIA ROMA 1, MILANO');
risposte = [[/from sedi_geo/, () => [
  { indirizzo_chiave: 'VIA ROMA 1, 20100, MILANO, MI, ITALIA', lat: 45, lng: 9, stato: 'ok' },
]]];
eseguite.length = 0;
const punti = await puntiSedi(client, 'B000575758', [
  { oss: 7, indirizzo_sede: 'Via Roma 1', cap_sede: '20100', comune_sede: 'MILANO', provincia_sede: 'MI' },
  // Stesso oss, indirizzo cambiato dopo un import: niente coordinate vecchie.
  { oss: 8, indirizzo_sede: 'Via Verdi 2', cap_sede: '20100', comune_sede: 'MILANO', provincia_sede: 'MI' },
], { geocodifica: false });
assert.deepEqual(eseguite[0].params, ['B000575758', [
  'VIA ROMA 1, 20100, MILANO, MI, ITALIA', 'VIA VERDI 2, 20100, MILANO, MI, ITALIA',
]]);
assert.equal(punti[0].stato, 'ok');
assert.equal(punti[0].lat, 45);
assert.equal(punti[1].stato, 'manca');
assert.equal(punti[1].lat, null);

// --- lookup dall'export: stesse regole della rete materializzata -----------------
const { cercaNellExport, sottoGrafo } = await import('../src/lookup.js');
const iscritto = (oss, rui, nome, societa = false) => {
  const riga = Array(20).fill(null);
  riga[0] = String(oss);
  riga[3] = rui;
  riga[societa ? 9 : 5] = nome;
  return riga;
};
const tabelle = {
  intermediari: [
    iscritto(1, 'B000000001', 'BROKER SPA', true),
    iscritto(2, 'E000000002', 'SOCIETA E SRL', true),
    iscritto(3, 'E000000003', "NICOLO' ROSSI"),
    iscritto(4, 'D000000004', 'BANCA SPA', true),
  ],
  // oss, livello, principale, I livello, II livello, qualifica
  collaboratori: [
    ['1', 'I', 'B000000001', 'E000000002', null, 'Collaboratore di intermediario'],
    ['2', 'II', 'B000000001', 'E000000002', 'E000000003', 'Addetto di società iscritta'],
    ['3', 'II', 'D000000004', 'E000000002', 'E000000003', 'Addetto di società iscritta'],
  ],
  sedi: [], mandati: [], cariche: [], siti_internet: [],
};
const societa = sottoGrafo(tabelle, 'E2');
assert.deepEqual(societa.rapporti.come_principale.map((a) => [a.collegato, a.livello, a.tramite]), [
  ['E000000003', 'I', null],
]);
const persona = sottoGrafo(tabelle, 'E000000003');
assert.deepEqual(persona.rapporti.come_collaboratore.map((a) => [a.principale, a.livello, a.tramite]).sort(), [
  ['B000000001', 'II', 'E000000002'],
  ['E000000002', 'I', null],
]);
assert.equal(sottoGrafo(tabelle, 'D000000004'), null);
const oggetti = tabelle.intermediari.map((r) => ({ numero_iscrizione_rui: r[3], cognome_nome: r[5], ragione_sociale: r[9] }));
assert.deepEqual(cercaNellExport(oggetti, { nome: 'Nicolò' }).map((r) => r.numero_iscrizione_rui), ['E000000003']);
assert.deepEqual(cercaNellExport(oggetti, { nome: 'banca' }), []);

console.log('check-ricerche: tutto ok');
