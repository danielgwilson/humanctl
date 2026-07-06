// Approximate public list prices, USD per 1,000,000 tokens. Used only for a
// LOCAL spend estimate shown in the desktop app, always labeled "est". These
// are not authoritative billing numbers. Update as vendor pricing changes.

export const AS_OF = '2026-06';

export interface PriceEntry {
  match?: RegExp;
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
}

// USD per 1M tokens. Matched against the model id in the transcript, first hit
// wins, so list specific model families before generic ones. Verified against
// platform.claude.com/pricing and developers.openai.com/api/docs/pricing (2026-06).
export const TABLE: PriceEntry[] = [
  // Anthropic (Claude 4.x). Note Opus 4.x is 5/25, not the old Claude-3-Opus 15/75.
  { match: /opus/i, in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { match: /sonnet/i, in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { match: /haiku/i, in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // OpenAI gpt-5.x (Codex). Specific dotted versions before the generic gpt-5.
  { match: /gpt-?5\.5/i, in: 5, out: 30, cacheRead: 0.5, cacheWrite: 0.5 },
  { match: /gpt-?5\.4/i, in: 2.5, out: 15, cacheRead: 0.25, cacheWrite: 0.25 },
  { match: /gpt-?5\.3/i, in: 1.75, out: 14, cacheRead: 0.175, cacheWrite: 0.175 },
  { match: /codex|gpt-?5/i, in: 1.25, out: 10, cacheRead: 0.125, cacheWrite: 0.125 },
];

export const DEFAULT: PriceEntry = { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 };

export function priceFor(model?: string | null): PriceEntry {
  if (model) {
    for (const p of TABLE) if (p.match && p.match.test(model)) return p;
  }
  return DEFAULT;
}

// Context window size (tokens) by model, for the context-fill signal. Codex
// records its own window in the transcript, so this is mainly for Claude, whose
// 4.x models are 200k by default (1M is an opt-in beta).
export function contextWindowFor(model?: string | null): number {
  if (model && /1m|1-million/i.test(model)) return 1000000;
  return 200000;
}
