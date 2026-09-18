import { RefreshCw } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { MessaggioStato } from "@/components/Tabella";
import { useApi } from "@/lib/useApi";
import { formatNumero, formatQuando } from "@/lib/format";
import type { ImportRun } from "@/api";

export function AggiornamentoPage() {
  const { data, errore, caricamento } = useApi<ImportRun[]>("/api/import-runs");
  const ultimo = data?.[0];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <p className="text-sm text-muted-foreground">Ultimo caricamento</p>
        <MessaggioStato caricamento={caricamento} errore={errore} />
        {ultimo ? (
          <>
            <p className="mt-1 font-display text-2xl">
              Run #{ultimo.id} · {ultimo.esito}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Concluso {formatQuando(ultimo.concluso_il)} · {formatNumero(ultimo.righe_totali)}{" "}
              righe. L'export ufficiale IVASS non gira in automatico.
            </p>
          </>
        ) : !caricamento && !errore ? (
          <p className="mt-1 font-display text-2xl">Mai eseguito</p>
        ) : null}
      </Card>
      <Card>
        <h3 className="mb-3 text-lg font-bold">Aggiorna a richiesta</h3>
        <p className="mb-6 text-sm text-muted-foreground">
          Lo script di import resta da terminale (`npm run import` / `import:rest`).
          Il pulsante in pagina arriva dopo. Nessun job notturno.
        </p>
        <Button disabled>
          <RefreshCw className="h-4 w-4" />
          Aggiorna ora
        </Button>
      </Card>
      {data && data.length > 0 ? (
        <Card className="lg:col-span-2">
          <h3 className="mb-3 text-lg font-bold">Storico</h3>
          <ul className="space-y-2 text-sm">
            {data.map((run) => (
              <li key={run.id} className="flex flex-wrap gap-x-3">
                <span className="font-semibold">#{run.id}</span>
                <span>{run.esito}</span>
                <span className="text-muted-foreground">{formatQuando(run.concluso_il)}</span>
                <span className="text-muted-foreground">{formatNumero(run.righe_totali)} righe</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
