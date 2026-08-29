import type { Bot } from "grammy";
import { isEmployeeChat, isHrChat } from "../auth.js";
import { CB } from "../constants.js";
import type { Logger } from "../logger.js";
import { decodeCallback } from "./callback.js";
import type { WeatherWorkflow, WorkflowError } from "../workflow.js";
import type { TelegramUser } from "../types.js";

interface FromLike {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

function toUser(from?: FromLike): TelegramUser {
  const displayName =
    [from?.first_name, from?.last_name].filter(Boolean).join(" ") || undefined;
  return {
    id: from?.id ?? 0,
    username: from?.username,
    displayName,
  };
}

export interface BotDeps {
  workflow: WeatherWorkflow;
  hrChatId: number;
  employeeChatId: number;
  log: Logger;
  /** Trigger a manual weather check (HR-only, for testing). */
  checkWeatherNow: () => Promise<void>;
}

export function registerHandlers(bot: Bot, deps: BotDeps): void {
  const { workflow, hrChatId, employeeChatId, log } = deps;

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "HR Weather Advisory System bot.\n\nUse /status for the latest weather advisory. HR workflow actions (compose, edit, approve, send) are available in the HR Weather Drafts group.",
    );
  });

  bot.command("status", async (ctx) => {
    if (!isHrChat(ctx.chat?.id, hrChatId)) {
      await ctx.reply("This command is available only in the HR Weather Drafts group.");
      return;
    }
    await ctx.reply(await workflow.latestStatus());
  });

  bot.command("checkweather", async (ctx) => {
    if (!isHrChat(ctx.chat?.id, hrChatId)) {
      await ctx.reply("This command is available only in the HR Weather Drafts group.");
      return;
    }
    await ctx.reply("🔎 Checking weather…");
    await deps.checkWeatherNow();
  });

  bot.on("callback_query:data", async (ctx) => {
    const cb = ctx.callbackQuery;
    const msgChatId = cb.message?.chat.id;

    // Acknowledge immediately so Telegram stops showing the spinner.
    await ctx.answerCallbackQuery().catch(() => undefined);

    // Authorization boundary: the button's chat must be the HR group.
    if (!isHrChat(msgChatId, hrChatId)) {
      log.warn(`Rejected callback from unauthorized chat ${msgChatId}`);
      return;
    }

    let decoded;
    try {
      decoded = decodeCallback(cb.data);
    } catch (err) {
      log.warn("Rejected malformed callback", err);
      return;
    }

    const user = toUser(cb.from);
    try {
      switch (decoded.action) {
        case CB.compose:
          await workflow.compose(msgChatId, decoded.eventId, user);
          break;
        case CB.send:
          await workflow.send(msgChatId, decoded.eventId, decoded.version, user);
          break;
        case CB.edit:
          await ctx.reply(
            `✏️ Reply to this chat with your edit instructions for ${decoded.eventId}.\n\nExample: "Make this shorter and mention possible flooding."`,
          );
          break;
        case CB.discard:
          await workflow.discard(msgChatId, decoded.eventId, user);
          break;
        case CB.status:
          await ctx.reply(await workflow.latestStatus());
          break;
      }
    } catch (err) {
      await handleWorkflowError(ctx, err as WorkflowError, workflow, decoded.eventId);
    }
  });

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat?.id;
    const text = ctx.message.text.trim();

    // Employee group is OUTPUT-ONLY. Never interpret its messages as instructions.
    if (isEmployeeChat(chatId, employeeChatId)) {
      log.info("Ignored message from employee group (output-only)");
      return;
    }

    if (isHrChat(chatId, hrChatId)) {
      await handleHrMessage(ctx, text, deps);
      return;
    }

    // Private chat or any other group: never perform privileged actions.
    await ctx.reply(
      "Weather-announcement approval must be performed in the HR Weather Drafts group. I can't action privileged requests from this chat.",
    );
  });
}

interface HrMessageCtx {
  reply: (text: string) => Promise<unknown>;
  chat: { id: number };
  from?: FromLike;
}

async function handleHrMessage(
  ctx: HrMessageCtx,
  text: string,
  deps: BotDeps,
): Promise<void> {
  const { workflow } = deps;
  const user = toUser(ctx.from);
  const lower = text.toLowerCase();

  // Status request.
  if (/weather/.test(lower) || /status/.test(lower) || /update/.test(lower)) {
    await ctx.reply(await workflow.latestStatus());
    return;
  }

  // Explicit discard.
  if (/discard|cancel/.test(lower)) {
    try {
      await workflow.discardLatest(ctx.chat.id, user);
    } catch (err) {
      await handleWorkflowError(ctx, err as WorkflowError, workflow, undefined);
    }
    return;
  }

  // Otherwise treat as an edit instruction for the current draft.
  try {
    await workflow.editLatest(ctx.chat.id, text, user);
  } catch (err) {
    await handleWorkflowError(ctx, err as WorkflowError, workflow, undefined);
  }
}

async function handleWorkflowError(
  ctx: {
    reply: (text: string) => Promise<unknown>;
    chat?: { id: number };
  },
  err: WorkflowError,
  workflow: WeatherWorkflow,
  eventId?: string,
): Promise<void> {
  const code = err?.code;

  if (code === "STALE_APPROVAL" && eventId) {
    await ctx.reply(
      `⚠️ ${err.message}\n\nHere is the latest version to review:`,
    );
    try {
      await workflow.showPreview(ctx.chat?.id, eventId);
    } catch {
      /* ignore */
    }
    return;
  }

  if (code === "ALREADY_SENT") {
    await ctx.reply(`ℹ️ ${err.message}`);
    return;
  }

  if (code === "NOT_FOUND" || code === "NO_ACTIVE_DRAFT") {
    await ctx.reply(`ℹ️ ${err.message}`);
    return;
  }

  // Invalid transition / generic — surface a concise message.
  await ctx.reply(`⚠️ ${err?.message ?? "That action could not be completed."}`);
}
