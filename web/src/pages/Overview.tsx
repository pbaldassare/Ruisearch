import { Building2, GitBranch, Handshake, Users } from "lucide-react";
import { Card } from "@/components/ui";
import { MessaggioStato } from "@/components/Tabella";
import { useApi } from "@/lib/useApi";
import { formatNumero, formatQuando } from "@/lib/format";
import type { Overview } from "@/api";

const KPI = [
  { label: "Intermediari A/B/E", chiave: "intermediari" as const, icon: Users },
  { label: "Collaborazioni", chiave: "collaborazioni" as const, icon: GitBranch },
  { label: "Sedi", chiave: "sedi" as const, icon: Building2 },
  { label: "Mandati", chiave: "mandati" as const, icon: Handshake },
];

export function OverviewPage() {
  const { data, errore, caricamento } = useApi<Overview>("/api/overview");
  const ultimo = data?.ultimo_import;

  return (
    <div className="space-y-6">
      <MessaggioStato caricamento={caricamento} errore={errore} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPI.map((k) => {
          const Icona = k.icon;
          return (
            <Card key={k.label}>
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Icona className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">{k.label}</p>
              <p className="mt-1 font-display text-3xl">
                {data ? formatNumero(data[k.chiave]) : "—"}
              </p>
            </Card>
          );
        })}
      </div>
      <Card>
        <h3 className="mb-2 text-lg font-bold">Ultimo caricamento</h3>
        {ultimo ? (
          <p className="text-sm text-muted-foreground">
            Run #{ultimo.id} · {ultimo.esito} · {formatQuando(ultimo.concluso_il)} ·{" "}
            {formatNumero(ultimo.righe_totali)} righe. Sezioni C, D, F e U restano
            fuori da queste viste.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nessun import ancora registrato. Il registro si carica solo a richiesta,
            dalla pagina Aggiornamento.
          </p>
        )}
      </Card>
    </div>
  );
}
