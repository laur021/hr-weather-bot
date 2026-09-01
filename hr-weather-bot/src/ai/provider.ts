import type { WeatherThreat } from "../types.js";
import {
  COMPOSE_SYSTEM,
  REVISE_SYSTEM,
  VALIDATE_LOCATION_SYSTEM,
  WEB_WEATHER_SEARCH_SYSTEM,
  composeUserPrompt,
  reviseUserPrompt,
  validateLocationUserPrompt,
  weatherSearchUserPrompt,
} from "./prompts.js";
import type { AiProvider, LocationValidation, WebWeatherResult } from "./prompts.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * DeepSeek provider using its OpenAI-compatible chat-completions endpoint.
 * The base URL / model are configurable, so any compatible endpoint works.
 */
export class DeepSeekProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly responsesBaseUrl: string,
  ) {}

  async composeDraft(weather: WeatherThreat): Promise<string> {
    return this.chat([
      { role: "system", content: COMPOSE_SYSTEM },
      { role: "user", content: composeUserPrompt(weather) },
    ]);
  }

  async reviseDraft(current: string, instruction: string): Promise<string> {
    return this.chat([
      { role: "system", content: REVISE_SYSTEM },
      { role: "user", content: reviseUserPrompt(current, instruction) },
    ]);
  }

  async validateLocation(input: string): Promise<LocationValidation> {
    const content = await this.chat(
      [
        { role: "system", content: VALIDATE_LOCATION_SYSTEM },
        { role: "user", content: validateLocationUserPrompt(input) },
      ],
      0,
    );
    return parseLocationValidation(content);
  }

  async searchWeather(location: string): Promise<WebWeatherResult> {
    const res = await fetch(this.responsesBaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        instructions: WEB_WEATHER_SEARCH_SYSTEM,
        input: weatherSearchUserPrompt(location),
        tools: [{ type: "web_search" }],
        tool_choice: { type: "web_search" },
        text: { format: { type: "json_object" } },
        reasoning: { effort: "none" },
        max_output_tokens: 1_200,
        stream: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`DeepSeek web search error ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      status?: string;
      error?: { message?: string };
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };
    if (data.status !== "completed") {
      throw new Error(`DeepSeek web search did not complete: ${data.error?.message ?? data.status ?? "unknown error"}`);
    }
    const content = data.output
      ?.filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!content) throw new Error("DeepSeek web search returned no weather report");
    return parseWebWeatherResult(content);
  }

  private async chat(messages: ChatMessage[], temperature = 0.4): Promise<string> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature,
        stream: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`DeepSeek API error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("DeepSeek API returned no content");
    }
    return content;
  }
}

/** Deterministic provider for tests/demos — never requires a network or key. */
export class MockAiProvider implements AiProvider {
  async composeDraft(weather: WeatherThreat): Promise<string> {
    return `[DRAFT] ${weather.severity.toUpperCase()}: ${weather.title} — ${weather.description}`;
  }

  async reviseDraft(current: string, instruction: string): Promise<string> {
    return `${current}\n\n[REVISED per: ${instruction}]`;
  }

  async validateLocation(input: string): Promise<LocationValidation> {
    const normalizedLocation = input.trim().replace(/\s+/g, " ");
    const isLegitimate = normalizedLocation.length >= 2 && /\p{L}/u.test(normalizedLocation);
    return {
      isLegitimate,
      normalizedLocation: isLegitimate ? normalizedLocation : null,
    };
  }

  async searchWeather(location: string): Promise<WebWeatherResult> {
    return {
      location: location.trim(),
      condition: "Unavailable",
      rainChancePercent: 0,
      expectedRainfallMm: 0,
      peakWindGustKmh: 0,
    };
  }
}

export function parseLocationValidation(content: string): LocationValidation {
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("AI returned an invalid location-validation response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new Error("AI returned invalid JSON for location validation");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI returned an invalid location-validation response");
  }
  const value = parsed as Record<string, unknown>;
  if (typeof value.isLegitimate !== "boolean") {
    throw new Error("AI omitted the location-validation decision");
  }
  if (!value.isLegitimate) {
    return { isLegitimate: false, normalizedLocation: null };
  }
  if (
    typeof value.normalizedLocation !== "string" ||
    !value.normalizedLocation.trim()
  ) {
    throw new Error("AI omitted the normalized location");
  }
  return {
    isLegitimate: true,
    normalizedLocation: value.normalizedLocation.trim(),
  };
}

export function parseWebWeatherResult(content: string): WebWeatherResult {
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("DeepSeek web search returned invalid weather JSON");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new Error("DeepSeek web search returned invalid weather JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("DeepSeek web search returned invalid weather JSON");
  }
  const value = parsed as Record<string, unknown>;
  const numericFields = [
    "rainChancePercent",
    "expectedRainfallMm",
    "peakWindGustKmh",
  ] as const;
  if (
    typeof value.location !== "string" ||
    !value.location.trim() ||
    typeof value.condition !== "string" ||
    !value.condition.trim() ||
    numericFields.some(
      (field) => typeof value[field] !== "number" || !Number.isFinite(value[field]),
    )
  ) {
    throw new Error("DeepSeek web search returned incomplete weather data");
  }
  return {
    location: value.location.trim(),
    condition: value.condition.trim(),
    rainChancePercent: Math.max(0, Math.round(value.rainChancePercent as number)),
    expectedRainfallMm: Math.max(0, Math.round(value.expectedRainfallMm as number)),
    peakWindGustKmh: Math.max(0, Math.round(value.peakWindGustKmh as number)),
  };
}
