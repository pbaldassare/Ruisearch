import { GitBranch, Search, Users } from "lucide-react";
import { Input } from "@/components/ui";
import { EmptyState, TabellaVuota } from "@/components/EmptyState";

export function IntermediariPage() {
  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-11" placeholder="Cerca per nome o numero RUI" disabled />
      </div>
      <TabellaVuota colonne={["RUI", "Denominazione", "Sezione", "Iscrizione", "Stato"]} />
    </div>
  );
}

export function IntermediarioPage() {
  return (
    <EmptyState
      icon={Users}
      titolo="Scheda intermediario"
      testo="Qui compariranno anagrafica, rapporti, sedi e — solo a richiesta — i recapiti extra. Nessun profilo LinkedIn in questa fase."
    />
  );
}

export function RetePage() {
  return (
    <EmptyState
      icon={GitBranch}
      titolo="Grafo della rete"
      testo="Selezionerai un intermediario e vedrai principali e collaboratori. Il disegno arriva dopo il caricamento del registro."
    />
  );
}

export function SediPage() {
  return <TabellaVuota colonne={["RUI", "Tipo", "Comune", "Provincia", "Indirizzo"]} />;
}

export function MandatiPage() {
  return <TabellaVuota colonne={["Matricola", "Compagnia", "Codice"]} />;
}

export function CarichePage() {
  return <TabellaVuota colonne={["Persona", "Società", "Qualifica"]} />;
}
