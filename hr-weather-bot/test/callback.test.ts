import { describe, it, expect } from "vitest";
import { CB } from "../src/constants.js";
import { decodeCallback, encodeCallback } from "../src/telegram/callback.js";

describe("callback encoding", () => {
  it("round-trips with a version", () => {
    const enc = encodeCallback(CB.send, "weather_20260829_001", 4);
    expect(enc).toBe("send:weather_20260829_001:4");
    expect(decodeCallback(enc)).toEqual({
      action: "send",
      eventId: "weather_20260829_001",
      version: 4,
    });
  });

  it("round-trips without a version", () => {
    const enc = encodeCallback(CB.compose, "weather_20260829_001");
    expect(enc).toBe("compose:weather_20260829_001");
    expect(decodeCallback(enc)).toEqual({
      action: "compose",
      eventId: "weather_20260829_001",
      version: undefined,
    });
  });

  it("round-trips monitoring callbacks", () => {
    const enc = encodeCallback(CB.stopAlerts, "weather_20260829_001");
    expect(decodeCallback(enc)).toEqual({
      action: CB.stopAlerts,
      eventId: "weather_20260829_001",
      version: undefined,
    });
  });

  it("rejects malformed or unknown data", () => {
    expect(() => decodeCallback(undefined)).toThrow();
    expect(() => decodeCallback("")).toThrow();
    expect(() => decodeCallback("hack:123")).toThrow();
    expect(() => decodeCallback("send:123:notanumber")).toThrow();
    expect(() => decodeCallback("sendonly")).toThrow();
  });
});
