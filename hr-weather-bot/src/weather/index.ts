import type { HrWeatherAdvisory, WeatherThreat } from "../types.js";
import { OpenMeteoWeatherSource } from "./open-meteo.js";

/**
 * Weather sources return both a human-readable current forecast summary and
 * an optional threat when alert thresholds are reached.
 */
export interface WeatherCheckResult {
  threat: WeatherThreat | null;
  summary: string;
  /** The HR workflow event created or updated for this check, when applicable. */
  eventId?: string;
  /** Forecast metrics for the requested location, even if no threat is active. */
  advisory?: HrWeatherAdvisory;
}

export interface WeatherLocation {
  name: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  /** ISO 3166-1 alpha-2 country code when resolved by the geocoder. */
  countryCode?: string;
  /** Locality aliases suitable for matching official regional advisories. */
  localityMatchList?: string[];
}

export interface WeatherSource {
  check(): Promise<WeatherCheckResult>;
}

export class NoopWeatherSource implements WeatherSource {
  async check(): Promise<WeatherCheckResult> {
    return { threat: null, summary: "Weather checks are disabled." };
  }
}

/** Deterministic mock used for local testing and demos. */
export class MockWeatherSource implements WeatherSource {
  constructor(
    private readonly threat: WeatherThreat | null = {
      severity: "warning",
      title: "Severe Tropical Storm Warning",
      description:
        "Heavy rainfall and strong winds expected across Metro Manila within the next 24 hours. Flooding possible in low-lying areas.",
      source: "mock",
      detectedAt: new Date().toISOString(),
    },
  ) {}

  async check(): Promise<WeatherCheckResult> {
    const threat = this.threat ? { ...this.threat } : null;
    return {
      threat,
      summary: threat
        ? `Test weather source: ${threat.title}. ${threat.description}`
        : "Test weather source: no advisory required.",
    };
  }
}

/**
 * Polls an HTTP endpoint that returns JSON in the shape:
 *   { "severity": "watch|warning|emergency", "title": "...", "description": "..." }
 * An empty object or 204 means no threat.
 */
export class HttpWeatherSource implements WeatherSource {
  constructor(private readonly url: string) {}

  async check(): Promise<WeatherCheckResult> {
    const res = await fetch(this.url);
    if (res.status === 204) {
      return { threat: null, summary: "Weather source returned no advisory." };
    }
    if (!res.ok) {
      throw new Error(`Weather endpoint ${this.url} returned ${res.status}`);
    }
    const text = await res.text();
    if (!text.trim()) {
      return { threat: null, summary: "Weather source returned no advisory." };
    }
    const data = JSON.parse(text) as Partial<WeatherThreat>;
    if (!data.severity || !data.title) {
      return { threat: null, summary: "Weather source returned no advisory." };
    }
    const threat: WeatherThreat = {
      severity: data.severity,
      title: data.title,
      description: data.description ?? "",
      source: "http",
      detectedAt: data.detectedAt ?? new Date().toISOString(),
      raw: data,
    };
    return { threat, summary: `${threat.title}. ${threat.description}` };
  }
}

export interface WeatherSourceOptions {
  httpUrl: string;
  latitude: number;
  longitude: number;
  locationName: string;
  timezone?: string;
}

export function createWeatherSource(
  kind: "mock" | "http" | "noop" | "open-meteo",
  opts: WeatherSourceOptions,
): WeatherSource {
  switch (kind) {
    case "open-meteo":
      if (opts.latitude === undefined || opts.longitude === undefined) {
        throw new Error("Open-Meteo weather checks require location coordinates");
      }
      return new OpenMeteoWeatherSource(
        opts.latitude,
        opts.longitude,
        opts.locationName,
        opts.timezone,
      );
    case "http":
      if (!opts.httpUrl) {
        throw new Error("WEATHER_HTTP_URL is required when WEATHER_SOURCE=http");
      }
      return new HttpWeatherSource(opts.httpUrl);
    case "noop":
      return new NoopWeatherSource();
    case "mock":
    default:
      return new MockWeatherSource();
  }
}
