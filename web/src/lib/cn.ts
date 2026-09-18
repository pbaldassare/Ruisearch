export function cn(...parti: Array<string | false | null | undefined>) {
  return parti.filter(Boolean).join(" ");
}
