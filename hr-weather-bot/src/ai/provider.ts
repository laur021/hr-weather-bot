import type { WeatherThreat } from "../types.js";
import {
  COMPOSE_SYSTEM,
  REVISE_SYSTEM,
  composeUserPrompt,
  reviseUserPrompt,
} from "./prompts.js";
import type { AiProvider } from "./prompts.js";

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

  private async chat(messages: ChatMessage[]): Promise<string> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.4,
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
}
