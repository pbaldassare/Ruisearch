import { Card } from "@/components/ui";
import { BadgeSezione, BadgeStato, MessaggioStato, Tabella, type Colonna } from "@/components/Tabella";
import { useAuth } from "@/auth/AuthContext";
import { useApi } from "@/lib/useApi";
import { formatNumero } from "@/lib/format";
import { qs } from "@/api";

type Voce = {
  rui_collegato: string;
  denominazione: string | null;
  sezione: string | null;
  qualifica: string | null;
  inoperativo: boolean | null;
  indice: number;
  stato_relazione: string;
};

type Payload = {
  sintesi: { in_rete: number; da_impostare: number; da_riattivare: number };
  voci: Voce[];
};

const COLONNE: Colonna<Voce>[] = [
  { id: "nome", etichetta: "Nominativo", cella: (r) => r.denominazione || "—" },
  { id: "rui", etichetta: "RUI", cella: (r) => r.rui_collegato },
  { id: "sez", etichetta: "Sez.", cella: (r) => <BadgeSezione sezione={r.sezione} /> },
  { id: "stato", etichetta: "Stato RUI", cella: (r) => <BadgeStato inoperativo={r.inoperativo} /> },
  {
    id: "rel",
    etichetta: "Relazione",
    cella: (r) => (r.stato_relazione === "da_riattivare" ? "Da riattivare" : "Da impostare"),
  },
  { id: "idx", etichetta: "Indice", cella: (r) => String(r.indice) },
];

export function FidelizzazionePage() {
  const { cliente } = useAuth();
  const { data, errore, caricamento } = useApi<Payload>(
    cliente ? `/api/cliente/fidelizzazione${qs({ rui: cliente.rui })}` : null,
  );

  return (
    <div className="space-y-6">
      <MessaggioStato caricamento={caricamento} errore={errore} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted-foreground">In rete</p>
          <p className="mt-1 font-display text-3xl">{data ? formatNumero(data.sintesi.in_rete) : "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Da impostare</p>
          <p className="mt-1 font-display text-3xl">{data ? formatNumero(data.sintesi.da_impostare) : "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Da riattivare</p>
          <p className="mt-1 font-display text-3xl">{data ? formatNumero(data.sintesi.da_riattivare) : "—"}</p>
        </Card>
      </div>
      <Card>
        <p className="text-sm text-muted-foreground">
          Struttura pronta. Gli indici sono un avvio: poi si legano a incontri, rinnovi e segnali di rete.
        </p>
      </Card>
      <Tabella
        colonne={COLONNE}
        righe={data?.voci ?? []}
        vuoto="Nessun nominativo in rete da fidelizzare."
        chiave={(r) => r.rui_collegato}
      />
    </div>
  );
}
