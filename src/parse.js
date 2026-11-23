// Lettura dei CSV dell'export IVASS.
//
// Il formato e' semplice ma sporco: separatore punto e virgola, nessuna
// quotatura, spazi in coda quasi ovunque, date in due formati diversi e un
// ritorno a capo isolato dentro una ragione sociale.

const DATA_ITALIANA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})(?: \d{2}:\d{2}:\d{2})?$/;

export class ErroreDiFormato extends Error {}

/**
 * Converte una data della fonte in formato ISO.
 * La fonte usa gg/mm/aaaa nella maggior parte dei casi e timestamp ISO nelle
 * colonne relative agli intermediari comunitari e ai collaboratori accessori.
 */
export function convertiData(valore, dove) {
  const italiana = DATA_ITALIANA.exec(valore);
  const iso = italiana ? null : DATA_ISO.exec(valore);
  if (!italiana && !iso) {
    throw new ErroreDiFormato(`data non riconosciuta in ${dove}: ${JSON.stringify(valore)}`);
  }
  const [anno, mese, giorno] = italiana
    ? [italiana[3], italiana[2], italiana[1]]
    : [iso[1], iso[2], iso[3]];
  // 31/02/2020 ha la forma giusta ma non esiste: meglio fermarsi qui che dentro COPY.
  if (!dataEsiste(Number(anno), Number(mese), Number(giorno))) {
    throw new ErroreDiFormato(`data inesistente in ${dove}: ${JSON.stringify(valore)}`);
  }
  return `${anno}-${mese}-${giorno}`;
}

/** Calendario gregoriano, come Postgres: niente anno 0 (la fonte ha anche un 30/05/0007, valido). */
export function dataEsiste(anno, mese, giorno) {
  if (anno < 1 || mese < 1 || mese > 12 || giorno < 1) return false;
  const bisestile = (anno % 4 === 0 && anno % 100 !== 0) || anno % 400 === 0;
  const giorniDelMese = [31, bisestile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mese - 1];
  return giorno <= giorniDelMese;
}

export function convertiBooleano(valore, dove) {
  if (valore === '0') return false;
  if (valore === '1') return true;
  throw new ErroreDiFormato(`booleano non riconosciuto in ${dove}: ${JSON.stringify(valore)}`);
}

/** Intestazione attesa: i nomi delle colonne in maiuscolo, tranne quelle che la fonte lascia senza nome. */
export function intestazioneAttesa(spec) {
  const conNome = spec.colonne.length - (spec.colonneSenzaNome ?? 0);
  return spec.colonne.slice(0, conNome).map(([nome]) => nome.toUpperCase());
}

/**
 * Confronta la prima riga del CSV con le colonne attese: nomi, ordine e numero.
 * Senza questo controllo una colonna nuova o spostata nella fonte finirebbe
 * nella colonna sbagliata senza nessun errore (es. incollata all'indirizzo
 * delle sedi da riunisciCodaIn).
 */
export function verificaIntestazione(riga, spec) {
  const attese = intestazioneAttesa(spec);
  const trovate = riga
    .replace(/^\uFEFF/, '')
    .split(';')
    .map((c) => c.trim().toUpperCase() || '(senza nome)');
  if (trovate.length === attese.length && trovate.every((c, i) => c === attese[i])) return;

  const differenze = [];
  const mancanti = attese.filter((c) => !trovate.includes(c));
  const nuove = trovate.filter((c) => !attese.includes(c));
  if (mancanti.length) differenze.push(`mancano ${mancanti.join(', ')}`);
  if (nuove.length) differenze.push(`colonne nuove ${nuove.join(', ')}`);
  if (trovate.length !== attese.length) {
    differenze.push(`${trovate.length} colonne invece di ${attese.length}`);
  }
  if (!mancanti.length && !nuove.length) {
    const spostate = attese
      .map((c, i) => (trovate[i] === c ? null : `posizione ${i + 1}: ${trovate[i] ?? '(nessuna)'} invece di ${c}`))
      .filter(Boolean);
    differenze.push(`ordine diverso (${spostate.join('; ')})`);
  }
  throw new ErroreDiFormato(
    `${spec.file}: l'intestazione non è quella attesa, ${differenze.join('; ')}. ` +
      "Il formato dell'export IVASS è cambiato: va aggiornato src/tables.js prima di caricare.",
  );
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
  verificaIntestazione(righe[0], spec);

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
