import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  return r.frase || [r.zona, r.compagnia].filter(Boolean).join(" · ") || "Ricerca";
}

export function IntermediariClientePage() {
  const { cliente } = useAuth();
  const [parametri] = useSearchParams();
  const [vista, setVista] = useState<"rete" | "mercato">(parametri.get("vista") === "rete" ? "rete" : "mercato");
  const { data, errore, caricamento } = useApi<Estratto>(
    cliente ? `/api/cliente/estratto${qs({ rui: cliente.rui })}` : null,
  );
  const [filtroRete, setFiltroRete] = useState("");
  const [frase, setFrase] = useState("");
  const [zona, setZona] = useState("");
  const [compagnia, setCompagnia] = useState("");
  const [sezione, setSezione] = useState("");
  const [notaRicerca, setNotaRicerca] = useState<string | null>(null);
  // null = nessuna ricerca ancora fatta: niente tabella vuota con "nessun risultato".
  const [risultati, setRisultati] = useState<VoceMercato[] | null>(null);
  const [totale, setTotale] = useState<number | null>(null);
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
        setTotale(null);
        setRicercaAttiva(out.ricerca?.id ?? null);
        setNotaRicerca(out.ricerca?.nota || "Ti mostro l'ultima ricerca che hai fatto.");
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
        totale?: number;
        nota?: string | null;
        ricerca_id?: number | string | null;
        filtri?: { zona?: string | null; compagnia?: string | null; sezione?: string[] };
      }>(
        `/api/cliente/mercato${qs({ q: frase, zona, compagnia, sezione, limit: 40, rui: cliente.rui })}`,
      );
      setRisultati(out.items || []);
      setTotale(out.totale ?? null);
      setNotaRicerca(out.nota || null);
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
      setTotale(null);
      setRicercaAttiva(out.ricerca?.id ?? id);
      setNotaRicerca(out.ricerca?.nota || null);
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
    { id: "sub", etichetta: "Collaboratori", classe: "text-right", cella: (r) => String(r.subagenti) },
    {
      id: "az",
      etichetta: "",
      cella: (r) => (
        <Link
          className="inline-flex h-9 items-center whitespace-nowrap rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-secondary"
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
              Trova agenti e broker per zona e compagnia. Con «Apri rete» vedi i loro collaboratori. Le ricerche che
              fai restano qui sotto, pronte da riaprire.
            </p>
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void cerca();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  value={zona}
                  onChange={(e) => setZona(e.target.value)}
                  placeholder="Zona, es. Roma o RM"
                  aria-label="Zona"
                />
                <Input
                  value={compagnia}
                  onChange={(e) => setCompagnia(e.target.value)}
                  placeholder="Compagnia, es. Allianz"
                  aria-label="Compagnia"
                />
                <select
                  className="h-11 rounded-full border border-input bg-card px-4 text-sm"
                  value={sezione}
                  onChange={(e) => setSezione(e.target.value)}
                  aria-label="Tipo di intermediario"
                >
                  <option value="">Broker e agenti</option>
                  <option value="B">Solo broker (B)</option>
                  <option value="A">Solo agenti (A)</option>
                </select>
              </div>
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-semibold text-primary">Oppure scrivilo in una frase</summary>
                <Input
                  className="mt-2"
                  value={frase}
                  onChange={(e) => setFrase(e.target.value)}
                  placeholder="es. agenti a Brescia con Generali"
                  aria-label="Ricerca in una frase"
                />
              </details>
              <div className="mt-4">
                <Button
                  type="submit"
                  disabled={Boolean(busy) || !(zona.trim() || compagnia.trim() || frase.trim())}
                >
                  {busy === "cerca" ? "Cerco…" : "Cerca"}
                </Button>
              </div>
            </form>
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
          {risultati && totale != null && busy !== "cerca" ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{totale.toLocaleString("it-IT")}</span>{" "}
              {totale === 1 ? "intermediario trovato" : "intermediari trovati"}
              {totale > risultati.length ? ` · ti mostro i primi ${risultati.length}: restringi zona o compagnia per vederne altri` : ""}
            </p>
          ) : null}
          {notaRicerca ? <p className="text-sm text-muted-foreground">{notaRicerca}</p> : null}
          {risultati || busy ? (
            <Tabella
              colonne={colonneMercato}
              righe={risultati ?? []}
              vuoto="Nessun intermediario con questi filtri. Prova una zona più ampia o un'altra compagnia."
              chiave={(r) => r.rui}
              caricamento={busy === "cerca" || Boolean(busy?.startsWith("storico"))}
            />
          ) : (
            <Card>
              <p className="text-sm text-muted-foreground">
                Inserisci una zona, una compagnia o entrambe e premi <span className="font-semibold">Cerca</span>.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
