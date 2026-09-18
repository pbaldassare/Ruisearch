import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Colonna<T> = {
  id: string;
  etichetta: string;
  classe?: string;
  cella: (riga: T) => ReactNode;
};

export function Tabella<T>({
  colonne,
  righe,
  vuoto,
  chiave,
}: {
  colonne: Colonna<T>[];
  righe: T[];
  vuoto: string;
  chiave: (riga: T) => string;
}) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary/70 text-muted-foreground">
            <tr>
              {colonne.map((c) => (
                <th key={c.id} className={cn("px-4 py-3 font-semibold", c.classe)}>
                  {c.etichetta}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {righe.length === 0 ? (
              <tr>
                <td colSpan={colonne.length} className="px-4 py-12 text-center text-muted-foreground">
                  {vuoto}
                </td>
              </tr>
            ) : (
              righe.map((riga) => (
                <tr key={chiave(riga)} className="border-t border-border/60">
                  {colonne.map((c) => (
                    <td key={c.id} className={cn("px-4 py-3 align-top", c.classe)}>
                      {c.cella(riga)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BadgeStato({ inoperativo }: { inoperativo: boolean | null | undefined }) {
  if (inoperativo == null) return <span>—</span>;
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
        inoperativo ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
      )}
    >
      {inoperativo ? "Inoperativo" : "Operativo"}
    </span>
  );
}

export function BadgeSezione({ sezione }: { sezione: string | null | undefined }) {
  return (
    <span className="inline-flex min-w-7 justify-center rounded-full bg-secondary px-2 py-0.5 text-xs font-bold">
      {sezione || "—"}
    </span>
  );
}

export function MessaggioStato({
  caricamento,
  errore,
}: {
  caricamento: boolean;
  errore: string | null;
}) {
  if (caricamento) {
    return <p className="text-sm text-muted-foreground">Caricamento…</p>;
  }
  if (errore) {
    return <p className="text-sm text-destructive">{errore}</p>;
  }
  return null;
}
