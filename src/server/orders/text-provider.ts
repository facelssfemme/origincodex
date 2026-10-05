import { openAIReadingAdapter } from "./openai-reading.ts";
import { promptFor, validateReading, type Snapshot } from "./domain.ts";

type Environment = Record<string, string | undefined>;
export interface ReadingAdapter {
  // Validate provider-specific credentials here, before any paid work starts.
  configure(modelId: string, env: Environment): {
    generate(prompt: ReturnType<typeof promptFor>, signal: AbortSignal): Promise<string>;
  };
}
export type ReadingAdapters = Readonly<Record<string, ReadingAdapter>>;

// OpenAI was explicitly selected. The provider and exact model still require
// server configuration; neither is inferred from a key or browser input.
export const readingAdapters: ReadingAdapters = Object.freeze({ openai: openAIReadingAdapter() });

export function resolveReadingProvider(
  env: Environment = process.env,
  adapters: ReadingAdapters = readingAdapters,
) {
  const providerId = env.SYRENA_READING_PROVIDER?.trim();
  const modelId = env.SYRENA_READING_MODEL?.trim();
  if (!providerId || !modelId) throw Error("Reading provider and model must be selected");
  const adapter = Object.hasOwn(adapters, providerId) ? adapters[providerId] : undefined;
  if (!adapter) throw Error("Selected reading provider is not installed");
  const configured = adapter.configure(modelId, env);
  return { ...configured, providerId, modelId };
}

export async function generateProviderReading(
  snapshot: Snapshot,
  provider = resolveReadingProvider(),
) {
  // One attempt only. Errors, refusals, malformed JSON and incomplete Shadow
  // propagate to the worker's review state; there is no canned paid fallback.
  const raw = await provider.generate(promptFor(snapshot), AbortSignal.timeout(45_000));
  return validateReading(JSON.parse(raw), snapshot.includeShadow);
}
