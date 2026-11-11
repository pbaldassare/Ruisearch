export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Dove AuthContext salva la sessione (email, ruolo, token). */
export const CHIAVE_SESSIONE = "rui_session_v4";

function token(): string | null {
  try {
    const grezzo = sessionStorage.getItem(CHIAVE_SESSIONE);
    return grezzo ? (JSON.parse(grezzo) as { token?: string }).token ?? null : null;
  } catch {
    return null;
  }
}

function sessioneScaduta() {
  try {
    sessionStorage.removeItem(CHIAVE_SESSIONE);
  } catch {
    // niente: il redirect basta
  }
  if (!window.location.pathname.startsWith("/login")) {
    window.location.assign(`/login?scaduta=1`);
  }
}

async function richiesta(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const t = token();
  if (t) headers.set("authorization", `Bearer ${t}`);
  let risposta: Response;
  try {
    risposta = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Connessione assente: controlla la rete e riprova.");
  }
  if (risposta.status === 401 && t) sessioneScaduta();
  return risposta;
}

async function leggi<T>(risposta: Response): Promise<T> {
  const testo = await risposta.text();
  let corpo: unknown = null;
  let json = true;
  try {
    corpo = testo ? JSON.parse(testo) : null;
  } catch {
    json = false;
  }
  if (!risposta.ok) {
    if (json && corpo && typeof corpo === "object" && "errore" in corpo) {
      throw new ApiError(risposta.status, String((corpo as { errore: unknown }).errore));
    }
    // Risposta non JSON (es. pagina di errore del proxy): mai mostrarla grezza.
    throw new ApiError(
      risposta.status,
      risposta.status >= 500
        ? "Il servizio non è raggiungibile in questo momento. Riprova tra poco."
        : `Richiesta non riuscita (errore ${risposta.status}).`,
    );
  }
  if (!json) throw new ApiError(risposta.status, "Risposta non valida dal servizio.");
  return corpo as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return leggi<T>(
    await richiesta(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function deleteJson<T>(path: string): Promise<T> {
  return leggi<T>(await richiesta(path, { method: "DELETE" }));
}

export async function getJson<T>(path: string): Promise<T> {
  return leggi<T>(await richiesta(path));
}

/** Scarica un file (es. CSV) con la sessione: un link semplice non porta il token. */
export async function scaricaFile(path: string): Promise<void> {
  const risposta = await richiesta(path);
  if (!risposta.ok) await leggi(risposta);
  const nome =
    /filename="([^"]+)"/.exec(risposta.headers.get("content-disposition") || "")?.[1] || "ruisearch.csv";
  const url = URL.createObjectURL(await risposta.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
  /** Solo sulla prima pagina: quanti risultati in tutto. */
  totale?: number | null;
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

export type FaseAggiornamento = "download" | "validazione" | "caricamento" | "rete" | "completato";

export type StatoAggiornamento = {
  in_corso: boolean;
  fase: FaseAggiornamento | null;
  percentuale: number | null;
  messaggio: string | null;
  iniziato_il: string | null;
  concluso_il: string | null;
  esito: "completato" | "identico" | "validato" | "fallito" | null;
  errore: string | null;
  log: string[];
  /** true online: il caricamento gira su GitHub Actions, non sul server. */
  remoto?: boolean;
  /** Online: il pulsante puo' avviare GitHub Actions da solo. */
  avviabile?: boolean;
  /** Online: pagina del workflow su GitHub. */
  link?: string;
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
