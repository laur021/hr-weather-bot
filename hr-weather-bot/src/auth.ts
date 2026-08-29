/**
 * Group-based authorization.
 *
 * The ONLY thing that authorizes an HR workflow action is the Telegram chat
 * where it originated. Knowing a callback id, event id, command, message id,
 * the employee chat id, or the bot username grants nothing.
 */
export function isHrChat(chatId: number | null | undefined, hrChatId: number): boolean {
  return typeof chatId === "number" && chatId === hrChatId;
}

export function isEmployeeChat(
  chatId: number | null | undefined,
  employeeChatId: number,
): boolean {
  return typeof chatId === "number" && chatId === employeeChatId;
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Assert that a chat id is the authorized HR group; throws otherwise.
 * Use at the boundary of every privileged operation.
 */
export function assertHrChat(
  chatId: number | null | undefined,
  hrChatId: number,
): void {
  if (!isHrChat(chatId, hrChatId)) {
    throw new AuthorizationError(
      "Unauthorized: weather-announcement actions must be performed in the authorized HR group (HR Weather Drafts).",
    );
  }
}
