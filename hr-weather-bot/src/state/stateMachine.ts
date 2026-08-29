import type { EventStatus } from "../types.js";

/**
 * Explicit allow-list of state transitions. Anything not listed is rejected,
 * which enforces double-send protection and lifecycle integrity at the
 * application layer (never rely on the AI for this).
 */
const ALLOWED: Record<EventStatus, EventStatus[]> = {
  DETECTED: ["WAITING_FOR_APPROVAL", "DISCARDED"],
  WAITING_FOR_APPROVAL: ["APPROVED", "DISCARDED"],
  APPROVED: ["SENDING"],
  SENDING: ["SENT", "SEND_FAILED"],
  SENT: [],
  SEND_FAILED: ["SENDING", "DISCARDED"],
  DISCARDED: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: EventStatus, to: EventStatus) {
    super(`Invalid transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function assertTransition(from: EventStatus, to: EventStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
