export type TransformType =
  | "shorter"
  | "aggressive"
  | "premium"
  | "translate"
  | "regenerate";

export function systemPrompt() {
  return `
You are iDive Script Editor.
Return ONLY the final script text, no markdown fences, no explanations.
Preserve speaker intent and factual claims.
Keep it coherent and natural.`;
}

export function buildTransformInstruction(args: {
  type: TransformType;
  fromLanguage: string;
  toLanguage?: string;
}) {
  const { type, fromLanguage, toLanguage } = args;

  switch (type) {
    case "shorter":
      return `Rewrite the script to be ~25% shorter while preserving meaning. Language: ${fromLanguage}.`;
    case "aggressive":
      return `Rewrite the script to be more aggressive/direct/sales-forward, but not rude. Keep it believable. Language: ${fromLanguage}.`;
    case "premium":
      return `Rewrite the script to sound premium/luxury/high-status. Avoid clichés. Language: ${fromLanguage}.`;
    case "translate":
      return `Translate the script from ${fromLanguage} to ${toLanguage}. Keep tone and formatting.`;
    case "regenerate":
      return `Regenerate a fresh script based on the same intent, improving clarity and persuasion. Language: ${fromLanguage}.`;
    default:
      return `Improve the script. Language: ${fromLanguage}.`;
  }
}
