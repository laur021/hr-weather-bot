import type { OfficeLocation } from "../types.js";
import type { WeatherLocation } from "./index.js";

interface GeocodingResult {
  name?: string;
  latitude?: number;
  longitude?: number;
  admin1?: string;
  admin2?: string;
  admin3?: string;
  admin4?: string;
  country?: string;
  country_code?: string;
  timezone?: string;
}

interface GeocodingResponse {
  results?: GeocodingResult[];
}

/** Resolve a validated place name to coordinates using Open-Meteo's free geocoder. */
export async function resolveOpenMeteoLocation(
  query: string,
): Promise<WeatherLocation | null> {
  const params = new URLSearchParams({
    name: query,
    count: "1",
    language: "en",
    format: "json",
  });
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?${params}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) {
    throw new Error(`Open-Meteo geocoding returned ${res.status}`);
  }

  const data = (await res.json()) as GeocodingResponse;
  const match = data.results?.[0];
  if (
    !match?.name ||
    typeof match.latitude !== "number" ||
    typeof match.longitude !== "number"
  ) {
    return null;
  }

  const localityMatchList = uniqueNonEmpty([
    match.name,
    match.admin4,
    match.admin3,
    match.admin2,
    match.admin1,
  ]);
  const labelParts = [...localityMatchList, match.country].filter(
    (part): part is string => Boolean(part?.trim()),
  );
  const uniqueParts = labelParts.filter(
    (part, index) =>
      labelParts.findIndex(
        (candidate) => candidate.toLocaleLowerCase() === part.toLocaleLowerCase(),
      ) === index,
  );

  return {
    name: uniqueParts.join(", "),
    latitude: match.latitude,
    longitude: match.longitude,
    timezone: match.timezone ?? "auto",
    countryCode: match.country_code,
    localityMatchList,
  };
}

/** PAGASA sources are relevant only for a Philippine location. */
export function isPhilippineLocation(location: WeatherLocation): boolean {
  return location.countryCode?.toUpperCase() === "PH" ||
    /(?:^|,)\s*Philippines\s*$/i.test(location.name);
}

/** Adapt a geocoded location to PAGASA's locality matching model. */
export function pagasaOfficeFor(location: WeatherLocation): OfficeLocation {
  const localityMatchList = uniqueNonEmpty([
    ...(location.localityMatchList ?? []),
    ...location.name.split(",").map((part) => part.trim()),
  ]).filter((part) => !/^Philippines$/i.test(part));
  return {
    name: location.name,
    address: location.name,
    latitude: location.latitude ?? 0,
    longitude: location.longitude ?? 0,
    timezone: location.timezone ?? "Asia/Manila",
    localityMatchList,
  };
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized && !result.some((item) => item.localeCompare(normalized, undefined, { sensitivity: "accent" }) === 0)) {
      result.push(normalized);
    }
  }
  return result;
}
