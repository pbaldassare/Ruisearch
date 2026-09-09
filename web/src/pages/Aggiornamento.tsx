import { RefreshCw } from "lucide-react";
import { Button, Card } from "@/components/ui";

export function AggiornamentoPage() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <p className="text-sm text-muted-foreground">Ultimo caricamento</p>
        <p className="mt-1 font-display text-2xl">Mai eseguito da questa console</p>
        <p className="mt-3 text-sm text-muted-foreground">
          L'export ufficiale IVASS non gira in automatico. Quando vorrai
          aggiornare il registro, lo lanceremo da qui a mano.
        </p>
      </Card>
      <Card>
        <h3 className="mb-3 text-lg font-bold">Aggiorna a richiesta</h3>
        <p className="mb-6 text-sm text-muted-foreground">
          Il pulsante è disattivato finché non colleghiamo lo script a questa
          pagina. Nessun job notturno.
        </p>
        <Button disabled>
          <RefreshCw className="h-4 w-4" />
          Aggiorna ora
        </Button>
      </Card>
    </div>
  );
}
