import { createHash } from "node:crypto";
import type {
  OfficeLocation,
  PagasaVerification,
  PagasaWeatherAdvisory,
  Severity,
  WeatherThreat,
} from "../types.js";
import type { WeatherCheckResult } from "./index.js";

export interface PagasaClientOptions {
  bulletinUrl: string;
  dailyWeatherUrl: string;
  weatherAdvisoryUrl: string;
  office: OfficeLocation;
  fetcher?: typeof fetch;
  now?: () => Date;
}

/** Direct official-source client. It never returns or persists raw HTML. */
export class PagasaClient {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: PagasaClientOptions) {
    for (const url of [
      options.bulletinUrl,
      options.dailyWeatherUrl,
      options.weatherAdvisoryUrl,
    ]) {
      assertOfficialPagasaUrl(url);
    }
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async check(): Promise<PagasaVerification> {
    const checkedAt = this.now().toISOString();
    const [bulletinResult, dailyResult, advisoryResult] = await Promise.allSettled([
      this.fetchOfficialHtml(this.options.bulletinUrl),
      this.fetchOfficialHtml(this.options.dailyWeatherUrl),
      this.fetchOfficialHtml(this.options.weatherAdvisoryUrl),
    ]);

    const weatherAdvisory = parsePagasaWeatherContext(
      dailyResult.status === "fulfilled" ? dailyResult.value : undefined,
      advisoryResult.status === "fulfilled" ? advisoryResult.value : undefined,
      this.options.dailyWeatherUrl,
      this.options.weatherAdvisoryUrl,
      checkedAt,
      this.options.office.localityMatchList,
    );

    if (bulletinResult.status === "rejected") {
      return unavailableVerification(
        this.options.bulletinUrl,
        checkedAt,
        bulletinResult.reason,
        weatherAdvisory,
      );
    }

    try {
      return parsePagasaBulletin(
        bulletinResult.value,
        this.options.bulletinUrl,
        checkedAt,
        this.options.office.localityMatchList,
        weatherAdvisory,
      );
    } catch (error) {
      return unavailableVerification(
        this.options.bulletinUrl,
        checkedAt,
        error,
        weatherAdvisory,
      );
    }
  }

  private async fetchOfficialHtml(url: string): Promise<string> {
    const response = await this.fetcher(url, {
      headers: { "User-Agent": "AblazeHRAssistantBot/1.0 official-weather-check" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      throw new Error(`official source returned HTTP ${response.status}`);
    }
    const html = await response.text();
    if (!html.trim() || html.length > 3_000_000) {
      throw new Error("official source returned an empty or oversized response");
    }
    return html;
  }
}

export function parsePagasaBulletin(
  html: string,
  sourceUrl: string,
  checkedAt: string,
  localityMatchList: string[],
  weatherAdvisory?: PagasaWeatherAdvisory,
): PagasaVerification {
  const contentStart = findBulletinContentStart(html);
  if (contentStart < 0) {
    throw new Error("PAGASA bulletin content marker was not found");
  }
  const contentEnd = html.indexOf("Tropical Cyclone Bulletin Archive", contentStart);
  const articleHtml = html.slice(contentStart, contentEnd > contentStart ? contentEnd : undefined);
  const articleText = htmlToText(articleHtml);

  if (/No Active Tropical Cyclone within the Philippine Area of Responsibility/i.test(articleText)) {
    const verification: PagasaVerification = {
      officialVerificationStatus: "NO_APPLICABLE_BULLETIN",
      sourceUrl,
      checkedAt,
      bulletinHash: hashStructured({ state: "NO_ACTIVE_TROPICAL_CYCLONE" }),
      windSignals: [],
      areasAffected: weatherAdvisory?.affectedAreaText
        ? [weatherAdvisory.affectedAreaText]
        : [],
      rainfallOutlook: weatherAdvisory?.outlook,
      rainfallCause: weatherAdvisory?.cause,
      officeAreaExplicitlyAffected: Boolean(weatherAdvisory?.officeAreaExplicitlyAffected),
      directCycloneImpact: false,
      weatherAdvisory,
    };
    return verification;
  }

  const bulletinNumber = capture(articleText, /Tropical Cyclone Bulletin\s*#\s*(\d+)/i);
  const cyclone = articleText.match(
    /\b(Tropical Depression|Tropical Storm|Severe Tropical Storm|Typhoon|Super Typhoon)\s+["“”']?([A-Za-z][A-Za-z -]*?)["“”']?(?=\s*(?:\n|Issued at))/i,
  );
  if (!bulletinNumber || !cyclone) {
    throw new Error("PAGASA active bulletin identity could not be parsed");
  }

  const cycloneClassification = normalizeSpace(cyclone[1]!);
  const cycloneName = normalizeSpace(cyclone[2]!).toUpperCase();
  const bulletinIssuedAt = capture(articleText, /Issued at\s+([^\n]+)/i);
  const bulletinValidUntil = capture(articleText, /\(Valid for broadcast\s+([^\n)]+)\)/i);
  const location = section(articleText, "Location of Eye/center", ["Movement"]);
  const movement = section(articleText, "Movement", ["Strength"]);
  const rainfallSection = section(articleText, "Heavy Rainfall Outlook", [
    "Severe Winds",
    "HAZARDS AFFECTING COASTAL WATERS",
  ]);
  const windSignalSection = section(articleText, "Wind Signal", [
    "Considering these developments",
    "Tropical Cyclone Bulletin Archive",
  ]);
  const windSignals = meaningfulLines(windSignalSection).slice(0, 30);
  const affectedAreas = unique([
    ...meaningfulLines(rainfallSection),
    ...windSignals.filter((line) => !/^(Wind Signal|Meteorological Condition|Impact of the Wind)$/i.test(line)),
  ]).slice(0, 50);

  const bulletinOfficeText = `${rainfallSection}\n${windSignalSection}`;
  const bulletinExplicitlyAffectsOffice = containsLocality(
    bulletinOfficeText,
    localityMatchList,
  );
  const windExplicitlyAffectsOffice = containsLocality(
    windSignalSection ?? "",
    localityMatchList,
  );
  const bulletinRainfallCause = detectCause(rainfallSection, cycloneName);
  const rainfallCause = weatherAdvisory?.officeAreaExplicitlyAffected
    ? weatherAdvisory.cause ?? bulletinRainfallCause
    : bulletinRainfallCause;
  const rainDirectlyCausedByCyclone = Boolean(
    bulletinExplicitlyAffectsOffice &&
      (new RegExp(`\\b${escapeRegex(cycloneName)}\\b`, "i").test(rainfallSection ?? "") ||
        /\b(?:TC|tropical cyclone)\b/i.test(rainfallSection ?? "")) &&
      !isMonsoonOnly(rainfallCause),
  );
  const directCycloneImpact = windExplicitlyAffectsOffice || rainDirectlyCausedByCyclone;
  const officeAreaExplicitlyAffected = bulletinExplicitlyAffectsOffice || Boolean(
    weatherAdvisory?.officeAreaExplicitlyAffected,
  );

  const hashInput = {
    bulletinNumber,
    bulletinIssuedAt,
    bulletinValidUntil,
    cycloneName,
    cycloneClassification,
    location,
    movement,
    rainfallSection,
    rainfallCause,
    windSignals,
    affectedAreas,
    directCycloneImpact,
  };
  return {
    officialVerificationStatus: directCycloneImpact
      ? "VERIFIED"
      : "ACTIVE_BULLETIN_NO_DIRECT_IMPACT",
    sourceUrl,
    checkedAt,
    bulletinId: `${slug(cycloneName)}-TCB-${bulletinNumber}`,
    bulletinNumber,
    bulletinVersion: bulletinNumber,
    bulletinHash: hashStructured(hashInput),
    bulletinIssuedAt,
    bulletinValidUntil,
    cycloneName,
    cycloneClassification,
    location,
    movement,
    rainfallOutlook: rainfallSection || weatherAdvisory?.outlook,
    rainfallCause,
    windSignals,
    areasAffected: affectedAreas,
    officeAreaExplicitlyAffected,
    directCycloneImpact,
    weatherAdvisory,
  };
}

export function parsePagasaWeatherContext(
  dailyWeatherHtml: string | undefined,
  weatherAdvisoryHtml: string | undefined,
  dailyWeatherUrl: string,
  weatherAdvisoryUrl: string,
  checkedAt: string,
  localityMatchList: string[],
): PagasaWeatherAdvisory {
  const advisoryNumber = weatherAdvisoryHtml
    ? capture(htmlToText(weatherAdvisoryHtml), /WEATHER ADVISORY\s+NO\.\s*([^\n]+)/i)
    : undefined;
  const iframeUrl = weatherAdvisoryHtml
    ? capture(
        weatherAdvisoryHtml,
        /<iframe[^>]+src=["'](https:\/\/[^"']*pagasa\.dost\.gov\.ph[^"']+)["']/i,
      )
    : undefined;

  if (!dailyWeatherHtml) {
    return {
      sourceUrl: iframeUrl ?? weatherAdvisoryUrl,
      checkedAt,
      advisoryNumber,
      officeAreaExplicitlyAffected: false,
      status: "UNAVAILABLE",
    };
  }

  const dailyText = htmlToText(dailyWeatherHtml.slice(findDailyWeatherStart(dailyWeatherHtml)));
  const issuedAt = capture(dailyText, /Issued at:\s*([^\n]+)/i);
  const rows = extractTableRows(dailyWeatherHtml);
  const officeRow = rows.find(
    (cells) => cells.length >= 3 && containsLocality(cells[0] ?? "", localityMatchList),
  );
  const affectedAreaText = officeRow?.[0];
  const condition = officeRow?.[1];
  const cause = officeRow?.[2] ?? detectCause(dailyText);
  const impacts = officeRow?.[3];
  return {
    sourceUrl: iframeUrl ?? (advisoryNumber ? weatherAdvisoryUrl : dailyWeatherUrl),
    checkedAt,
    advisoryNumber,
    issuedAt,
    cause,
    outlook: [condition, impacts].filter(Boolean).join(". ") || undefined,
    affectedAreaText,
    officeAreaExplicitlyAffected: Boolean(affectedAreaText),
    status: "AVAILABLE",
  };
}

export function enrichWithPagasa(
  result: WeatherCheckResult,
  officialPagasa: PagasaVerification,
  office: OfficeLocation,
): WeatherCheckResult {
  const advisory = result.advisory
    ? {
        ...result.advisory,
        location: office.name,
        address: office.address,
        latitude: office.latitude,
        longitude: office.longitude,
        timezone: office.timezone,
        officialPagasa,
      }
    : undefined;

  let threat = result.threat
    ? { ...result.threat, hrAdvisory: advisory, officialPagasa }
    : null;
  if (officialPagasa.officialVerificationStatus === "VERIFIED") {
    const officialSeverity = severityFromSignals(officialPagasa.windSignals);
    if (!threat) {
      threat = {
        severity: officialSeverity,
        title: officialStormTitle(officialPagasa),
        description: `PAGASA explicitly includes ${office.name} in the current affected-area information.`,
        source: "pagasa",
        detectedAt: officialPagasa.checkedAt,
        hrAdvisory: advisory,
        officialPagasa,
      };
    } else {
      threat = {
        ...threat,
        severity: higherSeverity(threat.severity, officialSeverity),
        title: officialStormTitle(officialPagasa),
        source: `${threat.source}+pagasa`,
      };
    }
  }

  return {
    ...result,
    threat,
    advisory,
    summary: `${result.summary}\nOfficial PAGASA verification: ${officialPagasa.officialVerificationStatus}.`,
  };
}

export function pagasaRiskFingerprint(verification: PagasaVerification | undefined): string {
  if (!verification) return "NO_OFFICIAL_CONTEXT";
  const applicable = verification.officialVerificationStatus === "VERIFIED";
  return hashStructured({
    status: verification.officialVerificationStatus,
    cycloneName: applicable ? verification.cycloneName : undefined,
    cycloneClassification: applicable ? verification.cycloneClassification : undefined,
    directCycloneImpact: verification.directCycloneImpact,
    officeAreaExplicitlyAffected: verification.officeAreaExplicitlyAffected,
    rainfallCause: verification.rainfallCause,
    highestWindSignal: highestWindSignal(verification.windSignals),
  });
}

function unavailableVerification(
  sourceUrl: string,
  checkedAt: string,
  error: unknown,
  weatherAdvisory?: PagasaWeatherAdvisory,
): PagasaVerification {
  return {
    officialVerificationStatus: "UNAVAILABLE",
    sourceUrl,
    checkedAt,
    windSignals: [],
    areasAffected: [],
    officeAreaExplicitlyAffected: false,
    directCycloneImpact: false,
    weatherAdvisory,
    error: errorMessage(error),
  };
}

function findBulletinContentStart(html: string): number {
  const header = html.search(/<div[^>]*class=["'][^"']*article-header[^"']*["'][^>]*id=["']swb["'][^>]*>/i);
  if (header >= 0) return header;
  return html.search(/No Active Tropical Cyclone within the Philippine Area of Responsibility/i);
}

function findDailyWeatherStart(html: string): number {
  const matches = [...html.matchAll(/Daily Weather/gi)];
  return matches.at(-1)?.index ?? 0;
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split(/\r?\n/)
    .map(normalizeSpace)
    .filter(Boolean)
    .join("\n");
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#")) {
      const radix = code[1]?.toLowerCase() === "x" ? 16 : 10;
      const digits = radix === 16 ? code.slice(2) : code.slice(1);
      const point = Number.parseInt(digits, radix);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}

function extractTableRows(html: string): string[][] {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      normalizeSpace(htmlToText(cell[1]!)),
    ),
  );
}

function section(text: string, heading: string, nextHeadings: string[]): string | undefined {
  const start = text.toLocaleLowerCase().indexOf(heading.toLocaleLowerCase());
  if (start < 0) return undefined;
  const contentStart = start + heading.length;
  const lower = text.toLocaleLowerCase();
  const ends = nextHeadings
    .map((next) => lower.indexOf(next.toLocaleLowerCase(), contentStart))
    .filter((index) => index >= 0);
  const end = ends.length ? Math.min(...ends) : text.length;
  return normalizeMultiline(text.slice(contentStart, end));
}

function containsLocality(text: string, aliases: string[]): boolean {
  return aliases.some((alias) => {
    const pattern = new RegExp(`(^|[^A-Za-z])${escapeRegex(alias)}([^A-Za-z]|$)`, "i");
    return pattern.test(text);
  });
}

function detectCause(text: string | undefined, cycloneName?: string): string | undefined {
  if (!text) return undefined;
  if (/Southwest Monsoon|Habagat/i.test(text)) return "Southwest Monsoon (Habagat)";
  if (cycloneName && new RegExp(`\\b${escapeRegex(cycloneName)}\\b`, "i").test(text)) {
    return `Tropical Cyclone ${cycloneName}`;
  }
  const match = text.match(/(?:Caused By|due to)\s*:?\s*([^\n.]+)/i);
  return match ? normalizeSpace(match[1]!) : undefined;
}

function isMonsoonOnly(cause: string | undefined): boolean {
  return Boolean(cause && /Southwest Monsoon|Habagat/i.test(cause) && !/Tropical Cyclone|\bTC\b/i.test(cause));
}

function officialStormTitle(verification: PagasaVerification): string {
  return `${verification.cycloneClassification} ${verification.cycloneName} — PAGASA-verified office impact`;
}

function severityFromSignals(signals: string[]): Severity {
  const signal = highestWindSignal(signals);
  if (signal >= 4) return "emergency";
  if (signal >= 2) return "warning";
  return "watch";
}

function highestWindSignal(signals: string[]): number {
  return Math.max(
    0,
    ...signals.flatMap((line) =>
      [...line.matchAll(/(?:Signal(?:\s+No\.)?|TCWS)\s*#?\s*(\d)/gi)].map((match) =>
        Number.parseInt(match[1]!, 10),
      ),
    ),
  );
}

function higherSeverity(a: Severity, b: Severity): Severity {
  const order: Record<Severity, number> = { watch: 1, warning: 2, emergency: 3 };
  return order[a] >= order[b] ? a : b;
}

function capture(value: string, pattern: RegExp): string | undefined {
  const result = value.match(pattern)?.[1];
  return result ? normalizeSpace(decodeEntities(result)) : undefined;
}

function meaningfulLines(value: string | undefined): string[] {
  if (!value) return [];
  return value.split("\n").map(normalizeSpace).filter(Boolean);
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMultiline(value: string): string | undefined {
  const result = meaningfulLines(value).join("\n");
  return result || undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function hashStructured(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

function assertOfficialPagasaUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith("pagasa.dost.gov.ph")) {
    throw new Error(`PAGASA source must be an official HTTPS PAGASA URL: ${value}`);
  }
}
