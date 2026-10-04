import { Resend } from "resend";
import { generateProviderReading, resolveReadingProvider } from "./text-provider.ts";
import type { Providers } from "./service.ts";
import { required, paymentConfig } from "./config.ts";
export const providers: Providers = {
  preflight(order) {
    const config = paymentConfig();
    if (
      order.environment !== config.environment ||
      order.stripeAccountId !== config.accountId
    )
      throw Error("Order environment mismatch");
    if (
      process.env.SYRENA_GENERATION_ENABLED !== `approved-${order.environment}`
    )
      throw Error("Generation is disabled");
    if (
      order.environment === "test" &&
      order.paymentEmail !== required("SYRENA_TEST_INBOX")
    )
      throw Error("Test recipient is not allowlisted");
    const reading = resolveReadingProvider();
    for (const n of [
      "ELEVENLABS_API_KEY",
      "ELEVENLABS_VOICE_ID",
      "RESEND_API_KEY",
      "RESEND_EMAIL_FROM",
    ])
      required(n);
    if (process.env.SYRENA_VOICE_APPROVED !== "true" || process.env.ELEVENLABS_VOICE_ID !== "uG1JFy6xppqckhHCs2KG")
      throw Error("Website voice is not approved");
    return {
      providerId: reading.providerId,
      modelId: reading.modelId,
      voiceId: required("ELEVENLABS_VOICE_ID"),
    };
  },
  async text(order) {
    return generateProviderReading(order.snapshot);
  },
  async audio(order) {
    if (!order.reading) throw Error("Text not ready");
    const text =
      order.reading.primary +
      (order.reading.shadow
        ? "\n\nShadow Origin.\n" + order.reading.shadow
        : "");
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(required("ELEVENLABS_VOICE_ID"))}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": required("ELEVENLABS_API_KEY"),
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
        signal: AbortSignal.timeout(45000),
      },
    );
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("audio/")
    )
      throw Error("Audio unavailable");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 100 || bytes.length > 8_000_000)
      throw Error("Audio size invalid");
    return bytes.toString("base64");
  },
  async email(payload, key) {
    const resend = new Resend(required("RESEND_API_KEY"));
    const result = await resend.emails.send(
      { from: required("RESEND_EMAIL_FROM"), ...payload },
      { idempotencyKey: key },
    );
    if (result.error || !result.data?.id) throw Error("Email unavailable");
    return result.data.id;
  },
};
