// lib/openai/client.ts
import OpenAI from "openai";

export const openaiServer = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// compat: ca să nu mai crape importurile vechi
export const openai = openaiServer;