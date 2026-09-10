import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui";

export function EmptyState({
  icon: Icona,
  titolo,
  testo,
}: {
  icon: LucideIcon;
  titolo: string;
  testo: string;
}) {
  return (
    <Card className="flex flex-col items-center justify-center px-8 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <Icona className="h-6 w-6 text-primary" />
      </div>
      <h3 className="mb-2 text-xl font-bold">{titolo}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{testo}</p>
    </Card>
  );
}

export function TabellaVuota({ colonne }: { colonne: string[] }) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary/70 text-muted-foreground">
            <tr>
              {colonne.map((c) => (
                <th key={c} className="px-4 py-3 font-semibold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={colonne.length} className="px-4 py-12 text-center text-muted-foreground">
                Nessun dato caricato. L'elenco si riempie dopo l'import a richiesta.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
