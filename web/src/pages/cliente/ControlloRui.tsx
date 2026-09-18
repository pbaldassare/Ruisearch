import { Card } from "@/components/ui";
import { BadgeSezione, BadgeStato, MessaggioStato } from "@/components/Tabella";
import { useAuth } from "@/auth/AuthContext";
import { useApi } from "@/lib/useApi";
import { qs } from "@/api";
import { cn } from "@/lib/cn";

type Voce = {
  rui_collegato: string;
  denominazione: string | null;
  sezione: string | null;
  inoperativo: boolean | null;
};

type Segnalazione = {
  id: string;
  gravita: "alta" | "media" | "bassa" | "info";
  titolo: string;
  testo: string;
  voci: Voce[];
};

type Payload = {
  numeri: { rete: number; inoperativi: number };
  segnalazioni: Segnalazione[];
};

const COLORE: Record<Segnalazione["gravita"], string> = {
  alta: "border-destructive/40 bg-destructive/5",
  media: "border-primary/30 bg-primary/5",
  bassa: "border-border bg-secondary/50",
  info: "border-border bg-card",
};

export function ControlloRuiPage() {
  const { cliente } = useAuth();
  const { data, errore, caricamento } = useApi<Payload>(
    cliente ? `/api/cliente/controllo${qs({ rui: cliente.rui })}` : null,
  );

  return (
    <div className="space-y-4">
      <MessaggioStato caricamento={caricamento} errore={errore} />
      {(data?.segnalazioni ?? []).map((s) => (
        <Card key={s.id} className={cn("border", COLORE[s.gravita])}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.gravita}</p>
          <h3 className="mt-1 text-lg font-bold">{s.titolo}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{s.testo}</p>
          {s.voci.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {s.voci.map((v) => (
                <li key={v.rui_collegato} className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{v.denominazione}</span>
                  <span className="text-muted-foreground">{v.rui_collegato}</span>
                  <BadgeSezione sezione={v.sezione} />
                  <BadgeStato inoperativo={v.inoperativo} />
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
