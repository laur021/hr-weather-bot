import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonFileStore } from "../src/store/json-store.js";
import type { WeatherEvent } from "../src/types.js";

describe("JsonFileStore", () => {
  it("persists a same-day monitoring choice across a new store instance", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "hr-weather-store-"));
    const filePath = path.join(directory, "events.json");
    const event: WeatherEvent = {
      id: "weather_20260830_001",
      status: "SENT",
      createdAt: "2026-08-30T01:00:00.000Z",
      updatedAt: "2026-08-30T01:05:00.000Z",
      sentAt: "2026-08-30T01:05:00.000Z",
      weather: {
        severity: "warning",
        title: "Severe Tropical Storm",
        description: "Heavy rain expected.",
        source: "test",
        detectedAt: "2026-08-30T01:00:00.000Z",
      },
      draftHistory: [],
      monitoring: {
        day: "2026-08-30",
        mode: "STOPPED",
        decidedByTelegramUserId: 111,
        decidedAt: "2026-08-30T01:06:00.000Z",
      },
    };

    try {
      const first = new JsonFileStore(filePath);
      await first.init();
      await first.upsert(event);

      const restarted = new JsonFileStore(filePath);
      await restarted.init();
      expect((await restarted.get(event.id))?.monitoring).toEqual(event.monitoring);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
