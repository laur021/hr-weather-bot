import type { WeatherEvent } from "../types.js";

export interface EventStore {
  init(): Promise<void>;
  get(id: string): Promise<WeatherEvent | undefined>;
  list(): Promise<WeatherEvent[]>;
  listActive(): Promise<WeatherEvent[]>;
  upsert(event: WeatherEvent): Promise<void>;
  /** Latest active (non-DISCARDED) event, or undefined. */
  latestActive(): Promise<WeatherEvent | undefined>;
}
