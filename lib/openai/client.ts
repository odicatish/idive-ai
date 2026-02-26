import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

// exportăm ambele nume ca să nu mai crape importurile existente
export const openaiServer = new OpenAI({ apiKey: apiKey! });
export const openai = openaiServer;