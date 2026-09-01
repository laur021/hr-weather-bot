import type { WeatherThreat } from "../types.js";
import { classifyThreat, msToKmh } from "./classify.js";
import type { WeatherCheckResult, WeatherSource } from "./index.js";

interface OpenMeteoResponse {
  current_units?: { wind_speed_10m?: string };
  daily_units?: { wind_gusts_10m_max?: string };
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    precipitation_probability_max?: number[];
    wind_gusts_10m_max?: number[];
  };
}

const weatherDescription = (code: number | undefined): string => {
  const labels: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Heavy drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    80: "Rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };
  return labels[code ?? -1] ?? "Unavailable";
};

const windDirection = (degrees: number | undefined): string => {
  if (degrees === undefined) return "Unavailable";
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % directions.length]!;
};

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
    private readonly timezone = "Asia/Manila",
  ) {}

  async check(): Promise<WeatherCheckResult> {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${this.latitude}&longitude=${this.longitude}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max` +
      `&wind_speed_unit=ms` +
      `&timezone=${encodeURIComponent(this.timezone)}&forecast_days=1`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      throw new Error(`Open-Meteo returned ${res.status}`);
    }
    const data = (await res.json()) as OpenMeteoResponse;

    assertMetersPerSecond(data.current_units?.wind_speed_10m, "current wind");
    assertMetersPerSecond(data.daily_units?.wind_gusts_10m_max, "daily gust");
    const windMs = data.current?.wind_speed_10m ?? 0;
    const gustMs = data.daily?.wind_gusts_10m_max?.[0] ?? windMs;
    const precipitationMm = data.daily?.precipitation_sum?.[0] ?? 0;

    const hrAdvisory = {
      location: this.locationName,
      address: this.locationName,
      latitude: this.latitude,
      longitude: this.longitude,
      timezone: this.timezone,
      condition: weatherDescription(
        data.daily?.weather_code?.[0] ?? data.current?.weather_code,
      ),
      rainChancePercent: Math.round(
        data.daily?.precipitation_probability_max?.[0] ?? 0,
      ),
      expectedRainfallMm: Math.round(precipitationMm),
      peakWindGustMs: gustMs,
    };
    const threat = classifyThreat({
      windMs,
      gustMs,
      precipitationMm,
      location: this.locationName,
    });
    if (threat) {
      threat.hrAdvisory = hrAdvisory;
    }
    const advisory = threat
      ? `Advisory: ${threat.severity.toUpperCase()}.`
      : "Advisory: none required.";
    return {
      threat,
      advisory: hrAdvisory,
      summary: [
        `Detailed weather forecast for ${this.locationName}`,
        "",
        "Current conditions",
        `• ${weatherDescription(data.current?.weather_code)}`,
        `• Temperature: ${Math.round(data.current?.temperature_2m ?? 0)}°C (feels like ${Math.round(data.current?.apparent_temperature ?? 0)}°C)`,
        `• Humidity: ${Math.round(data.current?.relative_humidity_2m ?? 0)}%`,
        `• Wind: ${Math.round(msToKmh(windMs))} km/h (${round(windMs)} m/s) ${windDirection(data.current?.wind_direction_10m)}`,
        `• Current precipitation: ${data.current?.precipitation ?? 0} mm`,
        "",
        "Today",
        `• ${weatherDescription(data.daily?.weather_code?.[0])}`,
        `• Temperature range: ${Math.round(data.daily?.temperature_2m_min?.[0] ?? 0)}–${Math.round(data.daily?.temperature_2m_max?.[0] ?? 0)}°C`,
        `• Rain chance: ${Math.round(data.daily?.precipitation_probability_max?.[0] ?? 0)}%`,
        `• Expected rainfall: ${Math.round(precipitationMm)} mm`,
        `• Peak wind gust: ${Math.round(msToKmh(gustMs))} km/h (${round(gustMs)} m/s)`,
        "",
        advisory,
      ].join("\n"),
    };
  }
}

function assertMetersPerSecond(unit: string | undefined, label: string): void {
  if (unit !== undefined && unit !== "m/s") {
    throw new Error(`Open-Meteo ${label} unit mismatch: expected m/s, received ${unit}`);
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
