import { config as loadEnv } from "dotenv";
import { AUTHORIZED_HR_CHAT_ID, EMPLOYEE_CHAT_ID } from "./constants.js";

loadEnv();

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer for env ${name}: ${raw}`);
  return n;
}

function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n)) throw new Error(`Invalid number for env ${name}: ${raw}`);
  return n;
}

function strEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export interface AppConfig {
  telegramBotToken: string;
  authorizedHrChatId: number;
  employeeChatId: number;
  aiProvider: "deepseek" | "mock";
  deepseekApiKey: string;
  deepseekModel: string;
  deepseekBaseUrl: string;
  weatherSource: "mock" | "http" | "noop" | "open-meteo";
  weatherHttpUrl: string;
  weatherPollIntervalMs: number;
  openMeteoLatitude: number;
  openMeteoLongitude: number;
  openMeteoLocationName: string;
  dataDir: string;
  logLevel: string;
}

export function loadConfig(): AppConfig {
  const token = strEnv("TELEGRAM_BOT_TOKEN");
  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is required. Copy .env.example to .env and set it.",
    );
  }

  return {
    telegramBotToken: token,
    authorizedHrChatId: intEnv("AUTHORIZED_HR_CHAT_ID", AUTHORIZED_HR_CHAT_ID),
    employeeChatId: intEnv("EMPLOYEE_CHAT_ID", EMPLOYEE_CHAT_ID),
    aiProvider: (strEnv("AI_PROVIDER", "deepseek") as AppConfig["aiProvider"]) || "deepseek",
    deepseekApiKey: strEnv("DEEPSEEK_API_KEY"),
    deepseekModel: strEnv("DEEPSEEK_MODEL", "deepseek-chat"),
    deepseekBaseUrl: strEnv(
      "DEEPSEEK_BASE_URL",
      "https://api.deepseek.com/chat/completions",
    ),
    weatherSource: (strEnv("WEATHER_SOURCE", "mock") as AppConfig["weatherSource"]) || "mock",
    weatherHttpUrl: strEnv("WEATHER_HTTP_URL"),
    weatherPollIntervalMs: intEnv("WEATHER_POLL_INTERVAL_MS", 600_000),
    openMeteoLatitude: floatEnv("OPEN_METEO_LATITUDE", 14.6096),
    openMeteoLongitude: floatEnv("OPEN_METEO_LONGITUDE", 121.08),
    openMeteoLocationName: strEnv("OPEN_METEO_LOCATION_NAME", "Eastwood City, Quezon City"),
    dataDir: strEnv("DATA_DIR", "./data"),
    logLevel: strEnv("LOG_LEVEL", "info"),
  };
}
