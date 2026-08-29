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

  const weather: WeatherSource = createWeatherSource(
    config.weatherSource,
    config.weatherHttpUrl,
  );

  const bot = new Bot(config.telegramBotToken);
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
  if (config.weatherSource === "http") {
    setInterval(checkOnce, config.weatherHttpIntervalMs);
    log.info(`Weather polling every ${config.weatherHttpIntervalMs}ms`);
  }

  await bot.start({
    onStart: (me) => {
      log.info(`Bot @${me.username} started. HR chat ${config.authorizedHrChatId}, employee chat ${config.employeeChatId}.`);
    },
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
