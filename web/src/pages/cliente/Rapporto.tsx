/** Livello del rapporto in rete_collegati: 'I' diretto, 'II' indiretto attraverso un collaboratore di I livello. */
export function Rapporto({
  livello,
  tramite,
  tramiteNome,
}: {
  livello: string | null | undefined;
  tramite?: string | null;
  tramiteNome?: string | null;
}) {
  if (livello === "I") return <>Diretto</>;
  if (livello !== "II") return <>—</>;
  const via = tramiteNome || tramite;
  return (
    <span>
      Indiretto
      {via ? <span className="block text-xs text-muted-foreground">tramite {via}</span> : null}
    </span>
  );
}
