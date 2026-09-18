// Geocoding a richiesta delle sedi di un'azienda. Chiave solo lato server.

function indirizzoSede(sede) {
  return [sede.indirizzo_sede, sede.cap_sede, sede.comune_sede, sede.provincia_sede, 'Italia']
    .filter((p) => p && String(p).trim())
    .join(', ');
}

export async function puntiSedi(client, rui, sedi, { geocodifica = true } = {}) {
  if (!sedi.length) return [];
  const ossList = sedi.map((s) => Number(s.oss)).filter((n) => Number.isFinite(n));
  const cache = new Map();
  if (ossList.length) {
    const { rows } = await client.query(
      `select oss, lat, lng, stato, indirizzo_usato, errore
       from sedi_geo where oss = any($1::bigint[])`,
      [ossList],
    );
    for (const r of rows) cache.set(Number(r.oss), r);
  }

  const punti = [];
  for (const sede of sedi) {
    const oss = Number(sede.oss);
    const usato = indirizzoSede(sede);
    let geo = cache.get(oss);
    if (geocodifica && (!geo || geo.stato === 'in_corso' || geo.stato === 'errore')) {
      geo = await geocodificaUno(client, { oss, rui, sede, usato, precedente: geo });
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

async function geocodificaUno(client, { oss, rui, usato }) {
  const key = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (!key) {
    return { lat: null, lng: null, stato: 'errore', errore: 'GOOGLE_MAPS_API_KEY non impostata' };
  }
  if (!usato || usato === 'Italia') {
    await upsertGeo(client, {
      oss, rui, usato: usato || '', lat: null, lng: null, stato: 'zero', errore: 'indirizzo vuoto',
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

  await upsertGeo(client, { oss, rui, usato, lat, lng, stato, errore });
  return { lat, lng, stato, errore };
}

async function upsertGeo(client, { oss, rui, usato, lat, lng, stato, errore }) {
  if (!Number.isFinite(oss)) return;
  await client.query(
    `
    insert into sedi_geo (oss, numero_iscrizione_rui, indirizzo_usato, lat, lng, stato, errore, geocodificato_il)
    values ($1, $2, $3, $4, $5, $6, $7, now())
    on conflict (oss) do update set
      numero_iscrizione_rui = excluded.numero_iscrizione_rui,
      indirizzo_usato = excluded.indirizzo_usato,
      lat = excluded.lat,
      lng = excluded.lng,
      stato = excluded.stato,
      errore = excluded.errore,
      geocodificato_il = excluded.geocodificato_il
    `,
    [oss, rui, usato, lat, lng, stato, errore],
  );
}
