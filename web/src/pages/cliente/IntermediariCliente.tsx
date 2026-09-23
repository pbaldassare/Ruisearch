import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Input } from "@/components/ui";
import { BadgeSezione, BadgeStato, MessaggioStato, Tabella, type Colonna } from "@/components/Tabella";
import { useAuth } from "@/auth/AuthContext";
import { useApi } from "@/lib/useApi";
import { getJson, qs } from "@/api";

type IntermediarioRete = {
  rui_collegato: string;
  denominazione: string | null;
  sezione: string | null;
  qualifica: string | null;
  livello: string | null;
  inoperativo: boolean | null;
};

type Estratto = { intermediari: IntermediarioRete[] };

type VoceMercato = {
  rui: string;
  denominazione: string;
  sezione: string;
  inoperativo: boolean;
  subagenti: number;
  comuni: string | null;
  province: string | null;
};

type RicercaSalvata = {
  id: number | string;
  frase: string | null;
  zona: string | null;
  compagnia: string | null;
  sezione: string | null;
  nota: string | null;
  n: number;
};

const COLONNE_RETE: Colonna<IntermediarioRete>[] = [
  { id: "nome", etichetta: "Nominativo", cella: (r) => r.denominazione || "—" },
  { id: "rui", etichetta: "RUI", cella: (r) => r.rui_collegato },
  { id: "sez", etichetta: "Sez.", cella: (r) => <BadgeSezione sezione={r.sezione} /> },
  { id: "qual", etichetta: "Ruolo", cella: (r) => r.qualifica || "—" },
  { id: "liv", etichetta: "Livello", cella: (r) => r.livello || "—" },
  { id: "stato", etichetta: "Stato", cella: (r) => <BadgeStato inoperativo={r.inoperativo} /> },
];

function etichettaRicerca(r: RicercaSalvata) {
  return [r.frase || [r.zona, r.compagnia].filter(Boolean).join(" · "), `${r.n} nominativi`]
    .filter(Boolean)
    .join(" · ");
}

export function IntermediariClientePage() {
  const { cliente } = useAuth();
  const [vista, setVista] = useState<"rete" | "mercato">("mercato");
  const { data, errore, caricamento } = useApi<Estratto>(
    cliente ? `/api/cliente/estratto${qs({ rui: cliente.rui })}` : null,
  );
  const [filtroRete, setFiltroRete] = useState("");
  const [frase, setFrase] = useState("broker su Roma con Allianz");
  const [zona, setZona] = useState("Roma");
  const [compagnia, setCompagnia] = useState("Allianz");
  const [sezione, setSezione] = useState("");
  const [notaRicerca, setNotaRicerca] = useState<string | null>(null);
  const [risultati, setRisultati] = useState<VoceMercato[]>([]);
  const [ricerche, setRicerche] = useState<RicercaSalvata[]>([]);
  const [ricercaAttiva, setRicercaAttiva] = useState<string | number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [erroreAzione, setErroreAzione] = useState<string | null>(null);

  const reteFiltrata = useMemo(() => {
    const tutte = data?.intermediari ?? [];
    const testo = filtroRete.trim().toLowerCase();
    if (!testo) return tutte;
    return tutte.filter(
      (r) =>
        (r.denominazione || "").toLowerCase().includes(testo)
        || r.rui_collegato.toLowerCase().includes(testo)
        || (r.qualifica || "").toLowerCase().includes(testo),
    );
  }, [data, filtroRete]);

  useEffect(() => {
    if (!cliente) return;
    void getJson<{ ricerche: RicercaSalvata[]; ricerca: RicercaSalvata | null; items: VoceMercato[] }>(
      `/api/cliente/mercato/storico${qs({ rui: cliente.rui })}`,
    ).then((out) => {
      setRicerche(out.ricerche || []);
      if (out.items?.length) {
        setRisultati(out.items);
        setRicercaAttiva(out.ricerca?.id ?? null);
        setNotaRicerca(out.ricerca?.nota || "Ultima ricerca già in archivio.");
        if (out.ricerca?.zona) setZona(out.ricerca.zona);
        if (out.ricerca?.compagnia) setCompagnia(out.ricerca.compagnia);
        if (out.ricerca?.frase) setFrase(out.ricerca.frase);
      }
    }).catch(() => {
      // Lo storico non deve bloccare una nuova ricerca.
    });
  }, [cliente]);

  async function cerca() {
    if (!cliente) return;
    setErroreAzione(null);
    setBusy("cerca");
    try {
      const out = await getJson<{
        items: VoceMercato[];
        nota?: string | null;
        ricerca_id?: number | string | null;
        filtri?: { zona?: string | null; compagnia?: string | null; sezione?: string[] };
      }>(
        `/api/cliente/mercato${qs({ q: frase, zona, compagnia, sezione, limit: 40, rui: cliente.rui })}`,
      );
      setRisultati(out.items || []);
      setNotaRicerca(out.nota || "Ricerca salvata. Stessi filtri non creano doppioni.");
      setRicercaAttiva(out.ricerca_id ?? null);
      if (out.filtri?.zona) setZona(out.filtri.zona);
      if (out.filtri?.compagnia) setCompagnia(out.filtri.compagnia);
      const storico = await getJson<{ ricerche: RicercaSalvata[] }>(
        `/api/cliente/mercato/storico${qs({ rui: cliente.rui })}`,
      );
      setRicerche(storico.ricerche || []);
    } catch (err) {
      setErroreAzione(err instanceof Error ? err.message : "ricerca non riuscita");
    } finally {
      setBusy(null);
    }
  }

  async function apriStorico(id: string | number) {
    if (!cliente) return;
    setErroreAzione(null);
    setBusy(`storico-${id}`);
    try {
      const out = await getJson<{ ricerca: RicercaSalvata | null; items: VoceMercato[] }>(
        `/api/cliente/mercato/storico${qs({ rui: cliente.rui, id })}`,
      );
      setRisultati(out.items || []);
      setRicercaAttiva(out.ricerca?.id ?? id);
      setNotaRicerca(out.ricerca?.nota || "Ricerca già salvata, niente doppioni.");
      if (out.ricerca?.zona) setZona(out.ricerca.zona);
      if (out.ricerca?.compagnia) setCompagnia(out.ricerca.compagnia);
      if (out.ricerca?.frase) setFrase(out.ricerca.frase);
    } catch (err) {
      setErroreAzione(err instanceof Error ? err.message : "archivio non disponibile");
    } finally {
      setBusy(null);
    }
  }

  const linkRete = qs({ zona, compagnia });

  const colonneMercato: Colonna<VoceMercato>[] = [
    { id: "nome", etichetta: "Nominativo", cella: (r) => r.denominazione },
    { id: "rui", etichetta: "RUI", cella: (r) => r.rui },
    { id: "sez", etichetta: "Sez.", cella: (r) => <BadgeSezione sezione={r.sezione} /> },
    { id: "zona", etichetta: "Zona", cella: (r) => [r.comuni, r.province].filter(Boolean).join(" · ") || "—" },
    { id: "sub", etichetta: "Sub-agenti", cella: (r) => String(r.subagenti) },
    {
      id: "az",
      etichetta: "",
      cella: (r) => (
        <Link
          className="inline-flex h-9 items-center rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-secondary"
          to={`/cliente/intermediari/${encodeURIComponent(r.rui)}${linkRete}`}
        >
          Apri rete
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={vista === "mercato" ? "default" : "outline"} onClick={() => setVista("mercato")}>
          Cerca mercato
        </Button>
        <Button type="button" size="sm" variant={vista === "rete" ? "default" : "outline"} onClick={() => setVista("rete")}>
          La tua rete
        </Button>
      </div>

      {vista === "rete" ? (
        <>
          <MessaggioStato errore={errore} />
          <Input value={filtroRete} onChange={(e) => setFiltroRete(e.target.value)} placeholder="Cerca nome, RUI o qualifica" />
          <Tabella
            colonne={COLONNE_RETE}
            righe={reteFiltrata}
            vuoto="Nessun broker o intermediario in questa rete."
            chiave={(r) => `${r.rui_collegato}-${r.qualifica}`}
            caricamento={caricamento}
          />
        </>
      ) : (
        <>
          <Card>
            <p className="text-sm text-muted-foreground">
              Cerca broker e agenti per zona o mandato. «Apri rete» apre la pagina dei sub-agenti. Ogni ricerca resta in database: stessi filtri non creano doppioni.
            </p>
            <div className="mt-4">
              <Input
                value={frase}
                onChange={(e) => setFrase(e.target.value)}
                placeholder="broker su Roma con Allianz"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void cerca();
                }}
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Input value={zona} onChange={(e) => setZona(e.target.value)} placeholder="Zona, es. Roma o RM" />
              <Input value={compagnia} onChange={(e) => setCompagnia(e.target.value)} placeholder="Compagnia, es. Allianz" />
              <select
                className="h-11 rounded-full border border-input bg-card px-4 text-sm"
                value={sezione}
                onChange={(e) => setSezione(e.target.value)}
              >
                <option value="">Broker e agenti</option>
                <option value="B">Solo broker (B)</option>
                <option value="A">Solo agenti (A)</option>
              </select>
            </div>
            <div className="mt-4">
              <Button type="button" disabled={Boolean(busy)} onClick={() => void cerca()}>
                {busy === "cerca" ? "Cerco…" : "Cerca"}
              </Button>
            </div>
          </Card>
          {ricerche.length ? (
            <div className="flex flex-wrap gap-2">
              {ricerche.map((r) => (
                <Button
                  key={String(r.id)}
                  type="button"
                  size="sm"
                  variant={String(ricercaAttiva) === String(r.id) ? "default" : "outline"}
                  disabled={Boolean(busy)}
                  onClick={() => void apriStorico(r.id)}
                >
                  {etichettaRicerca(r)}
                </Button>
              ))}
            </div>
          ) : null}
          {erroreAzione ? <p className="text-sm text-destructive">{erroreAzione}</p> : null}
          {notaRicerca ? <p className="text-sm text-muted-foreground">{notaRicerca}</p> : null}
          <Tabella
            colonne={colonneMercato}
            righe={risultati}
            vuoto="Nessun intermediario per questi filtri. Prova zona o compagnia."
            chiave={(r) => r.rui}
            caricamento={busy === "cerca" || Boolean(busy?.startsWith("storico"))}
          />
        </>
      )}
    </div>
  );
}
