import type { WeatherThreat } from "../types.js";
import { OpenMeteoWeatherSource } from "./open-meteo.js";

/**
 * Weather sources are pluggable. `check()` returns a threat when dangerous
 * weather is detected, or null when conditions are clear.
 */
export interface WeatherSource {
  check(): Promise<WeatherThreat | null>;
}

export class NoopWeatherSource implements WeatherSource {
  async check(): Promise<WeatherThreat | null> {
    return null;
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

  async check(): Promise<WeatherThreat | null> {
    return this.threat ? { ...this.threat } : null;
  }
}

/**
 * Polls an HTTP endpoint that returns JSON in the shape:
 *   { "severity": "watch|warning|emergency", "title": "...", "description": "..." }
 * An empty object or 204 means no threat.
 */
export class HttpWeatherSource implements WeatherSource {
  constructor(private readonly url: string) {}

  async check(): Promise<WeatherThreat | null> {
    const res = await fetch(this.url);
    if (res.status === 204) return null;
    if (!res.ok) {
      throw new Error(`Weather endpoint ${this.url} returned ${res.status}`);
    }
    const text = await res.text();
    if (!text.trim()) return null;
    const data = JSON.parse(text) as Partial<WeatherThreat>;
    if (!data.severity || !data.title) return null;
    return {
      severity: data.severity,
      title: data.title,
      description: data.description ?? "",
      source: "http",
      detectedAt: data.detectedAt ?? new Date().toISOString(),
      raw: data,
    };
  }
}

export interface WeatherSourceOptions {
  httpUrl: string;
  latitude: number;
  longitude: number;
  locationName: string;
}

export function createWeatherSource(
  kind: "mock" | "http" | "noop" | "open-meteo",
  opts: WeatherSourceOptions,
): WeatherSource {
  switch (kind) {
    case "open-meteo":
      return new OpenMeteoWeatherSource(
        opts.latitude,
        opts.longitude,
        opts.locationName,
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
