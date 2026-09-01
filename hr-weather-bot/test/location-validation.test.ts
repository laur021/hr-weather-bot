import { describe, expect, it } from "vitest";
import {
  MockAiProvider,
  parseLocationValidation,
  parseWebWeatherResult,
} from "../src/ai/provider.js";

describe("AI location validation", () => {
  it("parses a valid normalized location from a fenced AI response", () => {
    expect(
      parseLocationValidation(
        '```json\n{"isLegitimate":true,"normalizedLocation":"Quezon City, Philippines"}\n```',
      ),
    ).toEqual({
      isLegitimate: true,
      normalizedLocation: "Quezon City, Philippines",
    });
  });

  it("fails closed when the AI response is malformed", () => {
    expect(() => parseLocationValidation("yes, probably a city")).toThrow(
      "invalid location-validation response",
    );
  });

  it("provides deterministic validation in mock mode", async () => {
    const ai = new MockAiProvider();
    await expect(ai.validateLocation("  Makati City  ")).resolves.toEqual({
      isLegitimate: true,
      normalizedLocation: "Makati City",
    });
    await expect(ai.validateLocation("12345")).resolves.toEqual({
      isLegitimate: false,
      normalizedLocation: null,
    });
  });

  it("parses structured weather returned after AI web search", () => {
    expect(
      parseWebWeatherResult(
        '{"location":"San Mateo, Rizal, Philippines","condition":"Thunderstorm","rainChancePercent":76,"expectedRainfallMm":7,"peakWindGustKmh":69}',
      ),
    ).toEqual({
      location: "San Mateo, Rizal, Philippines",
      condition: "Thunderstorm",
      rainChancePercent: 76,
      expectedRainfallMm: 7,
      peakWindGustKmh: 69,
    });
  });
});
