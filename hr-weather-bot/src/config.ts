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
  weatherSource: "mock" | "http" | "noop";
  weatherHttpUrl: string;
  weatherHttpIntervalMs: number;
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
    aiProvider: (strEnv("AI_PROVIDER", "deepseek") as "deepseek") || "deepseek",
    deepseekApiKey: strEnv("DEEPSEEK_API_KEY"),
    deepseekModel: strEnv("DEEPSEEK_MODEL", "deepseek-chat"),
    deepseekBaseUrl: strEnv(
      "DEEPSEEK_BASE_URL",
      "https://api.deepseek.com/chat/completions",
    ),
    weatherSource: (strEnv("WEATHER_SOURCE", "mock") as "mock") || "mock",
    weatherHttpUrl: strEnv("WEATHER_HTTP_URL"),
    weatherHttpIntervalMs: intEnv("WEATHER_HTTP_INTERVAL_MS", 600_000),
    dataDir: strEnv("DATA_DIR", "./data"),
    logLevel: strEnv("LOG_LEVEL", "info"),
  };
}
