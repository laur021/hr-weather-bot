import { describe, it, expect } from "vitest";
import {
  InvalidTransitionError,
  assertTransition,
  canTransition,
} from "../src/state/stateMachine.js";

describe("stateMachine", () => {
  it("allows the happy path", () => {
    expect(canTransition("DETECTED", "WAITING_FOR_APPROVAL")).toBe(true);
    expect(canTransition("WAITING_FOR_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "SENDING")).toBe(true);
    expect(canTransition("SENDING", "SENT")).toBe(true);
    expect(canTransition("SENDING", "SEND_FAILED")).toBe(true);
    expect(canTransition("SEND_FAILED", "SENDING")).toBe(true);
  });

  it("allows discard from pre-send states", () => {
    expect(canTransition("DETECTED", "DISCARDED")).toBe(true);
    expect(canTransition("WAITING_FOR_APPROVAL", "DISCARDED")).toBe(true);
    expect(canTransition("SEND_FAILED", "DISCARDED")).toBe(true);
    expect(canTransition("SENT", "DISCARDED")).toBe(false);
  });

  it("blocks double-send / illegal transitions", () => {
    expect(canTransition("SENT", "APPROVED")).toBe(false);
    expect(canTransition("SENDING", "APPROVED")).toBe(false);
    expect(canTransition("SENT", "SENDING")).toBe(false);
    expect(canTransition("APPROVED", "WAITING_FOR_APPROVAL")).toBe(false);
  });

  it("throws on invalid transitions", () => {
    expect(() => assertTransition("SENT", "APPROVED")).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertTransition("DETECTED", "SENT")).toThrow(
      InvalidTransitionError,
    );
  });
});
