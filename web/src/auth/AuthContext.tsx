import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "rui_session_email";

type AuthContextValue = {
  email: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(() => sessionStorage.getItem(STORAGE_KEY));

  const value = useMemo<AuthContextValue>(
    () => ({
      email,
      async login(indirizzo, password) {
        const pulita = indirizzo.trim().toLowerCase();
        if (!pulita || !pulita.includes("@")) {
          throw new Error("Inserisci un'email valida.");
        }
        if (!password.trim()) {
          throw new Error("Inserisci la password.");
        }
        sessionStorage.setItem(STORAGE_KEY, pulita);
        setEmail(pulita);
      },
      logout() {
        sessionStorage.removeItem(STORAGE_KEY);
        setEmail(null);
      },
    }),
    [email],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth va usato dentro AuthProvider");
  return ctx;
}
