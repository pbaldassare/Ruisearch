import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Database, Loader2, RefreshCw, X } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { Osso } from "@/components/Skeleton";
import { MessaggioStato } from "@/components/Tabella";
import { useApi } from "@/lib/useApi";
import { formatNumero, formatQuando } from "@/lib/format";
import { cn } from "@/lib/cn";
import { getJson, postJson } from "@/api";
import type { FaseAggiornamento, ImportRun, StatoAggiornamento } from "@/api";

const PASSI: { fase: FaseAggiornamento; titolo: string }[] = [
  { fase: "download", titolo: "Download dal sito IVASS" },
  { fase: "validazione", titolo: "Controllo dei file" },
  { fase: "caricamento", titolo: "Caricamento nel database" },
  { fase: "rete", titolo: "Ricostruzione della rete A/B/E" },
];

const ORDINE: FaseAggiornamento[] = ["download", "validazione", "caricamento", "rete", "completato"];

function durata(da: string | null, a: string | null): string {
  if (!da || !a) return "";
  const s = Math.max(0, Math.round((new Date(a).getTime() - new Date(da).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

function EtichettaEsito({ esito }: { esito: string }) {
  const stile =
    esito === "completato"
      ? "bg-primary/10 text-primary"
      : esito === "fallito"
        ? "bg-destructive/10 text-destructive"
        : "bg-secondary text-muted-foreground";
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", stile)}>{esito}</span>
  );
}

function Avanzamento({ stato }: { stato: StatoAggiornamento }) {
  const corrente = stato.fase ? ORDINE.indexOf(stato.fase) : -1;
  return (
    <ol className="space-y-3" aria-live="polite">
      {PASSI.map((passo, i) => {
        const fatto = corrente > i || stato.fase === "completato";
        const attivo = corrente === i && stato.in_corso;
        return (
          <li key={passo.fase} className="flex gap-3">
            <span
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs",
                fatto && "border-primary bg-primary text-primary-foreground",
                attivo && "border-primary text-primary",
                !fatto && !attivo && "border-border text-muted-foreground",
              )}
            >
              {fatto ? (
                <Check className="h-3.5 w-3.5" />
              ) : attivo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                i + 1
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-semibold", !fatto && !attivo && "text-muted-foreground")}>
                {passo.titolo}
              </p>
              {attivo ? (
                <>
                  {stato.percentuale != null ? (
                    <div
                      className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
                      role="progressbar"
                      aria-valuenow={stato.percentuale}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500 ease-smooth"
                        style={{ width: `${stato.percentuale}%` }}
                      />
                    </div>
                  ) : null}
                  {stato.messaggio ? (
                    <p className="mt-1 text-xs text-muted-foreground">{stato.messaggio}</p>
                  ) : null}
                </>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function AggiornamentoPage() {
  const [giro, setGiro] = useState(0);
  const storico = useApi<ImportRun[]>(`/api/import-runs?giro=${giro}`);
  const [stato, setStato] = useState<StatoAggiornamento | null>(null);
  const [conferma, setConferma] = useState(false);
  const [avvio, setAvvio] = useState(false);
  const [erroreAvvio, setErroreAvvio] = useState<string | null>(null);
  const eraInCorso = useRef(false);

  const ultimoRiuscito = storico.data?.find((r) => r.esito === "completato");
  const inCorso = Boolean(stato?.in_corso);

  const leggiStato = useCallback(async () => {
    try {
      const s = await getJson<StatoAggiornamento>("/api/admin/aggiornamento");
      // Appena finisce, ricarico lo storico per mostrare la nuova riga.
      if (eraInCorso.current && !s.in_corso) setGiro((g) => g + 1);
      eraInCorso.current = s.in_corso;
      setStato(s);
    } catch {
      // La pagina resta usabile anche se lo stato non risponde per un attimo.
    }
  }, []);

  useEffect(() => {
    void leggiStato();
  }, [leggiStato]);

  useEffect(() => {
    if (!inCorso) return;
    const t = window.setInterval(() => void leggiStato(), 1500);
    return () => window.clearInterval(t);
  }, [inCorso, leggiStato]);

  async function avvia(forza = false) {
    setAvvio(true);
    setErroreAvvio(null);
    try {
      const s = await postJson<StatoAggiornamento>("/api/admin/aggiornamento", { forza });
      eraInCorso.current = s.in_corso;
      setStato(s);
      setConferma(false);
    } catch (err) {
      setErroreAvvio(err instanceof Error ? err.message : "avvio non riuscito");
    } finally {
      setAvvio(false);
    }
  }

  const finito = stato && !stato.in_corso && stato.esito;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Database className="h-4 w-4" />
          Dati in uso
        </div>
        <MessaggioStato errore={storico.errore} />
        {storico.caricamento && !storico.data ? (
          <>
            <Osso className="mt-3 h-8 w-56 rounded-lg" />
            <Osso className="mt-3 h-4 w-full rounded-full" />
          </>
        ) : ultimoRiuscito ? (
          <>
            <p className="mt-2 font-display text-2xl">
              Aggiornati al {formatQuando(ultimoRiuscito.concluso_il)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatNumero(ultimoRiuscito.righe_totali)} record dall'export ufficiale IVASS
              {ultimoRiuscito.zip_bytes
                ? ` · archivio di ${(ultimoRiuscito.zip_bytes / 1024 / 1024).toFixed(1)} MB`
                : ""}
              .
            </p>
          </>
        ) : !storico.errore ? (
          <>
            <p className="mt-2 font-display text-2xl">Nessun dato caricato</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Avvia il primo aggiornamento per popolare il registro.
            </p>
          </>
        ) : null}
      </Card>

      <Card>
        <h3 className="text-lg font-bold">Aggiorna dal registro IVASS</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Non parte mai in automatico. Scarica l'export pubblicato stanotte da IVASS, lo controlla e
          sostituisce i dati. Il sito IVASS è lento: di solito servono <b>4–6 minuti</b>. Durante
          l'aggiornamento l'app resta utilizzabile e, se qualcosa va storto, restano i dati di prima.
        </p>

        {inCorso && stato ? (
          <div className="mt-5">
            <Avanzamento stato={stato} />
            <p className="mt-4 text-xs text-muted-foreground">
              Puoi chiudere questa pagina: l'aggiornamento continua sul server.
            </p>
          </div>
        ) : conferma ? (
          <div className="mt-5 rounded-2xl border border-border bg-secondary/50 p-4">
            <p className="text-sm font-semibold">Avvio l'aggiornamento adesso?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              I dati attuali vengono sostituiti solo se l'export scaricato supera tutti i controlli.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => void avvia()} disabled={avvio}>
                {avvio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Sì, aggiorna
              </Button>
              <Button variant="outline" onClick={() => setConferma(false)} disabled={avvio}>
                <X className="h-4 w-4" />
                Annulla
              </Button>
            </div>
          </div>
        ) : (
          <Button className="mt-5" onClick={() => setConferma(true)}>
            <RefreshCw className="h-4 w-4" />
            Aggiorna ora
          </Button>
        )}

        {erroreAvvio ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {erroreAvvio}
          </p>
        ) : null}

        {finito && !conferma ? (
          <div
            className={cn(
              "mt-5 flex gap-3 rounded-2xl p-4 text-sm",
              stato.esito === "fallito" ? "bg-destructive/10" : "bg-primary/10",
            )}
            role={stato.esito === "fallito" ? "alert" : "status"}
          >
            {stato.esito === "fallito" ? (
              <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            ) : (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
            )}
            <div className="min-w-0">
              <p className="font-semibold">
                {stato.esito === "completato" && "Aggiornamento completato"}
                {stato.esito === "identico" && "I dati sono già aggiornati"}
                {stato.esito === "fallito" && "Aggiornamento non riuscito"}
              </p>
              <p className="mt-1 break-words text-muted-foreground">
                {stato.esito === "fallito"
                  ? `${stato.errore}. I dati precedenti sono ancora in uso.`
                  : stato.esito === "identico"
                    ? "IVASS non ha pubblicato novità rispetto all'ultimo caricamento."
                    : `Concluso in ${durata(stato.iniziato_il, stato.concluso_il)}.`}
              </p>
              {stato.esito === "identico" ? (
                <Button size="sm" variant="outline" className="mt-3" onClick={() => void avvia(true)}>
                  Ricarica comunque
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>

      {storico.data && storico.data.length > 0 ? (
        <Card className="lg:col-span-2">
          <h3 className="mb-3 text-lg font-bold">Storico aggiornamenti</h3>
          <ul className="divide-y divide-border text-sm">
            {storico.data.map((run) => (
              <li key={run.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold">#{run.id}</span>
                  <EtichettaEsito esito={run.esito} />
                  <span className="text-muted-foreground">
                    {formatQuando(run.concluso_il ?? run.iniziato_il)}
                  </span>
                  <span className="text-muted-foreground">
                    {formatNumero(run.righe_totali)} record
                  </span>
                  {run.concluso_il ? (
                    <span className="text-muted-foreground">
                      {durata(run.iniziato_il, run.concluso_il)}
                    </span>
                  ) : null}
                </div>
                {run.errore ? (
                  <p className="mt-1 break-words text-xs text-destructive">{run.errore}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
