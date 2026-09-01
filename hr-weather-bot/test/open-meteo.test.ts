import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenMeteoWeatherSource } from "../src/weather/open-meteo.js";
import { kmhToMs } from "../src/weather/classify.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenMeteoWeatherSource", () => {
  it("returns a weather summary even when no advisory threshold is reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          current_units: { wind_speed_10m: "m/s" },
          daily_units: { wind_gusts_10m_max: "m/s" },
          current: {
            temperature_2m: 29,
            apparent_temperature: 34,
            relative_humidity_2m: 75,
            precipitation: 0.4,
            weather_code: 63,
            wind_speed_10m: kmhToMs(12),
            wind_direction_10m: 70,
          },
          daily: {
            weather_code: [80],
            temperature_2m_min: [25],
            temperature_2m_max: [31],
            precipitation_probability_max: [70],
            precipitation_sum: [4],
            wind_gusts_10m_max: [kmhToMs(21)],
          },
        }),
      }),
    );

    const result = await new OpenMeteoWeatherSource(14.5995, 120.9842, "Metro Manila").check();

    expect(result.threat).toBeNull();
    expect(result.summary).toContain("Detailed weather forecast for Metro Manila");
    expect(result.summary).toContain("Moderate rain");
    expect(result.summary).toContain("Temperature: 29°C (feels like 34°C)");
    expect(result.summary).toContain("Wind: 12 km/h (3.33 m/s) E");
    expect(result.summary).toContain("Rain chance: 70%");
    expect(result.summary).toContain("Expected rainfall: 4 mm");
    expect(result.advisory).toEqual({
      location: "Metro Manila",
      address: "Metro Manila",
      latitude: 14.5995,
      longitude: 120.9842,
      timezone: "Asia/Manila",
      condition: "Rain showers",
      rainChancePercent: 70,
      expectedRainfallMm: 4,
      peakWindGustMs: kmhToMs(21),
    });
  });

  it("treats a 38 km/h gust as 10.56 m/s and does not trigger 20 m/s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          current_units: { wind_speed_10m: "m/s" },
          daily_units: { wind_gusts_10m_max: "m/s" },
          current: { weather_code: 95, wind_speed_10m: kmhToMs(20) },
          daily: {
            weather_code: [95],
            precipitation_probability_max: [92],
            precipitation_sum: [10],
            wind_gusts_10m_max: [kmhToMs(38)],
          },
        }),
      }),
    );

    const result = await new OpenMeteoWeatherSource(
      25.033,
      121.5654,
      "Taipei, Taiwan",
      "Asia/Taipei",
    ).check();

    expect(result.threat).toBeNull();
    expect(result.advisory).toEqual({
      location: "Taipei, Taiwan",
      address: "Taipei, Taiwan",
      latitude: 25.033,
      longitude: 121.5654,
      timezone: "Asia/Taipei",
      condition: "Thunderstorm",
      rainChancePercent: 92,
      expectedRainfallMm: 10,
      peakWindGustMs: kmhToMs(38),
    });
    expect(result.summary).toContain("38 km/h (10.56 m/s)");
  });
});
