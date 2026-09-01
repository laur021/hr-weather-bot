import type { Bot } from "grammy";
import { isEmployeeChat, isHrChat } from "../auth.js";
import { CB, WEATHER_LOCATION_CB } from "../constants.js";
import type { Logger } from "../logger.js";
import { decodeCallback, encodeCallback } from "./callback.js";
import { toInlineKeyboard } from "./messenger.js";
import type { WeatherWorkflow, WorkflowError } from "../workflow.js";
import type { TelegramUser } from "../types.js";
import type { WeatherCheckResult, WeatherLocation } from "../weather/index.js";
import { formatHrWeatherAlert, formatHrWeatherUpdate } from "../workflow.js";

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
  checkWeatherNow: (location?: WeatherLocation) => Promise<WeatherCheckResult | null>;
  defaultWeatherLocationName: string;
  /** Validates the input by resolving it to weather-service coordinates. */
  resolveWeatherLocation: (input: string) => Promise<WeatherLocation | null>;
}

export function registerHandlers(bot: Bot, deps: BotDeps): void {
  const { workflow, hrChatId, employeeChatId, log } = deps;
  // Associate an Edit request with one HR user to avoid cross-user overwrites.
  const pendingManualDrafts = new Map<string, string>();
  const pendingManualAnnouncements = new Set<string>();
  const pendingWeatherLocations = new Set<string>();
  const pendingKey = (chatId: number, userId: number | undefined): string =>
    `${chatId}:${userId ?? 0}`;

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "HR Weather Advisory System bot.\n\nUse /check_weather for the current forecast. HR workflow actions are available in the HR Weather Drafts group.",
    );
  });

  bot.command("check_weather", async (ctx) => {
    if (!isHrChat(ctx.chat?.id, hrChatId)) {
      await ctx.reply("This command is available only in the HR Weather Drafts group.");
      return;
    }
    pendingWeatherLocations.delete(pendingKey(ctx.chat.id, ctx.from?.id));
    await ctx.reply(
      `Which location should I check? The default is ${deps.defaultWeatherLocationName}.`,
      { reply_markup: toInlineKeyboard(weatherLocationKeyboard(deps.defaultWeatherLocationName)) },
    );
  });

  bot.command("create_announcement", async (ctx) => {
    if (!isHrChat(ctx.chat?.id, hrChatId)) {
      await ctx.reply("This command is available only in the HR Weather Drafts group.");
      return;
    }
    pendingManualAnnouncements.add(pendingKey(ctx.chat.id, ctx.from?.id));
    await ctx.reply(
      "Send the complete employee announcement as your next message. I will show it for confirmation before anything is sent.",
    );
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

    if (cb.data === WEATHER_LOCATION_CB.default) {
      pendingWeatherLocations.delete(pendingKey(msgChatId!, cb.from?.id));
      await runWeatherCheck(
        (text, keyboard, parseMode) =>
          ctx.reply(text, {
            reply_markup: keyboard ? toInlineKeyboard(keyboard) : undefined,
            parse_mode: parseMode,
          }),
        deps,
      );
      return;
    }

    if (cb.data === WEATHER_LOCATION_CB.custom) {
      pendingWeatherLocations.add(pendingKey(msgChatId!, cb.from?.id));
      await ctx.reply(
        "Send the city, municipality, province, region, or country to check. I’ll validate the location before checking its weather.",
      );
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
        case CB.createAnnouncement:
          pendingManualAnnouncements.add(pendingKey(msgChatId!, cb.from?.id));
          await ctx.reply(
            "Send the complete employee announcement as your next message. I will show it for confirmation before anything is sent.",
          );
          break;
        case CB.send:
          await workflow.send(msgChatId, decoded.eventId, decoded.version, user);
          break;
        case CB.edit:
          pendingManualDrafts.set(pendingKey(msgChatId!, cb.from?.id), decoded.eventId);
          await ctx.reply(
            [
              `✏️ Send your revised employee announcement for ${decoded.eventId} as your next message.`,
              "",
              "I’ll save it as a new draft version, then show the Send to Employees or Discard buttons for confirmation.",
            ].join("\n"),
          );
          break;
        case CB.discard:
          await workflow.discard(msgChatId, decoded.eventId, user);
          break;
        case CB.stopAlerts:
          await workflow.chooseMonitoring(msgChatId, decoded.eventId, "STOPPED", user);
          break;
        case CB.continueMonitoring:
          await workflow.chooseMonitoring(msgChatId, decoded.eventId, "CONTINUING", user);
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
      const key = pendingKey(chatId!, ctx.from?.id);
      if (pendingWeatherLocations.has(key)) {
        await ctx.reply("🔎 Validating that location…");
        try {
          const location = await deps.resolveWeatherLocation(text);
          if (!location) {
            await ctx.reply(
              "I couldn’t verify that as a real, searchable location. Please enter a more specific place, such as “Makati City, Philippines”, or use /check_weather to choose the default.",
            );
            return;
          }
          pendingWeatherLocations.delete(key);
          await ctx.reply(`📍 Location received: ${location.name}. I’ll verify it through the live weather search.`);
          await runWeatherCheck(
            (message, keyboard, parseMode) =>
              ctx.reply(message, {
                reply_markup: keyboard ? toInlineKeyboard(keyboard) : undefined,
                parse_mode: parseMode,
              }),
            deps,
            location,
          );
        } catch (err) {
          log.error("Weather location validation failed", err);
          await ctx.reply(
            "⚠️ I couldn’t validate that location right now. Please try again shortly.",
          );
        }
        return;
      }
      if (pendingManualAnnouncements.has(key)) {
        try {
          await workflow.createManualAnnouncement(chatId, text, toUser(ctx.from));
          pendingManualAnnouncements.delete(key);
        } catch (err) {
          await handleWorkflowError(ctx, err as WorkflowError, workflow, undefined);
        }
        return;
      }
      const eventId = pendingManualDrafts.get(key);
      if (eventId) {
        try {
          await workflow.replaceDraft(chatId, eventId, text, toUser(ctx.from));
          pendingManualDrafts.delete(key);
        } catch (err) {
          await handleWorkflowError(ctx, err as WorkflowError, workflow, eventId);
        }
        return;
      }
      await handleHrMessage(ctx, text, deps);
      return;
    }

    // Private chat or any other group: never perform privileged actions.
    await ctx.reply(
      "Weather-announcement approval must be performed in the HR Weather Drafts group. I can't action privileged requests from this chat.",
    );
  });
}

function weatherLocationKeyboard(defaultLocationName: string) {
  return [
    [{ text: `📍 ${defaultLocationName} (Default)`, data: WEATHER_LOCATION_CB.default }],
    [{ text: "🌎 Enter another location", data: WEATHER_LOCATION_CB.custom }],
  ];
}

async function runWeatherCheck(
  reply: (
    text: string,
    keyboard?: ReturnType<typeof composeDraftKeyboard>,
    parseMode?: "HTML",
  ) => Promise<unknown>,
  deps: BotDeps,
  location?: WeatherLocation,
): Promise<void> {
  const locationName = location?.name ?? deps.defaultWeatherLocationName;
  await reply(`🔎 Checking weather for ${locationName}…`);
  try {
    const result = await deps.checkWeatherNow(location);
    if (!result) {
      await reply("A weather check is already in progress. Please try again shortly.");
      return;
    }
    if (!result.threat) {
      await reply(
        `Weather check complete.\n\n${formatHrWeatherUpdate(
          locationName,
          result.advisory,
          undefined,
          result.summary,
        )}`,
        composeDraftKeyboard(),
        "HTML",
      );
      return;
    }
    const keyboard = result.eventId
      ? await deps.workflow.actionsForEventId(result.eventId)
      : undefined;
    await reply(
      `Weather check complete.\n\n${formatHrWeatherAlert(result.threat)}`,
      withComposeDraftAction(keyboard),
      "HTML",
    );
  } catch (err) {
    deps.log.error("Manual weather check failed", err);
    await reply("⚠️ Weather check failed. Please try again shortly.");
  }
}

function composeDraftKeyboard() {
  return [[{ text: "📝 Compose Draft", data: encodeCallback(CB.createAnnouncement, "manual") }]];
}

function withComposeDraftAction(keyboard?: ReturnType<typeof composeDraftKeyboard>) {
  const composeDraft = composeDraftKeyboard()[0];
  const alreadyHasCompose = keyboard?.some((row) =>
    row.some((button) => button.data.startsWith(`${CB.compose}:`)),
  );
  return alreadyHasCompose ? keyboard! : [...(keyboard ?? []), composeDraft];
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

  // Direct users to the explicit forecast command instead of treating their
  // message as an edit instruction.
  if (/weather/.test(lower) || /status/.test(lower) || /update/.test(lower)) {
    await ctx.reply("Use /check_weather to request the current weather forecast.");
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
