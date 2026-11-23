import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, KeyRound, X } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { SkeletonCard } from "@/components/Skeleton";
import { Tabella, type Colonna } from "@/components/Tabella";
import { postJson, qs } from "@/api";
import { cn } from "@/lib/cn";
import { formatQuando } from "@/lib/format";
import { useApi } from "@/lib/useApi";

type ChiaveApi = {
  id: number;
  nome: string;
  prefisso: string;
  creata_il: string;
  ultimo_uso: string | null;
  revocata_il: string | null;
};

function ChiaviApi() {
  const [tick, setTick] = useState(0);
  const { data, errore, caricamento } = useApi<{ chiavi: ChiaveApi[] }>(`/api/admin/api-keys${qs({ t: tick })}`);
  const [nome, setNome] = useState("");
  const [nuova, setNuova] = useState<{ nome: string; chiave: string } | null>(null);
  const [copiata, setCopiata] = useState(false);
  const [conferma, setConferma] = useState<number | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [erroreAzione, setErroreAzione] = useState<string | null>(null);
  // Due Invio di fila arrivano prima che il pulsante si disabiliti: il ref blocca subito il secondo.
  const occupato = useRef(false);

  async function azione(fn: () => Promise<void>) {
    if (occupato.current) return;
    occupato.current = true;
    setErroreAzione(null);
    setInCorso(true);
    try {
      await fn();
      setConferma(null);
      setTick((n) => n + 1);
    } catch (err) {
      setErroreAzione(err instanceof Error ? err.message : "operazione non riuscita");
    } finally {
      occupato.current = false;
      setInCorso(false);
    }
  }

  function genera() {
    if (!nome.trim() || occupato.current) return;
    void azione(async () => {
      const out = await postJson<{ chiave: string; voce: ChiaveApi }>("/api/admin/api-keys", { nome: nome.trim() });
      setNuova({ nome: out.voce.nome, chiave: out.chiave });
      setCopiata(false);
      setNome("");
    });
  }

  async function copia(testo: string) {
    try {
      await navigator.clipboard.writeText(testo);
      setCopiata(true);
    } catch {
      setErroreAzione("Copia non riuscita: seleziona la chiave e copiala a mano.");
    }
  }

  const colonne: Colonna<ChiaveApi>[] = [
    { id: "nome", etichetta: "Nome", cella: (r) => <span className="font-semibold">{r.nome}</span> },
    { id: "pref", etichetta: "Chiave", cella: (r) => <code className="text-xs">{r.prefisso}…</code> },
    { id: "creata", etichetta: "Creata", cella: (r) => formatQuando(r.creata_il) },
    { id: "uso", etichetta: "Ultimo uso", cella: (r) => (r.ultimo_uso ? formatQuando(r.ultimo_uso) : "Mai") },
    {
      id: "stato",
      etichetta: "Stato",
      cella: (r) => (
        <span
          className={cn(
            "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
            r.revocata_il ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-primary",
          )}
        >
          {r.revocata_il ? `Revocata il ${formatQuando(r.revocata_il)}` : "Attiva"}
        </span>
      ),
    },
    {
      id: "azioni",
      etichetta: "",
      classe: "text-right",
      cella: (r) =>
        r.revocata_il ? null : conferma === r.id ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs font-semibold">Revocare la chiave? Chi la usa smette di funzionare.</span>
            <Button
              size="sm"
              variant="outline"
              className="border-destructive text-destructive"
              disabled={inCorso}
              onClick={() => void azione(() => postJson("/api/admin/api-keys/revoca", { id: r.id }).then(() => undefined))}
            >
              <Check className="h-4 w-4" />
              Sì
            </Button>
            <Button size="sm" variant="ghost" disabled={inCorso} onClick={() => setConferma(null)}>
              <X className="h-4 w-4" />
              No
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" disabled={inCorso} onClick={() => setConferma(r.id)}>
            Revoca
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-lg font-bold">Chiavi API</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Una chiave per ogni software che usa <code>/api/v1</code>, così si può revocare senza fermare gli altri.
        </p>
        <div className="mt-4 flex max-w-xl flex-col gap-3 sm:flex-row">
          <Input
            value={nome}
            maxLength={80}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.repeat) genera();
            }}
            placeholder="Nome (es. Assicurapp produzione)"
            aria-label="Nome della chiave"
          />
          <Button disabled={inCorso || !nome.trim()} onClick={genera}>
            <KeyRound className="h-4 w-4" />
            Genera chiave
          </Button>
        </div>
        {nuova ? (
          <div className="mt-4 rounded-2xl bg-primary/10 p-4 text-sm" role="status">
            <p className="font-semibold">
              Chiave «{nuova.nome}» creata. Copiala ora: dopo aver lasciato la pagina non sarà più visibile.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all rounded-xl bg-card px-3 py-2 text-xs">{nuova.chiave}</code>
              <Button size="sm" variant="outline" onClick={() => void copia(nuova.chiave)}>
                {copiata ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiata ? "Copiata" : "Copia"}
              </Button>
            </div>
          </div>
        ) : null}
        {errore || erroreAzione ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {erroreAzione || errore}
          </p>
        ) : null}
      </Card>
      <Tabella
        colonne={colonne}
        righe={data?.chiavi ?? []}
        vuoto="Nessuna chiave. Generane una qui sopra."
        chiave={(r) => String(r.id)}
        caricamento={caricamento && !data}
        righeSkeleton={2}
      />
    </div>
  );
}

type Doc = {
  titolo: string;
  sezioni_ammesse: string[];
  autenticazione: { header: string; nota: string };
  dimensioni: Array<{ id: string; etichetta: string; esempio: string }>;
  esempi_domanda: string[];
  endpoint: Array<{ metodo: string; path: string; uso: string }>;
};

export function DocumentazionePage() {
  const { data, errore, caricamento } = useApi<Doc>("/api/documentazione");
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-4">
      {caricamento ? (
        <>
          <SkeletonCard righe={4} />
          <SkeletonCard righe={5} />
          <SkeletonCard righe={3} />
        </>
      ) : null}
      {errore ? <p className="text-sm text-destructive">{errore}</p> : null}
      {data ? (
        <>
          <Card>
            <h3 className="text-lg font-bold">{data.titolo}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Base URL pubblica di questa sessione: <code className="font-semibold">{origin}/api</code>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Per software esterni usa il prefisso <code>/api/v1</code> e l&apos;header{" "}
              <code>{data.autenticazione.header}</code>. {data.autenticazione.nota}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Sezioni esposte: {data.sezioni_ammesse.join(", ")}. Solo lettura. Gli elenchi accettano{" "}
              <code>formato=csv</code> per scaricare fino a 5.000 righe. I dati si aggiornano a mano dalla pagina{" "}
              <Link className="font-semibold text-primary hover:underline" to="/app/aggiornamento">
                Aggiornamento
              </Link>
              .
            </p>
            <p className="mt-3 text-sm">
              Specifica OpenAPI:{" "}
              <a className="font-semibold text-primary hover:underline" href="/api/openapi.json" target="_blank" rel="noreferrer">
                /api/openapi.json
              </a>
            </p>
          </Card>

          <ChiaviApi />

          <Card>
            <h3 className="mb-3 text-lg font-bold">Endpoint</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Metodo</th>
                    <th className="py-2 pr-3">Path</th>
                    <th className="py-2">Uso</th>
                  </tr>
                </thead>
                <tbody>
                  {data.endpoint.map((e) => (
                    <tr key={e.path} className="border-t border-border/60">
                      <td className="py-2 pr-3 font-semibold">{e.metodo}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{e.path}</td>
                      <td className="py-2">{e.uso}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 text-lg font-bold">Esempi cURL</h3>
            <pre className="overflow-x-auto rounded-2xl bg-secondary p-4 text-xs">{`curl -H "X-API-Key: $RUI_API_KEY" \\
  "${origin}/api/v1/query?q=quanti+intermediari+ha+consulbrokers"

curl -H "X-API-Key: $RUI_API_KEY" \\
  "${origin}/api/v1/intermediari/E000188700"`}</pre>
          </Card>

          <Card>
            <h3 className="mb-3 text-lg font-bold">Domande in italiano</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {data.esempi_domanda.map((es) => (
                <li key={es}>{es}</li>
              ))}
            </ul>
          </Card>

          <Card>
            <h3 className="mb-3 text-lg font-bold">Dimensioni</h3>
            <ul className="space-y-2 text-sm">
              {data.dimensioni.map((d) => (
                <li key={d.id}>
                  <span className="font-semibold">{d.etichetta}</span>
                  <span className="text-muted-foreground"> — {d.esempio}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}
    </div>
  );
}
