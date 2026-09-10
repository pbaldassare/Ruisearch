import { useMemo, useState } from "react";
import { Bell, Plus, X } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { BadgeSezione, BadgeStato, MessaggioStato, Tabella, type Colonna } from "@/components/Tabella";
import { useAuth } from "@/auth/AuthContext";
import { useApi, useDebounce } from "@/lib/useApi";
import { formatNumero } from "@/lib/format";
import { deleteJson, postJson, qs, type IntermediarioLista, type Pagina } from "@/api";

type Principale = {
  rui: string;
  denominazione: string | null;
  sezione: string | null;
};

type Voce = {
  rui_collegato: string;
  denominazione: string | null;
  sezione: string | null;
  qualifica: string | null;
  inoperativo: boolean | null;
  indice: number;
  stato_relazione: string;
  compagnie: string[];
  altri_principali: Principale[];
};

type Barra = { etichetta: string; valore: number };

type Sorvegliato = {
  id: number;
  rui_broker: string;
  denominazione: string | null;
  sezione: string | null;
  in_rete: number;
};

type AlertRiga = {
  id: number;
  rui_broker: string;
  broker_denominazione: string | null;
  rui_nuovo: string;
  nuovo_denominazione: string | null;
  sezione: string | null;
  letto: boolean;
  creato_il: string;
};

type Payload = {
  sintesi: {
    in_rete: number;
    da_impostare: number;
    da_riattivare: number;
    lavorano_altrove: number;
    compagnie_distinte: number;
    alert_non_letti: number;
  };
  grafici: { compagnie: Barra[]; principali: Barra[] };
  voci: Voce[];
  sorvegliati: Sorvegliato[];
  alert: AlertRiga[];
};

function ChipList({ voci, max = 6 }: { voci: string[]; max?: number }) {
  if (!voci.length) return <span className="text-muted-foreground">—</span>;
  const visibili = voci.slice(0, max);
  const extra = voci.length - visibili.length;
  return (
    <div className="flex max-w-md flex-wrap gap-1">
      {visibili.map((v) => (
        <span key={v} className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
          {v}
        </span>
      ))}
      {extra > 0 ? (
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

function Barre({ titolo, voci, vuoto }: { titolo: string; voci: Barra[]; vuoto: string }) {
  const max = Math.max(...voci.map((v) => v.valore), 1);
  return (
    <Card>
      <p className="text-sm font-semibold">{titolo}</p>
      {voci.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{vuoto}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {voci.map((v) => (
            <div key={v.etichetta}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{v.etichetta}</span>
                <span className="shrink-0 font-semibold">{formatNumero(v.valore)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.max(6, (v.valore / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const COLONNE: Colonna<Voce>[] = [
  { id: "nome", etichetta: "Nominativo", cella: (r) => r.denominazione || "—" },
  { id: "rui", etichetta: "RUI", cella: (r) => r.rui_collegato },
  { id: "sez", etichetta: "Sez.", cella: (r) => <BadgeSezione sezione={r.sezione} /> },
  {
    id: "comp",
    etichetta: "Compagnie",
    cella: (r) => <ChipList voci={r.compagnie} />,
  },
  {
    id: "princ",
    etichetta: "Altri con cui lavora",
    cella: (r) => (
      <ChipList
        voci={r.altri_principali.map((p) => p.denominazione || p.rui)}
      />
    ),
  },
  { id: "stato", etichetta: "Stato RUI", cella: (r) => <BadgeStato inoperativo={r.inoperativo} /> },
];

export function FidelizzazionePage() {
  const { cliente } = useAuth();
  const [tick, setTick] = useState(0);
  const [filtro, setFiltro] = useState("");
  const [cercaBroker, setCercaBroker] = useState("");
  const cercaDebounced = useDebounce(cercaBroker, 300);
  const [azione, setAzione] = useState<string | null>(null);
  const [erroreAzione, setErroreAzione] = useState<string | null>(null);

  const { data, errore, caricamento } = useApi<Payload>(
    cliente ? `/api/cliente/fidelizzazione${qs({ rui: cliente.rui, t: tick })}` : null,
  );
  const { data: trovati } = useApi<Pagina<IntermediarioLista, unknown>>(
    cercaDebounced.trim().length >= 2
      ? `/api/intermediari${qs({ q: cercaDebounced.trim(), limit: 8 })}`
      : null,
  );

  const righe = useMemo(() => {
    const tutte = data?.voci ?? [];
    const testo = filtro.trim().toLowerCase();
    if (!testo) return tutte;
    return tutte.filter((r) => {
      const principali = r.altri_principali.map((p) => p.denominazione || p.rui).join(" ");
      return (
        (r.denominazione || "").toLowerCase().includes(testo)
        || r.rui_collegato.toLowerCase().includes(testo)
        || r.compagnie.join(" ").toLowerCase().includes(testo)
        || principali.toLowerCase().includes(testo)
      );
    });
  }, [data, filtro]);

  const giaSorvegliati = useMemo(
    () => new Set((data?.sorvegliati ?? []).map((s) => s.rui_broker)),
    [data],
  );
  const candidati = (trovati?.items ?? []).filter(
    (i) => i.numero_iscrizione_rui !== cliente?.rui && !giaSorvegliati.has(i.numero_iscrizione_rui),
  );
  const nonLetti = (data?.alert ?? []).filter((a) => !a.letto);
  const letti = (data?.alert ?? []).filter((a) => a.letto);

  async function conAzione(fn: () => Promise<void>) {
    setErroreAzione(null);
    setAzione("in corso");
    try {
      await fn();
      setTick((n) => n + 1);
    } catch (err) {
      setErroreAzione(err instanceof Error ? err.message : "operazione non riuscita");
    } finally {
      setAzione(null);
    }
  }

  function aggiungi(ruiBroker: string) {
    if (!cliente) return;
    void conAzione(async () => {
      await postJson("/api/cliente/sorveglianza", { rui: cliente.rui, rui_broker: ruiBroker });
      setCercaBroker("");
    });
  }

  function togli(ruiBroker: string) {
    if (!cliente) return;
    void conAzione(async () => {
      await deleteJson(`/api/cliente/sorveglianza${qs({ rui: cliente.rui, broker: ruiBroker })}`);
    });
  }

  function leggi(id?: number, tutti = false) {
    if (!cliente) return;
    void conAzione(async () => {
      await postJson("/api/cliente/alert", { rui: cliente.rui, id, tutti });
    });
  }

  return (
    <div className="space-y-6">
      <MessaggioStato caricamento={caricamento} errore={errore} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <p className="text-sm text-muted-foreground">In rete</p>
          <p className="mt-1 font-display text-3xl">{data ? formatNumero(data.sintesi.in_rete) : "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Lavorano anche altrove</p>
          <p className="mt-1 font-display text-3xl">
            {data ? formatNumero(data.sintesi.lavorano_altrove) : "—"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Compagnie distinte</p>
          <p className="mt-1 font-display text-3xl">
            {data ? formatNumero(data.sintesi.compagnie_distinte) : "—"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Avvisi da leggere</p>
          <p className="mt-1 font-display text-3xl">
            {data ? formatNumero(data.sintesi.alert_non_letti) : "—"}
          </p>
        </Card>
      </div>

      {nonLetti.length > 0 ? (
        <Card className="border-primary/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Nuovi iscritti sotto i broker sorvegliati</p>
            </div>
            <Button size="sm" variant="outline" disabled={Boolean(azione)} onClick={() => leggi(undefined, true)}>
              Segna tutti come letti
            </Button>
          </div>
          <ul className="mt-4 space-y-3">
            {nonLetti.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-secondary/60 px-4 py-3">
                <p className="text-sm">
                  <span className="font-semibold">{a.nuovo_denominazione || a.rui_nuovo}</span>
                  {a.sezione ? ` · sez. ${a.sezione}` : ""} si è iscritto sotto{" "}
                  <span className="font-semibold">{a.broker_denominazione || a.rui_broker}</span>
                  {" "}({a.rui_nuovo})
                </p>
                <Button size="sm" variant="ghost" disabled={Boolean(azione)} onClick={() => leggi(a.id)}>
                  Letto
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Barre
          titolo="Compagnie con cui lavorano"
          voci={data?.grafici.compagnie ?? []}
          vuoto="Nessuna compagnia in registro sui mandati della rete o degli altri intermediari con cui lavorano."
        />
        <Barre
          titolo="Altri intermediari con cui lavorano"
          voci={data?.grafici.principali ?? []}
          vuoto="Nessun altro principale A/B/E: in registro la rete risulta solo sotto di te."
        />
      </div>

      <Card>
        <p className="text-sm font-semibold">Broker da sorvegliare</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Aggiungi un broker: alla prima volta memorizziamo chi ha già sotto. Quando qualcuno nuovo si iscrive sotto di lui, compare un avviso.
        </p>
        <div className="relative mt-4 max-w-xl">
          <Input
            value={cercaBroker}
            onChange={(e) => setCercaBroker(e.target.value)}
            placeholder="Cerca broker per nome o RUI"
          />
          {cercaDebounced.trim().length >= 2 ? (
            <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-border bg-card shadow-card">
              {candidati.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Nessun intermediario A/B/E da aggiungere.</p>
              ) : (
                candidati.map((i) => (
                  <button
                    key={i.oss}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-secondary"
                    disabled={Boolean(azione)}
                    onClick={() => aggiungi(i.numero_iscrizione_rui)}
                  >
                    <span>
                      <span className="font-semibold">{i.denominazione}</span>
                      <span className="ml-2 text-muted-foreground">{i.numero_iscrizione_rui}</span>
                    </span>
                    <Plus className="h-4 w-4 text-primary" />
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
        {erroreAzione ? <p className="mt-3 text-sm text-destructive">{erroreAzione}</p> : null}
        <div className="mt-4 space-y-2">
          {(data?.sorvegliati ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun broker in sorveglianza.</p>
          ) : (
            (data?.sorvegliati ?? []).map((s) => (
              <div
                key={s.rui_broker}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-secondary/50 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold">{s.denominazione || s.rui_broker}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.rui_broker}
                    {s.sezione ? ` · sez. ${s.sezione}` : ""}
                    {" · "}
                    {formatNumero(s.in_rete)} iscritti A/B/E sotto di lui
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(azione)}
                  onClick={() => togli(s.rui_broker)}
                >
                  <X className="h-4 w-4" />
                  Togli
                </Button>
              </div>
            ))
          )}
        </div>
        {letti.length > 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            {formatNumero(letti.length)} avvisi già letti restano in storico.
          </p>
        ) : null}
      </Card>

      <Input
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Filtra la rete per nome, compagnia o altro intermediario"
      />
      <Tabella
        colonne={COLONNE}
        righe={righe}
        vuoto="Nessun nominativo in rete da fidelizzare."
        chiave={(r) => r.rui_collegato}
      />
    </div>
  );
}
