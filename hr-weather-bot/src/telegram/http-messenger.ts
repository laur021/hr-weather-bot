import type { Keyboard, MessageOptions, Messenger, SendResult } from "../types.js";

type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };

/** A polling-free Telegram adapter for OpenClaw-triggered workflow runs. */
export class HttpTelegramMessenger implements Messenger {
  constructor(
    private readonly token: string,
    private readonly hrChatId: number,
    private readonly employeeChatId: number,
    private readonly opsChatId = 0,
  ) {}

  async sendToHr(text: string, keyboard?: Keyboard, options?: MessageOptions): Promise<void> {
    await this.send(this.hrChatId, text, keyboard, options);
  }

  async sendToEmployees(text: string): Promise<SendResult> {
    try {
      const result = await this.send<{ message_id: number }>(this.employeeChatId, text);
      return { ok: true, messageId: result.message_id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async sendToOps(text: string): Promise<void> {
    if (!this.opsChatId) return;
    await this.send(this.opsChatId, text);
  }

  private async send<T = unknown>(
    chatId: number,
    text: string,
    keyboard?: Keyboard,
    options?: MessageOptions,
  ): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options?.parseMode,
        reply_markup: keyboard ? { inline_keyboard: keyboard.map((row) => row.map((button) => ({ text: button.text, callback_data: button.data }))) } : undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json() as TelegramResponse<T>;
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new Error(`Telegram send failed: ${payload.description ?? response.statusText}`);
    }
    return payload.result;
  }
}
