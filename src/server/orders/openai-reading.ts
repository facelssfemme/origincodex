import type { ReadingAdapter } from "./text-provider.ts";

// Server-only, fixed API destination. Never accept a browser endpoint/key/model.
export function openAIReadingAdapter(request: typeof fetch = fetch): ReadingAdapter {
  return {
    configure(modelId, env) {
      const key = env.OPENAI_API_KEY?.trim();
      if (!key || !/^sk-[A-Za-z0-9_-]{20,}$/.test(key))
        throw Error("OpenAI API key is missing or malformed");
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(modelId))
        throw Error("Explicit OpenAI model ID required");
      // Syntax is checked locally; only an actual API call can establish that
      // this key has access to a compatible model. There is no default model.
      return {
        async generate(prompt, signal) {
          try {
            signal.throwIfAborted();
            const response = await request("https://api.openai.com/v1/responses", {
              method: "POST",
              headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
              redirect: "error",
              cache: "no-store",
              signal,
              body: JSON.stringify({
                model: modelId,
                store: false,
                max_output_tokens: 2400,
                input: [
                  { role: "system", content: prompt.system },
                  { role: "user", content: prompt.user },
                ],
                text: { format: {
                  type: "json_schema",
                  name: "syrena_reading",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: { primary: { type: "string" }, shadow: { type: ["string", "null"] } },
                    required: ["primary", "shadow"],
                    additionalProperties: false,
                  },
                } },
              }),
            });
            if (!response.ok) throw Error("OpenAI request rejected");
            const raw = await response.text();
            if (raw.length > 200_000) throw Error("Oversized OpenAI response");
            const result = JSON.parse(raw);
            if (result.status !== "completed" || result.error || result.incomplete_details || !Array.isArray(result.output))
              throw Error("Incomplete OpenAI response");
            // Reasoning items may precede the assistant message. No tool output
            // or refusal is a reading, even when another item contains text.
            const messages = result.output.filter((item: { type?: string }) => item?.type !== "reasoning");
            if (messages.length !== 1) throw Error("Unexpected OpenAI output");
            const message = messages[0];
            if (message?.type !== "message" || message.role !== "assistant" || message.status !== "completed" || !Array.isArray(message.content) || message.content.length !== 1)
              throw Error("Unexpected OpenAI message");
            const part = message.content[0];
            if (part?.type !== "output_text" || typeof part.text !== "string" || !part.text.trim())
              throw Error("OpenAI refused or returned no reading");
            const reading = JSON.parse(part.text);
            if (!reading || typeof reading !== "object" || Array.isArray(reading) || Object.keys(reading).sort().join(",") !== "primary,shadow")
              throw Error("Invalid reading structure");
            return part.text; // Common validation enforces paid Shadow and text lengths.
          } catch {
            // Do not log/return response bodies, prompts, credentials or provider
            // exception text. The worker preserves uncertain outcomes for review.
            throw Error("OpenAI reading generation failed");
          }
        },
      };
    },
  };
}
