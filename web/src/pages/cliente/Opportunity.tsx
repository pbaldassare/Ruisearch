import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { SkeletonOpportunity } from "@/components/Skeleton";
import { BadgeSezione, MessaggioStato } from "@/components/Tabella";
import { useAuth } from "@/auth/AuthContext";
import { useApi } from "@/lib/useApi";
import { postJson, qs } from "@/api";

type Recapito = {
  tipo: string;
  valore: string;
  etichetta: string | null;
  fonte: string | null;
  fonte_url: string | null;
};

type Voce = {
  id: number;
  rui_target: string;
  denominazione: string | null;
  sezione: string | null;
  rui_broker: string | null;
  broker_denominazione: string | null;
  zona: string | null;
  compagnia: string | null;
  stato: "nuova" | "in_lavorazione" | "contattata" | "scartata";
  note: string | null;
  sintesi: string | null;
  recapiti: Recapito[];
};

type Payload = { kimi_pronta: boolean; voci: Voce[] };

const STATI: Array<Voce["stato"]> = ["nuova", "in_lavorazione", "contattata", "scartata"];
const ETICHETTA: Record<Voce["stato"], string> = {
  nuova: "Nuova",
  in_lavorazione: "In lavorazione",
  contattata: "Contattata",
  scartata: "Scartata",
};

export function OpportunityPage() {
  const { cliente } = useAuth();
  const [tick, setTick] = useState(0);
  const [filtro, setFiltro] = useState<Voce["stato"] | "tutte">("tutte");
  const { data, errore, caricamento } = useApi<Payload>(
    cliente ? `/api/cliente/opportunity${qs({ rui: cliente.rui, t: tick })}` : null,
  );
  const [busy, setBusy] = useState<number | null>(null);
  const [busyAi, setBusyAi] = useState<number | null>(null);
  const [erroreAzione, setErroreAzione] = useState<string | null>(null);

  const voci = (data?.voci ?? []).filter((v) => filtro === "tutte" || v.stato === filtro);

  async function arricchisciDiNuovo(v: Voce) {
    if (!cliente) return;
    setErroreAzione(null);
    setBusyAi(v.id);
    try {
      await postJson("/api/cliente/opportunity/arricchisci", {
        rui: cliente.rui,
        rui_target: v.rui_target,
        rui_broker: v.rui_broker,
        zona: v.zona,
        compagnia: v.compagnia,
      });
      setTick((n) => n + 1);
    } catch (err) {
      setErroreAzione(err instanceof Error ? err.message : "arricchimento non riuscito");
    } finally {
      setBusyAi(null);
    }
  }

  async function cambiaStato(id: number, stato: Voce["stato"]) {
    if (!cliente) return;
    setBusy(id);
    try {
      await postJson("/api/cliente/opportunity/stato", { rui: cliente.rui, id, stato });
      setTick((n) => n + 1);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <MessaggioStato errore={errore} />
      <p className="text-sm text-muted-foreground">
        Qui arrivano i nominativi su cui hai premuto «Cerca recapiti». I dati restano in database.
        {data && !data.kimi_pronta ? " Kimi non è configurata: per ora si salvano sede e sito del RUI." : " Kimi cerca sul web, LinkedIn e i social."}
      </p>
      {erroreAzione ? <p className="text-sm text-destructive">{erroreAzione}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={filtro === "tutte" ? "default" : "outline"} onClick={() => setFiltro("tutte")}>
          Tutte
        </Button>
        {STATI.map((s) => (
          <Button key={s} size="sm" variant={filtro === s ? "default" : "outline"} onClick={() => setFiltro(s)}>
            {ETICHETTA[s]}
          </Button>
        ))}
      </div>
      {caricamento ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonOpportunity />
          <SkeletonOpportunity />
          <SkeletonOpportunity />
          <SkeletonOpportunity />
        </div>
      ) : null}
      {voci.length === 0 && !caricamento ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Nessuna opportunity. Vai su Intermediari → Cerca mercato, apri un broker e cerca i recapiti di un sub-agente.
          </p>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {voci.map((v) => (
          <Card key={v.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">{ETICHETTA[v.stato]}</p>
                <h3 className="mt-1 text-lg font-bold">{v.denominazione || v.rui_target}</h3>
                <p className="text-sm text-muted-foreground">
                  {v.rui_target} <BadgeSezione sezione={v.sezione} />
                </p>
              </div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {[v.broker_denominazione && `via ${v.broker_denominazione}`, v.zona, v.compagnia]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {v.sintesi ? <p className="mt-3 text-sm">{v.sintesi}</p> : null}
            {v.recapiti.length ? (
              <ul className="mt-3 space-y-1 text-sm">
                {v.recapiti.map((c, i) => (
                  <li key={`${c.tipo}-${c.valore}-${i}`}>
                    <span className="font-semibold">{c.etichetta || c.tipo}</span>
                    {": "}
                    {c.fonte_url ? (
                      <a className="text-primary hover:underline" href={c.fonte_url} target="_blank" rel="noreferrer">
                        {c.valore}
                      </a>
                    ) : (
                      c.valore
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Ancora senza recapiti extra.</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busyAi === v.id}
                onClick={() => void arricchisciDiNuovo(v)}
              >
                {busyAi === v.id ? "Cerco sul web…" : "Cerca di nuovo sul web"}
              </Button>
              {STATI.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={v.stato === s ? "default" : "ghost"}
                  disabled={busy === v.id}
                  onClick={() => void cambiaStato(v.id, s)}
                >
                  {ETICHETTA[s]}
                </Button>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
