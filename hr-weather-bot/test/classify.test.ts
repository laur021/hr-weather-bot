import { describe, expect, it } from "vitest";
import { classifyThreat } from "../src/weather/classify.js";

const LOC = "Test City";

describe("classifyThreat", () => {
  it("returns null for calm conditions", () => {
    expect(
      classifyThreat({ windKmh: 10, gustKmh: 20, precipitationMm: 5, location: LOC }),
    ).toBeNull();
  });

  it("classifies watch from moderate wind", () => {
    const t = classifyThreat({ windKmh: 40, gustKmh: 45, precipitationMm: 10, location: LOC });
    expect(t?.severity).toBe("watch");
  });

  it("classifies warning from storm-force wind", () => {
    const t = classifyThreat({ windKmh: 70, gustKmh: 90, precipitationMm: 20, location: LOC });
    expect(t?.severity).toBe("warning");
  });

  it("classifies emergency from typhoon-force wind", () => {
    const t = classifyThreat({ windKmh: 130, gustKmh: 150, precipitationMm: 30, location: LOC });
    expect(t?.severity).toBe("emergency");
  });

  it("classifies from heavy rainfall", () => {
    const t = classifyThreat({ windKmh: 15, gustKmh: 25, precipitationMm: 120, location: LOC });
    expect(t?.severity).toBe("warning");
    expect(t?.title.toLowerCase()).toContain("rain");
  });

  it("picks the higher severity across wind and rain", () => {
    // wind -> warning, rain -> emergency => emergency
    const t = classifyThreat({ windKmh: 70, gustKmh: 80, precipitationMm: 250, location: LOC });
    expect(t?.severity).toBe("emergency");
  });
});
