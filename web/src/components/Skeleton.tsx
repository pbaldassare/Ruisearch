import type { CSSProperties, ReactNode } from "react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";

const LARGHEZZE = ["w-3/4", "w-1/2", "w-5/6", "w-2/3", "w-4/5", "w-1/3"] as const;

export function Osso({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span className={cn("skeleton-osso block", className)} style={style} aria-hidden />;
}

export function SchermoCaricamento({ children }: { children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Caricamento in corso</span>
      {children}
    </div>
  );
}

export function SkeletonKpi({
  etichetta,
  conIcona = true,
}: {
  etichetta?: string;
  conIcona?: boolean;
}) {
  return (
    <Card>
      {conIcona ? <Osso className="mb-3 h-10 w-10 rounded-xl" /> : null}
      {etichetta ? (
        <p className="text-sm text-muted-foreground">{etichetta}</p>
      ) : (
        <Osso className="h-3.5 w-36 rounded-full" />
      )}
      <Osso className="mt-3 h-8 w-16 rounded-lg" />
    </Card>
  );
}

export function SkeletonScheda() {
  return (
    <Card>
      <Osso className="h-3 w-24 rounded-full" />
      <Osso className="mt-3 h-7 w-64 max-w-full rounded-lg" />
      <Osso className="mt-2 h-4 w-48 max-w-full rounded-full" />
    </Card>
  );
}

export function SkeletonCard({
  titolo = true,
  righe = 3,
}: {
  titolo?: boolean;
  righe?: number;
}) {
  return (
    <Card>
      {titolo ? <Osso className="mb-4 h-5 w-40 rounded-lg" /> : null}
      <div className="space-y-2.5">
        {Array.from({ length: righe }, (_, i) => (
          <Osso
            key={i}
            className={cn(
              "h-3.5 rounded-full",
              i === righe - 1 ? "w-2/3" : i % 2 === 0 ? "w-full" : "w-5/6",
            )}
          />
        ))}
      </div>
    </Card>
  );
}

export function SkeletonBarre() {
  return (
    <Card>
      <Osso className="h-4 w-48 rounded-full" />
      <div className="mt-5 space-y-4">
        {[88, 64, 47, 31].map((larghezza, i) => (
          <div key={i}>
            <div className="mb-1.5 flex justify-between gap-3">
              <Osso className="h-3 w-32 rounded-full" />
              <Osso className="h-3 w-8 shrink-0 rounded-full" />
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <Osso className="h-2 rounded-full" style={{ width: `${larghezza}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function SkeletonTabella({
  colonne = 5,
  righe = 6,
}: {
  colonne?: number;
  righe?: number;
}) {
  return (
    <div className="glass-card overflow-hidden" aria-hidden>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary/70">
            <tr>
              {Array.from({ length: colonne }, (_, i) => (
                <th key={i} className="px-4 py-3">
                  <Osso className="h-3 w-16 rounded-full" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: righe }, (_, r) => (
              <tr key={r} className="border-t border-border/60">
                {Array.from({ length: colonne }, (_, c) => (
                  <td key={c} className="px-4 py-3">
                    <Osso
                      className={cn("h-3.5 rounded-full", LARGHEZZE[(r + c) % LARGHEZZE.length])}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SkeletonOpportunity() {
  return (
    <Card>
      <Osso className="h-3 w-16 rounded-full" />
      <Osso className="mt-2 h-6 w-52 max-w-full rounded-lg" />
      <Osso className="mt-2 h-4 w-36 rounded-full" />
      <Osso className="mt-4 h-3.5 w-full rounded-full" />
      <Osso className="mt-2 h-3.5 w-4/5 rounded-full" />
      <div className="mt-5 flex flex-wrap gap-2">
        <Osso className="h-9 w-32 rounded-full" />
        <Osso className="h-9 w-24 rounded-full" />
        <Osso className="h-9 w-28 rounded-full" />
      </div>
    </Card>
  );
}

export function SkeletonRigaLista({ n = 4 }: { n?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 rounded-2xl bg-secondary/50 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Osso className="h-3.5 w-40 max-w-full rounded-full" />
            <Osso className="h-3 w-28 max-w-full rounded-full" />
          </div>
          <Osso className="h-8 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}
