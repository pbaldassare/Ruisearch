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

// Online il job di GitHub parte qualche decina di secondi dopo l'avvio (e poi installa le
// dipendenze): fino a 5 minuti si aspetta che compaia la sua riga nello storico.
const ATTESA_AVVIO_MS = 5 * 60_000;
// L'esito resta in evidenza per un giorno; poi basta lo storico.
const ESITO_RECENTE_MS = 24 * 3600_000;

function EtichettaEsito({ esito }: { esito: string }) {
  const stile =
    esito === "completato"
      ? "bg-primary/10 text-primary"
      : esito === "fallito" || esito === "incompleto"
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
  const storico = useApi<ImportRun[]>(`/api/import-runs?limit=50&giro=${giro}`);
  const [stato, setStato] = useState<StatoAggiornamento | null>(null);
  const [conferma, setConferma] = useState(false);
  const [avvio, setAvvio] = useState(false);
  const [erroreAvvio, setErroreAvvio] = useState<string | null>(null);
  // Online, dopo "Aggiorna ora": quando GitHub ha accettato e quale era l'ultima riga in quel momento.
  const [avviatoIl, setAvviatoIl] = useState<number | null>(null);
  const idPrima = useRef<number | null | undefined>(undefined);
  const eraInCorso = useRef(false);
  const ultimoId = useRef<number | null | undefined>(undefined);
  const visto = useRef(false);

  // Dati in uso: l'ultimo caricamento che ha sostituito il registro ('incompleto' = manca solo la rete).
  const ultimoRiuscito = storico.data?.find((r) => r.esito === "completato" || r.esito === "incompleto");
  const inCorso = Boolean(stato?.in_corso);
  const remoto = Boolean(stato?.remoto);

  const leggiStato = useCallback(async () => {
    try {
      const s = await getJson<StatoAggiornamento>("/api/admin/aggiornamento");
      const id = s.id ?? null;
      // Una riga nuova (il job e' partito) o una corsa appena finita: ricarico lo storico.
      const nuova = ultimoId.current !== undefined && id !== ultimoId.current;
      if (nuova || (eraInCorso.current && !s.in_corso)) setGiro((g) => g + 1);
      if (s.in_corso) visto.current = true;
      ultimoId.current = id;
      eraInCorso.current = s.in_corso;
      setStato(s);
    } catch {
      // La pagina resta usabile anche se lo stato non risponde per un attimo.
    }
  }, []);

  useEffect(() => {
    void leggiStato();
  }, [leggiStato]);

  // Avviato online ma la riga del job non c'e' ancora: si continua a controllare per qualche minuto.
  const adesso = Date.now();
  const stessaRiga = (stato?.id ?? null) === (idPrima.current ?? null);
  // Avviato da qui ma lo stato e' ancora quello della corsa precedente.
  const attesaAvvio = remoto && avviatoIl != null && !inCorso && stessaRiga;
  const inAttesa = attesaAvvio && adesso - avviatoIl < ATTESA_AVVIO_MS;
  const nonPartito = attesaAvvio && adesso - avviatoIl >= ATTESA_AVVIO_MS;
  const segui = inCorso || inAttesa;

  useEffect(() => {
    // Online il caricamento gira su GitHub Actions e scrive fase ed esito nel
    // database: basta controllare ogni 10 secondi. In locale ogni 1,5 s.
    if (!segui) return;
    const t = window.setInterval(() => void leggiStato(), remoto ? 10_000 : 1500);
    return () => window.clearInterval(t);
  }, [segui, remoto, leggiStato]);

  async function avvia(forza = false) {
    setAvvio(true);
    setErroreAvvio(null);
    try {
      const s = await postJson<StatoAggiornamento>("/api/admin/aggiornamento", { forza });
      if (s.remoto) {
        // Online la risposta e' ancora la corsa precedente: si aspetta la riga nuova del job.
        idPrima.current = s.id ?? null;
        ultimoId.current = s.id ?? null;
        setAvviatoIl(Date.now());
      } else {
        visto.current = true;
      }
      eraInCorso.current = s.in_corso;
      setStato(s);
      setConferma(false);
    } catch (err) {
      setErroreAvvio(err instanceof Error ? err.message : "avvio non riuscito");
    } finally {
      setAvvio(false);
    }
  }

  // L'esito si mostra se lo si e' visto arrivare da qui o se e' di oggi (online lo stato e' l'ultima riga).
  const quandoEsito = stato?.concluso_il ?? stato?.iniziato_il;
  const recente = quandoEsito ? adesso - new Date(quandoEsito).getTime() < ESITO_RECENTE_MS : false;
  const finito = stato && !stato.in_corso && !attesaAvvio && stato.esito && (visto.current || recente);
  const finitoMale = stato?.esito === "fallito" || stato?.esito === "incompleto";

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
          sostituisce i dati. Il sito IVASS è lento: di solito servono <b>4–6 minuti</b>, durante i quali
          l'app si usa normalmente. Solo alla fine, per circa un minuto mentre le tabelle vengono
          sostituite, ricerche e schede rispondono «Registro in aggiornamento» e vanno ripetute. Se qualcosa
          va storto prima di quel momento restano i dati di prima.
        </p>

        {inAttesa && stato ? (
          <div className="mt-5 flex gap-3 rounded-2xl bg-primary/10 p-4 text-sm" role="status">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
            <div>
              <p className="font-semibold">Aggiornamento avviato</p>
              <p className="mt-1 text-muted-foreground">
                {stato.messaggio || "Il caricamento gira su GitHub Actions."} Questa pagina si aggiorna da sola;
                puoi anche chiuderla.
              </p>
              {stato.link ? (
                <a className="mt-2 inline-block font-semibold text-primary hover:underline" href={stato.link} target="_blank" rel="noreferrer">
                  Segui l'avanzamento su GitHub
                </a>
              ) : null}
            </div>
          </div>
        ) : inCorso && stato && remoto ? (
          <div className="mt-5">
            <Avanzamento stato={stato} />
            <p className="mt-4 text-xs text-muted-foreground">
              Il caricamento gira su GitHub Actions: puoi chiudere questa pagina.{" "}
              {stato.link ? (
                <a className="font-semibold text-primary hover:underline" href={stato.link} target="_blank" rel="noreferrer">
                  Segui l'avanzamento su GitHub
                </a>
              ) : null}
            </p>
          </div>
        ) : inCorso && stato ? (
          <div className="mt-5">
            <Avanzamento stato={stato} />
            <p className="mt-4 text-xs text-muted-foreground">
              Puoi chiudere questa pagina: l'aggiornamento continua sul server.
            </p>
          </div>
        ) : remoto && !stato?.avviabile && stato?.link ? (
          <div className="mt-5 space-y-2">
            <a
              href={stato.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-glow hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" />
              Avvia su GitHub
            </a>
            <p className="text-xs text-muted-foreground">
              Si apre la pagina del workflow «Aggiorna registro IVASS»: premi «Run workflow». Per avviarlo
              direttamente da qui serve il segreto GITHUB_TOKEN sulla funzione Supabase.
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

        {nonPartito && !conferma ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            GitHub ha accettato la richiesta ma dopo 5 minuti l'aggiornamento non risulta partito.{" "}
            {stato?.link ? (
              <a className="font-semibold underline" href={stato.link} target="_blank" rel="noreferrer">
                Controlla il workflow su GitHub
              </a>
            ) : null}
          </p>
        ) : null}

        {finito && !conferma ? (
          <div
            className={cn(
              "mt-5 flex gap-3 rounded-2xl p-4 text-sm",
              finitoMale ? "bg-destructive/10" : "bg-primary/10",
            )}
            role={finitoMale ? "alert" : "status"}
          >
            {finitoMale ? (
              <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            ) : (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
            )}
            <div className="min-w-0">
              <p className="font-semibold">
                {stato.esito === "completato" && "Aggiornamento completato"}
                {stato.esito === "identico" && "I dati sono già aggiornati"}
                {stato.esito === "fallito" && "Aggiornamento non riuscito"}
                {stato.esito === "incompleto" && "Registro aggiornato, rete non ricostruita"}
              </p>
              <p className="mt-1 break-words text-muted-foreground">
                {stato.esito === "fallito"
                  ? `${stato.errore ?? "errore sconosciuto"}. I dati precedenti sono ancora in uso.`
                  : stato.esito === "incompleto"
                    ? `${stato.errore ?? ""} Riprova l'aggiornamento con «Ricarica comunque».`
                    : stato.esito === "identico"
                      ? "IVASS non ha pubblicato novità rispetto all'ultimo caricamento."
                      : `Concluso in ${durata(stato.iniziato_il, stato.concluso_il)}.`}
              </p>
              {(stato.esito === "identico" || stato.esito === "incompleto") && (!remoto || stato.avviabile) ? (
                <Button size="sm" variant="outline" className="mt-3" disabled={avvio} onClick={() => void avvia(true)}>
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
