import { Card } from "@/components/ui";
import { MessaggioStato } from "@/components/Tabella";
import { useAuth } from "@/auth/AuthContext";
import { useApi } from "@/lib/useApi";
import { qs } from "@/api";

type Idea = {
  id: string;
  titolo: string;
  stato: "aperta" | "monitorare" | "in_attesa";
  testo: string;
};

type Payload = { idee: Idea[] };

const ETICHETTA: Record<Idea["stato"], string> = {
  aperta: "Aperta",
  monitorare: "Da monitorare",
  in_attesa: "In attesa",
};

export function OpportunityPage() {
  const { cliente } = useAuth();
  const { data, errore, caricamento } = useApi<Payload>(
    cliente ? `/api/cliente/opportunity${qs({ rui: cliente.rui })}` : null,
  );

  return (
    <div className="space-y-4">
      <MessaggioStato caricamento={caricamento} errore={errore} />
      <div className="grid gap-4 lg:grid-cols-2">
        {(data?.idee ?? []).map((idea) => (
          <Card key={idea.id}>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {ETICHETTA[idea.stato]}
            </p>
            <h3 className="mt-1 text-lg font-bold">{idea.titolo}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{idea.testo}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
