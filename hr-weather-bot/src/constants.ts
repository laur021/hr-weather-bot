/**
 * Hard-coded identity constants from the HR Weather Advisory System spec.
 * These are the source of truth unless overridden via environment config.
 */
export const BOT_USERNAME = "AblazeHRAssistantBot";

/** Authorized HR group — the only chat allowed to drive the workflow. */
export const AUTHORIZED_HR_CHAT_ID = -5368977850;

/** Employee-facing announcement group — output-only for this workflow. */
export const EMPLOYEE_CHAT_ID = -5324314507;

/** Callback data prefixes. Parsed as `action:eventId[:extra]`. */
export const CB = {
  compose: "compose",
  send: "send",
  edit: "edit",
  discard: "discard",
  status: "status",
} as const;

export type CallbackAction = (typeof CB)[keyof typeof CB];
