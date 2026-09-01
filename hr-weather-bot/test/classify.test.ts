import { describe, expect, it } from "vitest";
import { classifyThreat, kmhToMs } from "../src/weather/classify.js";

const LOC = "Test City";

describe("classifyThreat", () => {
  it("returns null for calm conditions", () => {
    expect(
      classifyThreat({ windMs: 2, gustMs: 5, precipitationMm: 5, location: LOC }),
    ).toBeNull();
  });

  it("classifies watch at the canonical 20 m/s gust threshold", () => {
    const t = classifyThreat({ windMs: 10, gustMs: 20, precipitationMm: 10, location: LOC });
    expect(t?.severity).toBe("watch");
  });

  it("classifies warning from storm-force wind", () => {
    const t = classifyThreat({ windMs: 20, gustMs: 25, precipitationMm: 20, location: LOC });
    expect(t?.severity).toBe("warning");
  });

  it("classifies emergency from typhoon-force wind", () => {
    const t = classifyThreat({ windMs: 30, gustMs: 33, precipitationMm: 30, location: LOC });
    expect(t?.severity).toBe("emergency");
  });

  it("classifies from heavy rainfall", () => {
    const t = classifyThreat({ windMs: 4, gustMs: 7, precipitationMm: 120, location: LOC });
    expect(t?.severity).toBe("warning");
    expect(t?.title.toLowerCase()).toContain("rain");
  });

  it("picks the higher severity across wind and rain", () => {
    // wind -> warning, rain -> emergency => emergency
    const t = classifyThreat({ windMs: 20, gustMs: 22, precipitationMm: 250, location: LOC });
    expect(t?.severity).toBe("emergency");
  });

  it("converts km/h to m/s and does not alert for a 38 km/h gust", () => {
    expect(kmhToMs(38)).toBeCloseTo(10.56, 2);
    expect(
      classifyThreat({
        windMs: 0,
        gustMs: kmhToMs(38),
        precipitationMm: 0,
        location: LOC,
      }),
    ).toBeNull();
  });
});
