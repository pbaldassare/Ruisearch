#!/usr/bin/env node
// Controllo rapido dell'area cliente senza database (finto client in memoria):
// validazione dei recapiti, prenotazione delle ricerche web, sorveglianza broker, accessi operatori.
// node scripts/check-cliente.js

import assert from 'node:assert/strict';

const {
  validaRecapito, chiaveRecapito, salvaContatto, prenotaRicerca, chiudiRicerca, inTransazione, TETTO_GIORNO,
} = await import('../src/opportunity.js');
const { sincronizzaSorveglianza, rimuoviBrokerSorvegliato } = await import('../src/cliente.js');
const { creaUtenteCliente, reimpostaPasswordUtente } = await import('../src/utenti.js');

// --- Recapiti ------------------------------------------------------------------------------------
const v = (valore, opz) => validaRecapito(valore, opz);

// Spazzatura vista in produzione e nei test: mai un recapito
assert.equal(v('16/01/2025', { etichetta: 'Data iscrizione' }), null);
assert.equal(v('nessun dato pubblico', { tipo: 'sito' }), null);
assert.equal(v('non disponibile', { tipo: 'email' }), null);
assert.equal(v('[object Object]', { tipo: 'linkedin', etichetta: 'LinkedIn' }), null);
assert.equal(v({ url: 'https://x.it' }, { tipo: 'sito' }), null);
assert.equal(v(['a@b.it', 'c@d.it'], { tipo: 'email' }), null);
assert.equal(v(3331234567, { tipo: 'telefono' }), null);
assert.equal(v('2019-2023', { etichetta: 'Telefono' }), null);
assert.equal(v('2019 / 2023'), null);
assert.equal(v('12345', { etichetta: 'Cellulare' }), null);
assert.equal(v('0000000000'), null);
assert.equal(v('RC auto', { etichetta: 'Settore automobile' }), null); // "automobile" non è "mobile"
assert.equal(v('positivo', { etichetta: 'Esito' }), null); // "esito" non è "sito"
assert.equal(v('dott.rossi'), null);
assert.equal(v('Via Roma, Milano'), null); // senza civico né CAP
assert.equal(v('linkedin.com/in/'), null);
assert.equal(v('mailto:'), null);
assert.equal(v('a'.repeat(400)), null);

// Email e PEC
assert.deepEqual(v('MAILTO:Info@Agenzia.IT'), { tipo: 'email', valore: 'info@agenzia.it', etichetta: 'Email' });
assert.equal(v('agenzia@pec.it').tipo, 'pec');
assert.equal(v('agenzia@legalmail.it').tipo, 'pec');
assert.equal(v('info@pecora.it').tipo, 'email');
assert.equal(v('agenzia@x.it', { etichetta: 'PEC' }).tipo, 'pec');

// Telefoni: tipo dal valore, cellulare/fisso dal prefisso, non dall'etichetta
assert.deepEqual(v('+39 333 123 4567', { etichetta: 'Telefono' }), {
  tipo: 'telefono', valore: '+39 333 123 4567', etichetta: 'Cellulare',
});
assert.equal(v('06 1234567', { etichetta: 'Cellulare' }).etichetta, 'Telefono fisso');
assert.equal(v('0571/123456').tipo, 'telefono');
assert.equal(v('0039 06.123.4567').etichetta, 'Telefono fisso');
assert.equal(v('800 123 456').etichetta, 'Numero verde');
assert.equal(v('06 1234567', { etichetta: 'Fax' }).etichetta, 'Fax');
// 11 cifre: senza etichetta è un fisso, con "P.IVA" è la partita IVA
assert.equal(v('01234567890').tipo, 'telefono');
assert.deepEqual(v('IT 01234567890', { etichetta: 'P.IVA' }), {
  tipo: 'partita_iva', valore: '01234567890', etichetta: 'Partita IVA',
});
assert.equal(v('Via Roma 1', { etichetta: 'P.IVA' }), null);
assert.equal(v('RSSMRA80A01H501U', { etichetta: 'Codice fiscale' }).tipo, 'codice_fiscale');

// Siti e social
assert.deepEqual(v('www.ageallianz.it/milano10114/', { etichetta: 'Sito RUI' }), {
  tipo: 'sito', valore: 'www.ageallianz.it/milano10114/', etichetta: 'Sito RUI',
});
assert.equal(v('agenzia.it').tipo, 'sito');
assert.equal(v('https://agenzia.example.museum/chi-siamo').tipo, 'sito');
assert.equal(v('javascript:alert(1)'), null);
assert.equal(v('https://www.linkedin.com/in/mario-rossi-123/').tipo, 'linkedin');
assert.deepEqual(v('facebook.com/agenziarossi'), { tipo: 'altro', valore: 'facebook.com/agenziarossi', etichetta: 'Facebook' });
assert.equal(v('https://instagram.com/agenzia', { etichetta: 'Sito' }).etichetta, 'Instagram');
assert.equal(v('https://www.agenzia.it', { etichetta: 'LinkedIn' }).etichetta, 'Sito');

// Indirizzi: parola di strada + civico o CAP
assert.equal(v('VIA PALAZZO PONTIFICIO 1, 00040, CASTEL GANDOLFO, RM', { etichetta: 'Sede operativa' }).etichetta, 'Sede operativa');
assert.equal(v('CSO VITTORIO EMANUELE II 184, 00186 ROMA (RM)').tipo, 'indirizzo');
assert.equal(v('P.ZZA LUIGI DI SAVOIA 24, 20124, MILANO, MI').tipo, 'indirizzo');
assert.equal(v('Loc. San Marco snc, 12345 Alba').tipo, 'indirizzo');
assert.equal(v('Bahnhofstr. 12, 39100 Bolzano').tipo, 'indirizzo');
assert.equal(v('Via Roma 1', { etichetta: 'Automobile' }).etichetta, 'Indirizzo');

// Stesso recapito scritto diverso: stessa chiave
assert.equal(
  chiaveRecapito('indirizzo', 'VIA NAZIONALE TIBURTINA 22, 00019, TIVOLI, RM'),
  chiaveRecapito('indirizzo', 'Via Nazionale Tiburtina 22, 00019 Tivoli (RM)'),
);
assert.equal(chiaveRecapito('telefono', '+39 333 1234567'), chiaveRecapito('telefono', '333.123.4567'));
assert.equal(chiaveRecapito('sito', 'http://www.x.it/'), chiaveRecapito('sito', 'x.it'));

// salvaContatto: lo scarto non tocca il DB; il gemello già salvato si riusa; etichetta/fonte_url non si sovrascrivono
{
  const chiamate = [];
  const db = {
    async query(sql, p = []) {
      chiamate.push({ sql, p });
      if (sql.includes('select valore from contatti')) {
        return { rows: [{ valore: 'VIA NAZIONALE TIBURTINA 22, 00019, TIVOLI, RM' }] };
      }
      if (sql.includes('insert into contatti')) return { rows: [{ nuovo: false }] };
      throw new Error(`query inattesa: ${sql}`);
    },
  };
  assert.equal(await salvaContatto(db, 'A000000617', 'altro', '16/01/2025', { etichetta: 'Data iscrizione' }), null);
  assert.equal(chiamate.length, 0);
  const out = await salvaContatto(db, 'A000000617', 'indirizzo', 'Via Nazionale Tiburtina 22, 00019 Tivoli (RM)', {
    etichetta: 'Sede web', url: 'javascript:alert(1)', ricercaId: 7,
  });
  assert.deepEqual(out, { tipo: 'indirizzo', valore: 'VIA NAZIONALE TIBURTINA 22, 00019, TIVOLI, RM', nuovo: false });
  const ins = chiamate.find((c) => c.sql.includes('insert into contatti'));
  assert.equal(ins.p[2], 'VIA NAZIONALE TIBURTINA 22, 00019, TIVOLI, RM');
  assert.equal(ins.p[5], null); // fonte_url non http(s): scartata
  assert.equal(ins.p[7], 7); // ricerca_id
  assert.match(ins.sql, /coalesce\(contatti\.etichetta, excluded\.etichetta\)/);
  assert.match(ins.sql, /fonte_url = coalesce\(contatti\.fonte_url, excluded\.fonte_url\)/);
  assert.match(ins.sql, /raccolto_il/);
}

// --- Prenotazione delle ricerche web (finto ricerche_web in memoria) -----------------------------
function dbRicerche() {
  const righe = [];
  let id = 0;
  const stato = { transazioni: 0, rollback: 0, rilasciate: 0 };
  const conn = {
    async query(sql, p = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s === 'begin') { stato.transazioni += 1; return { rows: [] }; }
      if (s === 'commit') return { rows: [] };
      if (s === 'rollback') { stato.rollback += 1; return { rows: [] }; }
      if (s.includes('pg_advisory_xact_lock')) return { rows: [{}] };
      if (s.startsWith("update ricerche_web set stato = 'errore'")) {
        const limite = Date.now() - p[1] * 60_000;
        for (const r of righe) {
          if (r.rui_target === p[0] && r.stato === 'in_corso' && r.iniziata_il < limite) r.stato = 'errore';
        }
        return { rows: [] };
      }
      if (s.startsWith('select id, tipo, sintesi')) {
        const r = righe.filter((x) => x.rui_target === p[0] && x.stato === 'ok' && /^nuova_/.test(x.tipo || '')).at(-1);
        return { rows: r ? [{ id: r.id, tipo: r.tipo, sintesi: r.sintesi, giorno: '2026-11-23' }] : [] };
      }
      if (s.startsWith('select 1 from ricerche_web')) {
        return { rows: righe.filter((x) => x.rui_target === p[0] && x.stato === 'in_corso').map(() => ({})) };
      }
      if (s.startsWith('select count(*)::int as fatte')) {
        const fatte = righe.filter((x) => x.cliente_id === p[0] && !/^cache/.test(x.tipo || '')).length;
        return { rows: [{ fatte }] };
      }
      if (s.startsWith('insert into ricerche_web')) {
        const inCorso = s.includes("'in_corso'");
        if (inCorso && righe.some((x) => x.rui_target === p[1] && x.stato === 'in_corso')) {
          throw Object.assign(new Error('duplicate key'), { code: '23505' });
        }
        id += 1;
        righe.push({
          id, cliente_id: p[0], rui_target: p[1], stato: inCorso ? 'in_corso' : 'ok',
          tipo: inCorso ? null : p[2], iniziata_il: Date.now(), sintesi: null,
        });
        return { rows: [{ id, costo_eur: null }] };
      }
      if (s.startsWith('update ricerche_web set stato = $2')) {
        const r = righe.find((x) => x.id === p[0]);
        Object.assign(r, { stato: p[1], tipo: p[2], sintesi: p[3] });
        return { rows: [{ costo_eur: null }] };
      }
      throw new Error(`query inattesa: ${s}`);
    },
    release() { stato.rilasciate += 1; },
  };
  // Si presenta come il pool di pg: inTransazione deve prendere e restituire una connessione
  const pool = { idleCount: 0, connect: async () => conn, query: conn.query };
  return { pool, righe, stato };
}

{
  const { pool, righe, stato } = dbRicerche();
  const prima = await prenotaRicerca(pool, 1, 'E000000001');
  assert.equal(prima.cache, null);
  assert.equal(righe[0].stato, 'in_corso');
  assert.equal(stato.rilasciate, 1);

  // Secondo clic (o altro cliente) mentre la prima è in corso: 409, niente seconda ricerca pagata
  await assert.rejects(prenotaRicerca(pool, 1, 'E000000001'), (e) => e.statusCode === 409 && /già in corso/.test(e.message));
  await assert.rejects(prenotaRicerca(pool, 2, 'E000000001'), (e) => e.statusCode === 409);
  assert.equal(righe.length, 1);
  assert.equal(stato.rilasciate, 3);

  // Chiusa con risultati: le richieste dopo leggono dalla cache, con una riga loro che non conta nel tetto
  await chiudiRicerca(pool, prima.id, { stato: 'ok', tipo: 'nuova_con_risultati', sintesi: 'ok' });
  const dopo = await prenotaRicerca(pool, 2, 'E000000001');
  assert.equal(dopo.tipo, 'cache_con_risultati');
  assert.equal(dopo.cache.giorno, '2026-11-23');
  assert.equal(righe.at(-1).tipo, 'cache_con_risultati');
  // Anche senza AI configurata la cache vale
  assert.equal((await prenotaRicerca(pool, 2, 'E000000001', { nuova: false })).tipo, 'cache_con_risultati');
  // Senza AI e senza cache: nessuna riga
  assert.equal(await prenotaRicerca(pool, 2, 'E000000099', { nuova: false }), null);

  // Ricerca fallita: 'errore', non vale per il riuso (si può rifare), ma conta nel tetto
  const fallita = await prenotaRicerca(pool, 3, 'E000000002');
  await chiudiRicerca(pool, fallita.id, { stato: 'errore' });
  assert.equal((await prenotaRicerca(pool, 3, 'E000000002')).cache, null);

  // In corso da più di 5 minuti: è morta, non blocca più
  righe.at(-1).iniziata_il -= 6 * 60_000;
  const ripresa = await prenotaRicerca(pool, 3, 'E000000002');
  assert.equal(ripresa.cache, null);
  assert.equal(righe.filter((x) => x.rui_target === 'E000000002' && x.stato === 'errore').length, 2);

  // Tetto del giorno: contano nuove, fallite e in corso; non le letture dalla cache
  const { pool: p2, righe: r2 } = dbRicerche();
  for (let i = 0; i < TETTO_GIORNO; i += 1) await prenotaRicerca(p2, 9, `E1000000${String(i).padStart(2, '0')}`);
  await assert.rejects(prenotaRicerca(p2, 9, 'E200000000'), (e) => e.statusCode === 429);
  r2.push({ id: 99, cliente_id: 8, rui_target: 'E300000000', stato: 'ok', tipo: 'nuova_senza_risultati', iniziata_il: Date.now() });
  for (let i = 0; i < 25; i += 1) assert.equal((await prenotaRicerca(p2, 7, 'E300000000')).tipo, 'cache_senza_risultati');
  assert.equal((await prenotaRicerca(p2, 7, 'E300000001')).cache, null);

  // Doppione sullo stesso RUI nello stesso istante (indice unico parziale): 409 e rollback
  const corsa = {
    idleCount: 0,
    connect: async () => ({
      async query(sql) {
        if (sql.includes("'in_corso', now()")) throw Object.assign(new Error('duplicate key'), { code: '23505' });
        if (sql.includes('count(*)')) return { rows: [{ fatte: 0 }] };
        return { rows: [] };
      },
      release() {},
    }),
  };
  await assert.rejects(prenotaRicerca(corsa, 1, 'E000000003'), (e) => e.statusCode === 409);
}

// inTransazione: errore = rollback e connessione restituita; un client già dedicato si usa così com'è
{
  const log = [];
  const conn = { query: async (sql) => { log.push(sql); return { rows: [] }; }, release: () => log.push('release') };
  const pool = { idleCount: 0, connect: async () => conn };
  await assert.rejects(inTransazione(pool, async () => { throw new Error('boom'); }), /boom/);
  assert.deepEqual(log, ['begin', 'rollback', 'release']);
  log.length = 0;
  assert.equal(await inTransazione(conn, async () => 42), 42);
  assert.deepEqual(log, ['begin', 'commit']);
}

// --- Sorveglianza broker ------------------------------------------------------------------------
{
  const sql = [];
  const db = {
    async query(s, p = []) {
      sql.push(s);
      if (s.includes('from cliente_broker_sorvegliati') && s.includes('order by denominazione')) {
        return { rows: [
          { id: 1, rui_broker: 'B000000001', denominazione: 'Alfa', sezione: 'B', creato_il: 'x' },
          { id: 2, rui_broker: 'B000000002', denominazione: 'Beta', sezione: 'B', creato_il: 'x' },
        ] };
      }
      if (s.includes('with attuali as')) return { rows: [{ rui_broker: 'B000000001', in_rete: 5467 }] };
      if (s.includes('limit 80')) return { rows: [{ id: 10, letto: false }] };
      if (s.includes('as non_letti')) return { rows: [{ non_letti: 120, letti: 3 }] };
      throw new Error(`query inattesa: ${s} ${p}`);
    },
  };
  const out = await sincronizzaSorveglianza(db, { id: 1 });
  // Un solo giro per tutti i broker: avvisi e snapshot nella stessa istruzione, niente insert riga per riga
  const diff = sql.filter((s) => s.includes('with attuali as'));
  assert.equal(diff.length, 1);
  assert.match(diff[0], /not exists \(\s*select 1 from cliente_rete_snapshot/);
  assert.match(diff[0], /insert into cliente_alert[\s\S]*on conflict \(cliente_id, rui_broker, rui_nuovo\) do nothing/);
  assert.match(diff[0], /insert into cliente_rete_snapshot[\s\S]*from nuovi/);
  assert.deepEqual(out.sorvegliati.map((b) => b.in_rete), [5467, 0]);
  // Conteggi separati dall'elenco (che si ferma a 80) e solo per broker ancora sorvegliati
  assert.equal(out.non_letti, 120);
  assert.equal(out.letti, 3);
  assert.ok(sql.filter((s) => s.includes('from cliente_alert a')).every((s) => s.includes('from cliente_broker_sorvegliati b')));

  // Nessun broker: nessuna scrittura
  const vuoto = { query: async (s) => (s.includes('order by denominazione') ? { rows: [] } : assert.fail(s)) };
  assert.deepEqual(await sincronizzaSorveglianza(vuoto, { id: 1 }), { sorvegliati: [], alert: [], non_letti: 0, letti: 0 });

  // Togliere un broker cancella anche i suoi avvisi, nella stessa istruzione
  const tolte = [];
  const dbTogli = {
    async query(s) {
      if (s.includes('from clienti')) return { rows: [{ id: 1, numero_iscrizione_rui: 'B000778092' }] };
      tolte.push(s);
      return { rows: [{ n: 1 }] };
    },
  };
  assert.deepEqual(await rimuoviBrokerSorvegliato(dbTogli, 'B000778092', 'B000000001'), { ok: true, rimosso: true });
  assert.equal(tolte.length, 1);
  assert.match(tolte[0], /delete from cliente_alert/);
  assert.match(tolte[0], /delete from cliente_rete_snapshot/);
  assert.match(tolte[0], /delete from cliente_broker_sorvegliati/);
}

// --- Accessi operatori ----------------------------------------------------------------------------
{
  const operatori = [{ email: 'op@a.it', cliente_id: 1, rui: 'A000000001', denominazione: 'Agenzia A', attivo: false }];
  const scritture = [];
  const db = {
    async query(s, p = []) {
      if (s.includes('from intermediari')) {
        return { rows: [{ numero_iscrizione_rui: p[1], denominazione: `Soc ${p[1]}`, sezione: 'A', inoperativo_oggi: false }] };
      }
      if (s.includes('from operatori_cliente o')) {
        return { rows: operatori.filter((o) => o.email === p[0]).map((o) => ({ rui: o.rui, denominazione: o.denominazione })) };
      }
      if (s.includes('insert into clienti')) {
        scritture.push('clienti');
        return { rows: [{ id: 2, numero_iscrizione_rui: p[0], denominazione: p[1], sezione: p[2] }] };
      }
      if (s.includes('insert into operatori_cliente')) {
        scritture.push('operatori');
        assert.match(s, /on conflict \(email\) do nothing/);
        return { rowCount: 1, rows: [{ id: 5, email: p[1], nome: p[3], attivo: true }] };
      }
      if (s.includes('update operatori_cliente')) {
        assert.doesNotMatch(s, /attivo\s*=/);
        const o = operatori.find((x) => x.email === p[0]);
        return { rowCount: o ? 1 : 0, rows: o ? [{ id: 1, email: o.email, nome: null, attivo: o.attivo }] : [] };
      }
      throw new Error(`query inattesa: ${s}`);
    },
  };
  // Email di un'altra società: 409 e nessuna scrittura (né cliente creato/riattivato, né operatore spostato)
  await assert.rejects(
    creaUtenteCliente(db, { rui: 'A000000002', email: 'OP@a.it' }),
    (e) => e.statusCode === 409 && /Agenzia A/.test(e.message),
  );
  // Stessa società: 409 che rimanda a "Reimposta password"
  await assert.rejects(
    creaUtenteCliente(db, { rui: 'A000000001', email: 'op@a.it' }),
    (e) => e.statusCode === 409 && /Reimposta password/.test(e.message),
  );
  assert.deepEqual(scritture, []);
  const nuovo = await creaUtenteCliente(db, { rui: 'A000000002', email: 'nuovo@b.it' });
  assert.equal(nuovo.operatore.email, 'nuovo@b.it');
  // Reimposta password: l'operatore disattivato resta disattivato
  const reset = await reimpostaPasswordUtente(db, 'op@a.it');
  assert.equal(reset.operatore.attivo, false);
}

console.log('cliente: ok');
