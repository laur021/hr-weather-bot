import { Bot } from "grammy";
import type { AiProvider } from "./ai/prompts.js";
import { MockAiProvider, DeepSeekProvider } from "./ai/provider.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { JsonFileStore } from "./store/json-store.js";
import { registerHandlers } from "./telegram/bot.js";
import { GrammYMessenger } from "./telegram/messenger.js";
import { createWeatherSource, type WeatherSource } from "./weather/index.js";
import { WeatherWorkflow } from "./workflow.js";
import path from "node:path";

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel);

  const store = new JsonFileStore(path.join(config.dataDir, "events.json"));
  await store.init();

  const ai: AiProvider =
    config.aiProvider === "mock"
      ? new MockAiProvider()
      : new DeepSeekProvider(
          config.deepseekApiKey,
          config.deepseekModel,
          config.deepseekBaseUrl,
        );

  if (config.aiProvider === "deepseek" && !config.deepseekApiKey) {
    log.warn(
      "AI_PROVIDER=deepseek but DEEPSEEK_API_KEY is unset — draft generation will fail. Set the key or use AI_PROVIDER=mock.",
    );
  }

  const weather: WeatherSource = createWeatherSource(config.weatherSource, {
    httpUrl: config.weatherHttpUrl,
    latitude: config.openMeteoLatitude,
    longitude: config.openMeteoLongitude,
    locationName: config.openMeteoLocationName,
  });

  const bot = new Bot(config.telegramBotToken);

  // Debug: log every incoming update's chat + forward identity (gated by env).
  if (process.env.DEBUG_UPDATES === "1") {
    bot.use(async (ctx, next) => {
      const u = ctx.update as {
        message?: any;
        channel_post?: any;
        my_chat_member?: any;
        callback_query?: any;
      };
      const msg = u.message ?? u.channel_post;
      const chat = msg?.chat ?? u.my_chat_member?.chat ?? u.callback_query?.message?.chat;
      const fwd = msg?.forward_origin ?? msg?.forward_from_chat;
      const parts: string[] = [];
      if (chat) {
        parts.push(
          `chat_id=${chat.id} type=${chat.type} title=${chat.title ?? chat.first_name ?? "?"}`,
        );
      }
      if (fwd) {
        const c = fwd.chat ?? fwd.sender_chat;
        if (c) {
          parts.push(
            `FORWARDED from chat_id=${c.id} type=${c.type} title=${c.title ?? "?"}`,
          );
        }
      }
      if (parts.length) log.info(`[debug-update] ${parts.join(" | ")}`);
      await next();
    });
  }
  const messenger = new GrammYMessenger(
    bot,
    config.authorizedHrChatId,
    config.employeeChatId,
  );

  const workflow = new WeatherWorkflow(
    store,
    ai,
    messenger,
    config.authorizedHrChatId,
    config.employeeChatId,
  );

  // Weather check: poll on an interval + manual trigger via /checkweather.
  let checking = false;
  const checkOnce = async (): Promise<void> => {
    if (checking) return;
    checking = true;
    try {
      const threat = await weather.check();
      if (threat) {
        await workflow.onWeatherDetected(threat);
      }
    } catch (err) {
      log.error("Weather check failed", err);
    } finally {
      checking = false;
    }
  };

  registerHandlers(bot, {
    workflow,
    hrChatId: config.authorizedHrChatId,
    employeeChatId: config.employeeChatId,
    log,
    checkWeatherNow: checkOnce,
  });

  // Initial + periodic check.
  await checkOnce();
  if (config.weatherSource === "http" || config.weatherSource === "open-meteo") {
    setInterval(checkOnce, config.weatherPollIntervalMs);
    log.info(`Weather polling every ${config.weatherPollIntervalMs}ms`);
  }

  async function startResilient(): Promise<void> {
    for (;;) {
      try {
        await bot.start({
          onStart: (me) => {
            log.info(
              `Bot @${me.username} started. HR chat ${config.authorizedHrChatId}, employee chat ${config.employeeChatId}.`,
            );
          },
        });
      } catch (err) {
        const code = (err as { error_code?: number })?.error_code;
        if (code === 409) {
          log.warn("getUpdates 409 conflict (another instance polling?); retrying in 5s…");
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        throw err;
      }
    }
  }

  await startResilient();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
