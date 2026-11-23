import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { CHIAVE_SESSIONE, cancellaSessione, postJson, sessioneSalvata } from "@/api";

const STORAGE_KEY = CHIAVE_SESSIONE;

export type ClienteSessione = {
  id: number;
  rui: string;
  denominazione: string;
  sezione: string | null;
};

type Sessione = {
  email: string;
  ruolo: "admin" | "cliente";
  cliente?: ClienteSessione;
  token?: string;
};

type AuthContextValue = {
  email: string | null;
  ruolo: "admin" | "cliente" | null;
  cliente: ClienteSessione | null;
  login: (email: string, password: string, ricordami: boolean) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function leggiSessione(): Sessione | null {
  try {
    const grezzo = sessioneSalvata();
    if (!grezzo) return null;
    const parsed = JSON.parse(grezzo) as Sessione;
    if (!parsed?.email || !parsed.token || (parsed.ruolo !== "admin" && parsed.ruolo !== "cliente")) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessione, setSessione] = useState<Sessione | null>(() => leggiSessione());

  const value = useMemo<AuthContextValue>(
    () => ({
      email: sessione?.email ?? null,
      ruolo: sessione?.ruolo ?? null,
      cliente: sessione?.cliente ?? null,
      async login(indirizzo, password, ricordami) {
        const esito = await postJson<Sessione>("/api/auth/login", {
          email: indirizzo,
          password,
          ricordami,
        });
        cancellaSessione();
        (ricordami ? localStorage : sessionStorage).setItem(STORAGE_KEY, JSON.stringify(esito));
        setSessione(esito);
      },
      logout() {
        cancellaSessione();
        setSessione(null);
      },
    }),
    [sessione],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth va usato dentro AuthProvider");
  return ctx;
}
