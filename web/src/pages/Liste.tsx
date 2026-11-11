import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Download, Loader2, Search } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { SkeletonCard, SkeletonKpi, SkeletonScheda } from "@/components/Skeleton";
import { BadgeSezione, BadgeStato, MessaggioStato, Tabella, type Colonna } from "@/components/Tabella";
import {
  getJson,
  qs,
  scaricaFile,
  type CaricaRiga,
  type IntermediarioLista,
  type MandatoRiga,
  type Pagina,
  type Rete,
  type Scheda,
  type SedeRiga,
} from "@/api";
import { MappaSedi } from "@/components/MappaSedi";
import { useApi, useDebounce } from "@/lib/useApi";
import { formatData, formatNumero } from "@/lib/format";
import { cn } from "@/lib/cn";

const MASSIMO_EXPORT = 5000;

/**
 * Un parametro di ricerca salvato nell'indirizzo: tornando indietro dalla
 * scheda lo ritrovi. Il campo tiene il testo in locale e l'indirizzo si
 * aggiorna solo quando smetti di scrivere, cosi' non si perdono lettere.
 */
function useParametro(nome: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  const daUrl = params.get(nome) ?? "";
  const [valore, setValore] = useState(daUrl);
  const ritardato = useDebounce(valore, 300);
  const ultimoScritto = useRef(daUrl);

  // Indirizzo cambiato da fuori (es. tasto indietro): aggiorno il campo.
  useEffect(() => {
    if (daUrl !== ultimoScritto.current) {
      ultimoScritto.current = daUrl;
      setValore(daUrl);
    }
  }, [daUrl]);

  useEffect(() => {
    if (ritardato === ultimoScritto.current) return;
    ultimoScritto.current = ritardato;
    setParams(
      (prima) => {
        const nuovi = new URLSearchParams(prima);
        if (ritardato) nuovi.set(nome, ritardato);
        else nuovi.delete(nome);
        return nuovi;
      },
      { replace: true },
    );
  }, [ritardato, nome, setParams]);

  const imposta = useCallback((v: string) => setValore(v), []);
  return [valore, imposta];
}

function CampoRicerca({
  valore,
  onChange,
  placeholder,
  etichetta,
}: {
  valore: string;
  onChange: (v: string) => void;
  placeholder: string;
  etichetta: string;
}) {
  return (
    <div className="relative w-full sm:w-[28rem]">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        className="pl-11"
        value={valore}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={etichetta}
      />
    </div>
  );
}

function FiltroSezione({ valore, onChange }: { valore: string; onChange: (v: string) => void }) {
  return (
    <select
      className="h-11 rounded-full border border-input bg-card px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={valore}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Sezione"
    >
      <option value="">Tutte le sezioni</option>
      <option value="A">A · agenti</option>
      <option value="B">B · broker</option>
      <option value="E">E · collaboratori</option>
    </select>
  );
}

/** Totale dei risultati ed export CSV, sopra ogni tabella. */
function BarraRisultati({
  totale,
  mostrati,
  csv,
  nota,
}: {
  totale: number | null | undefined;
  mostrati: number;
  csv: string;
  nota?: string;
}) {
  const [scarico, setScarico] = useState(false);
  const [erroreScarico, setErroreScarico] = useState<string | null>(null);
  if (totale == null) return null;

  async function scarica() {
    setScarico(true);
    setErroreScarico(null);
    try {
      await scaricaFile(csv);
    } catch (err) {
      setErroreScarico(err instanceof Error ? err.message : "download non riuscito");
    } finally {
      setScarico(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">
        <span className="font-semibold text-foreground">{formatNumero(totale)}</span>{" "}
        {totale === 1 ? "risultato" : "risultati"}
        {mostrati < totale ? ` · ne vedi ${formatNumero(mostrati)}` : ""}
        {nota ? ` · ${nota}` : ""}
      </p>
      {totale > 0 ? (
        <div className="flex items-center gap-2">
          {erroreScarico ? <span className="text-destructive">{erroreScarico}</span> : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void scarica()}
            disabled={scarico}
            title={totale > MASSIMO_EXPORT ? `Scarica i primi ${formatNumero(MASSIMO_EXPORT)}` : undefined}
          >
            {scarico ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Scarica CSV
            {totale > MASSIMO_EXPORT ? (
              <span className="text-muted-foreground">(primi {formatNumero(MASSIMO_EXPORT)})</span>
            ) : null}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Prima pagina dalla API, pagine successive accodate con "Altri risultati". */
function usePaginato<T, C extends Record<string, string>>(base: string, filtri: Record<string, string>) {
  const percorso = `${base}${qs(filtri)}`;
  const { data, errore, caricamento } = useApi<Pagina<T, C>>(percorso);
  const [accodati, setAccodati] = useState<T[]>([]);
  const [coda, setCoda] = useState<C | null | undefined>(undefined);
  const [inCarico, setInCarico] = useState(false);

  useEffect(() => {
    setAccodati([]);
    setCoda(undefined);
  }, [percorso]);

  const righe = useMemo(() => [...(data?.items ?? []), ...accodati], [data, accodati]);
  const prossimo = coda === undefined ? data?.prossimo : coda;

  async function altre() {
    if (!prossimo) return;
    setInCarico(true);
    try {
      const extra = await getJson<Pagina<T, C>>(`${base}${qs({ ...filtri, ...prossimo })}`);
      setAccodati((prev) => [...prev, ...extra.items]);
      setCoda(extra.prossimo);
    } finally {
      setInCarico(false);
    }
  }

  return {
    righe,
    totale: data?.totale,
    prossimo,
    altre,
    inCarico,
    errore,
    caricamento,
    csv: `${base}${qs({ ...filtri, formato: "csv" })}`,
  };
}

function AltriRisultati({ visibile, inCarico, onClick }: { visibile: boolean; inCarico: boolean; onClick: () => void }) {
  if (!visibile) return null;
  return (
    <Button variant="outline" onClick={onClick} disabled={inCarico}>
      {inCarico ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      Altri risultati
    </Button>
  );
}

function LinkRui({ rui, children }: { rui: string; children?: ReactNode }) {
  return (
    <Link className="font-semibold text-primary hover:underline" to={`/app/intermediari/${rui}`}>
      {children ?? rui}
    </Link>
  );
}

export function IntermediariPage() {
  const [q, setQ] = useParametro("q");
  const [sezione, setSezione] = useParametro("sezione");
  const cerca = useDebounce(q);
  const elenco = usePaginato<IntermediarioLista, { dopo_nome: string; dopo_oss: string }>(
    "/api/intermediari",
    { q: cerca, sezione },
  );

  const colonne: Colonna<IntermediarioLista>[] = [
    { id: "rui", etichetta: "RUI", cella: (r) => <LinkRui rui={r.numero_iscrizione_rui} /> },
    {
      id: "nome",
      etichetta: "Denominazione",
      cella: (r) => <LinkRui rui={r.numero_iscrizione_rui}>{r.denominazione || "—"}</LinkRui>,
    },
    { id: "sez", etichetta: "Sez.", cella: (r) => <BadgeSezione sezione={r.sezione} /> },
    { id: "data", etichetta: "Iscrizione", cella: (r) => formatData(r.data_iscrizione) },
    { id: "stato", etichetta: "Stato", cella: (r) => <BadgeStato inoperativo={r.inoperativo} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <CampoRicerca
          valore={q}
          onChange={setQ}
          placeholder="Nome, ragione sociale o numero RUI"
          etichetta="Cerca intermediari"
        />
        <FiltroSezione valore={sezione} onChange={setSezione} />
      </div>
      <MessaggioStato errore={elenco.errore} />
      {!elenco.caricamento ? (
        <BarraRisultati
          totale={elenco.totale}
          mostrati={elenco.righe.length}
          csv={elenco.csv}
          nota={cerca && !elenco.prossimo && (elenco.totale ?? 0) > elenco.righe.length ? "i più pertinenti" : undefined}
        />
      ) : null}
      <Tabella
        colonne={colonne}
        righe={elenco.righe}
        vuoto={cerca ? `Nessun intermediario trovato per «${cerca}».` : "Nessun intermediario."}
        chiave={(r) => `${r.oss}`}
        caricamento={elenco.caricamento}
      />
      <AltriRisultati visibile={Boolean(elenco.prossimo)} inCarico={elenco.inCarico} onClick={() => void elenco.altre()} />
    </div>
  );
}

type CaricaPersona = {
  chiave: string;
  persona: string;
  persona_rui: string | null;
  qualifiche: string[];
  societa: string | null;
  societa_rui: string | null;
};

/** Una riga per persona e societa', con tutti i ruoli insieme. */
function raggruppaCariche(cariche: Scheda["cariche"]): CaricaPersona[] {
  const mappa = new Map<string, CaricaPersona>();
  for (const c of cariche) {
    const persona = c.persona || c.persona_rui || "—";
    const chiave = `${c.persona_rui ?? persona}|${c.societa_rui ?? ""}`;
    const voce = mappa.get(chiave) ?? {
      chiave,
      persona,
      persona_rui: c.persona_rui,
      qualifiche: [],
      societa: c.societa,
      societa_rui: c.societa_rui,
    };
    const q = c.qualifica || "Carica";
    if (!voce.qualifiche.includes(q)) voce.qualifiche.push(q);
    mappa.set(chiave, voce);
  }
  return [...mappa.values()].sort((a, b) => b.qualifiche.length - a.qualifiche.length || a.persona.localeCompare(b.persona));
}

export function IntermediarioPage() {
  const { rui = "" } = useParams();
  const { data, errore, caricamento } = useApi<Scheda>(rui ? `/api/intermediari/${encodeURIComponent(rui)}` : null);
  const { data: cfg } = useApi<{ maps_key: string }>("/api/config");
  const s = data?.soggetto;
  const cariche = useMemo(() => raggruppaCariche(data?.cariche ?? []), [data]);
  const nascita = s
    ? [s.comune_nascita, s.provincia_nascita ? `(${s.provincia_nascita})` : "", s.data_nascita ? formatData(s.data_nascita) : ""]
        .filter(Boolean)
        .join(" ")
    : "";

  return (
    <div className="space-y-4">
      <MessaggioStato errore={errore} />
      {caricamento ? (
        <>
          <SkeletonScheda />
          <div className="grid gap-3 sm:grid-cols-3">
            <SkeletonKpi conIcona={false} />
            <SkeletonKpi conIcona={false} />
            <SkeletonKpi conIcona={false} />
          </div>
          <SkeletonCard righe={3} />
          <SkeletonCard righe={2} />
        </>
      ) : null}
      {s ? (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{s.numero_iscrizione_rui}</p>
                <h3 className="break-words font-display text-2xl">{s.denominazione}</h3>
              </div>
              <div className="flex items-center gap-2">
                <BadgeSezione sezione={s.sezione} />
                <BadgeStato inoperativo={s.inoperativo} />
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Iscritto dal</dt>
                <dd className="font-semibold">{formatData(s.data_iscrizione)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Natura</dt>
                <dd className="font-semibold">{s.persona_giuridica ? "Società" : "Persona fisica"}</dd>
              </div>
              {nascita ? (
                <div>
                  <dt className="text-muted-foreground">{s.persona_giuridica ? "Costituzione" : "Nascita"}</dt>
                  <dd className="font-semibold">{nascita}</dd>
                </div>
              ) : null}
              {s.stato ? (
                <div>
                  <dt className="text-muted-foreground">Stato</dt>
                  <dd className="font-semibold">{s.stato}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          {data.numeri ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {data.profilo === "azienda" ? (
                <>
                  <KpiMini label="Intermediari in rete" valore={data.numeri.intermediari} />
                  <KpiMini label="Collaborazioni" valore={data.numeri.collaborazioni} />
                  <KpiMini label="Mandati" valore={data.numeri.mandati} />
                </>
              ) : (
                <>
                  <KpiMini label="Mandati propri" valore={data.numeri.mandati} />
                  <KpiMini label="Mandati via principali" valore={data.mandati_via_principali?.length ?? 0} />
                  <KpiMini label="Principali" valore={data.rete.principali.length} />
                </>
              )}
            </div>
          ) : null}

          {data.profilo === "azienda" && data.mappa && data.mappa.length > 0 ? (
            <Card>
              <h3 className="mb-3 text-lg font-bold">Mappa sedi</h3>
              {cfg?.maps_key ? (
                <MappaSedi punti={data.mappa} mapsKey={cfg.maps_key} />
              ) : (
                <p className="text-sm text-muted-foreground">La mappa non è disponibile: manca la chiave Google Maps sul server.</p>
              )}
            </Card>
          ) : null}

          <Blocco titolo="Sedi" vuoto="Nessuna sede in registro.">
            {data.sedi.map((sede, i) => (
              <p key={`${sede.indirizzo_sede}-${i}`}>
                <span className="font-semibold">{sede.tipo_sede || "Sede"}</span>
                {" · "}
                {[sede.indirizzo_sede, sede.cap_sede, sede.comune_sede, sede.provincia_sede ? `(${sede.provincia_sede})` : ""]
                  .filter(Boolean)
                  .join(" ")}
              </p>
            ))}
          </Blocco>

          <Blocco
            titolo="Mandati propri"
            vuoto={
              s.sezione === "B"
                ? "Nessun mandato intestato: per un broker è normale."
                : "Nessun mandato intestato a questo RUI."
            }
          >
            {data.mandati.map((m, i) => (
              <p key={`${m.codice_compagnia}-${i}`}>
                {m.ragione_sociale || "—"} {m.codice_compagnia ? <span className="text-muted-foreground">({m.codice_compagnia})</span> : null}
              </p>
            ))}
          </Blocco>

          {data.mandati_via_principali && data.mandati_via_principali.length > 0 ? (
            <Blocco titolo="Mandati tramite i principali" vuoto="">
              {data.mandati_via_principali.map((m, i) => (
                <p key={`${m.rui_principale}-${m.codice_compagnia}-${i}`}>
                  {m.ragione_sociale || "—"} tramite <LinkRui rui={m.rui_principale}>{m.principale || m.rui_principale}</LinkRui>
                  {m.sezione_principale ? <span className="text-muted-foreground"> · sez. {m.sezione_principale}</span> : null}
                </p>
              ))}
            </Blocco>
          ) : null}

          <Blocco titolo={cariche.length ? `Cariche · ${cariche.length} persone` : "Cariche"} vuoto="Nessuna carica in registro.">
            {cariche.map((c) => (
              <div key={c.chiave} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {c.persona_rui ? <LinkRui rui={c.persona_rui}>{c.persona}</LinkRui> : <span className="font-semibold">{c.persona}</span>}
                <span className="flex flex-wrap gap-1">
                  {c.qualifiche.map((q) => (
                    <span key={q} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                      {q}
                    </span>
                  ))}
                </span>
                {c.societa_rui && c.societa_rui !== s.numero_iscrizione_rui ? (
                  <span className="text-muted-foreground">
                    presso <LinkRui rui={c.societa_rui}>{c.societa || c.societa_rui}</LinkRui>
                  </span>
                ) : null}
              </div>
            ))}
          </Blocco>

          {data.siti_internet.length > 0 ? (
            <Blocco titolo="Siti" vuoto="">
              {data.siti_internet.map((url) => (
                <p key={url}>
                  <a
                    className="break-all text-primary hover:underline"
                    href={/^https?:\/\//i.test(url) ? url : `https://${url}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {url}
                  </a>
                </p>
              ))}
            </Blocco>
          ) : null}

          <Card>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold">Rete</h3>
              <Link
                className="text-sm font-semibold text-primary hover:underline"
                to={`/app/rete?rui=${encodeURIComponent(s.numero_iscrizione_rui)}`}
              >
                Apri nella pagina Rete
              </Link>
            </div>
            <ListeRete principali={data.rete.principali} collaboratori={data.rete.collaboratori} />
          </Card>

          {data.contatti.length > 0 ? (
            <Blocco titolo="Recapiti già raccolti" vuoto="">
              {data.contatti.map((c) => (
                <p key={`${c.tipo}-${c.valore}`}>
                  <span className="font-semibold">{c.tipo}</span>: {c.valore}
                  {c.affidabilita ? <span className="text-muted-foreground"> · {c.affidabilita.replaceAll("_", " ")}</span> : null}
                </p>
              ))}
            </Blocco>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function KpiMini({ label, valore }: { label: string; valore: string | number }) {
  return (
    <Card className="p-4 sm:p-6">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl sm:text-3xl">{formatNumero(valore)}</p>
    </Card>
  );
}

function Blocco({ titolo, vuoto, children }: { titolo: string; vuoto: string; children: ReactNode }) {
  const lista = Array.isArray(children) ? children : [children];
  const vuota = lista.filter(Boolean).length === 0;
  return (
    <Card>
      <h3 className="mb-3 text-lg font-bold">{titolo}</h3>
      {vuota ? <p className="text-sm text-muted-foreground">{vuoto}</p> : <div className="space-y-2 text-sm">{children}</div>}
    </Card>
  );
}

type Collegato = Scheda["rete"]["collaboratori"][number];

/** Elenco di collegati con ricerca e filtro per qualifica quando sono tanti. */
function ElencoCollegati({ titolo, voci, vuoto }: { titolo: string; voci: Collegato[]; vuoto: string }) {
  const [filtro, setFiltro] = useState("");
  const [qualifica, setQualifica] = useState("");
  const qualifiche = useMemo(() => {
    const conta = new Map<string, number>();
    for (const v of voci) conta.set(v.qualifica || "Senza qualifica", (conta.get(v.qualifica || "Senza qualifica") ?? 0) + 1);
    return [...conta.entries()].sort((a, b) => b[1] - a[1]);
  }, [voci]);
  const testo = filtro.trim().toLowerCase();
  const visibili = voci.filter(
    (v) =>
      (!qualifica || (v.qualifica || "Senza qualifica") === qualifica) &&
      (!testo || `${v.denominazione ?? ""} ${v.rui_collegato}`.toLowerCase().includes(testo)),
  );
  const tanti = voci.length > 10;

  return (
    <div className="min-w-0">
      <p className="mb-2 text-sm font-semibold text-muted-foreground">
        {titolo} {voci.length > 0 ? `· ${formatNumero(voci.length)}` : ""}
      </p>
      {voci.length === 0 ? (
        <p className="text-sm text-muted-foreground">{vuoto}</p>
      ) : (
        <>
          {tanti ? (
            <div className="mb-3 space-y-2">
              <Input
                type="search"
                className="h-9"
                placeholder={`Filtra ${titolo.toLowerCase()} per nome o RUI`}
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                aria-label={`Filtra ${titolo.toLowerCase()}`}
              />
              {qualifiche.length > 1 ? (
                <div className="flex flex-wrap gap-1.5">
                  <ChipFiltro attivo={!qualifica} onClick={() => setQualifica("")}>
                    Tutti
                  </ChipFiltro>
                  {qualifiche.map(([q, n]) => (
                    <ChipFiltro key={q} attivo={qualifica === q} onClick={() => setQualifica(qualifica === q ? "" : q)}>
                      {q} · {n}
                    </ChipFiltro>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <ul className={cn("space-y-2 text-sm", tanti && "max-h-96 overflow-y-auto pr-1")}>
            {visibili.map((p) => (
              <li key={`${p.rui_collegato}-${p.qualifica}`}>
                <LinkRui rui={p.rui_collegato}>{p.denominazione || p.rui_collegato}</LinkRui>
                <span className="text-muted-foreground">
                  {" "}
                  · {p.rui_collegato} · {p.qualifica || "rapporto"}
                </span>
                {p.inoperativo ? <span className="ml-1 text-xs font-semibold text-destructive">inoperativo</span> : null}
              </li>
            ))}
            {visibili.length === 0 ? <li className="text-muted-foreground">Nessuno corrisponde al filtro.</li> : null}
          </ul>
        </>
      )}
    </div>
  );
}

function ChipFiltro({ attivo, onClick, children }: { attivo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={attivo}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
        attivo ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-primary/10",
      )}
    >
      {children}
    </button>
  );
}

function ListeRete({
  principali,
  collaboratori,
}: {
  principali: Scheda["rete"]["principali"];
  collaboratori: Scheda["rete"]["collaboratori"];
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <ElencoCollegati titolo="Lavora per" voci={principali} vuoto="Non risulta collegato a principali A/B/E." />
      <ElencoCollegati titolo="Collaboratori" voci={collaboratori} vuoto="Nessun collaboratore A/B/E." />
    </div>
  );
}

export function RetePage() {
  const [params, setParams] = useSearchParams();
  const ruiScelto = (params.get("rui") || "").toUpperCase();
  const [q, setQ] = useState(ruiScelto);
  const cerca = useDebounce(q.trim());
  const naviga = useNavigate();
  const eRui = /^[ABE][0-9]{5,}$/i.test(cerca);

  // Un RUI scritto o incollato apre subito la rete.
  useEffect(() => {
    if (eRui && cerca.toUpperCase() !== ruiScelto) {
      setParams({ rui: cerca.toUpperCase() }, { replace: true });
    }
  }, [eRui, cerca, ruiScelto, setParams]);

  const candidati = useApi<Pagina<IntermediarioLista, unknown>>(
    cerca && !eRui && cerca.length >= 2 ? `/api/intermediari${qs({ q: cerca, limit: 8 })}` : null,
  );
  const { data, errore, caricamento } = useApi<Rete>(ruiScelto ? `/api/rete/${encodeURIComponent(ruiScelto)}` : null);

  function scegli(rui: string) {
    setQ(rui);
    naviga(`/app/rete?rui=${encodeURIComponent(rui)}`);
  }

  const mostraCandidati = Boolean(cerca) && !eRui && cerca.toUpperCase() !== ruiScelto;

  return (
    <div className="space-y-4">
      <CampoRicerca
        valore={q}
        onChange={setQ}
        placeholder="Nome o numero RUI, es. Consulbrokers"
        etichetta="Cerca l'intermediario di cui vedere la rete"
      />
      {mostraCandidati ? (
        <Card className="p-2">
          {candidati.caricamento ? (
            <p className="p-3 text-sm text-muted-foreground">Cerco…</p>
          ) : (candidati.data?.items ?? []).length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Nessun intermediario trovato per «{cerca}».</p>
          ) : (
            <ul>
              {(candidati.data?.items ?? []).map((c) => (
                <li key={c.oss}>
                  <button
                    type="button"
                    onClick={() => scegli(c.numero_iscrizione_rui)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm hover:bg-secondary"
                  >
                    <BadgeSezione sezione={c.sezione} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{c.denominazione}</span>
                    <span className="text-muted-foreground">{c.numero_iscrizione_rui}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
      <MessaggioStato errore={errore} />
      {caricamento ? <SkeletonScheda /> : null}
      {data?.soggetto && !mostraCandidati ? (
        <>
          <Card>
            <p className="text-sm text-muted-foreground">{data.soggetto.numero_iscrizione_rui}</p>
            <h3 className="font-display text-2xl">
              <Link className="hover:underline" to={`/app/intermediari/${data.soggetto.numero_iscrizione_rui}`}>
                {data.soggetto.denominazione}
              </Link>
            </h3>
            <div className="mt-2 flex gap-2">
              <BadgeSezione sezione={data.soggetto.sezione} />
              <BadgeStato inoperativo={data.soggetto.inoperativo} />
            </div>
          </Card>
          <Card>
            <ListeRete principali={data.principali} collaboratori={data.collaboratori} />
          </Card>
        </>
      ) : null}
      {!q.trim() && !ruiScelto ? (
        <p className="text-sm text-muted-foreground">
          Scrivi il nome o il numero RUI di un agente, broker o collaboratore per vedere per chi lavora e chi lavora per lui.
        </p>
      ) : null}
    </div>
  );
}

export function SediPage() {
  const [q, setQ] = useParametro("q");
  const cerca = useDebounce(q);
  const elenco = usePaginato<SedeRiga, { dopo_oss: string }>("/api/sedi", { q: cerca });
  const colonne: Colonna<SedeRiga>[] = [
    { id: "rui", etichetta: "RUI", cella: (r) => <LinkRui rui={r.rui} /> },
    { id: "nome", etichetta: "Denominazione", cella: (r) => r.denominazione || "—" },
    { id: "tipo", etichetta: "Tipo", cella: (r) => r.tipo_sede || "—" },
    { id: "comune", etichetta: "Comune", cella: (r) => r.comune_sede || "—" },
    { id: "prov", etichetta: "Prov.", cella: (r) => r.provincia_sede || "—" },
    { id: "ind", etichetta: "Indirizzo", cella: (r) => r.indirizzo_sede || "—" },
  ];
  return (
    <div className="space-y-4">
      <CampoRicerca
        valore={q}
        onChange={setQ}
        placeholder="Comune, sigla provincia (es. BS), indirizzo o RUI"
        etichetta="Cerca sedi"
      />
      <MessaggioStato errore={elenco.errore} />
      {!elenco.caricamento ? <BarraRisultati totale={elenco.totale} mostrati={elenco.righe.length} csv={elenco.csv} /> : null}
      <Tabella
        colonne={colonne}
        righe={elenco.righe}
        vuoto={cerca ? `Nessuna sede trovata per «${cerca}».` : "Nessuna sede."}
        chiave={(r) => String(r.oss)}
        caricamento={elenco.caricamento}
      />
      <AltriRisultati visibile={Boolean(elenco.prossimo)} inCarico={elenco.inCarico} onClick={() => void elenco.altre()} />
    </div>
  );
}

export function MandatiPage() {
  const [q, setQ] = useParametro("q");
  const cerca = useDebounce(q);
  const elenco = usePaginato<MandatoRiga, { dopo_oss: string }>("/api/mandati", { q: cerca });
  const colonne: Colonna<MandatoRiga>[] = [
    { id: "rui", etichetta: "RUI", cella: (r) => <LinkRui rui={r.rui} /> },
    { id: "nome", etichetta: "Intermediario", cella: (r) => r.denominazione || "—" },
    { id: "comp", etichetta: "Compagnia", cella: (r) => r.ragione_sociale || "—" },
    { id: "cod", etichetta: "Codice", cella: (r) => r.codice_compagnia || "—" },
  ];
  return (
    <div className="space-y-4">
      <CampoRicerca
        valore={q}
        onChange={setQ}
        placeholder="Compagnia, intermediario o RUI"
        etichetta="Cerca mandati"
      />
      <MessaggioStato errore={elenco.errore} />
      {!elenco.caricamento ? <BarraRisultati totale={elenco.totale} mostrati={elenco.righe.length} csv={elenco.csv} /> : null}
      <Tabella
        colonne={colonne}
        righe={elenco.righe}
        vuoto={cerca ? `Nessun mandato trovato per «${cerca}».` : "Nessun mandato."}
        chiave={(r) => String(r.oss)}
        caricamento={elenco.caricamento}
      />
      <AltriRisultati visibile={Boolean(elenco.prossimo)} inCarico={elenco.inCarico} onClick={() => void elenco.altre()} />
    </div>
  );
}

export function CarichePage() {
  const [q, setQ] = useParametro("q");
  const cerca = useDebounce(q);
  const elenco = usePaginato<CaricaRiga, { dopo_oss: string }>("/api/cariche", { q: cerca });
  const colonne: Colonna<CaricaRiga>[] = [
    {
      id: "persona",
      etichetta: "Persona",
      cella: (r) => (r.persona_rui ? <LinkRui rui={r.persona_rui}>{r.persona || r.persona_rui}</LinkRui> : r.persona || "—"),
    },
    {
      id: "soc",
      etichetta: "Società",
      cella: (r) => (r.societa_rui ? <LinkRui rui={r.societa_rui}>{r.societa || r.societa_rui}</LinkRui> : r.societa || "—"),
    },
    { id: "q", etichetta: "Qualifica", cella: (r) => r.qualifica || "—" },
  ];
  return (
    <div className="space-y-4">
      <CampoRicerca valore={q} onChange={setQ} placeholder="Persona, società, qualifica o RUI" etichetta="Cerca cariche" />
      <MessaggioStato errore={elenco.errore} />
      {!elenco.caricamento ? <BarraRisultati totale={elenco.totale} mostrati={elenco.righe.length} csv={elenco.csv} /> : null}
      <Tabella
        colonne={colonne}
        righe={elenco.righe}
        vuoto={cerca ? `Nessuna carica trovata per «${cerca}».` : "Nessuna carica."}
        chiave={(r) => String(r.oss)}
        caricamento={elenco.caricamento}
      />
      <AltriRisultati visibile={Boolean(elenco.prossimo)} inCarico={elenco.inCarico} onClick={() => void elenco.altre()} />
    </div>
  );
}
