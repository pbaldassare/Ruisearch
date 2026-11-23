import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button, Card, Input } from "@/components/ui";

const LUNGHEZZA_MIN = 10;

export function PasswordClientePage() {
  const { cambiaPassword } = useAuth();
  const [attuale, setAttuale] = useState("");
  const [nuova, setNuova] = useState("");
  const [ripeti, setRipeti] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [fatto, setFatto] = useState(false);
  const [inCorso, setInCorso] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrore(null);
    setFatto(false);
    if (nuova.length < LUNGHEZZA_MIN) return setErrore(`La nuova password deve avere almeno ${LUNGHEZZA_MIN} caratteri.`);
    if (nuova !== ripeti) return setErrore("Le due nuove password non coincidono.");
    setInCorso(true);
    try {
      await cambiaPassword(attuale, nuova);
      setAttuale("");
      setNuova("");
      setRipeti("");
      setFatto(true);
    } catch (err) {
      setErrore(err instanceof Error ? err.message : "Cambio password non riuscito.");
    } finally {
      setInCorso(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block text-sm font-semibold">
          Password attuale
          <Input
            className="mt-2"
            type="password"
            autoComplete="current-password"
            value={attuale}
            onChange={(e) => setAttuale(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm font-semibold">
          Nuova password
          <Input
            className="mt-2"
            type="password"
            autoComplete="new-password"
            minLength={LUNGHEZZA_MIN}
            value={nuova}
            onChange={(e) => setNuova(e.target.value)}
            placeholder={`almeno ${LUNGHEZZA_MIN} caratteri`}
            required
          />
        </label>
        <label className="block text-sm font-semibold">
          Ripeti la nuova password
          <Input
            className="mt-2"
            type="password"
            autoComplete="new-password"
            value={ripeti}
            onChange={(e) => setRipeti(e.target.value)}
            required
          />
        </label>
        {errore ? (
          <p className="text-sm text-destructive" role="alert">
            {errore}
          </p>
        ) : fatto ? (
          <p className="text-sm text-primary" role="status">
            Password cambiata. Sugli altri dispositivi dovrai accedere di nuovo.
          </p>
        ) : null}
        <Button type="submit" disabled={inCorso}>
          <KeyRound className="h-4 w-4" />
          {inCorso ? "Salvataggio…" : "Cambia password"}
        </Button>
      </form>
    </Card>
  );
}
