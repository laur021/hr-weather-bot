export type EventStatus =
  | "DETECTED" // event created + HR alerted (Compose Draft / Discard)
  | "WAITING_FOR_APPROVAL" // draft composed + preview shown (Send / Edit / Discard)
  | "APPROVED" // HR clicked Send; validated + locked for send
  | "SENDING" // employee Telegram send in flight
  | "SENT" // confirmed delivered to employees
  | "SEND_FAILED" // employee send failed (retryable)
  | "DISCARDED";

export type Severity = "watch" | "warning" | "emergency";
export type AnnouncementKind = "weather" | "manual";

export type OfficialVerificationStatus =
  | "VERIFIED"
  /** A PAGASA cyclone bulletin is active, but it does not verify a direct office impact. */
  | "ACTIVE_BULLETIN_NO_DIRECT_IMPACT"
  | "NO_APPLICABLE_BULLETIN"
  | "UNAVAILABLE";

export interface OfficeLocation {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  timezone: string;
  localityMatchList: string[];
}

export interface PagasaWeatherAdvisory {
  sourceUrl: string;
  checkedAt: string;
  advisoryNumber?: string;
  issuedAt?: string;
  cause?: string;
  outlook?: string;
  affectedAreaText?: string;
  officeAreaExplicitlyAffected: boolean;
  status: "AVAILABLE" | "UNAVAILABLE";
}

/** Structured official data only. Raw PAGASA HTML is never persisted or sent to AI. */
export interface PagasaVerification {
  officialVerificationStatus: OfficialVerificationStatus;
  sourceUrl: string;
  checkedAt: string;
  bulletinId?: string;
  bulletinNumber?: string;
  bulletinVersion?: string;
  bulletinHash?: string;
  bulletinIssuedAt?: string;
  bulletinValidUntil?: string;
  cycloneName?: string;
  cycloneClassification?: string;
  location?: string;
  movement?: string;
  rainfallOutlook?: string;
  rainfallCause?: string;
  windSignals: string[];
  areasAffected: string[];
  officeAreaExplicitlyAffected: boolean;
  directCycloneImpact: boolean;
  weatherAdvisory?: PagasaWeatherAdvisory;
  error?: string;
}

/** HR's choice for alerts after an employee advisory has been sent. */
export type MonitoringMode = "PENDING" | "CONTINUING" | "STOPPED";

/** Structured forecast details used only to make HR advisories actionable. */
export interface HrWeatherAdvisory {
  location: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  condition: string;
  rainChancePercent: number;
  expectedRainfallMm: number;
  /** Canonical internal wind unit. Convert to km/h only at display boundaries. */
  peakWindGustMs: number;
  officialPagasa?: PagasaVerification;
}

export interface WeatherThreat {
  severity: Severity;
  title: string;
  description: string;
  source: string;
  detectedAt: string; // ISO timestamp
  raw?: unknown;
  hrAdvisory?: HrWeatherAdvisory;
  officialPagasa?: PagasaVerification;
}

export interface DraftVersion {
  version: number;
  text: string;
  editedByTelegramUserId?: number;
  editedByTelegramUsername?: string;
  editedByDisplayName?: string;
  editedAt: string; // ISO timestamp
}

export interface TelegramUser {
  id: number;
  username?: string;
  displayName?: string;
}

export interface DailyMonitoringDecision {
  /** Manila calendar date, formatted YYYY-MM-DD. */
  day: string;
  mode: MonitoringMode;
  decidedByTelegramUserId?: number;
  decidedByTelegramUsername?: string;
  decidedByDisplayName?: string;
  decidedAt?: string;
}

export interface WeatherEvent {
  id: string;
  /** Omitted on legacy stored events, which are treated as weather advisories. */
  kind?: AnnouncementKind;
  status: EventStatus;
  createdAt: string;
  updatedAt: string;

  weather: WeatherThreat;

  /** Controlled revision metadata when official risk changes during approval. */
  revisionOfEventId?: string;
  revisionNumber?: number;

  /** Latest draft (authoritative version). */
  draft?: DraftVersion;
  /** All draft versions ever produced, oldest → newest. */
  draftHistory: DraftVersion[];

  // Audit — creation
  createdByTelegramUserId?: number;
  createdByTelegramUsername?: string;
  createdByDisplayName?: string;

  // Audit — approval
  approvedByTelegramUserId?: number;
  approvedByTelegramUsername?: string;
  approvedByDisplayName?: string;
  approvedAt?: string;
  approvedDraftVersion?: number;

  // Delivery
  sentAt?: string;
  sentMessageId?: number;
  sendError?: string;

  /** Same-day HR monitoring preference set after a successful send. */
  monitoring?: DailyMonitoringDecision;
}

export interface SendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

/** Telegram-button abstraction so the workflow stays decoupled from grammY. */
export type Button = { text: string; data: string };
export type Keyboard = Button[][];

export interface MessageOptions {
  parseMode?: "HTML";
}

export interface Messenger {
  sendToHr(text: string, keyboard?: Keyboard, options?: MessageOptions): Promise<void>;
  sendToEmployees(text: string): Promise<SendResult>;
}
