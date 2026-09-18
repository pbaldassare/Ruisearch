// Opportunity di mercato: salva prospect e recapiti trovati sul web via Kimi.

import { clienteDaRui } from './cliente.js';
import { approfondisciConKimi, kimiPronta } from './kimi-approfondisci.js';
import { anagrafica, normalizzaRui, scheda } from './query.js';

function erroreHttp(messaggio, status) {
  const errore = new Error(messaggio);
  errore.statusCode = status;
  return errore;
}

function testo(valore) {
  return String(valore || '').trim();
}

async function richiediCliente(client, rui) {
  const row = await clienteDaRui(client, rui);
  if (!row) throw erroreHttp(`nessun cliente attivo con RUI ${rui}`, 404);
  return row;
}

export async function elencoOpportunity(client, ruiCliente) {
  const cliente = await richiediCliente(client, ruiCliente);
  const { rows } = await client.query(
    `
    select
      o.id,
      o.rui_target,
      o.denominazione,
      o.sezione,
      o.rui_broker,
      o.broker_denominazione,
      o.zona,
      o.compagnia,
      o.stato,
      o.note,
      o.sintesi,
      o.arricchito_il,
      o.creato_il,
      coalesce(
        (
          select json_agg(c order by c.tipo, c.valore)
          from (
            select ct.tipo, ct.valore, ct.etichetta, ct.fonte, ct.fonte_url, ct.affidabilita
            from contatti ct
            where ct.numero_iscrizione_rui = o.rui_target
          ) c
        ),
        '[]'::json
      ) as recapiti
    from cliente_opportunity o
    where o.cliente_id = $1
    order by
      case o.stato
        when 'nuova' then 0
        when 'in_lavorazione' then 1
        when 'contattata' then 2
        else 3
      end,
      o.creato_il desc
    `,
    [cliente.id],
  );
  return { kimi_pronta: kimiPronta(), voci: rows };
}

export async function salvaOpportunity(client, {
  rui, rui_target, rui_broker, zona, compagnia, note,
} = {}) {
  const cliente = await richiediCliente(client, rui);
  const target = normalizzaRui(rui_target);
  if (!target) throw erroreHttp('indica il RUI da salvare', 400);
  const soggetti = await anagrafica(client, target);
  const s = soggetti[0];
  if (!s) throw erroreHttp(`nessun intermediario A/B/E con RUI ${target}`, 404);

  let brokerNome = null;
  const broker = normalizzaRui(rui_broker);
  if (broker) {
    const b = (await anagrafica(client, broker))[0];
    brokerNome = b?.denominazione || null;
  }

  const ins = await client.query(
    `
    insert into cliente_opportunity (
      cliente_id, rui_target, denominazione, sezione,
      rui_broker, broker_denominazione, zona, compagnia, note, stato
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'nuova')
    on conflict (cliente_id, rui_target) do update
      set denominazione = excluded.denominazione,
          sezione = excluded.sezione,
          rui_broker = coalesce(excluded.rui_broker, cliente_opportunity.rui_broker),
          broker_denominazione = coalesce(excluded.broker_denominazione, cliente_opportunity.broker_denominazione),
          zona = coalesce(excluded.zona, cliente_opportunity.zona),
          compagnia = coalesce(excluded.compagnia, cliente_opportunity.compagnia),
          note = coalesce(excluded.note, cliente_opportunity.note)
    returning *
    `,
    [
      cliente.id, target, s.denominazione, s.sezione,
      broker || null, brokerNome, testo(zona) || null, testo(compagnia) || null,
      testo(note) || null,
    ],
  );
  return { ok: true, voce: ins.rows[0] };
}

export async function aggiornaStatoOpportunity(client, { rui, id, stato, note } = {}) {
  const cliente = await richiediCliente(client, rui);
  const ammessi = ['nuova', 'in_lavorazione', 'contattata', 'scartata'];
  if (stato && !ammessi.includes(stato)) throw erroreHttp('stato non valido', 400);
  const voceId = Number(id);
  if (!Number.isFinite(voceId) || voceId <= 0) throw erroreHttp('indica l\'opportunity', 400);

  const upd = await client.query(
    `
    update cliente_opportunity
    set stato = coalesce($3, stato),
        note = coalesce($4, note)
    where cliente_id = $1 and id = $2
    returning id, rui_target, stato, note
    `,
    [cliente.id, voceId, stato || null, note === undefined ? null : testo(note)],
  );
  if (upd.rowCount === 0) throw erroreHttp('opportunity non trovata', 404);
  return { ok: true, voce: upd.rows[0] };
}

async function salvaContatto(client, rui, tipo, valore, { etichetta, fonte, url } = {}) {
  const v = testo(valore);
  if (!v) return null;
  const tipiOk = new Set([
    'email', 'telefono', 'pec', 'linkedin', 'sito', 'indirizzo',
    'partita_iva', 'codice_fiscale', 'altro',
  ]);
  const t = tipiOk.has(tipo) ? tipo : 'altro';
  await client.query(
    `
    insert into contatti (
      numero_iscrizione_rui, tipo, valore, etichetta, fonte, fonte_url, affidabilita
    )
    values ($1, $2, $3, $4, $5, $6, 'pubblico_recente')
    on conflict (numero_iscrizione_rui, tipo, valore) do update
      set etichetta = coalesce(excluded.etichetta, contatti.etichetta),
          fonte = case
            when contatti.fonte = 'rui' then contatti.fonte
            else coalesce(excluded.fonte, contatti.fonte)
          end,
          fonte_url = coalesce(excluded.fonte_url, contatti.fonte_url)
    `,
    [rui, t, v, etichettaContatto(t, etichetta, v), fonte || 'kimi_web', url || null],
  );
  return { tipo: t, valore: v };
}

function tipoDaEtichetta(etichetta, valore) {
  const e = String(etichetta || '').toLowerCase();
  const v = String(valore || '').toLowerCase();
  if (e.includes('email') || e.includes('mail') || v.includes('@')) return 'email';
  if (e.includes('cell') || e.includes('mobile') || e.includes('telefon')) return 'telefono';
  if (e.includes('linkedin') || v.includes('linkedin.com')) return 'linkedin';
  if (e.includes('sede') || e.includes('indirizzo') || /\bvia\b/.test(v)) return 'indirizzo';
  if (e.includes('sito') || e.includes('web') || v.startsWith('http')) return 'sito';
  if (e.includes('facebook') || e.includes('instagram') || e.includes('social')) return 'altro';
  return 'altro';
}

function eRecapitoUtile(tipo, valore, etichetta) {
  const v = String(valore || '').trim();
  if (!v) return false;
  const e = String(etichetta || '').toLowerCase();
  if (['denominazione', 'rui', 'sezione', 'iscrizione', 'stato', 'sedi', 'mandati', 'intermediari', 'collaborazioni'].includes(e)) {
    return false;
  }
  if (['email', 'telefono', 'pec', 'linkedin', 'sito', 'indirizzo'].includes(tipo)) return true;
  const low = v.toLowerCase();
  if (/linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com\//.test(low)) return true;
  if (/^https?:\/\//i.test(v) || v.includes('@')) return true;
  if (/^\+?\d[\d\s./()-]{6,}$/.test(v)) return true;
  return false;
}

function etichettaContatto(tipo, etichetta, valore) {
  if (etichetta) return etichetta;
  const v = String(valore || '').toLowerCase();
  if (tipo === 'linkedin' || v.includes('linkedin.com')) return 'LinkedIn';
  if (v.includes('facebook.com')) return 'Facebook';
  if (v.includes('instagram.com')) return 'Instagram';
  if (tipo === 'email') return 'Email';
  if (tipo === 'telefono') return 'Telefono';
  if (tipo === 'indirizzo') return 'Indirizzo';
  if (tipo === 'sito') return 'Sito';
  return null;
}

function sintesiOpportunity(kimi, s) {
  const testoKimi = String(kimi?.sintesi || '').trim();
  const rui = s?.soggetto?.numero_iscrizione_rui || '';
  const nome = s?.soggetto?.denominazione || rui;
  const eSoloNome = !testoKimi || (testoKimi.includes(rui) && testoKimi.length < 80);
  if (kimi && !eSoloNome) return testoKimi;
  const sede = (s?.sedi || [])[0];
  const pezzi = [
    `${nome}${rui ? ` (${rui})` : ''}`,
    sede
      ? `Sede RUI: ${[sede.indirizzo_sede, sede.comune_sede, sede.provincia_sede].filter(Boolean).join(', ')}`
      : null,
    kimi
      ? 'Ricerca web senza recapiti extra pubblici.'
      : 'Kimi non configurata: salvati solo sede e sito del registro.',
  ].filter(Boolean);
  return pezzi.join('. ');
}

export async function arricchisciOpportunity(client, {
  rui, rui_target, rui_broker, zona, compagnia,
} = {}) {
  const salvata = await salvaOpportunity(client, {
    rui, rui_target, rui_broker, zona, compagnia,
  });
  const target = salvata.voce.rui_target;
  const s = await scheda(client, target, { geocodifica: false });

  for (const sede of s.sedi || []) {
    const riga = [sede.indirizzo_sede, sede.cap_sede, sede.comune_sede, sede.provincia_sede]
      .filter(Boolean)
      .join(', ');
    await salvaContatto(client, target, 'indirizzo', riga, {
      etichetta: sede.tipo_sede || 'Sede RUI',
      fonte: 'rui',
    });
  }
  for (const url of s.siti_internet || []) {
    await salvaContatto(client, target, 'sito', url, { etichetta: 'Sito RUI', fonte: 'rui' });
  }

  let kimi = null;
  if (kimiPronta()) {
    kimi = await approfondisciConKimi(client, {
      q: [
        `Trova i recapiti pubblici di ${s.soggetto.denominazione} (RUI ${target}, intermediario assicurativo Italia).`,
        'Cerca sul web, su LinkedIn e sui social: indirizzo di sede, email, cellulare, LinkedIn, Facebook, Instagram e sito.',
        'Usa le ricerche web anche per LinkedIn e i canali social, non solo per email e telefono.',
        'Non inventare. Se un dato non è pubblico, omettilo.',
      ].join(' '),
      max_web: 5,
      budget_ms: 150_000,
      risultato: {
        scelto: {
          numero_iscrizione_rui: target,
          denominazione: s.soggetto.denominazione,
        },
      },
    });
    const fondi = kimi.fondamentali || {};
    if (fondi.email?.valore) {
      await salvaContatto(client, target, 'email', fondi.email.valore, { url: fondi.email.url });
    }
    if (fondi.cellulare?.valore) {
      await salvaContatto(client, target, 'telefono', fondi.cellulare.valore, {
        etichetta: 'Cellulare',
        url: fondi.cellulare.url,
      });
    }
    if (fondi.sede?.valore) {
      await salvaContatto(client, target, 'indirizzo', fondi.sede.valore, {
        etichetta: 'Sede web',
        url: fondi.sede.url,
      });
    }
    const skipCat = new Set(['anagrafica', 'rete']);
    for (const cat of kimi.categorie || []) {
      if (skipCat.has(cat.id)) continue;
      for (const voce of cat.voci || []) {
        const tipo = tipoDaEtichetta(voce.etichetta, voce.valore);
        if (!eRecapitoUtile(tipo, voce.valore, voce.etichetta)) continue;
        await salvaContatto(client, target, tipo, voce.valore, {
          etichetta: voce.etichetta,
          url: voce.url,
        });
      }
    }
  }

  const upd = await client.query(
    `
    update cliente_opportunity
    set sintesi = $3,
        arricchito_il = now(),
        stato = case when stato = 'nuova' then 'in_lavorazione' else stato end
    where cliente_id = $1 and rui_target = $2
    returning *
    `,
    [salvata.voce.cliente_id, target, sintesiOpportunity(kimi, s)],
  );

  const recapiti = await client.query(
    `
    select tipo, valore, etichetta, fonte, fonte_url, affidabilita
    from contatti
    where numero_iscrizione_rui = $1
    order by tipo, valore
    `,
    [target],
  );

  return {
    ok: true,
    kimi_usata: Boolean(kimi),
    voce: upd.rows[0],
    recapiti: recapiti.rows,
    sintesi: upd.rows[0].sintesi,
    passi: kimi?.passi || [],
  };
}
