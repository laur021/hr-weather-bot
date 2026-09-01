import { Bot, InlineKeyboard } from "grammy";
import type { Keyboard, Messenger, SendResult } from "../types.js";

export function toInlineKeyboard(kb: Keyboard): InlineKeyboard {
  const ik = new InlineKeyboard();
  kb.forEach((row, i) => {
    for (const b of row) ik.text(b.text, b.data);
    if (i < kb.length - 1) ik.row();
  });
  return ik;
}

/** Thin grammY adapter satisfying the workflow's Messenger contract. */
export class GrammYMessenger implements Messenger {
  constructor(
    private readonly bot: Bot,
    private readonly hrChatId: number,
    private readonly employeeChatId: number,
  ) {}

  async sendToHr(text: string, keyboard?: Keyboard): Promise<void> {
    await this.bot.api.sendMessage(this.hrChatId, text, {
      reply_markup: keyboard ? toInlineKeyboard(keyboard) : undefined,
    });
  }

  async sendToEmployees(text: string): Promise<SendResult> {
    try {
      const msg = await this.bot.api.sendMessage(this.employeeChatId, text);
      return { ok: true, messageId: msg.message_id };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
