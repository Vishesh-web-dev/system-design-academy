import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateText } from 'ai';
import { loadEnv } from './env';

/**
 * The M14 live-provider check, recorded in docs/V1_VERIFICATION.md.
 *
 * Not part of the standard gates: it needs network access and a real
 * AI_API_KEY, exactly like scripts/verify-resources.ts. It exercises the one
 * path the mock provider cannot — an actual model call with the key read
 * server-side — and writes docs/live-provider-check.json, which
 * scripts/verify-v1.ts embeds as evidence. A failure here degrades to a
 * recorded PENDING rather than a fabricated PASS.
 *
 * The provider selection here mirrors lib/ai/provider.ts deliberately, rather
 * than importing it, so the script can run under plain tsx without tripping
 * the `server-only` guard that file (correctly) carries.
 */

loadEnv();

const providerConfigured = (process.env.AI_PROVIDER ?? '').toLowerCase();
const apiKey = process.env.AI_API_KEY;
const sidecar = join('docs', 'live-provider-check.json');

// Mirrors the `main` defaults in lib/ai/provider.ts (kept in sync by hand so
// this script needs no server-only import).
const DEFAULT_MODELS: Record<string, string> = {
  google: 'gemini-3.6-flash',
  anthropic: 'claude-sonnet-4-5',
};

function record(result: Record<string, unknown>): void {
  writeFileSync(sidecar, `${JSON.stringify(result, null, 2)}\n`);
}

if (!apiKey || providerConfigured === 'mock' || (providerConfigured !== 'google' && providerConfigured !== 'anthropic')) {
  const reason = !apiKey
    ? 'no AI_API_KEY configured'
    : `AI_PROVIDER is "${providerConfigured || '(unset)'}", not a live provider`;
  console.log(`Live provider check: SKIPPED — ${reason}.`);
  record({ ok: false, status: 'skipped', reason, checkedAt: new Date().toISOString() });
  process.exit(0);
}

const model = (process.env.AI_MODEL && process.env.AI_MODEL.trim()) || DEFAULT_MODELS[providerConfigured];

async function buildModel() {
  if (providerConfigured === 'anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    return createAnthropic({ apiKey: apiKey! })(model);
  }
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
  return createGoogleGenerativeAI({ apiKey: apiKey! })(model);
}

const started = Date.now();
try {
  const llm = await buildModel();
  // A minimal interviewer-shaped turn: cheap, one short response, enough to
  // prove the key, the SDK wiring and the model round-trip all work.
  const { text } = await generateText({
    model: llm,
    system:
      'You are a system-design interviewer. Reply in ONE short sentence acknowledging the candidate and asking them to start with requirements.',
    messages: [{ role: 'user', content: 'I am ready to begin the URL shortener design.' }],
    temperature: 0.4,
    maxTokens: 120,
  });
  const latencyMs = Date.now() - started;
  const sample = text.trim().replace(/\s+/g, ' ').slice(0, 240);

  if (!sample) throw new Error('provider returned an empty response');

  console.log(`Live provider check: PASS — ${providerConfigured}/${model} in ${latencyMs} ms.`);
  console.log(`  sample: ${sample}`);
  record({
    ok: true,
    status: 'pass',
    provider: providerConfigured,
    model,
    latencyMs,
    sample,
    checkedAt: new Date().toISOString(),
  });
} catch (e) {
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const latencyMs = Date.now() - started;
  console.error(`Live provider check: FAILED — ${providerConfigured}/${model}: ${message}`);
  record({
    ok: false,
    status: 'failed',
    provider: providerConfigured,
    model,
    latencyMs,
    error: message,
    checkedAt: new Date().toISOString(),
  });
  // Do not fail the process: this is a recorded manual check, not a gate.
  process.exit(0);
}
