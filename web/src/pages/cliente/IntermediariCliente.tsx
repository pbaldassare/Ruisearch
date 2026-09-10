import { useMemo, useState } from "react";
import { Input } from "@/components/ui";
import { BadgeSezione, BadgeStato, MessaggioStato, Tabella, type Colonna } from "@/components/Tabella";
import { useAuth } from "@/auth/AuthContext";
import { useApi } from "@/lib/useApi";
import { qs } from "@/api";

type IntermediarioRete = {
  rui_collegato: string;
  denominazione: string | null;
  sezione: string | null;
  qualifica: string | null;
  livello: string | null;
  inoperativo: boolean | null;
};

type Estratto = { intermediari: IntermediarioRete[] };

const COLONNE: Colonna<IntermediarioRete>[] = [
  { id: "nome", etichetta: "Nominativo", cella: (r) => r.denominazione || "—" },
  { id: "rui", etichetta: "RUI", cella: (r) => r.rui_collegato },
  { id: "sez", etichetta: "Sez.", cella: (r) => <BadgeSezione sezione={r.sezione} /> },
  { id: "qual", etichetta: "Ruolo", cella: (r) => r.qualifica || "—" },
  { id: "liv", etichetta: "Livello", cella: (r) => r.livello || "—" },
  { id: "stato", etichetta: "Stato", cella: (r) => <BadgeStato inoperativo={r.inoperativo} /> },
];

export function IntermediariClientePage() {
  const { cliente } = useAuth();
  const { data, errore, caricamento } = useApi<Estratto>(
    cliente ? `/api/cliente/estratto${qs({ rui: cliente.rui })}` : null,
  );
  const [q, setQ] = useState("");
  const righe = useMemo(() => {
    const tutte = data?.intermediari ?? [];
    const testo = q.trim().toLowerCase();
    if (!testo) return tutte;
    return tutte.filter(
      (r) =>
        (r.denominazione || "").toLowerCase().includes(testo)
        || r.rui_collegato.toLowerCase().includes(testo)
        || (r.qualifica || "").toLowerCase().includes(testo),
    );
  }, [data, q]);

  return (
    <div className="space-y-4">
      <MessaggioStato caricamento={caricamento} errore={errore} />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca nome, RUI o qualifica" />
      <Tabella
        colonne={COLONNE}
        righe={righe}
        vuoto="Nessun broker o intermediario in questa rete."
        chiave={(r) => `${r.rui_collegato}-${r.qualifica}`}
      />
    </div>
  );
}
