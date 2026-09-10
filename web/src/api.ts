export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const risposta = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const testo = await risposta.text();
  let corpo: unknown = null;
  try {
    corpo = testo ? JSON.parse(testo) : null;
  } catch {
    corpo = { errore: testo || "risposta non valida" };
  }
  if (!risposta.ok) {
    const msg =
      corpo && typeof corpo === "object" && "errore" in corpo
        ? String((corpo as { errore: unknown }).errore)
        : `errore ${risposta.status}`;
    throw new ApiError(risposta.status, msg);
  }
  return corpo as T;
}

export async function getJson<T>(path: string): Promise<T> {
  const risposta = await fetch(path);
  const testo = await risposta.text();
  let corpo: unknown = null;
  try {
    corpo = testo ? JSON.parse(testo) : null;
  } catch {
    corpo = { errore: testo || "risposta non valida" };
  }
  if (!risposta.ok) {
    const msg =
      corpo && typeof corpo === "object" && "errore" in corpo
        ? String((corpo as { errore: unknown }).errore)
        : `errore ${risposta.status}`;
    throw new ApiError(risposta.status, msg);
  }
  return corpo as T;
}

export function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export type IntermediarioLista = {
  oss: number;
  numero_iscrizione_rui: string;
  sezione: string;
  denominazione: string;
  data_iscrizione: string | null;
  inoperativo: boolean;
  persona_giuridica: boolean;
  comune_nascita: string | null;
  provincia_nascita: string | null;
};

export type Pagina<T, C> = {
  items: T[];
  prossimo: C | null;
};

export type Overview = {
  intermediari: string | number;
  collaborazioni: string | number;
  sedi: string | number;
  mandati: string | number;
  ultimo_import: ImportRun | null;
};

export type ImportRun = {
  id: number;
  iniziato_il: string | null;
  concluso_il: string | null;
  esito: string;
  zip_sha256: string | null;
  zip_bytes: number | null;
  righe_totali: number | null;
  errore: string | null;
};

export type Collegato = {
  livello: string | null;
  qualifica: string | null;
  rui_collegato: string;
  denominazione: string | null;
  sezione: string | null;
  inoperativo: boolean | null;
};

export type Scheda = {
  soggetto: {
    numero_iscrizione_rui: string;
    sezione: string;
    denominazione: string;
    data_iscrizione: string | null;
    inoperativo: boolean;
    persona_giuridica: boolean;
    cognome_nome: string | null;
    ragione_sociale: string | null;
    stato: string | null;
    comune_nascita: string | null;
    provincia_nascita: string | null;
    data_nascita: string | null;
  };
  omonimi_rui: unknown[];
  profilo: "azienda" | "sezione_e" | "persona";
  numeri: {
    intermediari: string | number;
    collaborazioni: string | number;
    mandati: string | number;
    sedi: string | number;
  };
  sedi: Array<{
    oss?: number;
    tipo_sede: string | null;
    comune_sede: string | null;
    provincia_sede: string | null;
    cap_sede: string | null;
    indirizzo_sede: string | null;
  }>;
  mappa: Array<{
    oss: number;
    tipo_sede: string | null;
    comune_sede: string | null;
    provincia_sede: string | null;
    indirizzo_sede: string | null;
    lat: number | null;
    lng: number | null;
    stato: string;
  }>;
  siti_internet: string[];
  mandati: Array<{ codice_compagnia: string | null; ragione_sociale: string | null }>;
  mandati_via_principali: Array<{
    rui_principale: string;
    principale: string | null;
    sezione_principale: string | null;
    codice_compagnia: string | null;
    ragione_sociale: string | null;
  }>;
  cariche: Array<{
    qualifica: string | null;
    responsabile: string | null;
    persona_rui: string | null;
    persona: string | null;
    societa_rui: string | null;
    societa: string | null;
  }>;
  contatti: Array<{
    tipo: string;
    valore: string;
    etichetta: string | null;
    affidabilita: string | null;
    fonte: string | null;
    fonte_url: string | null;
  }>;
  rete: {
    principali: Collegato[];
    collaboratori: Collegato[];
  };
};

export type Rete = {
  soggetto: {
    numero_iscrizione_rui: string;
    denominazione: string;
    sezione: string;
    inoperativo: boolean;
  };
  principali: Collegato[];
  collaboratori: Collegato[];
};

export type SedeRiga = {
  oss: number;
  rui: string;
  denominazione: string | null;
  sezione: string | null;
  tipo_sede: string | null;
  comune_sede: string | null;
  provincia_sede: string | null;
  indirizzo_sede: string | null;
};

export type MandatoRiga = {
  oss: number;
  rui: string;
  denominazione: string | null;
  sezione: string | null;
  codice_compagnia: string | null;
  ragione_sociale: string | null;
};

export type CaricaRiga = {
  oss: number;
  persona_rui: string | null;
  persona: string | null;
  societa_rui: string | null;
  societa: string | null;
  qualifica: string | null;
  responsabile: string | null;
};
