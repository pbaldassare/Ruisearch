import { Building2, GitBranch, Handshake, Users } from "lucide-react";
import { Card } from "@/components/ui";
import { BadgeSezione, BadgeStato, MessaggioStato, Tabella, type Colonna } from "@/components/Tabella";
import { useAuth } from "@/auth/AuthContext";
import { useApi } from "@/lib/useApi";
import { formatNumero } from "@/lib/format";
import { qs } from "@/api";

type IntermediarioRete = {
  rui_collegato: string;
  denominazione: string | null;
  sezione: string | null;
  qualifica: string | null;
  inoperativo: boolean | null;
};

type Estratto = {
  soggetto: {
    numero_iscrizione_rui: string;
    denominazione: string;
    sezione: string;
    data_iscrizione: string | null;
    inoperativo: boolean;
  };
  numeri: {
    intermediari: number;
    collaborazioni: number;
    mandati: number;
    sedi: number;
    rete: number;
    operativi: number;
    inoperativi: number;
    sezione_e: number;
  };
  sedi: Array<{ tipo_sede: string | null; indirizzo_sede: string | null; comune_sede: string | null; provincia_sede: string | null }>;
  siti_internet: string[];
  mandati: Array<{ codice_compagnia: string | null; ragione_sociale: string | null }>;
  cariche: Array<{ qualifica: string | null; persona: string | null }>;
  intermediari: IntermediarioRete[];
};

const KPI = [
  { label: "Intermediari in rete", chiave: "rete" as const, icon: Users },
  { label: "Collaborazioni", chiave: "collaborazioni" as const, icon: GitBranch },
  { label: "Mandati", chiave: "mandati" as const, icon: Handshake },
  { label: "Sedi", chiave: "sedi" as const, icon: Building2 },
];

const COLONNE: Colonna<IntermediarioRete>[] = [
  { id: "nome", etichetta: "Nominativo", cella: (r) => r.denominazione || "—" },
  { id: "rui", etichetta: "RUI", cella: (r) => r.rui_collegato },
  { id: "sez", etichetta: "Sez.", cella: (r) => <BadgeSezione sezione={r.sezione} /> },
  { id: "qual", etichetta: "Qualifica", cella: (r) => r.qualifica || "—" },
  { id: "stato", etichetta: "Stato", cella: (r) => <BadgeStato inoperativo={r.inoperativo} /> },
];

export function EstrattoClientePage() {
  const { cliente } = useAuth();
  const { data, errore, caricamento } = useApi<Estratto>(
    cliente ? `/api/cliente/estratto${qs({ rui: cliente.rui })}` : null,
  );
  const s = data?.soggetto;

  return (
    <div className="space-y-6">
      <MessaggioStato caricamento={caricamento} errore={errore} />
      {s ? (
        <Card>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Iscrizione</p>
          <h3 className="mt-1 text-2xl font-bold">{s.denominazione}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.numero_iscrizione_rui} · sez. {s.sezione}
            {s.data_iscrizione ? ` · iscritta il ${s.data_iscrizione}` : ""}
          </p>
        </Card>
      ) : null}
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
                {data ? formatNumero(data.numeri[k.chiave]) : "—"}
              </p>
            </Card>
          );
        })}
      </div>
      {data?.sedi?.length ? (
        <Card>
          <h3 className="mb-3 text-lg font-bold">Sedi</h3>
          <ul className="space-y-1 text-sm">
            {data.sedi.map((sede, i) => (
              <li key={i}>
                {[sede.tipo_sede, sede.indirizzo_sede, sede.comune_sede, sede.provincia_sede]
                  .filter(Boolean)
                  .join(" · ")}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data?.siti_internet?.length ? (
        <Card>
          <h3 className="mb-3 text-lg font-bold">Siti</h3>
          <ul className="space-y-1 text-sm">
            {data.siti_internet.map((url) => (
              <li key={url}>
                <a className="text-primary hover:underline" href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data?.mandati?.length ? (
        <Card>
          <h3 className="mb-3 text-lg font-bold">Mandati</h3>
          <ul className="space-y-1 text-sm">
            {data.mandati.map((m, i) => (
              <li key={i}>{m.ragione_sociale || m.codice_compagnia}</li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <h3 className="mb-2 text-lg font-bold">Mandati</h3>
          <p className="text-sm text-muted-foreground">Nessun mandato diretto in registro.</p>
        </Card>
      )}
      {data?.cariche?.length ? (
        <Card>
          <h3 className="mb-3 text-lg font-bold">Cariche</h3>
          <ul className="space-y-1 text-sm">
            {data.cariche.map((c, i) => (
              <li key={i}>
                <span className="font-semibold">{c.qualifica || "Carica"}</span>
                {c.persona ? ` · ${c.persona}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <div>
        <h3 className="mb-3 text-lg font-bold">Prime figure della rete</h3>
        <Tabella
          colonne={COLONNE}
          righe={(data?.intermediari ?? []).slice(0, 12)}
          vuoto="Nessun intermediario collegato in A/B/E."
          chiave={(r) => r.rui_collegato}
        />
      </div>
    </div>
  );
}
