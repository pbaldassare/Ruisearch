import { Card } from "@/components/ui";
import { useApi } from "@/lib/useApi";

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
      {caricamento ? <p className="text-sm text-muted-foreground">Caricamento…</p> : null}
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
              Sezioni esposte: {data.sezioni_ammesse.join(", ")}. Solo lettura. L&apos;import resta a
              richiesta da terminale.
            </p>
            <p className="mt-3 text-sm">
              Specifica OpenAPI:{" "}
              <a className="font-semibold text-primary hover:underline" href="/api/openapi.json" target="_blank" rel="noreferrer">
                /api/openapi.json
              </a>
            </p>
          </Card>

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
