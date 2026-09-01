import type { Severity, WeatherThreat } from "../types.js";

const SEV_ORDER: Record<Severity, number> = { watch: 1, warning: 2, emergency: 3 };

/**
 * Severity thresholds, roughly aligned with PAGASA tropical-cyclone wind
 * signals and rainfall warning colors. Wind values are always m/s internally.
 */
function windSeverity(gustMs: number): Severity | null {
  if (gustMs >= 32.78) return "emergency"; // 118 km/h
  if (gustMs >= 24.44) return "warning"; // 88 km/h
  if (gustMs >= WIND_GUST_ALERT_THRESHOLD_MS) return "watch"; // 72 km/h
  return null;
}

function rainSeverity(precipMm: number): Severity | null {
  if (precipMm >= 200) return "emergency"; // red rainfall
  if (precipMm >= 100) return "warning"; // orange rainfall
  if (precipMm >= 50) return "watch"; // yellow rainfall
  return null;
}

function pick(a: Severity | null, b: Severity | null): Severity | null {
  if (!a) return b;
  if (!b) return a;
  return SEV_ORDER[a] >= SEV_ORDER[b] ? a : b;
}

export interface ThreatInput {
  windMs: number;
  gustMs: number;
  precipitationMm: number;
  location: string;
}

export function classifyThreat(input: ThreatInput): WeatherThreat | null {
  const gust = Math.max(input.windMs, input.gustMs);
  const wSev = windSeverity(gust);
  const rSev = rainSeverity(input.precipitationMm);
  const severity = pick(wSev, rSev);
  if (!severity) return null;

  const windDominant = wSev && (!rSev || SEV_ORDER[wSev] >= SEV_ORDER[rSev]);
  const title = windDominant
    ? `${SEV_LABEL[severity]} — strong winds`
    : `${SEV_LABEL[severity]} — heavy rainfall`;

  const parts: string[] = [];
  if (gust >= WIND_GUST_ALERT_THRESHOLD_MS) {
    parts.push(`peak wind gusts up to ${Math.round(msToKmh(gust))} km/h (${round(gust)} m/s)`);
  }
  if (input.precipitationMm >= 30) {
    parts.push(`up to ${Math.round(input.precipitationMm)} mm of rain`);
  }
  const conditions = parts.length
    ? `Expected today in ${input.location}: ${parts.join(" and ")}.`
    : `Adverse conditions expected today in ${input.location}.`;

  const advice =
    severity === "emergency"
      ? "Extreme weather. Consider suspending on-site work and prioritize employee safety."
      : severity === "warning"
        ? "Hazardous conditions possible. Travel with caution and prepare for possible flooding."
        : "Monitor conditions and stay updated.";

  return {
    severity,
    title,
    description: `${conditions} ${advice}`,
    source: "open-meteo",
    detectedAt: new Date().toISOString(),
    raw: input,
  };
}

export const WIND_GUST_ALERT_THRESHOLD_MS = 20;

export function kmhToMs(kmh: number): number {
  return kmh / 3.6;
}

export function msToKmh(ms: number): number {
  return ms * 3.6;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const SEV_LABEL: Record<Severity, string> = {
  watch: "Weather Watch",
  warning: "Weather Warning",
  emergency: "Severe Weather Emergency",
};
