import { Link } from "react-router-dom";
import { Building2, GitBranch, Handshake, Users } from "lucide-react";
import { Card } from "@/components/ui";
import { SkeletonCard, SkeletonKpi, SkeletonScheda } from "@/components/Skeleton";
import { BadgeSezione, BadgeStato, MessaggioStato, Tabella, type Colonna } from "@/components/Tabella";
import { useAuth } from "@/auth/AuthContext";
import { useApi } from "@/lib/useApi";
import { formatData, formatNumero } from "@/lib/format";
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
  { label: "Collaboratori diretti", chiave: "rete" as const, icon: Users },
  { label: "Rapporti in registro", chiave: "collaborazioni" as const, icon: GitBranch },
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

/** Una riga per persona con tutti i suoi ruoli. */
function raggruppa(cariche: Estratto["cariche"]): Array<[string, string[]]> {
  const mappa = new Map<string, string[]>();
  for (const c of cariche) {
    const persona = c.persona || "—";
    const ruoli = mappa.get(persona) ?? [];
    const ruolo = c.qualifica || "Carica";
    if (!ruoli.includes(ruolo)) ruoli.push(ruolo);
    mappa.set(persona, ruoli);
  }
  return [...mappa.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

export function EstrattoClientePage() {
  const { cliente } = useAuth();
  const { data, errore, caricamento } = useApi<Estratto>(
    cliente ? `/api/cliente/estratto${qs({ rui: cliente.rui })}` : null,
  );
  const s = data?.soggetto;

  return (
    <div className="space-y-6" aria-busy={caricamento}>
      <MessaggioStato errore={errore} />
      {caricamento ? <SkeletonScheda /> : s ? (
        <Card>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Iscrizione</p>
          <h3 className="mt-1 text-2xl font-bold">{s.denominazione}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.numero_iscrizione_rui} · sez. {s.sezione}
            {s.data_iscrizione ? ` · iscritta dal ${formatData(s.data_iscrizione)}` : ""}
          </p>
        </Card>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {KPI.map((k) => {
          if (caricamento) {
            return <SkeletonKpi key={k.label} etichetta={k.label} />;
          }
          const Icona = k.icon;
          return (
            <Card key={k.label} className="p-4 sm:p-6">
              <div className="mb-3 hidden h-10 w-10 items-center justify-center rounded-xl bg-primary/10 sm:flex">
                <Icona className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">{k.label}</p>
              <p className="mt-1 font-display text-2xl sm:text-3xl">
                {data ? formatNumero(data.numeri[k.chiave]) : "—"}
              </p>
            </Card>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        I collaboratori diretti sono agenti, broker e collaboratori collegati alla tua iscrizione nel RUI, contati una
        volta sola. Non comprendono la rete di altre società del tuo gruppo.
      </p>
      {caricamento ? <SkeletonCard righe={3} /> : null}
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
      {caricamento ? (
        <SkeletonCard righe={2} />
      ) : data?.mandati?.length ? (
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
          <p className="text-sm text-muted-foreground">
            {s?.sezione === "B"
              ? "Nessun mandato intestato: per un broker è normale, i mandati stanno sugli agenti."
              : "Nessun mandato diretto in registro."}
          </p>
        </Card>
      )}
      {data?.cariche?.length ? (
        <Card>
          <h3 className="mb-3 text-lg font-bold">Cariche</h3>
          <ul className="space-y-2 text-sm">
            {raggruppa(data.cariche).map(([persona, ruoli]) => (
              <li key={persona} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-semibold">{persona}</span>
                {ruoli.map((r) => (
                  <span key={r} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                    {r}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-bold">La tua rete</h3>
          {(data?.intermediari?.length ?? 0) > 12 ? (
            <Link className="text-sm font-semibold text-primary hover:underline" to="/cliente/intermediari?vista=rete">
              Vedi tutti i {formatNumero(data?.intermediari.length ?? 0)}
            </Link>
          ) : null}
        </div>
        <Tabella
          colonne={COLONNE}
          righe={(data?.intermediari ?? []).slice(0, 12)}
          vuoto="Nessun intermediario collegato in A/B/E."
          chiave={(r) => r.rui_collegato}
          caricamento={caricamento}
        />
      </div>
    </div>
  );
}
