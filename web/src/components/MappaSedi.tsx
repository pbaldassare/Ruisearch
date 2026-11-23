import { useEffect, useMemo, useRef, useState } from "react";
import type { Scheda } from "@/api";

declare global {
  interface Window {
    google?: {
      maps: {
        Map: new (el: HTMLElement, opts: object) => { fitBounds: (b: unknown) => void };
        Marker: new (opts: object) => unknown;
        LatLngBounds: new () => { extend: (p: object) => void };
      };
    };
    __ruiMapsReady?: () => void;
    gm_authFailure?: () => void;
  }
}

// Lo script di Google Maps si carica una volta sola per tutta l'app: chi arriva
// dopo aspetta la stessa promessa, che si risolve quando Google chiama il callback
// (non al "load" dello script, quando google.maps puo' non essere ancora pronto).
let caricamento: Promise<void> | null = null;

function caricaScript(key: string): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (caricamento) return caricamento;
  caricamento = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    window.__ruiMapsReady = () => resolve();
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__ruiMapsReady`;
    s.async = true;
    s.dataset.ruiMaps = "1";
    s.onerror = () => {
      // Al prossimo tentativo si riprova da capo.
      s.remove();
      caricamento = null;
      reject(new Error("Google Maps non si è caricato: controlla la connessione e riprova."));
    };
    document.head.appendChild(s);
  });
  return caricamento;
}

export function MappaSedi({
  punti,
  mapsKey,
}: {
  punti: Scheda["mappa"];
  mapsKey: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const ok = useMemo(() => punti.filter((p) => p.lat != null && p.lng != null), [punti]);
  // La mappa si crea solo quando cambiano davvero le sedi: ogni creazione e' un caricamento a pagamento.
  const firma = ok.map((p) => `${p.oss}:${p.lat}:${p.lng}`).join("|");
  const puntiRef = useRef(ok);
  puntiRef.current = ok;

  useEffect(() => {
    if (!firma || !mapsKey || !ref.current) return;
    let vivo = true;
    setErrore(null);
    // Chiave rifiutata da Google (dominio non autorizzato, fatturazione): la mappa resterebbe grigia.
    window.gm_authFailure = () => {
      if (vivo) setErrore("Google Maps ha rifiutato la chiave: la mappa non è disponibile.");
    };
    caricaScript(mapsKey)
      .then(() => {
        if (!vivo || !ref.current || !window.google) return;
        const sedi = puntiRef.current;
        const g = window.google.maps;
        const primo = { lat: Number(sedi[0].lat), lng: Number(sedi[0].lng) };
        const map = new g.Map(ref.current, { center: primo, zoom: 14, mapTypeControl: false });
        const bounds = new g.LatLngBounds();
        for (const p of sedi) {
          const pos = { lat: Number(p.lat), lng: Number(p.lng) };
          new g.Marker({
            map,
            position: pos,
            title: [p.tipo_sede, p.indirizzo_sede, p.comune_sede].filter(Boolean).join(" · "),
          });
          bounds.extend(pos);
        }
        if (sedi.length > 1) map.fitBounds(bounds);
      })
      .catch((err: unknown) => {
        if (vivo) setErrore(err instanceof Error ? err.message : "La mappa non si è caricata.");
      });
    return () => {
      vivo = false;
    };
  }, [mapsKey, firma]);

  if (!ok.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Nessuna sede geolocalizzata. Controlla l&apos;indirizzo in registro o la chiave Maps.
      </p>
    );
  }

  return (
    <>
      {errore ? (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {errore}
        </p>
      ) : null}
      <div ref={ref} className="h-80 w-full rounded-2xl bg-secondary" />
    </>
  );
}
