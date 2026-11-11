// Edge Function di Supabase con le API di Ruisearch.
// La logica e' in src/app.js: `npm run deploy:api` la copia in ./lib e pubblica.
//
// Il sito su Cloudflare Pages inoltra /api/* qui (functions/api/[[path]].js).
// verify_jwt e' disattivato: l'accesso lo controllano i token di Ruisearch.

import process from "node:process";
import { Buffer } from "node:buffer";

const g = globalThis as unknown as Record<string, unknown>;
g.process ??= process;
g.Buffer ??= Buffer;

const { creaApp } = await import("./lib/app.js");
const { getPool } = await import("./lib/db.js");

const REPO = (Deno.env.get("GITHUB_REPO") || "pbaldassare/Ruisearch").trim();
const WORKFLOW = "aggiorna-registro.yml";
const LINK_WORKFLOW = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;

// Qui non si puo' scaricare e caricare il registro (limiti di tempo e
// memoria): lo fa GitHub Actions. Con GITHUB_TOKEN il pulsante lo avvia
// direttamente, altrimenti la pagina porta al workflow su GitHub.
const aggiornamento = {
  async stato() {
    const { rows } = await getPool().query(
      `select id, iniziato_il, concluso_il, esito, errore from import_runs order by id desc limit 1`,
    );
    const ultimo = rows[0];
    const inCorso = ultimo?.esito === "in corso" &&
      Date.now() - new Date(ultimo.iniziato_il).getTime() < 45 * 60_000;
    return {
      remoto: true,
      avviabile: Boolean(Deno.env.get("GITHUB_TOKEN")),
      link: LINK_WORKFLOW,
      in_corso: inCorso,
      fase: inCorso ? "caricamento" : null,
      percentuale: null,
      messaggio: inCorso ? "Aggiornamento in corso su GitHub Actions." : null,
      iniziato_il: ultimo?.iniziato_il ?? null,
      concluso_il: ultimo?.concluso_il ?? null,
      esito: null,
      errore: null,
      log: [],
    };
  },
  async avvia({ forza }: { forza: boolean }) {
    const token = (Deno.env.get("GITHUB_TOKEN") || "").trim();
    if (!token) {
      const e = new Error(`Avvia l'aggiornamento da GitHub: ${LINK_WORKFLOW}`) as Error & { statusCode?: number };
      e.statusCode = 501;
      throw e;
    }
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "ruisearch-api",
      },
      body: JSON.stringify({ ref: "main", inputs: { forza: String(Boolean(forza)) } }),
    });
    if (!r.ok) {
      const e = new Error(`GitHub non ha avviato l'aggiornamento (errore ${r.status}).`) as Error & {
        statusCode?: number;
      };
      e.statusCode = 502;
      throw e;
    }
    return {
      ...(await aggiornamento.stato()),
      in_corso: true,
      fase: "download",
      messaggio: "Avviato su GitHub Actions: di solito servono 4–6 minuti.",
      iniziato_il: new Date().toISOString(),
    };
  },
};

const app = creaApp({ aggiornamento });

Deno.serve((request: Request) => app(request));
