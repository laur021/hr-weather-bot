import { config as loadEnv } from "dotenv";
import { AUTHORIZED_HR_CHAT_ID, EMPLOYEE_CHAT_ID } from "./constants.js";
import type { OfficeLocation } from "./types.js";

// The legacy standalone runner reads `.env`. OpenClaw supplies the same values
// through its resolved secret references and must never fall back to this file.
if (process.env.HR_WEATHER_SKIP_DOTENV !== "1") loadEnv();

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

function listEnv(name: string, fallback: string[]): string[] {
  const raw = strEnv(name);
  if (!raw.trim()) return fallback;
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

export interface AppConfig {
  telegramBotToken: string;
  authorizedHrChatId: number;
  employeeChatId: number;
  aiProvider: "deepseek" | "mock";
  deepseekApiKey: string;
  deepseekModel: string;
  deepseekBaseUrl: string;
  deepseekResponsesBaseUrl: string;
  weatherSource: "ai-web" | "mock" | "http" | "noop" | "open-meteo";
  weatherHttpUrl: string;
  weatherPollIntervalMs: number;
  officeLocation: OfficeLocation;
  pagasaBulletinUrl: string;
  pagasaDailyWeatherUrl: string;
  pagasaWeatherAdvisoryUrl: string;
  dataDir: string;
  logLevel: string;
  opsChatId: number;
}

export function loadConfig(): AppConfig {
  const token = strEnv("TELEGRAM_BOT_TOKEN");
  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is required. Copy .env.example to .env and set it.",
    );
  }

  // OPEN_METEO_* remain supported as deployment-compatible fallbacks, but all
  // runtime consumers receive this one office object.
  const officeName = strEnv(
    "OFFICE_NAME",
    strEnv("OPEN_METEO_LOCATION_NAME", strEnv("DEFAULT_WEATHER_LOCATION", "Metro Manila")),
  );
  const officeLocation: OfficeLocation = {
    name: officeName,
    address: strEnv("OFFICE_ADDRESS", officeName),
    latitude: floatEnv("OFFICE_LATITUDE", floatEnv("OPEN_METEO_LATITUDE", 14.5995)),
    longitude: floatEnv("OFFICE_LONGITUDE", floatEnv("OPEN_METEO_LONGITUDE", 120.9842)),
    timezone: strEnv("OFFICE_TIMEZONE", "Asia/Manila"),
    localityMatchList: listEnv("OFFICE_LOCALITY_MATCHES", [
      "NCR",
      "National Capital Region",
      "Metro Manila",
      "Quezon City",
    ]),
  };

  return {
    telegramBotToken: token,
    authorizedHrChatId: intEnv("AUTHORIZED_HR_CHAT_ID", AUTHORIZED_HR_CHAT_ID),
    employeeChatId: intEnv("EMPLOYEE_CHAT_ID", EMPLOYEE_CHAT_ID),
    aiProvider: (strEnv("AI_PROVIDER", "deepseek") as AppConfig["aiProvider"]) || "deepseek",
    deepseekApiKey: strEnv("DEEPSEEK_API_KEY"),
    deepseekModel: strEnv("DEEPSEEK_MODEL", "deepseek-v4-flash"),
    deepseekBaseUrl: strEnv(
      "DEEPSEEK_BASE_URL",
      "https://api.deepseek.com/chat/completions",
    ),
    deepseekResponsesBaseUrl: strEnv(
      "DEEPSEEK_RESPONSES_BASE_URL",
      "https://api.deepseek.com/responses",
    ),
    weatherSource:
      (strEnv("WEATHER_SOURCE", "open-meteo") as AppConfig["weatherSource"]) ||
      "open-meteo",
    weatherHttpUrl: strEnv("WEATHER_HTTP_URL"),
    weatherPollIntervalMs: intEnv("WEATHER_POLL_INTERVAL_MS", 600_000),
    officeLocation,
    pagasaBulletinUrl: strEnv(
      "PAGASA_BULLETIN_URL",
      "https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin",
    ),
    pagasaDailyWeatherUrl: strEnv(
      "PAGASA_DAILY_WEATHER_URL",
      "https://www.pagasa.dost.gov.ph/weather",
    ),
    pagasaWeatherAdvisoryUrl: strEnv(
      "PAGASA_WEATHER_ADVISORY_URL",
      "https://www.pagasa.dost.gov.ph/weather/weather-advisory",
    ),
    dataDir: strEnv("DATA_DIR", "./data"),
    logLevel: strEnv("LOG_LEVEL", "info"),
    opsChatId: intEnv("OPS_CHAT_ID", 0),
  };
}
