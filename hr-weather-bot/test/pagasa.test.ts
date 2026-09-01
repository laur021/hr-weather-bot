import { describe, expect, it, vi } from "vitest";
import type { OfficeLocation, PagasaVerification } from "../src/types.js";
import {
  enrichWithPagasa,
  PagasaClient,
  parsePagasaBulletin,
} from "../src/weather/pagasa.js";
import { formatHrWeatherAlert } from "../src/workflow.js";

const OFFICE: OfficeLocation = {
  name: "Metro Manila",
  address: "Metro Manila",
  latitude: 14.5995,
  longitude: 120.9842,
  timezone: "Asia/Manila",
  localityMatchList: ["NCR", "National Capital Region", "Metro Manila", "Quezon City"],
};

const SOURCE = "https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin";
const CHECKED = "2026-09-01T03:30:00.000Z";

const APPLICABLE_BULLETIN = `
<div class="article-header" id="swb">Tropical Cyclone Bulletin #4</div>
<div class="article-content">
  <h3>Tropical Storm &quot;Auring&quot;</h3>
  <h5>Issued at 11:00 am, 01 September 2026</h5>
  <h5>(Valid for broadcast until the next advisory to be issued at 5:00 PM today)</h5>
  <ul>
    <li>Heavy Rainfall Outlook</li>
    <li>Heavy rain over Metro Manila due to TC AURING.</li>
    <li>Severe Winds</li>
  </ul>
  <div class="panel-heading">Location of Eye/center</div>
  <div class="panel-body"><p>350 km East of Luzon</p></div>
  <div class="panel-heading">Movement</div>
  <div class="panel-body"><p>Moving West Northwestward at 20 km/h</p></div>
  <div class="panel-heading">Strength</div>
  <div class="panel-body"><p>Maximum sustained winds of 65 km/h</p></div>
  <div class="panel-heading">Wind Signal</div>
  <div class="panel-body"><span>Tropical Cyclone Wind Signal No. 1: Metro Manila</span></div>
  <p>Considering these developments</p>
</div>
<div>Tropical Cyclone Bulletin Archive</div>`;

const NON_APPLICABLE_BULLETIN = APPLICABLE_BULLETIN
  .replaceAll("Auring", "Pilandok")
  .replaceAll("AURING", "PILANDOK")
  .replace("Heavy rain over Metro Manila due to TC PILANDOK.", "Rainfall due to the Southwest Monsoon.")
  .replace("Tropical Cyclone Wind Signal No. 1: Metro Manila", "No Tropical Cyclone Wind Signal");

function localResult() {
  return {
    threat: {
      severity: "watch" as const,
      title: "Weather Watch — heavy rainfall",
      description: "Heavy rainfall is forecast locally.",
      source: "open-meteo",
      detectedAt: CHECKED,
    },
    advisory: {
      location: OFFICE.name,
      condition: "Thunderstorm",
      rainChancePercent: 90,
      expectedRainfallMm: 60,
      peakWindGustMs: 10,
    },
    summary: "Open-Meteo forecast",
  };
}

describe("official PAGASA enrichment", () => {
  it("includes an officially verified storm name and classification", () => {
    const official = parsePagasaBulletin(
      APPLICABLE_BULLETIN,
      SOURCE,
      CHECKED,
      OFFICE.localityMatchList,
    );
    const result = enrichWithPagasa(localResult(), official, OFFICE);
    const output = formatHrWeatherAlert(result.threat!);

    expect(official.officialVerificationStatus).toBe("VERIFIED");
    expect(official.bulletinId).toBe("auring-TCB-4");
    expect(official.bulletinHash).toMatch(/^[a-f0-9]{64}$/);
    expect(output).toContain("Tropical Storm AURING");
    expect(output).toContain("Office in official affected-area text:</b> Yes");
  });

  it("reports an active storm without treating it as a direct office impact", () => {
    const official = parsePagasaBulletin(
      NON_APPLICABLE_BULLETIN,
      SOURCE,
      CHECKED,
      OFFICE.localityMatchList,
      {
        sourceUrl: "https://www.pagasa.dost.gov.ph/weather",
        checkedAt: CHECKED,
        cause: "Southwest Monsoon (Habagat)",
        affectedAreaText: "Metro Manila",
        officeAreaExplicitlyAffected: true,
        status: "AVAILABLE",
      },
    );
    const result = enrichWithPagasa(localResult(), official, OFFICE);
    const output = formatHrWeatherAlert(result.threat!);

    expect(official.officialVerificationStatus).toBe("ACTIVE_BULLETIN_NO_DIRECT_IMPACT");
    expect(official.directCycloneImpact).toBe(false);
    expect(output).toContain("Tropical Storm PILANDOK is active");
    expect(output).toContain(
      "does not verify a direct tropical-cyclone impact on Metro Manila",
    );
    expect(output).toContain("Southwest Monsoon (Habagat)");
  });

  it("reports fetch failure as unavailable rather than no storm", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network down"));
    const client = new PagasaClient({
      bulletinUrl: SOURCE,
      dailyWeatherUrl: "https://www.pagasa.dost.gov.ph/weather",
      weatherAdvisoryUrl: "https://www.pagasa.dost.gov.ph/weather/weather-advisory",
      office: OFFICE,
      fetcher,
      now: () => new Date(CHECKED),
    });

    const official = await client.check();
    const result = enrichWithPagasa(localResult(), official, OFFICE);
    const output = formatHrWeatherAlert(result.threat!);

    expect(official.officialVerificationStatus).toBe("UNAVAILABLE");
    expect(output).toContain("Official PAGASA bulletin verification is temporarily unavailable");
    expect(output).not.toContain("No active PAGASA tropical cyclone bulletin");
  });

  it("parses an official no-active response without inventing a name", () => {
    const official: PagasaVerification = parsePagasaBulletin(
      '<div class="article-header" id="swb">Tropical Cyclone Bulletin</div><h3>No Active Tropical Cyclone within the Philippine Area of Responsibility</h3>',
      SOURCE,
      CHECKED,
      OFFICE.localityMatchList,
    );
    expect(official.officialVerificationStatus).toBe("NO_APPLICABLE_BULLETIN");
    expect(official.cycloneName).toBeUndefined();
  });
});
