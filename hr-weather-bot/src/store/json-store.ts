import { promises as fs } from "node:fs";
import path from "node:path";
import type { WeatherEvent } from "../types.js";
import type { EventStore } from "./store.js";

const TERMINAL = new Set(["SENT", "DISCARDED"]);

/**
 * Simple file-backed store. Writes are serialized through a promise queue to
 * avoid interleaved/corrupted writes. Adequate for a single-process bot;
 * swap for SQLite/Postgres via the EventStore interface if you scale out.
 */
export class JsonFileStore implements EventStore {
  private events = new Map<string, WeatherEvent>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as WeatherEvent[];
      this.events = new Map(parsed.map((e) => [e.id, e]));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        // Don't crash on a corrupt file, but surface it.
        console.error(`[store] failed to read ${this.filePath}:`, err);
      }
      this.events = new Map();
    }
  }

  async get(id: string): Promise<WeatherEvent | undefined> {
    return this.events.get(id);
  }

  async list(): Promise<WeatherEvent[]> {
    return [...this.events.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async listActive(): Promise<WeatherEvent[]> {
    return [...this.events.values()].filter((e) => !TERMINAL.has(e.status));
  }

  async latestActive(): Promise<WeatherEvent | undefined> {
    let latest: WeatherEvent | undefined;
    for (const e of this.events.values()) {
      if (TERMINAL.has(e.status)) continue;
      if (!latest || e.createdAt > latest.createdAt) latest = e;
    }
    return latest;
  }

  upsert(event: WeatherEvent): Promise<void> {
    this.events.set(event.id, structuredClone(event));
    this.writeQueue = this.writeQueue.then(() => this.persist());
    return this.writeQueue;
  }

  private async persist(): Promise<void> {
    const arr = [...this.events.values()];
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(arr, null, 2), "utf8");
    await fs.rename(tmp, this.filePath);
  }
}
