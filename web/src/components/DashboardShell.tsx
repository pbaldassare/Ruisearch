import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown, Menu, Shield } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { VOCI, type VoceMenu } from "@/nav";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

export function DashboardShell({
  children,
  voci = VOCI,
  titoloMarchio = "RUISEARCH",
  sottotitolo = "Area riservata",
  homePath = "/app",
}: {
  children: ReactNode;
  voci?: VoceMenu[];
  titoloMarchio?: string;
  sottotitolo?: string;
  homePath?: string;
}) {
  const { email, ruolo, cliente, logout } = useAuth();
  const locazione = useLocation();
  const [pannelloAperto, setPannelloAperto] = useState(false);
  const attiva = voci.find((v) =>
    v.path === homePath ? locazione.pathname === homePath : locazione.pathname.startsWith(v.path),
  );
  const badge = ruolo === "admin" ? "Admin" : cliente?.denominazione || "Cliente";
  const naviga = useNavigate();
  // Pagina di dettaglio (es. /app/intermediari/B000…): si torna alla lista.
  const dettaglio = Boolean(
    attiva && attiva.path !== homePath && locazione.pathname.replace(/\/$/, "") !== attiva.path,
  );
  const titolo = dettaglio ? "Scheda" : attiva?.label;

  function tornaIndietro() {
    if (window.history.length > 1) naviga(-1);
    else if (attiva) naviga(attiva.path);
  }

  // Su schermi bassi il menu scorre: lo segnalo con una sfumatura e una freccia.
  const navRef = useRef<HTMLElement | null>(null);
  const [altroSotto, setAltroSotto] = useState(false);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const misura = () => setAltroSotto(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    // La voce della pagina aperta resta sempre visibile, anche in fondo al menu.
    el.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "center" });
    misura();
    el.addEventListener("scroll", misura, { passive: true });
    window.addEventListener("resize", misura);
    return () => {
      el.removeEventListener("scroll", misura);
      window.removeEventListener("resize", misura);
    };
  }, [voci.length, locazione.pathname]);

  const marchio = (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
        <Shield className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0">
        <h1 className="text-lg font-bold">{titoloMarchio}</h1>
        <p className="text-xs text-muted-foreground">{sottotitolo}</p>
      </div>
    </div>
  );

  const navigazione = (riferimento?: (el: HTMLElement | null) => void) => (
    <div className="relative min-h-0 flex-1">
    <nav ref={riferimento} className="h-full space-y-1 overflow-y-auto p-4">
      {voci.map((voce) => {
        const Icona = voce.icon;
        return (
          <NavLink
            key={voce.id}
            to={voce.path}
            end={voce.path === homePath}
            onClick={() => setPannelloAperto(false)}
            className={({ isActive }) =>
              cn(
                "flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-300 ease-smooth",
                isActive
                  ? "bg-primary text-primary-foreground shadow-glow"
                  : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground",
              )
            }
          >
            <Icona className="h-4 w-4 shrink-0" />
            <span className="truncate text-left">{voce.label}</span>
          </NavLink>
        );
      })}
    </nav>
      {riferimento && altroSotto ? (
        <button
          type="button"
          aria-label="Altre voci del menu"
          onClick={() => navRef.current?.scrollBy({ top: 160, behavior: "smooth" })}
          className="absolute inset-x-0 bottom-0 flex h-12 items-end justify-center bg-gradient-to-t from-card via-card/90 to-transparent pb-1 text-muted-foreground"
        >
          <ChevronDown className="h-4 w-4 animate-bounce" />
        </button>
      ) : null}
    </div>
  );

  const piede = (
    <div className="border-t border-border/70 p-4">
      {email ? (
        <div className="mb-3">
          {badge ? (
            <div className="mb-1 inline-flex max-w-full items-center truncate rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
              {badge}
            </div>
          ) : null}
          <div className="truncate text-sm text-muted-foreground">{email}</div>
        </div>
      ) : null}
      <Button variant="outline" size="sm" className="w-full" onClick={logout}>
        Esci
      </Button>
    </div>
  );

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <aside className="hidden w-64 flex-col border-r border-border/70 bg-card md:flex">
        <div className="border-b border-border/70 p-5">{marchio}</div>
        {navigazione((el) => {
          navRef.current = el;
        })}
        {piede}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border/70 bg-card px-4 py-3 md:hidden">
          <Button
            variant="outline"
            size="icon"
            aria-label="Apri menu"
            onClick={() => setPannelloAperto(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          {dettaglio ? (
            <Button variant="ghost" size="icon" aria-label="Torna indietro" onClick={tornaIndietro}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate text-base font-bold">{titolo ?? "Ruisearch"}</h2>
        </div>

        {pannelloAperto ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-foreground/20"
              aria-label="Chiudi menu"
              onClick={() => setPannelloAperto(false)}
            />
            <aside className="relative flex h-full w-[280px] flex-col bg-card shadow-card">
              <div className="border-b border-border/70 p-6">{marchio}</div>
              {navigazione()}
              {piede}
            </aside>
          </div>
        ) : null}

        <main className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 lg:p-8">
            <div className="mb-6 hidden md:block lg:mb-8">
              {dettaglio ? (
                <button
                  type="button"
                  onClick={tornaIndietro}
                  className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Torna a {attiva?.label}
                </button>
              ) : null}
              <h2 className="mb-2 text-2xl font-bold lg:text-3xl">{titolo}</h2>
              {attiva?.descrizione && !dettaglio ? (
                <p className="text-muted-foreground">{attiva.descrizione}</p>
              ) : null}
            </div>
            {attiva?.descrizione && !dettaglio ? (
              <p className="mb-5 text-sm text-muted-foreground md:hidden">{attiva.descrizione}</p>
            ) : null}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
