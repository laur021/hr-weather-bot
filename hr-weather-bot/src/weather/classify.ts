import type { Severity, WeatherThreat } from "../types.js";

const SEV_ORDER: Record<Severity, number> = { watch: 1, warning: 2, emergency: 3 };

/**
 * Severity thresholds, roughly aligned with PAGASA tropical-cyclone wind
 * signals and rainfall warning colors.
 */
function windSeverity(gustKmh: number): Severity | null {
  if (gustKmh >= 118) return "emergency"; // typhoon-force
  if (gustKmh >= 62) return "warning"; // storm/gale-force
  if (gustKmh >= 30) return "watch"; // strong breeze
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
  windKmh: number;
  gustKmh: number;
  precipitationMm: number;
  location: string;
}

export function classifyThreat(input: ThreatInput): WeatherThreat | null {
  const gust = Math.max(input.windKmh, input.gustKmh);
  const wSev = windSeverity(gust);
  const rSev = rainSeverity(input.precipitationMm);
  const severity = pick(wSev, rSev);
  if (!severity) return null;

  const windDominant = wSev && (!rSev || SEV_ORDER[wSev] >= SEV_ORDER[rSev]);
  const title = windDominant
    ? `${SEV_LABEL[severity]} — strong winds`
    : `${SEV_LABEL[severity]} — heavy rainfall`;

  const parts: string[] = [];
  if (gust >= 30) parts.push(`peak wind gusts up to ${Math.round(gust)} km/h`);
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

const SEV_LABEL: Record<Severity, string> = {
  watch: "Weather Watch",
  warning: "Weather Warning",
  emergency: "Severe Weather Emergency",
};
