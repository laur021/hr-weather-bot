/**
 * One-shot workflow runner invoked by the OpenClaw plugin. It deliberately has
 * no long-polling loop and no interval: Gateway owns both ingress and cadence.
 */
import path from "node:path";
import { DeepSeekProvider, MockAiProvider } from "./ai/provider.js";
import { loadConfig } from "./config.js";
import { SqliteEventStore } from "./store/sqlite-store.js";
import { HttpTelegramMessenger } from "./telegram/http-messenger.js";
import { createWeatherSource, type WeatherCheckResult, type WeatherLocation } from "./weather/index.js";
import { enrichWithPagasa, PagasaClient } from "./weather/pagasa.js";
import { WeatherWorkflow } from "./workflow.js";
import type { AiProvider } from "./ai/prompts.js";
import type { TelegramUser } from "./types.js";

type Action =
  | "check"
  | "compose"
  | "edit"
  | "replace"
  | "manual"
  | "send"
  | "discard"
  | "retry"
  | "monitor"
  | "status";

interface Request {
  action: Action;
  eventId?: string;
  instruction?: string;
  text?: string;
  approvedVersion?: number;
  monitoring?: "CONTINUING" | "STOPPED";
  chatId?: number;
  user?: TelegramUser;
}

async function main(): Promise<void> {
  const request = JSON.parse(process.env.OPENCLAW_HR_REQUEST ?? "{}") as Request;
  if (!request.action) throw new Error("OPENCLAW_HR_REQUEST.action is required.");

  const config = loadConfig();
  const messenger = new HttpTelegramMessenger(
    config.telegramBotToken,
    config.authorizedHrChatId,
    config.employeeChatId,
    config.opsChatId,
  );
  const store = new SqliteEventStore(
    path.join(config.dataDir, "events.sqlite"),
    path.join(config.dataDir, "events.json"),
  );
  await store.init();

  const ai: AiProvider = config.aiProvider === "mock"
    ? new MockAiProvider()
    : new DeepSeekProvider(
      config.deepseekApiKey,
      config.deepseekModel,
      config.deepseekBaseUrl,
      config.deepseekResponsesBaseUrl,
    );
  const workflow = new WeatherWorkflow(
    store,
    ai,
    messenger,
    config.authorizedHrChatId,
    config.employeeChatId,
  );

  const user = request.user ?? { id: 0, displayName: "OpenClaw" };
  const chatId = request.chatId;
  let details: Record<string, unknown>;

  switch (request.action) {
    case "check":
      details = await checkWeather(config, workflow, messenger);
      break;
    case "compose":
      await workflow.compose(chatId, required(request.eventId, "eventId"), user);
      details = { action: request.action, ok: true };
      break;
    case "edit":
      await workflow.edit(chatId, required(request.eventId, "eventId"), required(request.instruction, "instruction"), user);
      details = { action: request.action, ok: true };
      break;
    case "replace":
      await workflow.replaceDraft(chatId, required(request.eventId, "eventId"), required(request.text, "text"), user);
      details = { action: request.action, ok: true };
      break;
    case "manual":
      await workflow.createManualAnnouncement(chatId, required(request.text, "text"), user);
      details = { action: request.action, ok: true };
      break;
    case "send":
      await workflow.send(chatId, required(request.eventId, "eventId"), request.approvedVersion, user);
      details = { action: request.action, ok: true };
      break;
    case "discard":
      await workflow.discard(chatId, required(request.eventId, "eventId"), user);
      details = { action: request.action, ok: true };
      break;
    case "retry":
      await workflow.retrySend(chatId, required(request.eventId, "eventId"), user);
      details = { action: request.action, ok: true };
      break;
    case "monitor":
      await workflow.chooseMonitoring(chatId, required(request.eventId, "eventId"), required(request.monitoring, "monitoring"), user);
      details = { action: request.action, ok: true };
      break;
    case "status":
      details = { action: request.action, text: await workflow.latestStatus() };
      break;
  }

  process.stdout.write(`${JSON.stringify(details)}\n`);
}

async function checkWeather(
  config: ReturnType<typeof loadConfig>,
  workflow: WeatherWorkflow,
  messenger: HttpTelegramMessenger,
): Promise<Record<string, unknown>> {
  const office: WeatherLocation = {
    name: config.officeLocation.name,
    latitude: config.officeLocation.latitude,
    longitude: config.officeLocation.longitude,
    timezone: config.officeLocation.timezone,
  };
  const source = createWeatherSource("open-meteo", {
    httpUrl: "",
    latitude: config.officeLocation.latitude,
    longitude: config.officeLocation.longitude,
    locationName: office.name,
    timezone: office.timezone,
  });
  const result = await source.check();
  const pagasa = new PagasaClient({
    bulletinUrl: config.pagasaBulletinUrl,
    dailyWeatherUrl: config.pagasaDailyWeatherUrl,
    weatherAdvisoryUrl: config.pagasaWeatherAdvisoryUrl,
    office: config.officeLocation,
  });
  const enriched = enrichWithPagasa(result, await pagasa.check(), config.officeLocation);

  // A general forecast must never create an alert when the official source is
  // unavailable. OpenClaw's generic weather skill is context-only for the same reason.
  if (enriched.advisory?.officialPagasa?.officialVerificationStatus === "UNAVAILABLE") {
    await messenger.sendToOps(
      `HR weather check could not verify PAGASA at ${enriched.advisory.officialPagasa.checkedAt}. No HR or employee alert was created.`,
    );
    return { ok: false, officialVerification: "UNAVAILABLE", alertCreated: false };
  }

  const event = enriched.threat ? await workflow.onWeatherDetected(enriched.threat) : undefined;
  return {
    ok: true,
    officialVerification: enriched.advisory?.officialPagasa?.officialVerificationStatus,
    alertCreated: Boolean(event),
    eventId: event?.id,
    summary: enriched.summary,
  };
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === "") throw new Error(`${name} is required.`);
  return value;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
