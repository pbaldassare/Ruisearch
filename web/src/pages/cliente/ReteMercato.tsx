import { Link, useParams, useSearchParams } from "react-router-dom";
import { Button, Card } from "@/components/ui";
import { SkeletonScheda } from "@/components/Skeleton";
import { BadgeSezione, BadgeStato, MessaggioStato, Tabella, type Colonna } from "@/components/Tabella";
import { useAuth } from "@/auth/AuthContext";
import { useApi } from "@/lib/useApi";
import { postJson, qs } from "@/api";
import { useState } from "react";

type Collegato = {
  rui_collegato: string;
  denominazione: string | null;
  sezione: string | null;
  qualifica: string | null;
  livello: string | null;
  inoperativo: boolean | null;
};

type SchedaMercato = {
  soggetto: { numero_iscrizione_rui: string; denominazione: string; sezione: string; inoperativo?: boolean };
  sedi: Array<{
    tipo_sede?: string | null;
    indirizzo_sede: string | null;
    comune_sede: string | null;
    provincia_sede: string | null;
    cap_sede?: string | null;
  }>;
  mandati: Array<{ ragione_sociale: string | null }>;
  collaboratori: Collegato[];
  principali: Collegato[];
};

export function ReteMercatoPage() {
  const { rui = "" } = useParams();
  const [params] = useSearchParams();
  const { cliente } = useAuth();
  const { data, errore, caricamento } = useApi<SchedaMercato>(
    rui ? `/api/cliente/mercato/scheda${qs({ rui })}` : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [erroreAzione, setErroreAzione] = useState<string | null>(null);
  const [okAzione, setOkAzione] = useState<string | null>(null);

  const zona = params.get("zona") || "";
  const compagnia = params.get("compagnia") || "";

  async function arricchisci(ruiTarget: string, ruiBroker?: string) {
    if (!cliente) return;
    setErroreAzione(null);
    setOkAzione(null);
    setBusy(`ai-${ruiTarget}`);
    try {
      const out = await postJson<{ recapiti: unknown[]; sintesi: string }>(
        "/api/cliente/opportunity/arricchisci",
        {
          rui: cliente.rui,
          rui_target: ruiTarget,
          rui_broker: ruiBroker,
          zona,
          compagnia,
        },
      );
      setOkAzione(
        `Salvato in Opportunity: ${out.sintesi || ruiTarget}. Recapiti: ${out.recapiti?.length ?? 0}.`,
      );
    } catch (err) {
      setErroreAzione(err instanceof Error ? err.message : "arricchimento non riuscito");
    } finally {
      setBusy(null);
    }
  }

  const contesto = qs({ zona, compagnia });

  const colonne: Colonna<Collegato>[] = [
    { id: "nome", etichetta: "Nominativo", cella: (r) => r.denominazione || "—" },
    { id: "rui", etichetta: "RUI", cella: (r) => r.rui_collegato },
    { id: "sez", etichetta: "Sez.", cella: (r) => <BadgeSezione sezione={r.sezione} /> },
    { id: "qual", etichetta: "Ruolo", cella: (r) => r.qualifica || "—" },
    { id: "liv", etichetta: "Livello", cella: (r) => r.livello || "—" },
    { id: "stato", etichetta: "Stato", cella: (r) => <BadgeStato inoperativo={r.inoperativo} /> },
    {
      id: "az",
      etichetta: "",
      cella: (r) => (
        <div className="flex flex-wrap gap-2">
          <Link
            className="inline-flex h-9 items-center rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-secondary"
            to={`/cliente/intermediari/${encodeURIComponent(r.rui_collegato)}${contesto}`}
          >
            Apri rete
          </Link>
          <Button
            type="button"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() => void arricchisci(r.rui_collegato, data?.soggetto.numero_iscrizione_rui)}
          >
            {busy === `ai-${r.rui_collegato}` ? "Cerco…" : "Cerca recapiti"}
          </Button>
        </div>
      ),
    },
  ];

  const s = data?.soggetto;

  return (
    <div className="space-y-4">
      <Link className="text-sm font-semibold text-primary hover:underline" to="/cliente/intermediari">
        ← Torna alle ricerche
      </Link>
      <MessaggioStato errore={errore} />
      {erroreAzione ? <p className="text-sm text-destructive">{erroreAzione}</p> : null}
      {okAzione ? <p className="text-sm text-primary">{okAzione}</p> : null}

      {caricamento ? <SkeletonScheda /> : null}
      {s ? (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-2xl font-bold">{s.denominazione}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {s.numero_iscrizione_rui} · sez. {s.sezione}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <BadgeSezione sezione={s.sezione} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => void arricchisci(s.numero_iscrizione_rui)}
              >
                {busy === `ai-${s.numero_iscrizione_rui}` ? "Cerco…" : "Cerca recapiti"}
              </Button>
            </div>
          </div>
          {data.sedi?.length ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Sedi:{" "}
              {data.sedi
                .map((sede) =>
                  [sede.indirizzo_sede, sede.cap_sede, sede.comune_sede, sede.provincia_sede]
                    .filter(Boolean)
                    .join(", "),
                )
                .join(" · ")}
            </p>
          ) : null}
          {data.mandati?.length ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Mandati: {data.mandati.slice(0, 10).map((m) => m.ragione_sociale).filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </Card>
      ) : null}

      {caricamento || data ? (
        <>
          <p className="text-sm font-semibold">Sub-agenti / collaboratori</p>
          <Tabella
            colonne={colonne}
            righe={data?.collaboratori ?? []}
            vuoto="Nessun collaboratore A/B/E sotto questo intermediario."
            chiave={(r) => r.rui_collegato}
            caricamento={caricamento}
          />
          {data?.principali?.length ? (
            <>
              <p className="text-sm font-semibold">Principali</p>
              <Tabella
                colonne={colonne}
                righe={data.principali}
                vuoto="Nessun principale."
                chiave={(r) => `p-${r.rui_collegato}`}
              />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
