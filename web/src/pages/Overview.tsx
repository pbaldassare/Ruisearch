import { Link } from "react-router-dom";
import { ArrowRight, Building2, GitBranch, Handshake, Users } from "lucide-react";
import { Card } from "@/components/ui";
import { SkeletonCard, SkeletonKpi } from "@/components/Skeleton";
import { MessaggioStato } from "@/components/Tabella";
import { useApi } from "@/lib/useApi";
import { formatNumero, formatQuando } from "@/lib/format";
import type { Overview } from "@/api";

const KPI = [
  { label: "Iscritti A, B, E", chiave: "intermediari" as const, icon: Users, link: "/app/intermediari" },
  { label: "Collaborazioni", chiave: "collaborazioni" as const, icon: GitBranch, link: "/app/rete" },
  { label: "Sedi", chiave: "sedi" as const, icon: Building2, link: "/app/sedi" },
  { label: "Mandati", chiave: "mandati" as const, icon: Handshake, link: "/app/mandati" },
];

export function OverviewPage() {
  const { data, errore, caricamento } = useApi<Overview>("/api/overview");
  const ultimo = data?.ultimo_import ?? null;
  // I dati che si stanno guardando: l'ultimo caricamento riuscito, non l'ultimo tentativo.
  // (Senza dati_in_uso, cioe' con un'API meno recente, vale l'ultimo import solo se completato.)
  const inUso =
    data?.dati_in_uso !== undefined ? data.dati_in_uso : ultimo?.esito === "completato" ? ultimo : null;
  const tentativoDopo = ultimo && ultimo.id !== inUso?.id ? ultimo : null;

  return (
    <div className="space-y-6">
      <MessaggioStato errore={errore} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {KPI.map((k) => {
          if (caricamento) {
            return <SkeletonKpi key={k.label} etichetta={k.label} />;
          }
          const Icona = k.icon;
          return (
            <Link
              key={k.label}
              to={k.link}
              className="group rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full p-4 transition-shadow group-hover:shadow-glow sm:p-6">
                <div className="mb-3 hidden h-10 w-10 items-center justify-center rounded-xl bg-primary/10 sm:flex">
                  <Icona className="h-5 w-5 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">{k.label}</p>
                <p className="mt-1 font-display text-2xl sm:text-3xl">{data ? formatNumero(data[k.chiave]) : "—"}</p>
                <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  Apri <ArrowRight className="h-3 w-3" />
                </p>
              </Card>
            </Link>
          );
        })}
      </div>
      {caricamento ? (
        <SkeletonCard righe={2} />
      ) : (
        <Card>
          <h3 className="mb-2 text-lg font-bold">Dati aggiornati</h3>
          {inUso ? (
            <p className="text-sm text-muted-foreground">
              Registro aggiornato al {formatQuando(inUso.concluso_il ?? inUso.iniziato_il)} ·{" "}
              {formatNumero(inUso.righe_totali)} record dall'export IVASS. Qui contano solo agenti (A), broker (B) e
              collaboratori (E).{" "}
              <Link className="font-semibold text-primary hover:underline" to="/app/aggiornamento">
                Gestisci aggiornamenti
              </Link>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nessun dato caricato.{" "}
              <Link className="font-semibold text-primary hover:underline" to="/app/aggiornamento">
                Avvia il primo aggiornamento
              </Link>
              .
            </p>
          )}
          {inUso?.esito === "incompleto" ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Dopo questo caricamento la rete A/B/E non è stata ricostruita: collaborazioni e reti possono essere
              quelle del caricamento precedente.
            </p>
          ) : null}
          {tentativoDopo && tentativoDopo.esito !== "identico" ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {tentativoDopo.esito === "in corso"
                ? `Aggiornamento in corso dal ${formatQuando(tentativoDopo.iniziato_il)}.`
                : `L'ultimo tentativo, il ${formatQuando(tentativoDopo.concluso_il ?? tentativoDopo.iniziato_il)}, non è riuscito${inUso ? ": restano questi dati" : ""}.`}
            </p>
          ) : null}
        </Card>
      )}
    </div>
  );
}
