import { useState } from "react";
import { Check, KeyRound, Plus, Power, Trash2, X } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { BadgeSezione, MessaggioStato, Tabella, type Colonna } from "@/components/Tabella";
import { useApi, useDebounce } from "@/lib/useApi";
import { postJson, qs, type IntermediarioLista, type Pagina } from "@/api";
import { cn } from "@/lib/cn";

type Operatore = {
  id: number;
  email: string;
  nome: string | null;
  attivo: boolean;
};

type ClienteUtente = {
  id: number;
  rui: string;
  denominazione: string;
  sezione: string | null;
  attivo: boolean;
  operatori: Operatore[];
};

type Elenco = {
  password_default: string;
  utenti: ClienteUtente[];
};

type Creato = {
  ok: boolean;
  password: string;
  cliente: { rui: string; denominazione: string };
  operatore: { email: string; nome: string | null };
};

type Riga = Operatore & { societa: string; rui: string; sezione: string | null };

type Conferma = { id: number; azione: "password" | "elimina" } | null;

export function UtentiPage() {
  const [tick, setTick] = useState(0);
  const { data, errore, caricamento } = useApi<Elenco>(`/api/admin/utenti${qs({ t: tick })}`);
  const [cerca, setCerca] = useState("");
  const cercaDebounced = useDebounce(cerca, 300);
  const [scelto, setScelto] = useState<IntermediarioLista | null>(null);
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [erroreAzione, setErroreAzione] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [conferma, setConferma] = useState<Conferma>(null);

  const { data: trovati } = useApi<Pagina<IntermediarioLista, unknown>>(
    !scelto && cercaDebounced.trim().length >= 2
      ? `/api/intermediari${qs({ q: cercaDebounced.trim(), limit: 8 })}`
      : null,
  );
  const candidati = (trovati?.items ?? []).filter((i) => i.sezione === "A" || i.sezione === "B");
  const password = data?.password_default || "Leone123!";

  const righe: Riga[] = (data?.utenti ?? []).flatMap((c) =>
    c.operatori.map((o) => ({ ...o, societa: c.denominazione, rui: c.rui, sezione: c.sezione })),
  );

  async function azione(fn: () => Promise<string>) {
    setErroreAzione(null);
    setMessaggio(null);
    setInCorso(true);
    try {
      setMessaggio(await fn());
      setConferma(null);
      setTick((n) => n + 1);
    } catch (err) {
      setErroreAzione(err instanceof Error ? err.message : "operazione non riuscita");
    } finally {
      setInCorso(false);
    }
  }

  function crea() {
    if (!scelto || !email.trim()) return;
    void azione(async () => {
      const out = await postJson<Creato>("/api/admin/utenti", {
        rui: scelto.numero_iscrizione_rui,
        email: email.trim(),
        nome: nome.trim() || undefined,
      });
      setEmail("");
      setNome("");
      setScelto(null);
      setCerca("");
      return `Accesso creato per ${out.operatore.email} (${out.cliente.denominazione}). Password: ${out.password}`;
    });
  }

  const colonne: Colonna<Riga>[] = [
    {
      id: "op",
      etichetta: "Operatore",
      cella: (r) => (
        <div className="min-w-0">
          <p className="font-semibold">{r.email}</p>
          {r.nome ? <p className="text-xs text-muted-foreground">{r.nome}</p> : null}
        </div>
      ),
    },
    {
      id: "soc",
      etichetta: "Società",
      cella: (r) => (
        <div className="flex items-center gap-2">
          <BadgeSezione sezione={r.sezione} />
          <span>
            {r.societa} <span className="text-muted-foreground">· {r.rui}</span>
          </span>
        </div>
      ),
    },
    {
      id: "stato",
      etichetta: "Accesso",
      cella: (r) => (
        <span
          className={cn(
            "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
            r.attivo ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground",
          )}
        >
          {r.attivo ? "Attivo" : "Disattivato"}
        </span>
      ),
    },
    {
      id: "azioni",
      etichetta: "",
      classe: "text-right",
      cella: (r) =>
        conferma?.id === r.id ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs font-semibold">
              {conferma.azione === "elimina" ? "Eliminare questo accesso?" : `Reimpostare la password a ${password}?`}
            </span>
            <Button
              size="sm"
              variant={conferma.azione === "elimina" ? "outline" : "default"}
              className={conferma.azione === "elimina" ? "border-destructive text-destructive" : undefined}
              disabled={inCorso}
              onClick={() =>
                void azione(async () => {
                  if (conferma.azione === "elimina") {
                    await postJson("/api/admin/utenti/elimina", { id: r.id });
                    return `Accesso di ${r.email} eliminato. I dati della società restano.`;
                  }
                  const out = await postJson<{ password: string }>("/api/admin/utenti/password", { email: r.email });
                  return `Password di ${r.email} reimpostata a ${out.password}.`;
                })
              }
            >
              <Check className="h-4 w-4" />
              Sì
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConferma(null)} disabled={inCorso}>
              <X className="h-4 w-4" />
              No
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" disabled={inCorso} onClick={() => setConferma({ id: r.id, azione: "password" })}>
              <KeyRound className="h-4 w-4" />
              Reimposta password
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={inCorso}
              onClick={() =>
                void azione(async () => {
                  await postJson("/api/admin/utenti/stato", { id: r.id, attivo: !r.attivo });
                  return r.attivo ? `Accesso di ${r.email} disattivato.` : `Accesso di ${r.email} riattivato.`;
                })
              }
            >
              <Power className="h-4 w-4" />
              {r.attivo ? "Disattiva" : "Riattiva"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10"
              aria-label={`Elimina l'accesso di ${r.email}`}
              disabled={inCorso}
              onClick={() => setConferma({ id: r.id, azione: "elimina" })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <MessaggioStato errore={errore} />
      <Card>
        <h3 className="text-lg font-bold">Nuovo accesso cliente</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Scegli la società (agente o broker) e l’email di chi entrerà. La password iniziale è{" "}
          <span className="font-semibold text-foreground">{password}</span>: comunicala al cliente.
        </p>
        <div className="relative mt-4 max-w-xl">
          <Input
            value={scelto ? `${scelto.denominazione} · ${scelto.numero_iscrizione_rui}` : cerca}
            onChange={(e) => {
              setScelto(null);
              setCerca(e.target.value);
            }}
            placeholder="Cerca la società per nome o RUI"
            aria-label="Società cliente"
          />
          {!scelto && cercaDebounced.trim().length >= 2 ? (
            <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-border bg-card shadow-card">
              {candidati.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Nessun agente o broker trovato.</p>
              ) : (
                candidati.map((i) => (
                  <button
                    key={i.oss}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-secondary"
                    onClick={() => {
                      setScelto(i);
                      setCerca("");
                    }}
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
        <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email dell'operatore"
            aria-label="Email dell'operatore"
          />
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome (facoltativo)"
            aria-label="Nome dell'operatore"
          />
        </div>
        <div className="mt-4">
          <Button disabled={inCorso || !scelto || !email.trim()} onClick={crea}>
            Crea accesso
          </Button>
        </div>
      </Card>

      {erroreAzione ? (
        <p className="text-sm text-destructive" role="alert">
          {erroreAzione}
        </p>
      ) : null}
      {messaggio ? (
        <p className="rounded-2xl bg-primary/10 px-4 py-3 text-sm" role="status">
          {messaggio}
        </p>
      ) : null}

      <Tabella
        colonne={colonne}
        righe={righe}
        vuoto="Nessun accesso cliente. Creane uno qui sopra."
        chiave={(r) => String(r.id)}
        caricamento={caricamento}
      />
    </div>
  );
}
