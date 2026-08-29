import { describe, it, expect } from "vitest";
import {
  AuthorizationError,
  assertHrChat,
  isEmployeeChat,
  isHrChat,
} from "../src/auth.js";

const HR = 5368977850;
const EMP = 5324314507;

describe("auth", () => {
  it("recognizes only the HR chat", () => {
    expect(isHrChat(HR, HR)).toBe(true);
    expect(isHrChat(EMP, HR)).toBe(false);
    expect(isHrChat(undefined, HR)).toBe(false);
    expect(isHrChat(null, HR)).toBe(false);
    expect(isHrChat(HR + 1, HR)).toBe(false);
  });

  it("recognizes only the employee chat", () => {
    expect(isEmployeeChat(EMP, EMP)).toBe(true);
    expect(isEmployeeChat(HR, EMP)).toBe(false);
  });

  it("assertHrChat throws for non-HR chats", () => {
    expect(() => assertHrChat(EMP, HR)).toThrow(AuthorizationError);
    expect(() => assertHrChat(undefined, HR)).toThrow(AuthorizationError);
    expect(() => assertHrChat(HR, HR)).not.toThrow();
  });
});
