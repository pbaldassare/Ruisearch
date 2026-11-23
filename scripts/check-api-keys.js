#!/usr/bin/env node
// Controllo rapido delle chiavi API senza database: un finto client in memoria.
// node scripts/check-api-keys.js

import assert from 'node:assert/strict';
import { chiaveValida, creaChiave, elencoChiavi, revocaChiave } from '../src/api-keys.js';

const righe = [];
const finto = {
  async query(sql, p = []) {
    if (sql.startsWith('insert')) {
      const r = { id: righe.length + 1, nome: p[0], prefisso: p[1], hash: p[2], revocata_il: null, ultimo_uso: null };
      righe.push(r);
      return { rows: [r], rowCount: 1 };
    }
    if (sql.includes('set ultimo_uso')) {
      const r = righe.find((x) => x.hash === p[0] && !x.revocata_il);
      if (r) r.ultimo_uso = new Date();
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (sql.includes('set revocata_il')) {
      const r = righe.find((x) => x.id === p[0] && !x.revocata_il);
      if (r) r.revocata_il = new Date();
      return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
    }
    return { rows: righe.map(({ hash, ...r }) => r), rowCount: righe.length };
  },
};

await assert.rejects(creaChiave(finto, { nome: '  ' }), /nome/);
const { chiave, voce } = await creaChiave(finto, { nome: 'Assicurapp' });
assert.match(chiave, /^rui_[A-Za-z0-9_-]{43}$/);
assert.equal(voce.prefisso, chiave.slice(0, 10));
assert.notEqual(righe[0].hash, chiave, 'in chiaro non si salva');
assert.equal((await elencoChiavi(finto)).chiavi[0].hash, undefined);

assert.equal(await chiaveValida(finto, chiave), true);
assert.ok(righe[0].ultimo_uso);
assert.equal(await chiaveValida(finto, `${chiave}x`), false);
assert.equal(await chiaveValida(finto, ''), false);
assert.equal(await chiaveValida(finto, 'x'.repeat(500)), false);

await revocaChiave(finto, { id: voce.id });
assert.equal(await chiaveValida(finto, chiave), false, 'revocata non vale più');
await assert.rejects(revocaChiave(finto, { id: voce.id }), /già revocata/);
await assert.rejects(revocaChiave(finto, { id: 'abc' }), /non valida/);

console.log('chiavi API: ok');
