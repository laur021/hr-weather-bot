import type { WeatherThreat } from "../types.js";

export interface AiProvider {
  composeDraft(weather: WeatherThreat): Promise<string>;
  reviseDraft(current: string, instruction: string): Promise<string>;
}

export const COMPOSE_SYSTEM = `You are the drafting assistant for a corporate HR Weather Advisory System.
Compose a formal, clear employee announcement based on the weather threat provided.
Guidelines:
- Professional, reassuring, and concise.
- Include: what the weather is, its severity, safety guidance, and any action employees should take (for example, work-from-home instructions when appropriate).
- Plain text only: no markdown formatting of any kind (no **bold**, *italics*, ## headers, or links).
- Do NOT include internal analysis, draft notes, approval instructions, or reasoning.
- Output ONLY the announcement text, ready to post as-is.`;

export const REVISE_SYSTEM = `You are the editing assistant for a corporate HR Weather Advisory System.
Revise the existing employee announcement according to the HR instruction provided.
- Keep it formal, clear, and employee-appropriate.
- Plain text only: no markdown formatting (no **bold**, *italics*, ## headers, or links).
- Do NOT include internal notes or reasoning.
- Output ONLY the revised announcement text, ready to post as-is.`;

export function composeUserPrompt(weather: WeatherThreat): string {
  return `Weather threat:
Severity: ${weather.severity}
Title: ${weather.title}
Description: ${weather.description}
Source: ${weather.source}
Detected at: ${weather.detectedAt}

Compose the employee announcement.`;
}

export function reviseUserPrompt(current: string, instruction: string): string {
  return `Current announcement:
"""
${current}
"""

HR instruction:
${instruction}

Return the revised announcement.`;
}
