import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { WeatherEvent } from "../types.js";
import type { EventStore } from "./store.js";

const TERMINAL = new Set(["SENT", "DISCARDED"]);

/**
 * Durable event storage for the OpenClaw runner. Event JSON remains intact for
 * forward-compatible audit records while SQLite provides atomic writes.
 */
export class SqliteEventStore implements EventStore {
  private db?: DatabaseSync;

  constructor(
    private readonly filePath: string,
    private readonly legacyJsonPath?: string,
  ) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    this.db = new DatabaseSync(this.filePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS weather_events (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS weather_events_active
        ON weather_events(status, created_at DESC);
    `);
    await this.importLegacyJsonOnce();
  }

  async get(id: string): Promise<WeatherEvent | undefined> {
    const row = this.database()
      .prepare("SELECT payload FROM weather_events WHERE id = ?")
      .get(id) as { payload?: string } | undefined;
    return row?.payload ? parseEvent(row.payload) : undefined;
  }

  async list(): Promise<WeatherEvent[]> {
    const rows = this.database()
      .prepare("SELECT payload FROM weather_events ORDER BY created_at DESC")
      .all() as Array<{ payload: string }>;
    return rows.map((row) => parseEvent(row.payload));
  }

  async listActive(): Promise<WeatherEvent[]> {
    const placeholders = [...TERMINAL].map(() => "?").join(", ");
    const rows = this.database()
      .prepare(
        `SELECT payload FROM weather_events WHERE status NOT IN (${placeholders}) ORDER BY created_at ASC`,
      )
      .all(...TERMINAL) as Array<{ payload: string }>;
    return rows.map((row) => parseEvent(row.payload));
  }

  async latestActive(): Promise<WeatherEvent | undefined> {
    const active = await this.listActive();
    return active.at(-1);
  }

  async upsert(event: WeatherEvent): Promise<void> {
    this.database()
      .prepare(
        `INSERT INTO weather_events (id, status, created_at, updated_at, payload)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at,
           payload = excluded.payload`,
      )
      .run(event.id, event.status, event.createdAt, event.updatedAt, JSON.stringify(event));
  }

  private database(): DatabaseSync {
    if (!this.db) throw new Error("SqliteEventStore.init() must be called first.");
    return this.db;
  }

  private async importLegacyJsonOnce(): Promise<void> {
    if (!this.legacyJsonPath) return;
    const count = this.database()
      .prepare("SELECT COUNT(*) AS count FROM weather_events")
      .get() as { count: number };
    if (count.count > 0) return;

    try {
      const raw = await (await import("node:fs/promises")).readFile(this.legacyJsonPath, "utf8");
      const events = JSON.parse(raw) as WeatherEvent[];
      const insert = this.database().prepare(
        "INSERT OR IGNORE INTO weather_events (id, status, created_at, updated_at, payload) VALUES (?, ?, ?, ?, ?)",
      );
      this.database().exec("BEGIN");
      try {
        for (const event of events) {
          insert.run(event.id, event.status, event.createdAt, event.updatedAt, JSON.stringify(event));
        }
        this.database().exec("COMMIT");
      } catch (error) {
        this.database().exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function parseEvent(payload: string): WeatherEvent {
  return JSON.parse(payload) as WeatherEvent;
}
