import { spawn } from "node:child_process";
import path from "node:path";
import { Static, Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const actionSchema = Type.Union([
  Type.Literal("check"), Type.Literal("compose"), Type.Literal("edit"),
  Type.Literal("replace"), Type.Literal("manual"), Type.Literal("send"),
  Type.Literal("discard"), Type.Literal("retry"), Type.Literal("monitor"),
  Type.Literal("status"),
]);
const parameters = Type.Object({
  action: actionSchema,
  eventId: Type.Optional(Type.String()),
  instruction: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  approvedVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  monitoring: Type.Optional(Type.Union([Type.Literal("CONTINUING"), Type.Literal("STOPPED")])),
});

const secretInputSchema = Type.Union([
  Type.String(),
  Type.Object({
    source: Type.Union([Type.Literal("env"), Type.Literal("file"), Type.Literal("exec"), Type.Literal("store")]),
    provider: Type.String(),
    id: Type.String(),
  }, { additionalProperties: false }),
]);

const configSchema = Type.Object({
  projectDir: Type.String(), dataDir: Type.String(), telegramBotToken: secretInputSchema, deepseekApiKey: secretInputSchema,
  authorizedHrChatId: Type.Integer(), employeeChatId: Type.Integer(), opsChatId: Type.Integer(),
  officeName: Type.String(), officeAddress: Type.String(), officeLatitude: Type.Number(), officeLongitude: Type.Number(),
  officeTimezone: Type.String(), officeLocalityMatches: Type.String(),
}, { additionalProperties: false });
type PluginConfig = Static<typeof configSchema>;
type ActionParams = Static<typeof parameters>;

export default defineToolPlugin({
  id: "hr-weather",
  name: "HR Weather Advisory",
  description: "Guarded PAGASA-first HR weather advisory workflow.",
  configSchema,
  tools: (tool) => [tool({
      name: "hr_weather_workflow",
      label: "HR Weather Workflow",
      description: "Run the guarded HR weather workflow. Use only for weather checks or requests originating from the configured HR Telegram group. Never send employee announcements through any other tool.",
      parameters,
      factory: ({ config, toolContext }) => ({
        name: "hr_weather_workflow",
        label: "HR Weather Workflow",
        description: "Run the guarded HR weather workflow.",
        parameters,
        outputSchema: Type.Object({ ok: Type.Boolean(), action: actionSchema, details: Type.Unknown() }),
        async execute(_toolCallId, params: ActionParams) {
          const isScheduledCheck = params.action === "check" && toolContext.sessionKey?.startsWith("agent:hr-weather:cron:");
          const trustedChatId = telegramChatId(toolContext.deliveryContext?.channel, toolContext.deliveryContext?.to);
          if (!isScheduledCheck && trustedChatId !== config.authorizedHrChatId) {
            throw new Error("This workflow action is allowed only from the configured HR Telegram group.");
          }
          const details = await invokeRunner(config, {
            ...params,
            chatId: isScheduledCheck ? undefined : trustedChatId,
            user: { id: numericTail(toolContext.requesterSenderId) ?? 0, username: toolContext.requesterSenderId },
          });
          return { content: [{ type: "text", text: `HR weather ${params.action} completed.` }], details: { ok: true, action: params.action, details } };
        },
      }),
  })],
});

async function invokeRunner(config: PluginConfig, request: Record<string, unknown>): Promise<unknown> {
  const entry = path.join(config.projectDir, "dist", "openclaw-runner.js");
  const stdout = await run(process.execPath, [entry], {
    HR_WEATHER_SKIP_DOTENV: "1", OPENCLAW_HR_REQUEST: JSON.stringify(request),
    TELEGRAM_BOT_TOKEN: requireResolvedSecret(config.telegramBotToken, "telegramBotToken"),
    DEEPSEEK_API_KEY: requireResolvedSecret(config.deepseekApiKey, "deepseekApiKey"),
    AUTHORIZED_HR_CHAT_ID: String(config.authorizedHrChatId), EMPLOYEE_CHAT_ID: String(config.employeeChatId),
    OPS_CHAT_ID: String(config.opsChatId), DATA_DIR: config.dataDir,
    OFFICE_NAME: config.officeName, OFFICE_ADDRESS: config.officeAddress,
    OFFICE_LATITUDE: String(config.officeLatitude), OFFICE_LONGITUDE: String(config.officeLongitude),
    OFFICE_TIMEZONE: config.officeTimezone, OFFICE_LOCALITY_MATCHES: config.officeLocalityMatches,
    WEATHER_SOURCE: "open-meteo", AI_PROVIDER: "deepseek",
  });
  return JSON.parse(stdout);
}

function requireResolvedSecret(value: Static<typeof secretInputSchema>, field: string): string {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`HR weather ${field} is unavailable; the OpenClaw SecretRef did not resolve.`);
}

function run(command: string, args: string[], extraEnv: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...extraEnv }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`HR weather runner failed (${code}): ${stderr.trim() || stdout.trim()}`)));
  });
}

function numericTail(value: string | undefined): number | undefined {
  const match = value?.match(/(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function telegramChatId(channel: string | undefined, target: string | undefined): number | undefined {
  if (channel !== "telegram") return undefined;
  const match = target?.trim().match(/(?:^|:)(-?\d+)$/);
  return match ? Number(match[1]) : undefined;
}
