import { useMemo, useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { BadgeSezione, BadgeStato, MessaggioStato, Tabella, type Colonna } from "@/components/Tabella";
import { useAuth } from "@/auth/AuthContext";
import { useApi } from "@/lib/useApi";
import { getJson, postJson, qs } from "@/api";

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

type SchedaMercato = {
  soggetto: { numero_iscrizione_rui: string; denominazione: string; sezione: string };
  sedi: Array<{ indirizzo_sede: string | null; comune_sede: string | null; provincia_sede: string | null }>;
  mandati: Array<{ ragione_sociale: string | null }>;
  collaboratori: IntermediarioRete[];
};

const COLONNE_RETE: Colonna<IntermediarioRete>[] = [
  { id: "nome", etichetta: "Nominativo", cella: (r) => r.denominazione || "—" },
  { id: "rui", etichetta: "RUI", cella: (r) => r.rui_collegato },
  { id: "sez", etichetta: "Sez.", cella: (r) => <BadgeSezione sezione={r.sezione} /> },
  { id: "qual", etichetta: "Ruolo", cella: (r) => r.qualifica || "—" },
  { id: "liv", etichetta: "Livello", cella: (r) => r.livello || "—" },
  { id: "stato", etichetta: "Stato", cella: (r) => <BadgeStato inoperativo={r.inoperativo} /> },
];

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
  const [scheda, setScheda] = useState<SchedaMercato | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [erroreAzione, setErroreAzione] = useState<string | null>(null);
  const [okAzione, setOkAzione] = useState<string | null>(null);

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

  async function cerca() {
    setErroreAzione(null);
    setOkAzione(null);
    setScheda(null);
    setBusy("cerca");
    try {
      const out = await getJson<{
        items: VoceMercato[];
        nota?: string | null;
        filtri?: { zona?: string | null; compagnia?: string | null; sezione?: string[] };
      }>(
        `/api/cliente/mercato${qs({ q: frase, zona, compagnia, sezione, limit: 40 })}`,
      );
      setRisultati(out.items || []);
      setNotaRicerca(out.nota || null);
      if (out.filtri?.zona) setZona(out.filtri.zona);
      if (out.filtri?.compagnia) setCompagnia(out.filtri.compagnia);
    } catch (err) {
      setErroreAzione(err instanceof Error ? err.message : "ricerca non riuscita");
    } finally {
      setBusy(null);
    }
  }

  async function apri(rui: string) {
    setErroreAzione(null);
    setBusy(`scheda-${rui}`);
    try {
      const out = await getJson<SchedaMercato>(`/api/cliente/mercato/scheda${qs({ rui })}`);
      setScheda(out);
    } catch (err) {
      setErroreAzione(err instanceof Error ? err.message : "scheda non disponibile");
    } finally {
      setBusy(null);
    }
  }

  async function arricchisci(ruiTarget: string, ruiBroker?: string) {
    if (!cliente) return;
    setErroreAzione(null);
    setOkAzione(null);
    setBusy(`ai-${ruiTarget}`);
    try {
      const out = await postJson<{ recapiti: unknown[]; sintesi: string }>(
        "/api/cliente/opportunity/arricchisci",
        {
          rui: cliente.rui,
          rui_target: ruiTarget,
          rui_broker: ruiBroker,
          zona,
          compagnia,
        },
      );
      setOkAzione(
        `Salvato in Opportunity: ${out.sintesi || ruiTarget}. Recapiti: ${out.recapiti?.length ?? 0}.`,
      );
    } catch (err) {
      setErroreAzione(err instanceof Error ? err.message : "arricchimento non riuscito");
    } finally {
      setBusy(null);
    }
  }

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
        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void apri(r.rui)}>
          Apri rete
        </Button>
      ),
    },
  ];

  const colonneSub: Colonna<IntermediarioRete>[] = [
    ...COLONNE_RETE,
    {
      id: "ai",
      etichetta: "",
      cella: (r) => (
        <Button
          size="sm"
          disabled={Boolean(busy)}
          onClick={() => void arricchisci(r.rui_collegato, scheda?.soggetto.numero_iscrizione_rui)}
        >
          {busy === `ai-${r.rui_collegato}` ? "Cerco…" : "Cerca recapiti"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={vista === "mercato" ? "default" : "outline"} onClick={() => setVista("mercato")}>
          Cerca mercato
        </Button>
        <Button size="sm" variant={vista === "rete" ? "default" : "outline"} onClick={() => setVista("rete")}>
          La tua rete
        </Button>
      </div>

      {vista === "rete" ? (
        <>
          <MessaggioStato caricamento={caricamento} errore={errore} />
          <Input value={filtroRete} onChange={(e) => setFiltroRete(e.target.value)} placeholder="Cerca nome, RUI o qualifica" />
          <Tabella
            colonne={COLONNE_RETE}
            righe={reteFiltrata}
            vuoto="Nessun broker o intermediario in questa rete."
            chiave={(r) => `${r.rui_collegato}-${r.qualifica}`}
          />
        </>
      ) : (
        <>
          <Card>
            <p className="text-sm text-muted-foreground">
              Cerca broker e agenti per zona o mandato, tipo «broker su Roma con Allianz». Apri la rete, poi cerca i recapiti sul web: si salvano in Opportunity.
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
              <Button disabled={Boolean(busy)} onClick={() => void cerca()}>
                {busy === "cerca" ? "Cerco…" : "Cerca"}
              </Button>
            </div>
          </Card>
          {erroreAzione ? <p className="text-sm text-destructive">{erroreAzione}</p> : null}
          {okAzione ? <p className="text-sm text-primary">{okAzione}</p> : null}
          {notaRicerca ? <p className="text-sm text-muted-foreground">{notaRicerca}</p> : null}
          <Tabella
            colonne={colonneMercato}
            righe={risultati}
            vuoto="Nessun intermediario per questi filtri. Prova zona o compagnia."
            chiave={(r) => r.rui}
          />
          {scheda ? (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">{scheda.soggetto.denominazione}</h3>
                  <p className="text-sm text-muted-foreground">
                    {scheda.soggetto.numero_iscrizione_rui} · sez. {scheda.soggetto.sezione}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => void arricchisci(scheda.soggetto.numero_iscrizione_rui)}
                >
                  Cerca recapiti del broker
                </Button>
              </div>
              {scheda.sedi?.length ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Sedi: {scheda.sedi.map((s) => [s.indirizzo_sede, s.comune_sede, s.provincia_sede].filter(Boolean).join(", ")).join(" · ")}
                </p>
              ) : null}
              {scheda.mandati?.length ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Mandati: {scheda.mandati.slice(0, 8).map((m) => m.ragione_sociale).filter(Boolean).join(" · ")}
                </p>
              ) : null}
              <p className="mt-4 text-sm font-semibold">Sub-agenti / collaboratori</p>
              <div className="mt-2">
                <Tabella
                  colonne={colonneSub}
                  righe={scheda.collaboratori}
                  vuoto="Nessun collaboratore A/B/E sotto questo intermediario."
                  chiave={(r) => r.rui_collegato}
                />
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
