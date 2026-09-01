import { Bot } from "grammy";
import path from "node:path";
import type { AiProvider, WebWeatherResult } from "./ai/prompts.js";
import { DeepSeekProvider, MockAiProvider } from "./ai/provider.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { JsonFileStore } from "./store/json-store.js";
import { registerHandlers } from "./telegram/bot.js";
import { GrammYMessenger } from "./telegram/messenger.js";
import {
  createWeatherSource,
  type WeatherCheckResult,
  type WeatherLocation,
} from "./weather/index.js";
import { classifyThreat, kmhToMs } from "./weather/classify.js";
import {
  isPhilippineLocation,
  pagasaOfficeFor,
  resolveOpenMeteoLocation,
} from "./weather/geocoding.js";
import { enrichWithPagasa, PagasaClient } from "./weather/pagasa.js";
import { WeatherWorkflow } from "./workflow.js";

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
          config.deepseekResponsesBaseUrl,
        );

  if (config.aiProvider === "deepseek" && !config.deepseekApiKey) {
    log.warn(
      "AI_PROVIDER=deepseek but DEEPSEEK_API_KEY is unset — draft generation will fail. Set the key or use AI_PROVIDER=mock."
    );
  }

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
          `chat_id=${chat.id} type=${chat.type} title=${chat.title ?? chat.first_name ?? "?"}`
        );
      }
      if (fwd) {
        const c = fwd.chat ?? fwd.sender_chat;
        if (c) {
          parts.push(`FORWARDED from chat_id=${c.id} type=${c.type} title=${c.title ?? "?"}`);
        }
      }
      if (parts.length) log.info(`[debug-update] ${parts.join(" | ")}`);
      await next();
    });
  }
  const messenger = new GrammYMessenger(bot, config.authorizedHrChatId, config.employeeChatId);

  const workflow = new WeatherWorkflow(
    store,
    ai,
    messenger,
    config.authorizedHrChatId,
    config.employeeChatId
  );
  const pagasa = new PagasaClient({
    bulletinUrl: config.pagasaBulletinUrl,
    dailyWeatherUrl: config.pagasaDailyWeatherUrl,
    weatherAdvisoryUrl: config.pagasaWeatherAdvisoryUrl,
    office: config.officeLocation,
  });

  // Weather check: poll on an interval + manual trigger via /check_weather.
  let checking = false;
  const checkOnce = async (
    location?: WeatherLocation,
  ): Promise<WeatherCheckResult | null> => {
    if (checking) return null;
    checking = true;
    try {
      const isOfficeCheck = location === undefined;
      const target = location ?? {
        name: config.officeLocation.name,
        latitude: config.officeLocation.latitude,
        longitude: config.officeLocation.longitude,
        timezone: config.officeLocation.timezone,
      };
      let result: WeatherCheckResult;
      if (config.weatherSource === "ai-web" && isOfficeCheck) {
        result = weatherSearchResult(await ai.searchWeather(target.name));
      } else {
        const sourceKind = location ? "open-meteo" : config.weatherSource;
        result = await createWeatherSource(
          sourceKind === "ai-web" ? "open-meteo" : sourceKind,
          {
            httpUrl: config.weatherHttpUrl,
            latitude: target.latitude ?? config.officeLocation.latitude,
            longitude: target.longitude ?? config.officeLocation.longitude,
            locationName: target.name,
            timezone: target.timezone ?? config.officeLocation.timezone,
          },
        ).check();
      }
      if (isOfficeCheck || isPhilippineLocation(target)) {
        const pagasaOffice = isOfficeCheck ? config.officeLocation : pagasaOfficeFor(target);
        const pagasaClient = isOfficeCheck
          ? pagasa
          : new PagasaClient({
              bulletinUrl: config.pagasaBulletinUrl,
              dailyWeatherUrl: config.pagasaDailyWeatherUrl,
              weatherAdvisoryUrl: config.pagasaWeatherAdvisoryUrl,
              office: pagasaOffice,
            });
        result = enrichWithPagasa(result, await pagasaClient.check(), pagasaOffice);
      }
      let eventId: string | undefined;
      if (result.threat) {
        eventId = (await workflow.onWeatherDetected(result.threat))?.id;
      }
      return { ...result, eventId };
    } finally {
      checking = false;
    }
  };

  const checkSafely = async (): Promise<void> => {
    try {
      await checkOnce();
    } catch (err) {
      log.error("Weather check failed", err);
    }
  };

  registerHandlers(bot, {
    workflow,
    hrChatId: config.authorizedHrChatId,
    employeeChatId: config.employeeChatId,
    log,
    checkWeatherNow: checkOnce,
    defaultWeatherLocationName: config.officeLocation.name,
    // Geocoding is the authoritative validation step for a custom location.
    // Do not make a valid place depend on an AI classification before resolving it.
    resolveWeatherLocation: (input) => resolveOpenMeteoLocation(input.trim()),
  });

  // Register the Telegram command menu so clients can autocomplete commands.
  try {
    await bot.api.setMyCommands([
      { command: "start", description: "Show bot help" },
      { command: "check_weather", description: "Choose a location and check weather" },
      { command: "create_announcement", description: "Create a manual employee announcement" },
    ]);
  } catch (err) {
    // The bot remains usable even if Telegram cannot update the command menu.
    log.warn("Failed to register Telegram command menu", err);
  }

  // Initial + periodic check.
  await checkSafely();
  setInterval(() => void checkSafely(), config.weatherPollIntervalMs);
  log.info(
    `Open-Meteo + official PAGASA weather check for ${config.officeLocation.name} every ${config.weatherPollIntervalMs}ms`,
  );

  async function startResilient(): Promise<void> {
    for (;;) {
      try {
        await bot.start({
          onStart: (me) => {
            log.info(
              `Bot @${me.username} started. HR chat ${config.authorizedHrChatId}, employee chat ${config.employeeChatId}.`
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

function weatherSearchResult(search: WebWeatherResult): WeatherCheckResult {
  const advisory = {
    location: search.location,
    condition: search.condition,
    rainChancePercent: search.rainChancePercent,
    expectedRainfallMm: search.expectedRainfallMm,
    peakWindGustMs: kmhToMs(search.peakWindGustKmh),
  };
  const threat = classifyThreat({
    windMs: 0,
    gustMs: kmhToMs(search.peakWindGustKmh),
    precipitationMm: search.expectedRainfallMm,
    location: search.location,
  });
  if (threat) {
    threat.source = "deepseek-web-search";
    threat.hrAdvisory = advisory;
    threat.raw = search;
  }
  return {
    threat,
    advisory,
    summary: `DeepSeek web weather search for ${search.location}: ${search.condition}.`,
  };
}
