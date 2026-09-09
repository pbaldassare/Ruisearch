import { useEffect, useState } from "react";
import { getJson } from "@/api";

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(false);

  useEffect(() => {
    if (!path) {
      setData(null);
      setErrore(null);
      setCaricamento(false);
      return;
    }
    let stop = false;
    setCaricamento(true);
    setErrore(null);
    getJson<T>(path)
      .then((risposta) => {
        if (!stop) setData(risposta);
      })
      .catch((err: unknown) => {
        if (!stop) {
          setData(null);
          setErrore(err instanceof Error ? err.message : "errore di rete");
        }
      })
      .finally(() => {
        if (!stop) setCaricamento(false);
      });
    return () => {
      stop = true;
    };
  }, [path]);

  return { data, errore, caricamento };
}

export function useDebounce<T>(valore: T, ms = 300): T {
  const [debounced, setDebounced] = useState(valore);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(valore), ms);
    return () => window.clearTimeout(t);
  }, [valore, ms]);
  return debounced;
}
