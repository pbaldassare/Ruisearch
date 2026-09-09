import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Menu, Shield } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { VOCI } from "@/nav";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

export function DashboardShell({ children }: { children: ReactNode }) {
  const { email, logout } = useAuth();
  const locazione = useLocation();
  const [pannelloAperto, setPannelloAperto] = useState(false);
  const attiva = VOCI.find((v) =>
    v.path === "/app" ? locazione.pathname === "/app" : locazione.pathname.startsWith(v.path),
  );

  const marchio = (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
        <Shield className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0">
        <h1 className="text-lg font-bold">RUISEARCH</h1>
        <p className="text-xs text-muted-foreground">Area riservata</p>
      </div>
    </div>
  );

  const navigazione = (
    <nav className="flex-1 space-y-1 overflow-y-auto p-4">
      {VOCI.map((voce) => {
        const Icona = voce.icon;
        return (
          <NavLink
            key={voce.id}
            to={voce.path}
            end={voce.path === "/app"}
            onClick={() => setPannelloAperto(false)}
            className={({ isActive }) =>
              cn(
                "flex w-full items-center gap-3 rounded-full px-4 py-3 text-sm font-semibold transition-all duration-300 ease-smooth",
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
  );

  const piede = (
    <div className="border-t border-border/70 p-4">
      {email ? <div className="mb-2 truncate text-sm text-muted-foreground">{email}</div> : null}
      <Button variant="outline" size="sm" className="w-full" onClick={logout}>
        Esci
      </Button>
    </div>
  );

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <aside className="hidden w-64 flex-col border-r border-border/70 bg-card md:flex">
        <div className="border-b border-border/70 p-6">{marchio}</div>
        {navigazione}
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
          <h2 className="min-w-0 flex-1 truncate text-base font-bold">{attiva?.label ?? "Ruisearch"}</h2>
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
              {navigazione}
              {piede}
            </aside>
          </div>
        ) : null}

        <main className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 lg:p-8">
            <div className="mb-6 hidden md:block lg:mb-8">
              <h2 className="mb-2 text-2xl font-bold lg:text-3xl">{attiva?.label}</h2>
              {attiva?.descrizione ? (
                <p className="text-muted-foreground">{attiva.descrizione}</p>
              ) : null}
            </div>
            {attiva?.descrizione ? (
              <p className="mb-5 text-sm text-muted-foreground md:hidden">{attiva.descrizione}</p>
            ) : null}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
