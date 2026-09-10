import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  Globe,
  Landmark,
  Mail,
  MapPin,
  MessageSquare,
  Sparkles,
  Users,
  GitBranch,
  type LucideIcon,
} from "lucide-react";
import { getJson, postJson, qs } from "@/api";
import { Button, Card, Input } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { formatNumero } from "@/lib/format";
import { cn } from "@/lib/cn";

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

type VoceAi = { etichetta: string; valore: string; url?: string | null };

type CategoriaAi = {
  id: string;
  titolo: string;
  voci: VoceAi[];
};

type RispostaAi = {
  domanda: string;
  risposta: string;
  sintesi?: string;
  categorie?: CategoriaAi[];
};

const ICONE_CATEGORIA: Record<string, LucideIcon> = {
  anagrafica: Building2,
  rete: GitBranch,
  sede: MapPin,
  recapiti: Mail,
  societa: Landmark,
  web: Globe,
  governance: Users,
  altro: Sparkles,
};

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
      onErrore("Approfondimento non riuscito. Riprova tra poco.");
    } finally {
      setInCorso(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-bold">Approfondimento</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Approfondisci ulteriormente la ricerca con l'utilizzo di un'AI avanzata.
          </p>
        </div>
        <Button type="button" onClick={() => void avvia()} disabled={inCorso}>
          <Sparkles className="h-4 w-4" />
          {inCorso ? "Approfondisco…" : "Approfondisci"}
        </Button>
      </div>
      {cfg && cfg.kimi_pronta === false ? (
        <p className="mt-3 text-sm text-muted-foreground">
          L&apos;approfondimento non è disponibile in questo momento.
        </p>
      ) : null}
      {errore ? <p className="mt-3 text-sm text-destructive">{errore}</p> : null}
      {ai ? <SchedaApprofondimento ai={ai} /> : null}
    </Card>
  );
}

function hrefVoce(voce: VoceAi): string | null {
  if (voce.url) return voce.url;
  const v = voce.valore.trim();
  if (/^https?:\/\//i.test(v)) return v;
  const et = voce.etichetta.toLowerCase();
  if (et.includes("email") || et.includes("pec") || v.includes("@")) return `mailto:${v}`;
  if (et.includes("tel") || et.includes("cell") || et.includes("fono")) {
    const n = v.replace(/[^\d+]/g, "");
    return n ? `tel:${n}` : null;
  }
  return null;
}

function SchedaApprofondimento({ ai }: { ai: RispostaAi }) {
  const categorie = (ai.categorie ?? []).filter((c) => c.voci?.length);
  const sintesi = ai.sintesi || (categorie.length ? "" : ai.risposta);

  if (!sintesi && categorie.length === 0) return null;

  return (
    <div className="mt-5 space-y-4">
      {sintesi ? <p className="text-sm leading-relaxed text-muted-foreground">{sintesi}</p> : null}
      {categorie.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {categorie.map((cat) => {
            const Icona = ICONE_CATEGORIA[cat.id] ?? Sparkles;
            const larga = cat.voci.length > 6 || cat.id === "governance";
            return (
              <div
                key={cat.id}
                className={cn("rounded-2xl bg-secondary/60 p-4", larga && "sm:col-span-2")}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                    <Icona className="h-4 w-4 text-primary" />
                  </span>
                  <h4 className="font-semibold">{cat.titolo}</h4>
                </div>
                <dl className={cn("grid gap-2", larga && "sm:grid-cols-2")}>
                  {cat.voci.map((voce, i) => {
                    const href = hrefVoce(voce);
                    return (
                      <div key={`${cat.id}-${voce.etichetta}-${i}`}>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {voce.etichetta}
                        </dt>
                        <dd className="mt-0.5 break-words text-sm font-semibold">
                          {href ? (
                            <a
                              className="text-primary hover:underline"
                              href={href}
                              target={href.startsWith("http") ? "_blank" : undefined}
                              rel={href.startsWith("http") ? "noreferrer" : undefined}
                            >
                              {voce.valore}
                            </a>
                          ) : (
                            voce.valore
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
