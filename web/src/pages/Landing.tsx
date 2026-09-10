import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Building2,
  GitBranch,
  Handshake,
  Menu,
  MessageSquare,
  Search,
  Shield,
  Users,
  X,
} from "lucide-react";
import { getJson, qs, type IntermediarioLista, type Overview, type Pagina } from "@/api";
import { useAuth } from "@/auth/AuthContext";
import { Button, Input } from "@/components/ui";
import { useApi, useDebounce } from "@/lib/useApi";
import { formatNumero } from "@/lib/format";
import { cn } from "@/lib/cn";

const ANCORE = [
  { id: "prodotto", label: "Il prodotto" },
  { id: "cerca", label: "Cerca" },
  { id: "funzioni", label: "Funzioni" },
  { id: "faq", label: "FAQ" },
  { id: "contatti", label: "Contatti" },
];

const FUNZIONI = [
  {
    icon: Users,
    titolo: "Chi è intermediario di chi",
    testo: "Apri una scheda e vedi principali, collaboratori e la rete a un salto. Solo sezioni A, B ed E.",
  },
  {
    icon: MessageSquare,
    titolo: "Domande in italiano",
    testo: "«Quanti intermediari ha Consulbrokers?» oppure «Baldassare lavora con AXA?» Le query restano SQL, non un chatbot.",
  },
  {
    icon: GitBranch,
    titolo: "Rete e mandati",
    testo: "Un'azienda mostra subito intermediari, collaborazioni e mandati. Un iscritto E vede i mandati dei suoi principali.",
  },
  {
    icon: Building2,
    titolo: "Sedi sulla mappa",
    testo: "Le sedi delle persone giuridiche si geolocalizzano a richiesta, quando apri la scheda.",
  },
  {
    icon: Handshake,
    titolo: "Mandati e cariche",
    testo: "Compagnie, qualifiche e cariche societarie collegate al numero RUI, senza raschiare il portale IVASS.",
  },
  {
    icon: BookOpen,
    titolo: "API per software esterni",
    testo: "Gli stessi endpoint della console, documentati, con chiave su /v1. L'import resta solo a richiesta.",
  },
];

const FAQ = [
  {
    d: "Che cos'è il RUI?",
    r: "Il Registro Unico degli Intermediari assicurativi e riassicurativi, tenuto dall'IVASS. RUI Search lo interroga dalla copia ufficiale già importata, non dalla vetrina Angular del portale.",
  },
  {
    d: "I dati sono pubblici?",
    r: "Sì: l'elenco è un registro di Stato. Qui lo organizziamo per ricerca, rete e query. L'area riservata serve a chi opera sul registro, non a nascondere l'anagrafica IVASS.",
  },
  {
    d: "Quali sezioni coprite?",
    r: "A (agenti), B (mediatori) ed E (collaboratori). C, D, F e U restano fuori dalle viste e dagli archi di rete.",
  },
  {
    d: "Aggiornate il registro ogni notte?",
    r: "No. L'export ufficiale si ricarica solo quando lo chiedi. Nessun job automatico.",
  },
  {
    d: "Posso collegare un gestionale?",
    r: "Sì. In area riservata c'è la pagina API e documenti, con OpenAPI e header X-API-Key.",
  },
];

export function LandingPage() {
  const { email } = useAuth();
  const riservata = email ? "/app" : "/login";

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-[hsl(40_40%_95%)] to-[hsl(40_34%_90%)]">
      <Header riservata={riservata} etichetta={email ? "Apri la console" : "Area riservata"} />
      <main>
        <Hero riservata={riservata} />
        <Prodotto />
        <CercaLive riservata={riservata} />
        <Funzioni />
        <Faq />
        <Contatti />
      </main>
      <Footer riservata={riservata} />
    </div>
  );
}

function Header({ riservata, etichetta }: { riservata: string; etichetta: string }) {
  const [aperto, setAperto] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-card/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <a href="#inizio" className="flex items-center gap-2 font-display text-lg font-bold">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Shield className="h-4 w-4 text-primary" />
          </span>
          RUI Search
        </a>
        <nav className="hidden items-center gap-5 text-sm font-semibold md:flex">
          {ANCORE.map((a) => (
            <a key={a.id} href={`#${a.id}`} className="text-muted-foreground hover:text-foreground">
              {a.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link to={riservata}>
            <Button size="sm">{etichetta}</Button>
          </Link>
          <Button
            variant="outline"
            size="icon"
            className="md:hidden"
            aria-label={aperto ? "Chiudi menu" : "Apri menu"}
            onClick={() => setAperto((v) => !v)}
          >
            {aperto ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>
      {aperto ? (
        <nav className="space-y-1 border-t border-border/70 px-4 py-3 md:hidden">
          {ANCORE.map((a) => (
            <a
              key={a.id}
              href={`#${a.id}`}
              className="block rounded-full px-4 py-2 text-sm font-semibold hover:bg-secondary"
              onClick={() => setAperto(false)}
            >
              {a.label}
            </a>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

function Hero({ riservata }: { riservata: string }) {
  const { data } = useApi<Overview>("/api/overview");

  return (
    <section id="inizio" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="text-sm font-semibold text-primary">Registro Unico Intermediari · IVASS</p>
          <h1 className="mt-3 max-w-xl text-4xl sm:text-5xl lg:text-6xl">
            Sai quali sono gli intermediari di chi.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            RUI Search interroga la copia ufficiale del RUI italiano: anagrafiche, collaborazioni,
            mandati e sedi. Niente scraping del portale, niente aggiornamento notturno. Solo A, B ed E.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#cerca">
              <Button>Prova una ricerca</Button>
            </a>
            <Link to={riservata}>
              <Button variant="outline">Area riservata</Button>
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Kpi etichetta="Intermediari A/B/E" valore={data?.intermediari} />
          <Kpi etichetta="Collaborazioni" valore={data?.collaborazioni} />
          <Kpi etichetta="Sedi" valore={data?.sedi} />
          <Kpi etichetta="Mandati" valore={data?.mandati} />
        </div>
      </div>
    </section>
  );
}

function Kpi({ etichetta, valore }: { etichetta: string; valore?: string | number }) {
  return (
    <div className="glass-card p-5">
      <p className="text-xs font-semibold text-muted-foreground">{etichetta}</p>
      <p className="mt-2 font-display text-3xl">{valore != null ? formatNumero(valore) : "—"}</p>
    </div>
  );
}

function Prodotto() {
  return (
    <section id="prodotto" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="glass-card p-8 sm:p-10">
        <h2 className="text-3xl">Perché esiste</h2>
        <p className="mt-4 max-w-3xl text-muted-foreground">
          Il RUI dice chi può intermediare assicurazioni in Italia e con chi collabora. Il portale
          pubblico è fatto per una consulta alla volta. RUI Search ricostruisce quel registro in
          un archivio interrogabile: cerchi un nome o un numero, vedi la rete, i mandati e — se è
          un&apos;azienda — dove sta.
        </p>
      </div>
    </section>
  );
}

function CercaLive({ riservata }: { riservata: string }) {
  const [q, setQ] = useState("");
  const cerca = useDebounce(q, 350);
  const path = cerca.trim().length >= 2 ? `/api/intermediari${qs({ q: cerca, limit: 8 })}` : null;
  const { data, errore, caricamento } = useApi<Pagina<IntermediarioLista, unknown>>(path);
  const navigate = useNavigate();
  const { email } = useAuth();

  const risultati = data?.items ?? [];

  function apriScheda(rui: string) {
    const destinazione = `/app/intermediari/${rui}`;
    if (email) navigate(destinazione);
    else navigate(`/login?next=${encodeURIComponent(destinazione)}`);
  }

  return (
    <section id="cerca" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h2 className="text-3xl">Cerca nel registro</h2>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Nome o numero RUI. I risultati sono veri. La scheda completa sta in area riservata.
      </p>
      <div className="relative mt-6 max-w-xl">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-11"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Es. Baldassare, Consulbrokers, E000188700"
          aria-label="Cerca intermediario"
        />
      </div>
      {caricamento ? <p className="mt-4 text-sm text-muted-foreground">Cerco…</p> : null}
      {errore ? <p className="mt-4 text-sm text-destructive">{errore}</p> : null}
      {cerca.trim().length >= 2 && !caricamento ? (
        <ul className="mt-4 divide-y divide-border/70 overflow-hidden rounded-3xl border border-border/70 bg-card">
          {risultati.length === 0 ? (
            <li className="px-5 py-8 text-sm text-muted-foreground">Nessun intermediario A, B o E.</li>
          ) : (
            risultati.map((r) => (
              <li key={r.oss}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-secondary/70"
                  onClick={() => apriScheda(r.numero_iscrizione_rui)}
                >
                  <span>
                    <span className="font-semibold">{r.denominazione}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {r.numero_iscrizione_rui}
                      {r.comune_nascita ? ` · ${r.comune_nascita}` : ""}
                    </span>
                  </span>
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-bold">{r.sezione}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        Per aprire la scheda serve l&apos;
        <Link className="font-semibold text-primary hover:underline" to={riservata}>
          area riservata
        </Link>
        .
      </p>
    </section>
  );
}

function Funzioni() {
  return (
    <section id="funzioni" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h2 className="text-3xl">Cosa fa, in pratica</h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FUNZIONI.map((f) => {
          const Icona = f.icon;
          return (
            <article key={f.titolo} className="glass-card p-6">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Icona className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-xl">{f.titolo}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.testo}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Faq() {
  const [aperta, setAperta] = useState<number | null>(0);
  return (
    <section id="faq" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h2 className="text-3xl">Domande frequenti</h2>
      <div className="mt-6 space-y-3">
        {FAQ.map((voce, i) => {
          const apertaQui = aperta === i;
          return (
            <div key={voce.d} className="glass-card overflow-hidden p-0">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left font-semibold"
                aria-expanded={apertaQui}
                onClick={() => setAperta(apertaQui ? null : i)}
              >
                {voce.d}
                <span className="text-primary">{apertaQui ? "−" : "+"}</span>
              </button>
              {apertaQui ? <p className="px-6 pb-5 text-sm text-muted-foreground">{voce.r}</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Contatti() {
  const [nome, setNome] = useState("");
  const [indirizzo, setIndirizzo] = useState("");
  const [messaggio, setMessaggio] = useState("");
  const [inviato, setInviato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const mailto = useMemo(() => {
    const oggetto = encodeURIComponent(`RUI Search — contatto da ${nome || "sito"}`);
    const corpo = encodeURIComponent(`${messaggio}\n\n— ${nome}\n${indirizzo}`);
    return `mailto:paolo.baldassare@gmail.com?subject=${oggetto}&body=${corpo}`;
  }, [nome, indirizzo, messaggio]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrore(null);
    if (!nome.trim() || !indirizzo.includes("@") || messaggio.trim().length < 8) {
      setErrore("Compila nome, un'email valida e un messaggio di almeno 8 caratteri.");
      return;
    }
    window.location.href = mailto;
    setInviato(true);
  }

  return (
    <section id="contatti" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="glass-card p-8 sm:p-10">
        <h2 className="text-3xl">Parliamone</h2>
        <p className="mt-2 max-w-xl text-muted-foreground">
          Accesso alla console, API per un gestionale o una domanda sul registro.
        </p>
        {inviato ? (
          <p className="mt-6 text-sm font-semibold text-primary">
            Si è aperto il client di posta. Se non succede, scrivi a paolo.baldassare@gmail.com.
          </p>
        ) : (
          <form className="mt-6 grid gap-4 sm:max-w-xl" onSubmit={onSubmit}>
            <label className="text-sm font-semibold">
              Nome
              <Input className="mt-2" value={nome} onChange={(e) => setNome(e.target.value)} required />
            </label>
            <label className="text-sm font-semibold">
              Email
              <Input
                className="mt-2"
                type="email"
                value={indirizzo}
                onChange={(e) => setIndirizzo(e.target.value)}
                required
              />
            </label>
            <label className="text-sm font-semibold">
              Messaggio
              <textarea
                className={cn(
                  "mt-2 min-h-28 w-full rounded-3xl border border-input bg-card px-4 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                value={messaggio}
                onChange={(e) => setMessaggio(e.target.value)}
                required
              />
            </label>
            {errore ? <p className="text-sm text-destructive">{errore}</p> : null}
            <Button type="submit">Invia</Button>
          </form>
        )}
      </div>
    </section>
  );
}

function Footer({ riservata }: { riservata: string }) {
  return (
    <footer className="border-t border-border/70 px-4 py-8 text-sm text-muted-foreground sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p>RUI Search · fonte export ufficiale IVASS · sezioni A, B, E</p>
        <div className="flex flex-wrap gap-4">
          <a href="#faq" className="hover:text-foreground">
            FAQ
          </a>
          <Link to={riservata} className="hover:text-foreground">
            Area riservata
          </Link>
          <a href="https://ruipubblico.ivass.it/" className="hover:text-foreground" target="_blank" rel="noreferrer">
            Portale IVASS
          </a>
        </div>
      </div>
    </footer>
  );
}
