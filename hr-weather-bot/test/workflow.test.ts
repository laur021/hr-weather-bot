import { beforeEach, describe, expect, it } from "vitest";
import type { AiProvider } from "../src/ai/prompts.js";
import type { EventStore } from "../src/store/store.js";
import type {
  Keyboard,
  Messenger,
  PagasaVerification,
  SendResult,
  TelegramUser,
  WeatherEvent,
  WeatherThreat,
} from "../src/types.js";
import {
  formatHrWeatherAlert,
  formatHrWeatherUpdate,
  WeatherWorkflow,
} from "../src/workflow.js";
import { kmhToMs } from "../src/weather/classify.js";

const HR = 5368977850;
const EMP = 5324314507;

const ALICE: TelegramUser = { id: 111, username: "alice", displayName: "Alice HR" };

class FakeStore implements EventStore {
  map = new Map<string, WeatherEvent>();
  async init(): Promise<void> {}
  async get(id: string): Promise<WeatherEvent | undefined> {
    return this.map.get(id);
  }
  async list(): Promise<WeatherEvent[]> {
    return [...this.map.values()];
  }
  async listActive(): Promise<WeatherEvent[]> {
    return [...this.map.values()].filter(
      (e) => e.status !== "SENT" && e.status !== "DISCARDED",
    );
  }
  async latestActive(): Promise<WeatherEvent | undefined> {
    return this.listActive().then((a) => a[a.length - 1]);
  }
  async upsert(event: WeatherEvent): Promise<void> {
    this.map.set(event.id, structuredClone(event));
  }
}

class FakeAi implements AiProvider {
  async composeDraft(w: WeatherThreat): Promise<string> {
    return `Attention: ${w.title} (${w.severity}). ${w.description}`;
  }
  async reviseDraft(current: string, instruction: string): Promise<string> {
    return `${current} [revised: ${instruction}]`;
  }
  async validateLocation(input: string) {
    return { isLegitimate: true, normalizedLocation: input };
  }
  async searchWeather(location: string) {
    return {
      location,
      condition: "Unavailable",
      rainChancePercent: 0,
      expectedRainfallMm: 0,
      peakWindGustKmh: 0,
    };
  }
}

class FakeMessenger implements Messenger {
  hr: string[] = [];
  hrMessages: Array<{ text: string; keyboard?: Keyboard }> = [];
  employees: string[] = [];
  employeeResult: SendResult = { ok: true, messageId: 42 };

  async sendToHr(text: string, keyboard?: Keyboard): Promise<void> {
    this.hr.push(text);
    this.hrMessages.push({ text, keyboard });
  }
  async sendToEmployees(text: string): Promise<SendResult> {
    this.employees.push(text);
    return this.employeeResult;
  }
}

function setup() {
  const store = new FakeStore();
  const ai = new FakeAi();
  const messenger = new FakeMessenger();
  const workflow = new WeatherWorkflow(store, ai, messenger, HR, EMP);
  return { store, ai, messenger, workflow };
}

function makeThreat(overrides: Partial<WeatherThreat> = {}): WeatherThreat {
  return {
    severity: "warning",
    title: "Severe Tropical Storm",
    description: "Heavy rain expected.",
    source: "test",
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeOfficial(
  overrides: Partial<PagasaVerification> = {},
): PagasaVerification {
  return {
    officialVerificationStatus: "VERIFIED",
    sourceUrl: "https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin",
    checkedAt: "2026-09-01T03:00:00.000Z",
    bulletinId: "auring-TCB-1",
    bulletinNumber: "1",
    bulletinVersion: "1",
    bulletinHash: "hash-1",
    cycloneName: "AURING",
    cycloneClassification: "Tropical Storm",
    windSignals: ["Tropical Cyclone Wind Signal No. 1: Metro Manila"],
    areasAffected: ["Metro Manila"],
    officeAreaExplicitlyAffected: true,
    directCycloneImpact: true,
    ...overrides,
  };
}

async function detectEvent(workflow: WeatherWorkflow) {
  await workflow.onWeatherDetected(makeThreat());
  const store = (workflow as unknown as { store: FakeStore }).store;
  return (await store.latestActive())!;
}

async function sendEvent(
  ctx: ReturnType<typeof setup>,
  threat: WeatherThreat = makeThreat(),
): Promise<WeatherEvent> {
  await ctx.workflow.onWeatherDetected(threat);
  const event = (await ctx.store.listActive())[0]!;
  await ctx.workflow.compose(HR, event.id, ALICE);
  await ctx.workflow.send(HR, event.id, 1, ALICE);
  return (await ctx.store.get(event.id))!;
}

describe("WeatherWorkflow", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("detects weather and notifies HR with alert", async () => {
    await ctx.workflow.onWeatherDetected(makeThreat());
    expect(ctx.messenger.hr.length).toBeGreaterThan(0);
    expect(ctx.messenger.employees).toHaveLength(0);
    const active = await ctx.store.latestActive();
    expect(active?.status).toBe("DETECTED");
  });

  it("keeps weather events separate when the same threat occurs in different locations", async () => {
    const first = makeThreat({
      hrAdvisory: {
        location: "Taipei, Taiwan",
        condition: "Thunderstorm",
        rainChancePercent: 92,
        expectedRainfallMm: 10,
        peakWindGustMs: kmhToMs(38),
      },
    });
    const second = makeThreat({
      hrAdvisory: { ...first.hrAdvisory!, location: "Metro Manila" },
    });

    await ctx.workflow.onWeatherDetected(first);
    await ctx.workflow.onWeatherDetected(second);

    expect(await ctx.store.listActive()).toHaveLength(2);
  });

  it("formats a readable, action-oriented HR weather advisory", () => {
    expect(
      formatHrWeatherAlert(
        makeThreat({
          severity: "watch",
          hrAdvisory: {
            location: "Taipei, Taiwan",
            condition: "Thunderstorm",
            rainChancePercent: 92,
            expectedRainfallMm: 10,
            peakWindGustMs: kmhToMs(38),
          },
        }),
      ),
    ).toBe(
      "🟡 <b>WATCH — Weather Watch</b>\n" +
        "<b>Office:</b> Taipei, Taiwan\n" +
        "<b>Local forecast:</b> A thunderstorm is expected today, with a 92% chance of rain, around 10 mm expected rainfall, and wind gusts reaching up to 38 km/h (10.56 m/s).\n" +
        "<b>HR recommendation:</b> Please monitor weather and transport conditions closely throughout the day. Prepare a staff advisory if conditions worsen, particularly for employees travelling to or from the office. No work-suspension announcement is recommended at this time.\n" +
        "Next update: as conditions change or in the next scheduled weather check.",
    );
  });

  it("formats a location-specific clear-weather update using the same layout", () => {
    expect(
      formatHrWeatherUpdate("Metro Manila", {
        location: "Metro Manila",
        condition: "Overcast",
        rainChancePercent: 20,
        expectedRainfallMm: 1,
        peakWindGustMs: kmhToMs(16),
      }),
    ).toContain("ℹ️ <b>INFO — Weather Update</b>");
  });

  it("returns compose actions with a detected advisory status", async () => {
    const event = await detectEvent(ctx.workflow);
    const status = await ctx.workflow.latestStatusWithActions();

    expect(status.text).toContain(event.id);
    expect(status.keyboard).toEqual([
      [
        { text: "📝 Compose Draft", data: `compose:${event.id}` },
        { text: "❌ Discard", data: `discard:${event.id}` },
      ],
    ]);
  });

  it("requires confirmation before sending a manual announcement", async () => {
    await ctx.workflow.createManualAnnouncement(
      HR,
      "The office will close at 3 PM today.",
      ALICE,
    );

    const event = (await ctx.store.listActive())[0]!;
    expect(event.kind).toBe("manual");
    expect(event.status).toBe("WAITING_FOR_APPROVAL");
    expect(event.draft?.text).toBe("The office will close at 3 PM today.");
    expect(ctx.messenger.employees).toHaveLength(0);

    await ctx.workflow.send(HR, event.id, 1, ALICE);

    expect(ctx.messenger.employees).toEqual(["The office will close at 3 PM today."]);
    expect((await ctx.store.get(event.id))?.monitoring).toBeUndefined();
  });

  it("rejects privileged actions from non-HR chat", async () => {
    const event = await detectEvent(ctx.workflow);
    await expect(ctx.workflow.compose(EMP, event.id, ALICE)).rejects.toThrow(
      /authorized HR group/,
    );
    await expect(ctx.workflow.send(EMP, event.id, 1, ALICE)).rejects.toThrow(
      /authorized HR group/,
    );
  });

  it("happy path: compose -> send -> SENT, employees receive it", async () => {
    const event = await detectEvent(ctx.workflow);

    await ctx.workflow.compose(HR, event.id, ALICE);
    const composed = (await ctx.store.get(event.id))!;
    expect(composed.status).toBe("WAITING_FOR_APPROVAL");
    expect(composed.draft?.version).toBe(1);
    expect(composed.createdByDisplayName).toBe("Alice HR");

    await ctx.workflow.send(HR, event.id, 1, ALICE);
    const sent = (await ctx.store.get(event.id))!;
    expect(sent.status).toBe("SENT");
    expect(sent.approvedDraftVersion).toBe(1);
    expect(sent.approvedByDisplayName).toBe("Alice HR");
    expect(ctx.messenger.employees).toHaveLength(1);
    expect(ctx.messenger.employees[0]).toContain("Severe Tropical Storm");
    expect(sent.monitoring?.mode).toBe("PENDING");
    expect(ctx.messenger.hrMessages.at(-1)?.keyboard?.[0].map((b) => b.text)).toEqual([
      "🛑 Stop alerts today",
      "🔔 Continue monitoring",
    ]);
  });

  it("suppresses duplicate weather alerts for an existing active event", async () => {
    await ctx.workflow.onWeatherDetected(makeThreat());
    expect(ctx.messenger.hr).toHaveLength(1);

    await ctx.workflow.onWeatherDetected(
      makeThreat({ description: "Heavy rain is still expected." }),
    );
    expect(ctx.messenger.hr).toHaveLength(1);
    const event = (await ctx.store.listActive())[0]!;
    expect(event.weather.description).toBe("Heavy rain is still expected.");

    await ctx.workflow.compose(HR, event.id, ALICE);
    expect(ctx.messenger.hr).toHaveLength(2);
    await ctx.workflow.onWeatherDetected(makeThreat());
    expect(ctx.messenger.hr).toHaveLength(2);
  });

  it("saves a newer bulletin hash without alerting again when risk is unchanged", async () => {
    const advisory = {
      location: "Metro Manila",
      condition: "Thunderstorm",
      rainChancePercent: 90,
      expectedRainfallMm: 60,
      peakWindGustMs: 10,
    };
    await ctx.workflow.onWeatherDetected(
      makeThreat({ hrAdvisory: advisory, officialPagasa: makeOfficial() }),
    );
    const first = (await ctx.store.listActive())[0]!;
    await ctx.workflow.onWeatherDetected(
      makeThreat({
        hrAdvisory: advisory,
        officialPagasa: makeOfficial({
          bulletinId: "auring-TCB-2",
          bulletinNumber: "2",
          bulletinVersion: "2",
          bulletinHash: "hash-2",
        }),
      }),
    );

    expect(ctx.messenger.hr).toHaveLength(1);
    expect(await ctx.store.listActive()).toHaveLength(1);
    expect((await ctx.store.get(first.id))?.weather.officialPagasa?.bulletinHash).toBe(
      "hash-2",
    );
  });

  it("creates a controlled revision when official risk changes during draft review", async () => {
    const advisory = {
      location: "Metro Manila",
      condition: "Thunderstorm",
      rainChancePercent: 90,
      expectedRainfallMm: 60,
      peakWindGustMs: 10,
    };
    await ctx.workflow.onWeatherDetected(
      makeThreat({ hrAdvisory: advisory, officialPagasa: makeOfficial() }),
    );
    const original = (await ctx.store.listActive())[0]!;
    await ctx.workflow.compose(HR, original.id, ALICE);

    await ctx.workflow.onWeatherDetected(
      makeThreat({
        severity: "warning",
        title: "Severe Tropical Storm AURING — PAGASA-verified office impact",
        hrAdvisory: advisory,
        officialPagasa: makeOfficial({
          bulletinId: "auring-TCB-2",
          bulletinNumber: "2",
          bulletinVersion: "2",
          bulletinHash: "hash-2",
          cycloneClassification: "Severe Tropical Storm",
        }),
      }),
    );

    const active = await ctx.store.listActive();
    expect(active).toHaveLength(2);
    expect(active.at(-1)?.revisionOfEventId).toBe(original.id);
    expect(active.at(-1)?.status).toBe("DETECTED");
    expect((await ctx.store.get(original.id))?.status).toBe("WAITING_FOR_APPROVAL");
  });

  it("stops same-or-lower severity alerts but permits escalation", async () => {
    const sent = await sendEvent(ctx);
    await ctx.workflow.chooseMonitoring(HR, sent.id, "STOPPED", ALICE);
    const before = ctx.messenger.hr.length;

    await ctx.workflow.onWeatherDetected(makeThreat({ severity: "watch" }));
    expect(ctx.messenger.hr).toHaveLength(before);

    await ctx.workflow.onWeatherDetected(makeThreat({ severity: "emergency" }));
    expect(ctx.messenger.hr).toHaveLength(before + 1);
    expect((await ctx.store.listActive())[0]?.weather.severity).toBe("emergency");
  });

  it("continues monitoring only when the threat type or severity changes", async () => {
    const sent = await sendEvent(ctx);
    await ctx.workflow.chooseMonitoring(HR, sent.id, "CONTINUING", ALICE);
    const before = ctx.messenger.hr.length;

    await ctx.workflow.onWeatherDetected(makeThreat());
    expect(ctx.messenger.hr).toHaveLength(before);

    await ctx.workflow.onWeatherDetected(
      makeThreat({ title: "Flash Flood Warning" }),
    );
    expect(ctx.messenger.hr).toHaveLength(before + 1);
  });

  it("rejects a monitoring choice from a non-HR chat", async () => {
    const sent = await sendEvent(ctx);
    await expect(
      ctx.workflow.chooseMonitoring(EMP, sent.id, "STOPPED", ALICE),
    ).rejects.toThrow(/authorized HR group/);
  });

  it("blocks a second send (double-send protection)", async () => {
    const event = await detectEvent(ctx.workflow);
    await ctx.workflow.compose(HR, event.id, ALICE);
    await ctx.workflow.send(HR, event.id, 1, ALICE);

    await expect(ctx.workflow.send(HR, event.id, 1, ALICE)).rejects.toMatchObject(
      { code: "ALREADY_SENT" },
    );
    expect(ctx.messenger.employees).toHaveLength(1); // still exactly one
  });

  it("rejects a stale approval after a newer edit", async () => {
    const event = await detectEvent(ctx.workflow);
    await ctx.workflow.compose(HR, event.id, ALICE); // v1
    await ctx.workflow.edit(HR, event.id, "make it shorter", ALICE); // v2

    // Approving v1 must fail with STALE_APPROVAL.
    await expect(ctx.workflow.send(HR, event.id, 1, ALICE)).rejects.toMatchObject(
      { code: "STALE_APPROVAL" },
    );

    // Approving v2 succeeds.
    await ctx.workflow.send(HR, event.id, 2, ALICE);
    expect((await ctx.store.get(event.id))?.status).toBe("SENT");
  });

  it("records multiple drafts and sends the latest version", async () => {
    const event = await detectEvent(ctx.workflow);
    await ctx.workflow.compose(HR, event.id, ALICE);
    await ctx.workflow.edit(HR, event.id, "more formal", ALICE);
    await ctx.workflow.edit(HR, event.id, "add flooding advice", ALICE);

    const before = (await ctx.store.get(event.id))!;
    expect(before.draft?.version).toBe(3);
    expect(before.draftHistory.map((d) => d.version)).toEqual([1, 2, 3]);

    await ctx.workflow.send(HR, event.id, 3, ALICE);
    expect(ctx.messenger.employees[0]).toContain("[revised: add flooding advice]");
  });

  it("saves an HR-written replacement as the next draft version", async () => {
    const event = await detectEvent(ctx.workflow);
    await ctx.workflow.compose(HR, event.id, ALICE);

    const replacement = "All employees may work from home today due to flooding risk.";
    await ctx.workflow.replaceDraft(HR, event.id, replacement, ALICE);

    const updated = (await ctx.store.get(event.id))!;
    expect(updated.draft?.version).toBe(2);
    expect(updated.draft?.text).toBe(replacement);
    expect(updated.draftHistory).toHaveLength(2);
    expect(ctx.messenger.hr.at(-1)).toContain("Draft — Version 2");
  });

  it("discard prevents sending", async () => {
    const event = await detectEvent(ctx.workflow);
    await ctx.workflow.compose(HR, event.id, ALICE);
    await ctx.workflow.discard(HR, event.id, ALICE);

    expect((await ctx.store.get(event.id))?.status).toBe("DISCARDED");
    await expect(ctx.workflow.send(HR, event.id, 1, ALICE)).rejects.toMatchObject(
      { code: "INVALID_STATE" },
    );
    expect(ctx.messenger.employees).toHaveLength(0);
  });

  it("free-text edit targets the latest draft", async () => {
    const event = await detectEvent(ctx.workflow);
    await ctx.workflow.compose(HR, event.id, ALICE);
    await ctx.workflow.editLatest(HR, "include WFH instructions", ALICE);

    expect((await ctx.store.get(event.id))?.draft?.version).toBe(2);
  });
});
