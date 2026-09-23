import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { BadgeSezione, MessaggioStato, Tabella, type Colonna } from "@/components/Tabella";
import { useApi, useDebounce } from "@/lib/useApi";
import { postJson, qs, type IntermediarioLista, type Pagina } from "@/api";

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

const COLONNE: Colonna<ClienteUtente>[] = [
  { id: "nome", etichetta: "Società", cella: (r) => r.denominazione },
  { id: "rui", etichetta: "RUI", cella: (r) => r.rui },
  { id: "sez", etichetta: "Sez.", cella: (r) => <BadgeSezione sezione={r.sezione} /> },
  {
    id: "op",
    etichetta: "Operatori",
    cella: (r) =>
      r.operatori.length
        ? r.operatori.map((o) => o.email).join(" · ")
        : "—",
  },
];

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
  const [creato, setCreato] = useState<Creato | null>(null);

  const { data: trovati } = useApi<Pagina<IntermediarioLista, unknown>>(
    !scelto && cercaDebounced.trim().length >= 2
      ? `/api/intermediari${qs({ q: cercaDebounced.trim(), limit: 8 })}`
      : null,
  );
  const candidati = (trovati?.items ?? []).filter((i) => i.sezione === "A" || i.sezione === "B");
  const password = data?.password_default || "Leone123!";

  async function crea() {
    if (!scelto || !email.trim()) return;
    setErroreAzione(null);
    setCreato(null);
    setInCorso(true);
    try {
      const out = await postJson<Creato>("/api/admin/utenti", {
        rui: scelto.numero_iscrizione_rui,
        email: email.trim(),
        nome: nome.trim() || undefined,
      });
      setCreato(out);
      setEmail("");
      setNome("");
      setScelto(null);
      setCerca("");
      setTick((n) => n + 1);
    } catch (err) {
      setErroreAzione(err instanceof Error ? err.message : "creazione non riuscita");
    } finally {
      setInCorso(false);
    }
  }

  async function reimposta(indirizzo: string) {
    setErroreAzione(null);
    setInCorso(true);
    try {
      const out = await postJson<Creato>("/api/admin/utenti/password", { email: indirizzo });
      setCreato({
        ok: true,
        password: out.password,
        cliente: { rui: "", denominazione: "" },
        operatore: { email: indirizzo, nome: null },
      });
    } catch (err) {
      setErroreAzione(err instanceof Error ? err.message : "reset non riuscito");
    } finally {
      setInCorso(false);
    }
  }

  return (
    <div className="space-y-6">
      <MessaggioStato errore={errore} />
      <Card>
        <p className="text-sm font-semibold">Nuovo utente cliente</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Scegli una società A o B, indica l’email dell’operatore. La password è sempre{" "}
          <span className="font-semibold text-foreground">{password}</span>, assegnata in automatico.
        </p>
        <div className="relative mt-4 max-w-xl">
          <Input
            value={scelto ? `${scelto.denominazione} · ${scelto.numero_iscrizione_rui}` : cerca}
            onChange={(e) => {
              setScelto(null);
              setCerca(e.target.value);
            }}
            placeholder="Cerca società per nome o RUI"
          />
          {!scelto && cercaDebounced.trim().length >= 2 ? (
            <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-border bg-card shadow-card">
              {candidati.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Nessuna iscrizione A/B.</p>
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
        <div className="mt-4 grid gap-3 sm:grid-cols-2 max-w-xl">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email operatore"
          />
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome (facoltativo)"
          />
        </div>
        <div className="mt-4">
          <Button disabled={inCorso || !scelto || !email.trim()} onClick={() => void crea()}>
            Crea utente
          </Button>
        </div>
        {erroreAzione ? <p className="mt-3 text-sm text-destructive">{erroreAzione}</p> : null}
        {creato ? (
          <p className="mt-3 text-sm">
            Pronto: <span className="font-semibold">{creato.operatore.email}</span>
            {creato.cliente.denominazione ? ` · ${creato.cliente.denominazione}` : ""}
            {" · password "}
            <span className="font-semibold">{creato.password}</span>
          </p>
        ) : null}
      </Card>

      <Tabella
        colonne={[
          ...COLONNE,
          {
            id: "reset",
            etichetta: "",
            cella: (r) =>
              r.operatori[0] ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={inCorso}
                  onClick={() => void reimposta(r.operatori[0].email)}
                >
                  Password {password}
                </Button>
              ) : null,
          },
        ]}
        righe={data?.utenti ?? []}
        vuoto="Nessun utente cliente. Creane uno sopra."
        chiave={(r) => String(r.id)}
        caricamento={caricamento}
      />
    </div>
  );
}
