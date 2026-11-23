// Geocoding a richiesta delle sedi di un'azienda. Chiave solo lato server.
//
// La cache sedi_geo e' per RUI + indirizzo, non per oss: oss e' il numero di
// riga dell'export IVASS e cambia a ogni import. Un indirizzo cambiato e' una
// chiave nuova, quindi si rigeocodifica (anche se prima era "zero").

function indirizzoSede(sede) {
  return [sede.indirizzo_sede, sede.cap_sede, sede.comune_sede, sede.provincia_sede, 'Italia']
    .filter((p) => p && String(p).trim())
    .join(', ');
}

/** Chiave della cache: l'indirizzo usato, maiuscolo e con gli spazi compattati. */
export function chiaveIndirizzo(usato) {
  return String(usato || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export async function puntiSedi(client, rui, sedi, { geocodifica = true } = {}) {
  if (!sedi.length) return [];
  const chiavi = [...new Set(sedi.map((s) => chiaveIndirizzo(indirizzoSede(s))))];
  const cache = new Map();
  const { rows } = await client.query(
    `select indirizzo_chiave, lat, lng, stato, indirizzo_usato, errore
     from sedi_geo
     where numero_iscrizione_rui = $1 and indirizzo_chiave = any($2::text[])`,
    [rui, chiavi],
  );
  for (const r of rows) cache.set(r.indirizzo_chiave, r);

  const punti = [];
  for (const sede of sedi) {
    const oss = Number(sede.oss);
    const usato = indirizzoSede(sede);
    const chiave = chiaveIndirizzo(usato);
    let geo = cache.get(chiave);
    if (geocodifica && (!geo || geo.stato === 'in_corso' || geo.stato === 'errore')) {
      geo = await geocodificaUno(client, { oss, rui, usato, chiave });
      cache.set(chiave, geo);
    }
    punti.push({
      oss,
      tipo_sede: sede.tipo_sede,
      comune_sede: sede.comune_sede,
      provincia_sede: sede.provincia_sede,
      cap_sede: sede.cap_sede,
      indirizzo_sede: sede.indirizzo_sede,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      stato: geo?.stato ?? 'manca',
      errore: geo?.errore ?? null,
    });
  }
  return punti;
}

async function geocodificaUno(client, { oss, rui, usato, chiave }) {
  const key = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (!key) {
    return { lat: null, lng: null, stato: 'errore', errore: 'GOOGLE_MAPS_API_KEY non impostata' };
  }
  if (!usato || usato === 'Italia') {
    await upsertGeo(client, {
      oss, rui, usato: usato || '', chiave, lat: null, lng: null, stato: 'zero', errore: 'indirizzo vuoto',
    });
    return { lat: null, lng: null, stato: 'zero', errore: 'indirizzo vuoto' };
  }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', usato);
  url.searchParams.set('language', 'it');
  url.searchParams.set('region', 'it');
  url.searchParams.set('key', key);

  let stato = 'errore';
  let lat = null;
  let lng = null;
  let errore = null;
  try {
    const risposta = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    const corpo = await risposta.json();
    if (corpo.status === 'OK' && corpo.results?.[0]?.geometry?.location) {
      lat = corpo.results[0].geometry.location.lat;
      lng = corpo.results[0].geometry.location.lng;
      stato = 'ok';
    } else if (corpo.status === 'ZERO_RESULTS') {
      stato = 'zero';
      errore = 'nessun risultato';
    } else {
      errore = corpo.error_message || corpo.status || `http ${risposta.status}`;
    }
  } catch (err) {
    errore = err instanceof Error ? err.message : 'geocoding fallito';
  }

  await upsertGeo(client, { oss, rui, usato, chiave, lat, lng, stato, errore });
  return { lat, lng, stato, errore };
}

async function upsertGeo(client, { oss, rui, usato, chiave, lat, lng, stato, errore }) {
  if (!rui) return;
  // oss resta solo come informazione (riga dell'ultimo import che ha usato l'indirizzo).
  await client.query(
    `
    insert into sedi_geo (
      numero_iscrizione_rui, indirizzo_chiave, oss, indirizzo_usato, lat, lng, stato, errore, geocodificato_il
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, now())
    on conflict (numero_iscrizione_rui, indirizzo_chiave) do update set
      oss = excluded.oss,
      indirizzo_usato = excluded.indirizzo_usato,
      lat = excluded.lat,
      lng = excluded.lng,
      stato = excluded.stato,
      errore = excluded.errore,
      geocodificato_il = excluded.geocodificato_il
    `,
    [rui, chiave, Number.isFinite(oss) ? oss : null, usato, lat, lng, stato, errore],
  );
}
