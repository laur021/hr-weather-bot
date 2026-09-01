import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPhilippineLocation,
  pagasaOfficeFor,
  resolveOpenMeteoLocation,
} from "../src/weather/geocoding.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Open-Meteo location resolution", () => {
  it("returns coordinates and a readable location label", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            name: "Makati City",
            admin1: "Metro Manila",
            country: "Philippines",
            latitude: 14.5503,
            longitude: 121.0327,
            timezone: "Asia/Manila",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveOpenMeteoLocation("Makati City, Philippines")).resolves.toMatchObject({
      name: "Makati City, Metro Manila, Philippines",
      latitude: 14.5503,
      longitude: 121.0327,
      timezone: "Asia/Manila",
      localityMatchList: ["Makati City", "Metro Manila"],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "name=Makati+City%2C+Philippines",
    );
  });

  it("accepts a municipality and province in a location query", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            name: "San Mateo",
            admin1: "Calabarzon",
            admin2: "Rizal",
            country: "Philippines",
            country_code: "PH",
            latitude: 14.6969,
            longitude: 121.1219,
            timezone: "Asia/Manila",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveOpenMeteoLocation("San Mateo, Rizal, Philippines"),
    ).resolves.toMatchObject({
      name: "San Mateo, Rizal, Calabarzon, Philippines",
      latitude: 14.6969,
      longitude: 121.1219,
      timezone: "Asia/Manila",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("name=San+Mateo%2C+Rizal%2C+Philippines"),
      expect.any(Object),
    );
  });

  it("marks Philippine locations for PAGASA and preserves local matching aliases", () => {
    const location = {
      name: "San Mateo, Rizal, Calabarzon, Philippines",
      latitude: 14.6969,
      longitude: 121.1219,
      timezone: "Asia/Manila",
      countryCode: "PH",
      localityMatchList: ["San Mateo", "Rizal", "Calabarzon"],
    };

    expect(isPhilippineLocation(location)).toBe(true);
    expect(isPhilippineLocation({ name: "Taipei, Taiwan", countryCode: "TW" })).toBe(false);
    expect(pagasaOfficeFor(location).localityMatchList).toEqual([
      "San Mateo",
      "Rizal",
      "Calabarzon",
    ]);
  });

  it("returns null when no geographic match exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }),
    );

    await expect(resolveOpenMeteoLocation("Not A Place")).resolves.toBeNull();
  });
});
