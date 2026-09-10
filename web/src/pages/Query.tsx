import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, Sparkles } from "lucide-react";
import { getJson, postJson, qs } from "@/api";
import { Button, Card, Input } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { formatNumero } from "@/lib/format";

type Dimensione = { id: string; etichetta: string; valori: string[]; esempio: string };

type RispostaDomanda = {
  tipo: string;
  domanda: string;
  ok?: boolean;
  errore?: string;
  nota?: string;
  risposta?: string;
  metrica?: string;
  valore?: string | number;
  numeri?: { intermediari: number; collaborazioni: number; mandati: number; sedi: number };
  scelto?: { numero_iscrizione_rui: string; denominazione: string; sezione: string };
  candidati?: Array<{ numero_iscrizione_rui: string; denominazione: string }>;
  risultati?: Array<{ numero_iscrizione_rui: string; denominazione: string; sezione: string }>;
  tramite_principali?: Array<{ denominazione: string; rui: string; ragione_sociale: string; sezione: string }>;
  mandati_propri?: Array<{ ragione_sociale: string }>;
  si?: boolean;
};

type PassoAi = { origine: "rui" | "web"; strumento: string; dettaglio: string };

type Fondamentale = {
  stato: "gia_in_rui" | "trovata" | "non_trovata";
  valore: string | null;
  url?: string | null;
  origine?: "rui" | "web" | null;
};

type RispostaAi = {
  domanda: string;
  modello?: string;
  risposta: string;
  passi: PassoAi[];
  fondamentali?: {
    email?: Fondamentale;
    cellulare?: Fondamentale;
    sede?: Fondamentale;
  };
  da_cercare?: string[];
};

const ETICHETTE_FONDAMENTALI: Record<string, string> = {
  email: "Email",
  cellulare: "Cellulare",
  sede: "Sede / residenza",
};

function etichettaStato(stato: Fondamentale["stato"]) {
  if (stato === "gia_in_rui") return "già in registro";
  if (stato === "trovata") return "trovata sul web";
  return "non trovata";
}

const ESEMPI = [
  "quanti intermediari ha consulbrokers",
  "quanti mandati ha consulbrokers spa",
  "paolo baldassare lavora con gli agenti con axa",
  "paolo baldassare lavora con axa",
];

export function QueryPage() {
  const { data: catalogo } = useApi<{ dimensioni: Dimensione[]; esempi: string[] }>("/api/dimensioni");
  const [testo, setTesto] = useState("");
  const [risposta, setRisposta] = useState<RispostaDomanda | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [ai, setAi] = useState<RispostaAi | null>(null);
  const [aiErrore, setAiErrore] = useState<string | null>(null);

  async function invia(e?: FormEvent, preset?: string) {
    e?.preventDefault();
    const q = (preset ?? testo).trim();
    if (!q) return;
    setTesto(q);
    setInCorso(true);
    setErrore(null);
    setAi(null);
    setAiErrore(null);
    try {
      const out = await getJson<RispostaDomanda>(`/api/query${qs({ q })}`);
      setRisposta(out);
    } catch (err) {
      setRisposta(null);
      setErrore(err instanceof Error ? err.message : "domanda non riuscita");
    } finally {
      setInCorso(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(e) => void invia(e)}>
          <Input
            value={testo}
            onChange={(e) => setTesto(e.target.value)}
            placeholder="quanti intermediari ha consulbrokers"
          />
          <Button type="submit" disabled={inCorso}>
            <MessageSquare className="h-4 w-4" />
            {inCorso ? "Interrogo…" : "Chiedi"}
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {ESEMPI.map((es) => (
            <button
              key={es}
              type="button"
              className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold hover:bg-primary/10"
              onClick={() => void invia(undefined, es)}
            >
              {es}
            </button>
          ))}
        </div>
      </Card>

      {errore ? <p className="text-sm text-destructive">{errore}</p> : null}

      {risposta ? <Risultato domanda={risposta} /> : null}

      {risposta ? (
        <ApprofondimentoAi
          domanda={testo}
          risultato={risposta}
          ai={ai}
          errore={aiErrore}
          onAi={setAi}
          onErrore={setAiErrore}
        />
      ) : null}

      <Card>
        <h3 className="mb-3 text-lg font-bold">Caratteristiche interrogabili</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {(catalogo?.dimensioni ?? []).map((d) => (
            <div key={d.id}>
              <p className="text-sm font-semibold">{d.etichetta}</p>
              <p className="text-xs text-muted-foreground">{d.valori.join(" · ")}</p>
              <p className="text-xs text-muted-foreground">es. {d.esempio}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Risultato({ domanda }: { domanda: RispostaDomanda }) {
  const s = domanda.scelto;
  return (
    <Card>
      <p className="text-xs uppercase text-muted-foreground">{domanda.tipo}</p>
      {domanda.risposta ? <p className="mt-2 text-lg font-semibold">{domanda.risposta}</p> : null}
      {domanda.errore ? <p className="mt-2 text-destructive">{domanda.errore}</p> : null}
      {domanda.nota ? <p className="mt-2 text-sm text-muted-foreground">{domanda.nota}</p> : null}
      {s ? (
        <p className="mt-3 text-sm">
          Soggetto:{" "}
          <Link className="font-semibold text-primary hover:underline" to={`/app/intermediari/${s.numero_iscrizione_rui}`}>
            {s.denominazione}
          </Link>{" "}
          · {s.numero_iscrizione_rui} · sez. {s.sezione}
        </p>
      ) : null}
      {domanda.valore != null ? (
        <p className="mt-2 font-display text-3xl">
          {formatNumero(domanda.valore)} <span className="text-base font-sans text-muted-foreground">{domanda.metrica}</span>
        </p>
      ) : null}
      {domanda.numeri ? (
        <p className="mt-2 text-sm text-muted-foreground">
          intermediari {formatNumero(domanda.numeri.intermediari)} · collaborazioni{" "}
          {formatNumero(domanda.numeri.collaborazioni)} · mandati {formatNumero(domanda.numeri.mandati)} · sedi{" "}
          {formatNumero(domanda.numeri.sedi)}
        </p>
      ) : null}
      {domanda.tramite_principali && domanda.tramite_principali.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm">
          {domanda.tramite_principali.map((t) => (
            <li key={`${t.rui}-${t.ragione_sociale}`}>
              <Link className="text-primary hover:underline" to={`/app/intermediari/${t.rui}`}>
                {t.denominazione}
              </Link>{" "}
              · {t.sezione} · {t.ragione_sociale}
            </li>
          ))}
        </ul>
      ) : null}
      {domanda.risultati && domanda.risultati.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm">
          {domanda.risultati.map((r) => (
            <li key={r.numero_iscrizione_rui}>
              <Link className="text-primary hover:underline" to={`/app/intermediari/${r.numero_iscrizione_rui}`}>
                {r.denominazione}
              </Link>{" "}
              · {r.numero_iscrizione_rui}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function ApprofondimentoAi({
  domanda,
  risultato,
  ai,
  errore,
  onAi,
  onErrore,
}: {
  domanda: string;
  risultato: RispostaDomanda;
  ai: RispostaAi | null;
  errore: string | null;
  onAi: (v: RispostaAi | null) => void;
  onErrore: (v: string | null) => void;
}) {
  const { data: cfg } = useApi<{ kimi_pronta?: boolean }>("/api/config");
  const [inCorso, setInCorso] = useState(false);

  async function avvia() {
    setInCorso(true);
    onErrore(null);
    try {
      const out = await postJson<RispostaAi>("/api/query/ai", { q: domanda, risultato });
      onAi(out);
    } catch (err) {
      onAi(null);
      onErrore(err instanceof Error ? err.message : "approfondimento non riuscito");
    } finally {
      setInCorso(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-bold">Approfondimento AI</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Kimi verifica il RUI e cerca sul web solo se mancano email, cellulare o sede/residenza.
            Poi può arricchire con altri dati.
          </p>
        </div>
        <Button type="button" onClick={() => void avvia()} disabled={inCorso}>
          <Sparkles className="h-4 w-4" />
          {inCorso ? "Verifico…" : "Cerca con AI"}
        </Button>
      </div>
      {cfg && cfg.kimi_pronta === false ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Manca la chiave Kimi (Moonshot) sul server. Incolla <code>MOONSHOT_API_KEY</code> nel{" "}
          <code>.env</code> e riavvia l&apos;API.
        </p>
      ) : null}
      {errore ? <p className="mt-3 text-sm text-destructive">{errore}</p> : null}
      {ai ? (
        <div className="mt-4 space-y-3">
          {ai.fondamentali ? (
            <ul className="grid gap-2 sm:grid-cols-3">
              {(["email", "cellulare", "sede"] as const).map((id) => {
                const f = ai.fondamentali?.[id];
                if (!f) return null;
                return (
                  <li key={id} className="rounded-2xl bg-secondary/70 px-3 py-2">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      {ETICHETTE_FONDAMENTALI[id]}
                    </p>
                    <p className="text-sm font-semibold">{etichettaStato(f.stato)}</p>
                    {f.valore ? <p className="mt-1 break-all text-xs">{f.valore}</p> : null}
                    {f.url ? (
                      <a
                        className="mt-1 block truncate text-xs text-primary hover:underline"
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        fonte
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {ai.passi.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {ai.passi.map((p, i) => (
                <li
                  key={`${p.strumento}-${i}`}
                  className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold"
                >
                  {p.origine === "rui" ? "RUI" : "Web"} · {p.dettaglio}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="space-y-2 text-sm whitespace-pre-wrap">{ai.risposta}</div>
        </div>
      ) : null}
    </Card>
  );
}
