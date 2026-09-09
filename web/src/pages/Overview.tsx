import { Building2, GitBranch, Handshake, Users } from "lucide-react";
import { Card } from "@/components/ui";

const KPI = [
  { label: "Intermediari", valore: "—", icon: Users },
  { label: "Collaborazioni", valore: "—", icon: GitBranch },
  { label: "Sedi", valore: "—", icon: Building2 },
  { label: "Mandati", valore: "—", icon: Handshake },
];

export function OverviewPage() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPI.map((k) => {
          const Icona = k.icon;
          return (
            <Card key={k.label}>
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Icona className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">{k.label}</p>
              <p className="mt-1 font-display text-3xl">{k.valore}</p>
            </Card>
          );
        })}
      </div>
      <Card>
        <h3 className="mb-2 text-lg font-bold">Dati non ancora in questa vista</h3>
        <p className="text-sm text-muted-foreground">
          Il registro si carica solo quando lo chiedi, dalla pagina Aggiornamento.
          LinkedIn e recapiti extra restano un passo successivo, a richiesta su un
          singolo intermediario.
        </p>
      </Card>
    </div>
  );
}
