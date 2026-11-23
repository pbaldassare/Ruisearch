// Edge Function di Supabase con le API di Ruisearch.
// La logica e' in src/app.js: `npm run deploy:api` la copia in ./lib e pubblica.
//
// Il sito su Cloudflare Pages inoltra /api/* qui (functions/api/[[path]].js).
// verify_jwt e' disattivato (supabase/config.toml): l'accesso lo controllano i token di Ruisearch.

import process from "node:process";
import { Buffer } from "node:buffer";

const g = globalThis as unknown as Record<string, unknown>;
g.process ??= process;
g.Buffer ??= Buffer;

// Solo il ruolo dedicato ruisearch_api: senza DATABASE_URL la funzione non parte,
// invece di ripiegare in silenzio su SUPABASE_DB_URL (utente postgres).
if (!(Deno.env.get("DATABASE_URL") || "").trim()) {
  throw new Error("ruisearch-api: manca il segreto DATABASE_URL (connessione col ruolo ruisearch_api).");
}

const { getPool, modalitaEdge } = await import("./lib/db.js");
modalitaEdge();
const { creaApp } = await import("./lib/app.js");

const REPO = (Deno.env.get("GITHUB_REPO") || "pbaldassare/Ruisearch").trim();
const WORKFLOW = "aggiorna-registro.yml";
const LINK_WORKFLOW = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;
// Il job su GitHub viene ucciso a 40 minuti: una riga "in corso" piu' vecchia e' un import morto.
const MINUTI_MASSIMI = 45;

type Errore = Error & { statusCode?: number };

function errore(messaggio: string, statusCode: number): Errore {
  const e = new Error(messaggio) as Errore;
  e.statusCode = statusCode;
  return e;
}

// Qui non si puo' scaricare e caricare il registro (limiti di tempo e
// memoria): lo fa GitHub Actions, che scrive fase ed esito in import_runs.
// Con GITHUB_TOKEN il pulsante lo avvia direttamente, altrimenti la pagina
// porta al workflow su GitHub.
const aggiornamento = {
  async stato() {
    const { rows } = await getPool().query(`select * from import_runs order by id desc limit 1`);
    const ultimo = rows[0];
    const vecchio = ultimo != null &&
      Date.now() - new Date(ultimo.iniziato_il).getTime() >= MINUTI_MASSIMI * 60_000;
    const inCorso = ultimo?.esito === "in corso" && !vecchio;
    const interrotto = ultimo?.esito === "in corso" && vecchio;
    return {
      remoto: true,
      avviabile: Boolean((Deno.env.get("GITHUB_TOKEN") || "").trim()),
      link: LINK_WORKFLOW,
      id: ultimo ? Number(ultimo.id) : null,
      in_corso: inCorso,
      fase: inCorso ? (ultimo.fase ?? "download") : ultimo?.esito === "completato" ? "completato" : (ultimo?.fase ?? null),
      percentuale: null,
      messaggio: inCorso ? (ultimo.messaggio ?? "Aggiornamento in corso su GitHub Actions.") : null,
      iniziato_il: ultimo?.iniziato_il ?? null,
      concluso_il: ultimo?.concluso_il ?? null,
      esito: interrotto ? "fallito" : inCorso ? null : (ultimo?.esito ?? null),
      errore: interrotto
        ? `interrotto: nessuna notizia da oltre ${MINUTI_MASSIMI} minuti (job GitHub Actions scaduto o annullato)`
        : (ultimo?.errore ?? null),
      log: [],
    };
  },
  async avvia({ forza }: { forza: boolean }) {
    const token = (Deno.env.get("GITHUB_TOKEN") || "").trim();
    if (!token) throw errore(`Avvia l'aggiornamento da GitHub: ${LINK_WORKFLOW}`, 501);
    const prima = await aggiornamento.stato();
    if (prima.in_corso) throw errore("un aggiornamento è già in corso: aspetta che finisca.", 409);
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "ruisearch-api",
      },
      body: JSON.stringify({ ref: "main", inputs: { forza: String(Boolean(forza)) } }),
    });
    if (!r.ok) throw errore(`GitHub non ha avviato l'aggiornamento (errore ${r.status}).`, 502);
    // La riga "in corso" la crea il job quando parte (di solito entro un minuto):
    // fino ad allora lo stato resta quello di prima e la pagina aspetta la riga nuova.
    return {
      ...prima,
      avviato_il: new Date().toISOString(),
      messaggio: "Avviato su GitHub Actions: parte entro un paio di minuti, poi servono 4–6 minuti.",
    };
  },
};

const app = creaApp({ aggiornamento });

Deno.serve((request: Request) => app(request));
