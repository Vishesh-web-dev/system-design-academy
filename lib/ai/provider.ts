import 'server-only';
import type { LanguageModel } from 'ai';

/**
 * The only place the AI key is read (docs/ARCHITECTURE.md → AI interviewer
 * architecture). Nothing here may be imported from a Client Component; the
 * `server-only` import turns that mistake into a build error rather than a
 * leaked credential.
 *
 * Provider is chosen by AI_PROVIDER so the model can be swapped without
 * touching prompts, session logic or UI.
 */

export type ProviderName = 'google' | 'anthropic' | 'mock';
export type Tier = 'main' | 'fast';

// Confirmed live against the configured Google key on 2026-09-15: the former
// gemini-2.5-flash default now 404s with "no longer available, use
// gemini-3.6-flash". The fast tier has no caller in the codebase today, so it
// points at the same known-available model; override with AI_MODEL_FAST once a
// current lite model is confirmed. Anthropic defaults are left as-is — that
// provider is not configured here and cannot be verified without its key.
const DEFAULT_MODELS: Record<Exclude<ProviderName, 'mock'>, Record<Tier, string>> = {
  google: { main: 'gemini-3.6-flash', fast: 'gemini-3.6-flash' },
  anthropic: { main: 'claude-sonnet-4-5', fast: 'claude-haiku-4-5-20251001' },
};

export function providerName(): ProviderName {
  const configured = (process.env.AI_PROVIDER ?? '').toLowerCase();
  const key = process.env.AI_API_KEY;

  if (configured === 'mock') return 'mock';
  // Without a key there is nothing to call. Falling back to the scripted
  // interviewer keeps the rest of the platform working rather than throwing
  // on a page load.
  if (!key) return 'mock';
  if (configured === 'anthropic') return 'anthropic';
  if (configured === 'google') return 'google';
  return 'mock';
}

export function isLive(): boolean {
  return providerName() !== 'mock';
}

export function modelId(tier: Tier = 'main'): string {
  const name = providerName();
  if (name === 'mock') return 'mock';
  const override = tier === 'fast' ? process.env.AI_MODEL_FAST : process.env.AI_MODEL;
  return override && override.trim() ? override.trim() : DEFAULT_MODELS[name][tier];
}

/**
 * Returns a configured model, or null when no provider is available. Callers
 * must handle null by degrading to the scripted interviewer — the interview
 * simulator is the only feature that needs a model, and a missing key must not
 * take down anything else.
 */
export async function getModel(tier: Tier = 'main'): Promise<LanguageModel | null> {
  const name = providerName();
  if (name === 'mock') return null;

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return null;

  if (name === 'anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    return createAnthropic({ apiKey })(modelId(tier));
  }

  const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
  return createGoogleGenerativeAI({ apiKey })(modelId(tier));
}

/** Safe to send to the client: never includes the key. */
export function providerStatus(): { provider: ProviderName; model: string; live: boolean } {
  return { provider: providerName(), model: modelId('main'), live: isLive() };
}
