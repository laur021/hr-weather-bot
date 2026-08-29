import type { WeatherThreat } from "../types.js";
import { classifyThreat } from "./classify.js";
import type { WeatherSource } from "./index.js";

interface OpenMeteoResponse {
  current_weather?: {
    windspeed?: number;
  };
  daily?: {
    time?: string[];
    precipitation_sum?: number[];
    wind_gusts_10m_max?: number[];
  };
}

/**
 * Open-Meteo forecast source. Free, no API key, no registration, no rate
 * limits for reasonable use. We derive a "threat" from today's forecast using
 * wind-gust + rainfall thresholds (see classify.ts).
 */
export class OpenMeteoWeatherSource implements WeatherSource {
  constructor(
    private readonly latitude: number,
    private readonly longitude: number,
    private readonly locationName: string,
  ) {}

  async check(): Promise<WeatherThreat | null> {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${this.latitude}&longitude=${this.longitude}` +
      `&current_weather=true` +
      `&daily=precipitation_sum,wind_gusts_10m_max` +
      `&timezone=Asia/Manila&forecast_days=1`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      throw new Error(`Open-Meteo returned ${res.status}`);
    }
    const data = (await res.json()) as OpenMeteoResponse;

    const windKmh = data.current_weather?.windspeed ?? 0;
    const gustKmh = data.daily?.wind_gusts_10m_max?.[0] ?? windKmh;
    const precipitationMm = data.daily?.precipitation_sum?.[0] ?? 0;

    return classifyThreat({
      windKmh,
      gustKmh,
      precipitationMm,
      location: this.locationName,
    });
  }
}
