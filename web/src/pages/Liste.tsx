import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { BadgeSezione, BadgeStato, MessaggioStato, Tabella, type Colonna } from "@/components/Tabella";
import { getJson, qs, type CaricaRiga, type IntermediarioLista, type MandatoRiga, type Pagina, type Rete, type Scheda, type SedeRiga } from "@/api";
import { useApi, useDebounce } from "@/lib/useApi";
import { formatData } from "@/lib/format";

function CampoRicerca({
  valore,
  onChange,
  placeholder,
}: {
  valore: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative max-w-md">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="pl-11"
        value={valore}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function FiltroSezione({
  valore,
  onChange,
}: {
  valore: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="h-11 rounded-full border border-input bg-card px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={valore}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Sezione"
    >
      <option value="">A · B · E</option>
      <option value="A">A agenti</option>
      <option value="B">B mediatori</option>
      <option value="E">E collaboratori</option>
    </select>
  );
}

export function IntermediariPage() {
  const [q, setQ] = useState("");
  const [sezione, setSezione] = useState("");
  const [accodati, setAccodati] = useState<IntermediarioLista[]>([]);
  const [coda, setCoda] = useState<{ dopo_nome: string; dopo_oss: string } | null | undefined>(undefined);
  const cerca = useDebounce(q);
  const path = `/api/intermediari${qs({ q: cerca, sezione })}`;
  const { data, errore, caricamento } = useApi<Pagina<IntermediarioLista, { dopo_nome: string; dopo_oss: string }>>(path);

  const righe = useMemo(() => [...(data?.items ?? []), ...accodati], [data, accodati]);

  useEffect(() => {
    setAccodati([]);
    setCoda(undefined);
  }, [path]);

  const prossimo = coda === undefined ? data?.prossimo : coda;

  async function altre() {
    if (!prossimo) return;
    const extra = await getJson<Pagina<IntermediarioLista, { dopo_nome: string; dopo_oss: string }>>(
      `/api/intermediari${qs({ q: cerca, sezione, dopo_nome: prossimo.dopo_nome, dopo_oss: prossimo.dopo_oss })}`,
    );
    setAccodati((prev) => [...prev, ...extra.items]);
    setCoda(extra.prossimo);
  }

  const colonne: Colonna<IntermediarioLista>[] = [
    {
      id: "rui",
      etichetta: "RUI",
      cella: (r) => (
        <Link className="font-semibold text-primary hover:underline" to={`/app/intermediari/${r.numero_iscrizione_rui}`}>
          {r.numero_iscrizione_rui}
        </Link>
      ),
    },
    { id: "nome", etichetta: "Denominazione", cella: (r) => r.denominazione || "—" },
    { id: "sez", etichetta: "Sez.", cella: (r) => <BadgeSezione sezione={r.sezione} /> },
    { id: "data", etichetta: "Iscrizione", cella: (r) => formatData(r.data_iscrizione) },
    { id: "stato", etichetta: "Stato", cella: (r) => <BadgeStato inoperativo={r.inoperativo} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <CampoRicerca valore={q} onChange={setQ} placeholder="Cerca per nome o numero RUI" />
        <FiltroSezione valore={sezione} onChange={setSezione} />
      </div>
      <MessaggioStato caricamento={caricamento} errore={errore} />
      <Tabella
        colonne={colonne}
        righe={righe}
        vuoto="Nessun intermediario A, B o E corrisponde."
        chiave={(r) => `${r.oss}`}
      />
      {prossimo ? (
        <Button variant="outline" onClick={() => void altre()}>
          Altri risultati
        </Button>
      ) : null}
    </div>
  );
}

export function IntermediarioPage() {
  const { rui = "" } = useParams();
  const { data, errore, caricamento } = useApi<Scheda>(rui ? `/api/intermediari/${encodeURIComponent(rui)}` : null);
  const s = data?.soggetto;

  return (
    <div className="space-y-4">
      <MessaggioStato caricamento={caricamento} errore={errore} />
      {s ? (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">{s.numero_iscrizione_rui}</p>
                <h3 className="font-display text-2xl">{s.denominazione}</h3>
              </div>
              <div className="flex items-center gap-2">
                <BadgeSezione sezione={s.sezione} />
                <BadgeStato inoperativo={s.inoperativo} />
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Iscrizione</dt>
                <dd className="font-semibold">{formatData(s.data_iscrizione)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Nascita / costituzione</dt>
                <dd className="font-semibold">
                  {s.comune_nascita || "—"}
                  {s.provincia_nascita ? ` (${s.provincia_nascita})` : ""}
                  {s.data_nascita ? ` · ${formatData(s.data_nascita)}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Natura</dt>
                <dd className="font-semibold">{s.persona_giuridica ? "Persona giuridica" : "Persona fisica"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Stato</dt>
                <dd className="font-semibold">{s.stato || "—"}</dd>
              </div>
            </dl>
          </Card>

          <Blocco titolo="Sedi" vuoto="Nessuna sede in registro.">
            {data.sedi.map((sede, i) => (
              <p key={`${sede.indirizzo_sede}-${i}`}>
                {[sede.tipo_sede, sede.indirizzo_sede, sede.cap_sede, sede.comune_sede, sede.provincia_sede]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ))}
          </Blocco>

          <Blocco titolo="Mandati" vuoto="Nessun mandato in registro.">
            {data.mandati.map((m, i) => (
              <p key={`${m.codice_compagnia}-${i}`}>
                {m.ragione_sociale || "—"} {m.codice_compagnia ? `(${m.codice_compagnia})` : ""}
              </p>
            ))}
          </Blocco>

          <Blocco titolo="Cariche" vuoto="Nessuna carica in registro.">
            {data.cariche.map((c, i) => (
              <p key={`${c.persona_rui}-${c.societa_rui}-${i}`}>
                {c.persona || c.persona_rui || "—"} · {c.qualifica || "carica"} · {c.societa || c.societa_rui || "—"}
              </p>
            ))}
          </Blocco>

          <Blocco titolo="Siti" vuoto="Nessun sito in registro.">
            {data.siti_internet.map((url) => (
              <p key={url}>
                <a className="text-primary hover:underline" href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              </p>
            ))}
          </Blocco>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold">Rete (1 salto)</h3>
              <Link className="text-sm font-semibold text-primary hover:underline" to={`/app/rete?rui=${encodeURIComponent(s.numero_iscrizione_rui)}`}>
                Apri in Rete
              </Link>
            </div>
            <ListeRete principali={data.rete.principali} collaboratori={data.rete.collaboratori} />
          </Card>

          {data.contatti.length > 0 ? (
            <Blocco titolo="Recapiti extra (già in archivio)" vuoto="">
              {data.contatti.map((c) => (
                <p key={`${c.tipo}-${c.valore}`}>
                  <span className="font-semibold">{c.tipo}</span>: {c.valore}
                  {c.affidabilita ? ` · ${c.affidabilita}` : ""}
                </p>
              ))}
            </Blocco>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Blocco({
  titolo,
  vuoto,
  children,
}: {
  titolo: string;
  vuoto: string;
  children: ReactNode;
}) {
  const lista = Array.isArray(children) ? children : [children];
  const vuota = lista.filter(Boolean).length === 0;
  return (
    <Card>
      <h3 className="mb-3 text-lg font-bold">{titolo}</h3>
      {vuota ? <p className="text-sm text-muted-foreground">{vuoto}</p> : <div className="space-y-2 text-sm">{children}</div>}
    </Card>
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
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className="mb-2 text-sm font-semibold text-muted-foreground">Principali</p>
        {principali.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun principale A/B/E.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {principali.map((p) => (
              <li key={`${p.rui_collegato}-${p.qualifica}`}>
                <Link className="font-semibold text-primary hover:underline" to={`/app/intermediari/${p.rui_collegato}`}>
                  {p.denominazione || p.rui_collegato}
                </Link>
                <span className="text-muted-foreground">
                  {" "}
                  · {p.rui_collegato} · {p.qualifica || "rapporto"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-muted-foreground">Collaboratori</p>
        {collaboratori.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun collaboratore A/B/E.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {collaboratori.map((p) => (
              <li key={`${p.rui_collegato}-${p.qualifica}`}>
                <Link className="font-semibold text-primary hover:underline" to={`/app/intermediari/${p.rui_collegato}`}>
                  {p.denominazione || p.rui_collegato}
                </Link>
                <span className="text-muted-foreground">
                  {" "}
                  · {p.rui_collegato} · {p.qualifica || "rapporto"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function RetePage() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("rui") || "");
  const cerca = useDebounce(q);
  const rui = cerca.trim().toUpperCase();
  const pronto = /^[ABE][0-9]{5,}$/.test(rui);
  const { data, errore, caricamento } = useApi<Rete>(
    pronto ? `/api/rete/${encodeURIComponent(rui)}` : null,
  );

  return (
    <div className="space-y-4">
      <CampoRicerca valore={q} onChange={setQ} placeholder="Numero RUI, es. E000188700" />
      {!pronto && q.trim() ? (
        <p className="text-sm text-muted-foreground">Inserisci un RUI di sezione A, B o E.</p>
      ) : null}
      <MessaggioStato caricamento={caricamento} errore={errore} />
      {data?.soggetto ? (
        <Card>
          <p className="text-sm text-muted-foreground">Centro</p>
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
      ) : null}
      {data ? <Card><ListeRete principali={data.principali} collaboratori={data.collaboratori} /></Card> : null}
      {!pronto && !q.trim() ? (
        <p className="text-sm text-muted-foreground">
          Cerca un intermediario dalla lista e apri la rete, oppure incolla qui il numero RUI.
        </p>
      ) : null}
    </div>
  );
}

export function SediPage() {
  const [q, setQ] = useState("");
  const cerca = useDebounce(q);
  const { data, errore, caricamento } = useApi<Pagina<SedeRiga, { dopo_oss: string }>>(
    `/api/sedi${qs({ q: cerca })}`,
  );
  const colonne: Colonna<SedeRiga>[] = [
    {
      id: "rui",
      etichetta: "RUI",
      cella: (r) => (
        <Link className="font-semibold text-primary hover:underline" to={`/app/intermediari/${r.rui}`}>
          {r.rui}
        </Link>
      ),
    },
    { id: "nome", etichetta: "Denominazione", cella: (r) => r.denominazione || "—" },
    { id: "tipo", etichetta: "Tipo", cella: (r) => r.tipo_sede || "—" },
    { id: "comune", etichetta: "Comune", cella: (r) => r.comune_sede || "—" },
    { id: "prov", etichetta: "Prov.", cella: (r) => r.provincia_sede || "—" },
    { id: "ind", etichetta: "Indirizzo", cella: (r) => r.indirizzo_sede || "—" },
  ];
  return (
    <div className="space-y-4">
      <CampoRicerca valore={q} onChange={setQ} placeholder="Comune, indirizzo o RUI" />
      <MessaggioStato caricamento={caricamento} errore={errore} />
      <Tabella colonne={colonne} righe={data?.items ?? []} vuoto="Nessuna sede." chiave={(r) => String(r.oss)} />
    </div>
  );
}

export function MandatiPage() {
  const [q, setQ] = useState("");
  const cerca = useDebounce(q);
  const { data, errore, caricamento } = useApi<Pagina<MandatoRiga, { dopo_oss: string }>>(
    `/api/mandati${qs({ q: cerca })}`,
  );
  const colonne: Colonna<MandatoRiga>[] = [
    {
      id: "rui",
      etichetta: "Matricola",
      cella: (r) => (
        <Link className="font-semibold text-primary hover:underline" to={`/app/intermediari/${r.rui}`}>
          {r.rui}
        </Link>
      ),
    },
    { id: "nome", etichetta: "Intermediario", cella: (r) => r.denominazione || "—" },
    { id: "comp", etichetta: "Compagnia", cella: (r) => r.ragione_sociale || "—" },
    { id: "cod", etichetta: "Codice", cella: (r) => r.codice_compagnia || "—" },
  ];
  return (
    <div className="space-y-4">
      <CampoRicerca valore={q} onChange={setQ} placeholder="Compagnia, intermediario o RUI" />
      <MessaggioStato caricamento={caricamento} errore={errore} />
      <Tabella colonne={colonne} righe={data?.items ?? []} vuoto="Nessun mandato." chiave={(r) => String(r.oss)} />
    </div>
  );
}

export function CarichePage() {
  const [q, setQ] = useState("");
  const cerca = useDebounce(q);
  const { data, errore, caricamento } = useApi<Pagina<CaricaRiga, { dopo_oss: string }>>(
    `/api/cariche${qs({ q: cerca })}`,
  );
  const colonne: Colonna<CaricaRiga>[] = [
    {
      id: "persona",
      etichetta: "Persona",
      cella: (r) =>
        r.persona_rui ? (
          <Link className="font-semibold text-primary hover:underline" to={`/app/intermediari/${r.persona_rui}`}>
            {r.persona || r.persona_rui}
          </Link>
        ) : (
          r.persona || "—"
        ),
    },
    {
      id: "soc",
      etichetta: "Società",
      cella: (r) =>
        r.societa_rui ? (
          <Link className="font-semibold text-primary hover:underline" to={`/app/intermediari/${r.societa_rui}`}>
            {r.societa || r.societa_rui}
          </Link>
        ) : (
          r.societa || "—"
        ),
    },
    { id: "q", etichetta: "Qualifica", cella: (r) => r.qualifica || "—" },
  ];
  return (
    <div className="space-y-4">
      <CampoRicerca valore={q} onChange={setQ} placeholder="Persona, società o RUI" />
      <MessaggioStato caricamento={caricamento} errore={errore} />
      <Tabella colonne={colonne} righe={data?.items ?? []} vuoto="Nessuna carica." chiave={(r) => String(r.oss)} />
    </div>
  );
}
