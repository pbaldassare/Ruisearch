export function formatNumero(n: string | number | null | undefined): string {
  if (n == null || n === "") return "—";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return String(n);
  return new Intl.NumberFormat("it-IT").format(v);
}

export function formatData(iso: string | null | undefined): string {
  if (!iso) return "—";
  const giorno = iso.slice(0, 10);
  const [y, m, d] = giorno.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function formatQuando(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatData(iso);
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

export function statoOperativo(inoperativo: boolean | null | undefined): string {
  if (inoperativo == null) return "—";
  return inoperativo ? "Inoperativo" : "Operativo";
}
