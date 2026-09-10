import { useEffect, useRef } from "react";
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
  }
}

function caricaScript(key: string): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  const esistente = document.querySelector<HTMLScriptElement>("script[data-rui-maps]");
  if (esistente) {
    return new Promise((resolve) => {
      esistente.addEventListener("load", () => resolve(), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    window.__ruiMapsReady = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__ruiMapsReady`;
    s.async = true;
    s.dataset.ruiMaps = "1";
    s.onerror = () => reject(new Error("Google Maps non si è caricato"));
    document.head.appendChild(s);
  });
}

export function MappaSedi({
  punti,
  mapsKey,
}: {
  punti: Scheda["mappa"];
  mapsKey: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ok = punti.filter((p) => p.lat != null && p.lng != null);
  const firma = ok.map((p) => `${p.oss}:${p.lat}:${p.lng}`).join("|");

  useEffect(() => {
    if (!firma || !mapsKey || !ref.current) return;
    let vivo = true;
    caricaScript(mapsKey)
      .then(() => {
        if (!vivo || !ref.current || !window.google) return;
        const g = window.google.maps;
        const primo = { lat: Number(ok[0].lat), lng: Number(ok[0].lng) };
        const map = new g.Map(ref.current, { center: primo, zoom: 14, mapTypeControl: false });
        const bounds = new g.LatLngBounds();
        for (const p of ok) {
          const pos = { lat: Number(p.lat), lng: Number(p.lng) };
          new g.Marker({
            map,
            position: pos,
            title: [p.tipo_sede, p.indirizzo_sede, p.comune_sede].filter(Boolean).join(" · "),
          });
          bounds.extend(pos);
        }
        if (ok.length > 1) map.fitBounds(bounds);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [mapsKey, firma, ok]);

  if (!ok.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Nessuna sede geolocalizzata. Controlla l&apos;indirizzo in registro o la chiave Maps.
      </p>
    );
  }

  return <div ref={ref} className="h-80 w-full rounded-2xl bg-secondary" />;
}
