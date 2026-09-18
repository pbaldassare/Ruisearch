import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { postJson } from "@/api";

const STORAGE_KEY = "rui_session_v3";

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
};

type AuthContextValue = {
  email: string | null;
  ruolo: "admin" | "cliente" | null;
  cliente: ClienteSessione | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function leggiSessione(): Sessione | null {
  try {
    const grezzo = sessionStorage.getItem(STORAGE_KEY);
    if (!grezzo) return null;
    const parsed = JSON.parse(grezzo) as Sessione;
    if (!parsed?.email || (parsed.ruolo !== "admin" && parsed.ruolo !== "cliente")) return null;
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
      async login(indirizzo, password) {
        const esito = await postJson<Sessione>("/api/auth/login", {
          email: indirizzo,
          password,
        });
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(esito));
        setSessione(esito);
      },
      logout() {
        sessionStorage.removeItem(STORAGE_KEY);
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
