import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Lock, Shield } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button, Input } from "@/components/ui";

export function LoginPage() {
  const { email, login } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next") || "/app";
  const destinazione = next.startsWith("/app") ? next : "/app";
  const [indirizzo, setIndirizzo] = useState("");
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  if (email) return <Navigate to={destinazione} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrore(null);
    setInCorso(true);
    try {
      await login(indirizzo, password);
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Accesso non riuscito.");
    } finally {
      setInCorso(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-b from-[hsl(40_40%_95%)] to-[hsl(40_34%_90%)] p-4">
      <div className="glass-card w-full max-w-md p-8 sm:p-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Shield className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-3xl font-bold">Ruisearch</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Area riservata del Registro Unico Intermediari
          </p>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm font-semibold">
            Email
            <Input
              className="mt-2"
              type="email"
              autoComplete="username"
              value={indirizzo}
              onChange={(e) => setIndirizzo(e.target.value)}
              placeholder="nome@dominio.it"
              required
            />
          </label>
          <label className="block text-sm font-semibold">
            Password
            <Input
              className="mt-2"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
          {errore ? <p className="text-sm text-destructive">{errore}</p> : null}
          <Button type="submit" className="w-full" disabled={inCorso}>
            <Lock className="h-4 w-4" />
            {inCorso ? "Accesso…" : "Entra"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Accesso solo per operatori autorizzati. Nessuna registrazione pubblica.
        </p>
        <p className="mt-3 text-center text-xs">
          <Link to="/" className="font-semibold text-primary hover:underline">
            Torna a RUI Search
          </Link>
        </p>
      </div>
    </div>
  );
}
