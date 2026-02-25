// app/lib/openai/client.ts
import OpenAI from "openai";

let _client: OpenAI | null = null;

/**
 * Server-only OpenAI client.
 * Use this in API routes / server actions.
 */
export function openaiServer() {
  if (_client) return _client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in environment");
  }

  _client = new OpenAI({ apiKey });
  return _client;
}