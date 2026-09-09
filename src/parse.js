// Lettura dei CSV dell'export IVASS.
//
// Il formato e' semplice ma sporco: separatore punto e virgola, nessuna
// quotatura, spazi in coda quasi ovunque, date in due formati diversi e un
// ritorno a capo isolato dentro una ragione sociale.

const DATA_ITALIANA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const DATA_ISO = /^(\d{4}-\d{2}-\d{2})(?: \d{2}:\d{2}:\d{2})?$/;

export class ErroreDiFormato extends Error {}

/**
 * Converte una data della fonte in formato ISO.
 * La fonte usa gg/mm/aaaa nella maggior parte dei casi e timestamp ISO nelle
 * colonne relative agli intermediari comunitari e ai collaboratori accessori.
 */
export function convertiData(valore, dove) {
  const italiana = DATA_ITALIANA.exec(valore);
  if (italiana) {
    const [, giorno, mese, anno] = italiana;
    return `${anno}-${mese}-${giorno}`;
  }
  const iso = DATA_ISO.exec(valore);
  if (iso) return iso[1];
  throw new ErroreDiFormato(`data non riconosciuta in ${dove}: ${JSON.stringify(valore)}`);
}

export function convertiBooleano(valore, dove) {
  if (valore === '0') return false;
  if (valore === '1') return true;
  throw new ErroreDiFormato(`booleano non riconosciuto in ${dove}: ${JSON.stringify(valore)}`);
}

/**
 * Scompone il contenuto di un CSV in righe di valori gia' convertiti.
 * Restituisce anche le anomalie incontrate, che il chiamante decide se
 * considerare bloccanti.
 */
export function leggiCsv(contenuto, spec) {
  // Un ritorno a capo isolato compare dentro una ragione sociale. Non e' un
  // fine riga: va neutralizzato prima di dividere, altrimenti spezza il record.
  const testo = contenuto.replace(/\r(?!\n)/g, ' ').replace(/\r\n/g, '\n');

  const righe = testo.split('\n');
  if (righe.at(-1) === '') righe.pop();
  if (righe.length === 0) throw new ErroreDiFormato(`${spec.file} e' vuoto`);

  const attese = spec.colonne.length;
  const anomalie = [];
  const risultato = [];

  for (let n = 1; n < righe.length; n++) {
    let campi = righe[n].split(';');

    if (campi.length > attese) {
      if (spec.riunisciCodaIn === undefined) {
        anomalie.push(`riga ${n + 1}: ${campi.length} campi invece di ${attese}`);
        continue;
      }
      // I campi in eccesso appartengono a una colonna che conteneva il
      // separatore: li riuniamo reinserendo il punto e virgola.
      const coda = campi.slice(spec.riunisciCodaIn).join(';');
      campi = [...campi.slice(0, spec.riunisciCodaIn), coda];
    }

    if (campi.length !== attese) {
      anomalie.push(`riga ${n + 1}: ${campi.length} campi invece di ${attese}`);
      continue;
    }

    const valori = new Array(attese);
    for (let c = 0; c < attese; c++) {
      const [nome, tipo] = spec.colonne[c];
      const grezzo = campi[c].trim();
      if (grezzo === '') {
        valori[c] = null;
        continue;
      }
      const dove = `${spec.file} riga ${n + 1} colonna ${nome}`;
      if (tipo === 'data') valori[c] = convertiData(grezzo, dove);
      else if (tipo === 'booleano') valori[c] = convertiBooleano(grezzo, dove);
      else valori[c] = grezzo;
    }
    risultato.push(valori);
  }

  return { righe: risultato, anomalie };
}

/** Serializza una riga nel formato CSV atteso da COPY: null come campo vuoto. */
export function rigaPerCopy(valori) {
  let out = '';
  for (let i = 0; i < valori.length; i++) {
    if (i > 0) out += ',';
    const v = valori[i];
    if (v === null) continue;
    if (typeof v === 'boolean') { out += v ? 't' : 'f'; continue; }
    out += '"' + String(v).replaceAll('"', '""') + '"';
  }
  return out + '\n';
}
