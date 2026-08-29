export type EventStatus =
  | "DETECTED" // event created + HR alerted (Compose Draft / Discard)
  | "WAITING_FOR_APPROVAL" // draft composed + preview shown (Send / Edit / Discard)
  | "APPROVED" // HR clicked Send; validated + locked for send
  | "SENDING" // employee Telegram send in flight
  | "SENT" // confirmed delivered to employees
  | "SEND_FAILED" // employee send failed (retryable)
  | "DISCARDED";

export type Severity = "watch" | "warning" | "emergency";

export interface WeatherThreat {
  severity: Severity;
  title: string;
  description: string;
  source: string;
  detectedAt: string; // ISO timestamp
  raw?: unknown;
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

export interface WeatherEvent {
  id: string;
  status: EventStatus;
  createdAt: string;
  updatedAt: string;

  weather: WeatherThreat;

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
}

export interface SendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

/** Telegram-button abstraction so the workflow stays decoupled from grammY. */
export type Button = { text: string; data: string };
export type Keyboard = Button[][];

export interface Messenger {
  sendToHr(text: string, keyboard?: Keyboard): Promise<void>;
  sendToEmployees(text: string): Promise<SendResult>;
}
