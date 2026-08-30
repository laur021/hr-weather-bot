export const TIME_ZONE = "Asia/Manila";

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatManila(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TIME_ZONE,
    dateStyle: "full",
    timeStyle: "short",
  }).format(d);
}

/** Manila calendar date, used for same-day alert suppression. */
export function manilaDay(iso = nowIso()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** `weather_YYYYMMDD_NNN` — readable, spec-style event id. */
export function makeEventId(iso: string, seq: number): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `weather_${y}${m}${day}_${String(seq).padStart(3, "0")}`;
}
