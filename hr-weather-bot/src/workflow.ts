import type { AiProvider } from "./ai/prompts.js";
import { assertHrChat } from "./auth.js";
import { CB } from "./constants.js";
import { encodeCallback } from "./telegram/callback.js";
import { formatManila, makeEventId, manilaDay, nowIso } from "./time.js";
import type { EventStore } from "./store/store.js";
import { assertTransition } from "./state/stateMachine.js";
import type {
  Keyboard,
  Messenger,
  MonitoringMode,
  TelegramUser,
  WeatherEvent,
  WeatherThreat,
} from "./types.js";

export class WorkflowError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_STATE"
      | "STALE_APPROVAL"
      | "ALREADY_SENT"
      | "NO_ACTIVE_DRAFT",
    message: string,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

const SEVERITY_ICON: Record<string, string> = {
  watch: "🟡",
  warning: "🟠",
  emergency: "🔴",
};

const SEVERITY_ORDER = { watch: 1, warning: 2, emergency: 3 } as const;

export class WeatherWorkflow {
  /** Serializes mutations per event to prevent lost updates on concurrent edits. */
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: EventStore,
    private readonly ai: AiProvider,
    private readonly messenger: Messenger,
    private readonly hrChatId: number,
    private readonly employeeChatId: number,
  ) {}

  // ---------------------------------------------------------------------
  // Weather detection (automatic)
  // ---------------------------------------------------------------------
  async onWeatherDetected(threat: WeatherThreat): Promise<void> {
    const existing = await this.findEventFor(threat);
    if (existing) {
      const updated: WeatherEvent = {
        ...existing,
        weather: { ...threat, detectedAt: existing.weather.detectedAt },
        updatedAt: nowIso(),
      };
      await this.store.upsert(updated);
      return;
    }

    const monitoring = await this.latestMonitoringForToday();
    if (monitoring && !this.shouldNotifyAfterSentAdvisory(threat, monitoring)) {
      return;
    }

    const id = makeEventId(nowIso(), await this.nextSeq());
    const event: WeatherEvent = {
      id,
      status: "DETECTED",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      weather: threat,
      draftHistory: [],
    };
    await this.store.upsert(event);
    await this.notifyHrAlert(event);
  }

  /** Create an HR-authored announcement that still requires explicit approval. */
  async createManualAnnouncement(
    chatId: number | null | undefined,
    text: string,
    user: TelegramUser,
  ): Promise<void> {
    assertHrChat(chatId, this.hrChatId);
    const announcement = text.trim();
    if (!announcement) {
      throw new WorkflowError("INVALID_STATE", "The announcement cannot be empty.");
    }

    const createdAt = nowIso();
    const draft = {
      version: 1,
      text: announcement,
      editedByTelegramUserId: user.id,
      editedByTelegramUsername: user.username,
      editedByDisplayName: user.displayName,
      editedAt: createdAt,
    };
    const event: WeatherEvent = {
      id: makeEventId(createdAt, await this.nextSeq(), "announcement"),
      kind: "manual",
      status: "WAITING_FOR_APPROVAL",
      createdAt,
      updatedAt: createdAt,
      // This placeholder is never used for weather monitoring or alerts.
      weather: {
        severity: "watch",
        title: "Manual announcement",
        description: "",
        source: "manual",
        detectedAt: createdAt,
      },
      draft,
      draftHistory: [draft],
      createdByTelegramUserId: user.id,
      createdByTelegramUsername: user.username,
      createdByDisplayName: user.displayName,
    };
    await this.store.upsert(event);
    await this.sendDraftPreview(event);
  }

  // ---------------------------------------------------------------------
  // HR actions
  // ---------------------------------------------------------------------
  async compose(chatId: number | null | undefined, eventId: string, user: TelegramUser): Promise<void> {
    assertHrChat(chatId, this.hrChatId);
    await this.withLock(eventId, async () => {
      const event = await this.mustGet(eventId);
      assertTransition(event.status, "WAITING_FOR_APPROVAL");

      const text = await this.ai.composeDraft(event.weather);
      const draft = {
        version: 1,
        text,
        editedByTelegramUserId: user.id,
        editedByTelegramUsername: user.username,
        editedByDisplayName: user.displayName,
        editedAt: nowIso(),
      };

      const updated: WeatherEvent = {
        ...event,
        status: "WAITING_FOR_APPROVAL",
        updatedAt: nowIso(),
        draft,
        draftHistory: [draft],
        createdByTelegramUserId: user.id,
        createdByTelegramUsername: user.username,
        createdByDisplayName: user.displayName,
      };
      await this.store.upsert(updated);
      await this.sendDraftPreview(updated);
    });
  }

  async edit(
    chatId: number | null | undefined,
    eventId: string,
    instruction: string,
    user: TelegramUser,
  ): Promise<void> {
    assertHrChat(chatId, this.hrChatId);
    await this.withLock(eventId, async () => {
      const event = await this.mustGet(eventId);
      if (event.status !== "WAITING_FOR_APPROVAL" || !event.draft) {
        throw new WorkflowError("INVALID_STATE", "There is no draft awaiting edits for this event.");
      }

      const revised = await this.ai.reviseDraft(event.draft.text, instruction);
      const draft = {
        version: event.draft.version + 1,
        text: revised,
        editedByTelegramUserId: user.id,
        editedByTelegramUsername: user.username,
        editedByDisplayName: user.displayName,
        editedAt: nowIso(),
      };

      const updated: WeatherEvent = {
        ...event,
        updatedAt: nowIso(),
        draft,
        draftHistory: [...event.draftHistory, draft],
      };
      await this.store.upsert(updated);
      await this.sendDraftPreview(updated);
    });
  }

  /** Save a complete replacement drafted by HR, without AI rewriting it. */
  async replaceDraft(
    chatId: number | null | undefined,
    eventId: string,
    text: string,
    user: TelegramUser,
  ): Promise<void> {
    assertHrChat(chatId, this.hrChatId);
    const replacement = text.trim();
    if (!replacement) {
      throw new WorkflowError("INVALID_STATE", "The replacement draft cannot be empty.");
    }

    await this.withLock(eventId, async () => {
      const event = await this.mustGet(eventId);
      if (event.status !== "WAITING_FOR_APPROVAL" || !event.draft) {
        throw new WorkflowError("INVALID_STATE", "There is no draft awaiting edits for this event.");
      }

      const draft = {
        version: event.draft.version + 1,
        text: replacement,
        editedByTelegramUserId: user.id,
        editedByTelegramUsername: user.username,
        editedByDisplayName: user.displayName,
        editedAt: nowIso(),
      };
      const updated: WeatherEvent = {
        ...event,
        updatedAt: nowIso(),
        draft,
        draftHistory: [...event.draftHistory, draft],
      };
      await this.store.upsert(updated);
      await this.sendDraftPreview(updated);
    });
  }

  async send(
    chatId: number | null | undefined,
    eventId: string,
    approvedVersion: number | undefined,
    user: TelegramUser,
  ): Promise<void> {
    assertHrChat(chatId, this.hrChatId);
    await this.withLock(eventId, async () => {
      const event = await this.mustGet(eventId);

      // Double-send / lifecycle protection (application-enforced).
      if (event.status === "SENDING" || event.status === "SENT") {
        throw new WorkflowError(
          "ALREADY_SENT",
          "This announcement has already been sent or is currently being sent.",
        );
      }
      if (event.status !== "WAITING_FOR_APPROVAL" || !event.draft) {
        throw new WorkflowError("INVALID_STATE", "This event is not awaiting approval.");
      }

      // Concurrent-edit protection: version must match the latest draft.
      if (approvedVersion !== undefined && approvedVersion !== event.draft.version) {
        throw new WorkflowError(
          "STALE_APPROVAL",
          "This announcement has been updated since this approval message was created. Please review the latest version before sending.",
        );
      }

      const approved: WeatherEvent = {
        ...event,
        status: "APPROVED",
        updatedAt: nowIso(),
        approvedByTelegramUserId: user.id,
        approvedByTelegramUsername: user.username,
        approvedByDisplayName: user.displayName,
        approvedAt: nowIso(),
        approvedDraftVersion: event.draft.version,
      };
      await this.store.upsert(approved);

      await this.doEmployeeSend(approved);
    });
  }

  async discard(
    chatId: number | null | undefined,
    eventId: string,
    user: TelegramUser,
  ): Promise<void> {
    assertHrChat(chatId, this.hrChatId);
    await this.withLock(eventId, async () => {
      const event = await this.mustGet(eventId);
      assertTransition(event.status, "DISCARDED");

      const updated: WeatherEvent = {
        ...event,
        status: "DISCARDED",
        updatedAt: nowIso(),
      };
      await this.store.upsert(updated);
      await this.messenger.sendToHr(
        `❌ Discarded\n\nEvent ${event.id} was discarded. No announcement was sent to employees.`,
      );
    });
  }

  async retrySend(
    chatId: number | null | undefined,
    eventId: string,
    user: TelegramUser,
  ): Promise<void> {
    assertHrChat(chatId, this.hrChatId);
    await this.withLock(eventId, async () => {
      const event = await this.mustGet(eventId);
      if (event.status !== "SEND_FAILED" || !event.draft) {
        throw new WorkflowError("INVALID_STATE", "Only a failed send can be retried.");
      }
      await this.doEmployeeSend({ ...event, status: "APPROVED" });
    });
  }

  /** Record HR's same-day preference after an employee announcement is sent. */
  async chooseMonitoring(
    chatId: number | null | undefined,
    eventId: string,
    mode: Extract<MonitoringMode, "CONTINUING" | "STOPPED">,
    user: TelegramUser,
  ): Promise<void> {
    assertHrChat(chatId, this.hrChatId);
    await this.withLock(eventId, async () => {
      const event = await this.mustGet(eventId);
      if (
        event.status !== "SENT" ||
        !event.monitoring ||
        event.monitoring.day !== manilaDay()
      ) {
        throw new WorkflowError(
          "INVALID_STATE",
          "This monitoring choice is available only for an advisory sent today.",
        );
      }

      const updated: WeatherEvent = {
        ...event,
        updatedAt: nowIso(),
        monitoring: {
          ...event.monitoring,
          mode,
          decidedByTelegramUserId: user.id,
          decidedByTelegramUsername: user.username,
          decidedByDisplayName: user.displayName,
          decidedAt: nowIso(),
        },
      };
      await this.store.upsert(updated);
      await this.messenger.sendToHr(
        mode === "STOPPED"
          ? "🛑 HR weather alerts are stopped for the rest of today. A higher severity alert will still be shown."
          : "🔔 Monitoring continues. HR will be alerted only if the weather threat type or severity changes.",
      );
    });
  }

  async latestStatus(): Promise<string> {
    const event = await this.latestWeatherActive();
    if (!event) {
      return "🌤️ No active weather advisories.";
    }
    const icon = SEVERITY_ICON[event.weather.severity] ?? "ℹ️";
    const statusLine =
      event.status === "WAITING_FOR_APPROVAL" && event.draft
        ? `Draft v${event.draft.version} awaiting approval`
        : event.status.replace(/_/g, " ");
    return [
      `${icon} Latest weather advisory`,
      ``,
      `${event.weather.title} (${event.weather.severity.toUpperCase()})`,
      event.weather.description,
      ``,
      `Event: ${event.id}`,
      `Status: ${statusLine}`,
      `Detected: ${formatManila(event.weather.detectedAt)}`,
    ].join("\n");
  }

  /** Latest advisory text plus the actions that are valid for its current state. */
  async latestStatusWithActions(): Promise<{ text: string; keyboard?: Keyboard }> {
    const event = await this.latestWeatherActive();
    if (!event) return { text: await this.latestStatus() };

    const keyboard =
      event.status === "DETECTED"
        ? this.alertKeyboard(event.id)
        : event.status === "WAITING_FOR_APPROVAL" && event.draft
          ? this.draftKeyboard(event.id, event.draft.version)
          : event.status === "SEND_FAILED" && event.draft
            ? [[{ text: "🔁 Retry Send", data: encodeCallback(CB.send, event.id, event.draft.version) }]]
            : undefined;

    return { text: await this.latestStatus(), keyboard };
  }

  /** Edit the latest active draft (for free-text HR instructions). */
  async editLatest(
    chatId: number | null | undefined,
    instruction: string,
    user: TelegramUser,
  ): Promise<void> {
    assertHrChat(chatId, this.hrChatId);
    const active = await this.store.latestActive();
    if (!active) {
      throw new WorkflowError("NO_ACTIVE_DRAFT", "There is no active weather event to edit.");
    }
    if (active.status !== "WAITING_FOR_APPROVAL" || !active.draft) {
      throw new WorkflowError(
        "NO_ACTIVE_DRAFT",
        "There is no draft awaiting edits. Compose a draft first.",
      );
    }
    await this.edit(chatId, active.id, instruction, user);
  }

  /** Discard the latest active event (for free-text "Discard."). */
  async discardLatest(
    chatId: number | null | undefined,
    user: TelegramUser,
  ): Promise<void> {
    assertHrChat(chatId, this.hrChatId);
    const active = await this.store.latestActive();
    if (!active) {
      throw new WorkflowError("NO_ACTIVE_DRAFT", "There is no active weather event to discard.");
    }
    await this.discard(chatId, active.id, user);
  }

  /** Re-send the latest draft preview (used after a stale approval). */
  async showPreview(
    chatId: number | null | undefined,
    eventId: string,
  ): Promise<void> {
    assertHrChat(chatId, this.hrChatId);
    const event = await this.mustGet(eventId);
    if (!event.draft) {
      throw new WorkflowError("NO_ACTIVE_DRAFT", "No draft available for this event.");
    }
    await this.sendDraftPreview(event);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------
  private async doEmployeeSend(event: WeatherEvent): Promise<void> {
    const draft = event.draft;
    if (!draft) throw new WorkflowError("INVALID_STATE", "No draft to send.");

    await this.store.upsert({ ...event, status: "SENDING", updatedAt: nowIso() });

    const result = await this.messenger.sendToEmployees(draft.text);

    if (result.ok) {
      const sent: WeatherEvent = {
        ...event,
        status: "SENT",
        updatedAt: nowIso(),
        sentAt: nowIso(),
        sentMessageId: result.messageId,
        sendError: undefined,
        monitoring:
          event.kind === "manual"
            ? undefined
            : {
                day: manilaDay(),
                mode: "PENDING",
              },
      };
      await this.store.upsert(sent);
      if (event.kind === "manual") {
        await this.messenger.sendToHr(
          [
            "Manual announcement sent",
            "",
            "The approved announcement was sent to the employee group.",
            "",
            `Event: ${event.id} (draft v${draft.version})`,
            `Sent by: ${event.approvedByDisplayName ?? event.approvedByTelegramUsername ?? "HR"}`,
            `Time: ${formatManila(nowIso())}`,
          ].join("\n"),
        );
        return;
      }
      await this.messenger.sendToHr(
        [
          `✅ Announcement Sent`,
          ``,
          `The approved weather advisory was successfully sent to the employee group.`,
          ``,
          `Event: ${event.id} (draft v${draft.version})`,
          `Sent by: ${event.approvedByDisplayName ?? event.approvedByTelegramUsername ?? "HR"}`,
          `Time: ${formatManila(nowIso())}`,
          ``,
          `Would you like to receive another HR alert if weather conditions change later today?`,
        ].join("\n"),
        this.monitoringKeyboard(event.id),
      );
    } else {
      const failed: WeatherEvent = {
        ...event,
        status: "SEND_FAILED",
        updatedAt: nowIso(),
        sendError: result.error,
      };
      await this.store.upsert(failed);
      await this.messenger.sendToHr(
        [
          `⚠️ Announcement send failed`,
          ``,
          `Event: ${event.id} (draft v${draft.version})`,
          `Error: ${result.error ?? "unknown"}`,
          ``,
          `Use 🔁 Retry Send to try again.`,
        ].join("\n"),
        [[{ text: "🔁 Retry Send", data: encodeCallback(CB.send, event.id, draft.version) }]],
      );
    }
  }

  private async notifyHrAlert(event: WeatherEvent): Promise<void> {
    const icon = SEVERITY_ICON[event.weather.severity] ?? "ℹ️";
    await this.messenger.sendToHr(
      [
        `🚨 Weather Alert — ${event.weather.severity.toUpperCase()}`,
        ``,
        `${icon} ${event.weather.title}`,
        event.weather.description,
        ``,
        `Event: ${event.id}`,
        `Detected: ${formatManila(event.weather.detectedAt)}`,
      ].join("\n"),
      this.alertKeyboard(event.id),
    );
  }

  private async sendDraftPreview(event: WeatherEvent): Promise<void> {
    const draft = event.draft;
    if (!draft) return;
    await this.messenger.sendToHr(
      [
        `📝 Draft — Version ${draft.version}`,
        ``,
        draft.text,
        ``,
        `Event: ${event.id}`,
        `Status: WAITING FOR APPROVAL`,
      ].join("\n"),
      this.draftKeyboard(event.id, draft.version),
    );
  }

  private alertKeyboard(eventId: string): Keyboard {
    return [
      [
        { text: "📝 Compose Draft", data: encodeCallback(CB.compose, eventId) },
        { text: "❌ Discard", data: encodeCallback(CB.discard, eventId) },
      ],
    ];
  }

  private draftKeyboard(eventId: string, version: number): Keyboard {
    return [
      [
        { text: "✅ Send to Employees", data: encodeCallback(CB.send, eventId, version) },
        { text: "✏️ Edit", data: encodeCallback(CB.edit, eventId) },
        { text: "❌ Discard", data: encodeCallback(CB.discard, eventId) },
      ],
    ];
  }

  private monitoringKeyboard(eventId: string): Keyboard {
    return [
      [
        { text: "🛑 Stop alerts today", data: encodeCallback(CB.stopAlerts, eventId) },
        { text: "🔔 Continue monitoring", data: encodeCallback(CB.continueMonitoring, eventId) },
      ],
    ];
  }

  private async mustGet(eventId: string): Promise<WeatherEvent> {
    const event = await this.store.get(eventId);
    if (!event) throw new WorkflowError("NOT_FOUND", `Event ${eventId} not found.`);
    return event;
  }

  private async findEventFor(threat: WeatherThreat): Promise<WeatherEvent | undefined> {
    const active = await this.store.listActive();
    return active.find(
      (e) =>
        e.kind !== "manual" &&
        e.weather.title === threat.title &&
        e.weather.severity === threat.severity,
    );
  }

  private async latestWeatherActive(): Promise<WeatherEvent | undefined> {
    const active = await this.store.listActive();
    return active.filter((event) => event.kind !== "manual").at(-1);
  }

  private async latestMonitoringForToday(): Promise<WeatherEvent | undefined> {
    const today = manilaDay();
    const events = await this.store.list();
    return events.find(
      (event) =>
        event.kind !== "manual" &&
        event.status === "SENT" &&
        event.monitoring?.day === today &&
        Boolean(event.sentAt),
    );
  }

  private shouldNotifyAfterSentAdvisory(
    threat: WeatherThreat,
    sentEvent: WeatherEvent,
  ): boolean {
    const monitoring = sentEvent.monitoring;
    if (!monitoring) return true;

    const previousSeverity = SEVERITY_ORDER[sentEvent.weather.severity];
    const newSeverity = SEVERITY_ORDER[threat.severity];
    if (monitoring.mode === "STOPPED") {
      return newSeverity > previousSeverity;
    }

    // Pending and continuing monitoring both avoid repeat alerts, but allow
    // a severity or threat-type change to open a new HR approval workflow.
    return (
      threat.severity !== sentEvent.weather.severity ||
      threat.title !== sentEvent.weather.title
    );
  }

  private async nextSeq(): Promise<number> {
    const events = await this.store.list();
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = events.filter((e) => e.id.includes(today.replace(/-/g, ""))).length;
    return todayCount + 1;
  }

  private withLock<T>(eventId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(eventId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.locks.set(
      eventId,
      run.catch(() => undefined),
    );
    return run;
  }
}
