import { createServerFn } from "@tanstack/react-start";
import { Resend } from "resend";

interface ResultsEmailInput {
  email: string;
  userName: string;
  primaryArchetype: string;
  secondaryArchetype: string;
  readingText: string;
}

function buildResultsEmailHtml(input: ResultsEmailInput): string {
  const paragraphs = input.readingText
    .split("\n")
    .filter((p) => p.trim())
    .map((p) => `<p style="color: #d1d5db; font-size: 16px; line-height: 1.75; margin: 0 0 16px 0; font-weight: 300;">${p.trim()}</p>`)
    .join("\n");

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="dark">
    </head>
    <body style="margin: 0; padding: 0; background-color: #0a0218; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0218; min-width: 100%;">
        <tr>
          <td align="center" style="padding: 40px 16px;">
            <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">
              <!-- Header -->
              <tr>
                <td style="text-align: center; padding: 0 0 32px 0;">
                  <div style="width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, rgba(124, 58, 237, 0.3), rgba(212, 168, 83, 0.2)); border: 1px solid rgba(255,255,255,0.1); margin: 0 auto 16px auto; display: flex; align-items: center; justify-content: center;">
                    <span style="font-size: 20px;">✦</span>
                  </div>
                  <h1 style="color: #d4a853; font-size: 14px; font-weight: 400; letter-spacing: 3px; text-transform: uppercase; margin: 0;">Syrena · The Origin Codex</h1>
                </td>
              </tr>
              <!-- Title -->
              <tr>
                <td style="text-align: center; padding: 0 0 32px 0;">
                  <h2 style="color: #ffffff; font-size: 24px; font-weight: 300; margin: 0 0 8px 0;">Your Starseed Origin Reading</h2>
                  <p style="color: #d4a853; font-size: 16px; font-weight: 500; margin: 0;">${input.primaryArchetype}${input.secondaryArchetype ? ` · ${input.secondaryArchetype}` : ""}</p>
                  <p style="color: #9ca3af; font-size: 14px; margin: 8px 0 0 0;">Prepared personally for ${input.userName}</p>
                  <div style="width: 40px; height: 2px; background: linear-gradient(90deg, transparent, #d4a853, transparent); margin: 16px auto 0 auto;"></div>
                </td>
              </tr>
              <!-- Reading Card -->
              <tr>
                <td style="padding: 0 0 24px 0;">
                  <div style="background: linear-gradient(135deg, rgba(88, 28, 135, 0.2), rgba(10, 2, 24, 0.5)); border: 1px solid rgba(139, 92, 246, 0.15); border-radius: 24px; padding: 32px;">
                    ${paragraphs}
                    <p style="color: #9ca3af; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0; font-style: italic;">With cosmic love,<br/>✦ Syrena</p>
                  </div>
                </td>
              </tr>
              <!-- CTA -->
              <tr>
                <td style="text-align: center; padding: 0 0 24px 0;">
                  <p style="color: #9ca3af; font-size: 13px; margin: 0 0 12px 0;">Your origin is ${input.primaryArchetype} — if this resonates, share it with someone who needs to hear it.</p>
                  <a href="https://theorigincodex.com" style="display: inline-block; color: #d4a853; text-decoration: none; font-size: 14px; border: 1px solid rgba(212, 168, 83, 0.3); padding: 10px 24px; border-radius: 12px;">Discover Your Origin</a>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="text-align: center; padding: 24px 0 0 0; border-top: 1px solid rgba(255,255,255,0.05);">
                  <p style="color: #6b7280; font-size: 11px; margin: 0;">This reading was generated personally for you by Syrena.</p>
                  <p style="color: #4b5563; font-size: 10px; margin: 8px 0 0 0;">Syrena · The Origin Codex</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export const sendResultsEmail = createServerFn({ method: "POST" })
  .validator((d: ResultsEmailInput) => d)
  .handler(async ({ data }) => {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_EMAIL_FROM || "syrena-the-origin-codex-ebcec24b@ctomail.io";

    // If no API key, return a graceful no-op
    if (!apiKey) {
      console.log("RESEND_API_KEY not set — results email delivery unavailable");
      return {
        sent: false,
        message: "Email delivery will be available soon.",
      };
    }

    try {
      const resend = new Resend(apiKey);

      const htmlContent = buildResultsEmailHtml(data);
      const plainText = [
        `Your Starseed Origin Reading`,
        `${data.primaryArchetype}${data.secondaryArchetype ? ` · ${data.secondaryArchetype}` : ""}`,
        `Prepared personally for ${data.userName}`,
        ``,
        data.readingText,
        ``,
        `Your origin is ${data.primaryArchetype} — if this resonates, share it with someone who needs to hear it.`,
        `Discover Your Origin: https://theorigincodex.com`,
        ``,
        `With cosmic love,`,
        `✦ Syrena`,
      ].join("\n\n");

      const { error } = await resend.emails.send({
        from: `Syrena <${fromEmail}>`,
        to: [data.email],
        subject: `Your Starseed Origin Reading — ${data.primaryArchetype}`,
        html: htmlContent,
        text: plainText,
      });

      if (error) {
        console.error("Resend results email error:", error);
        return {
          sent: false,
          message: "We couldn't send your results email right now.",
        };
      }

      return {
        sent: true,
        message: `Your reading has been sent to ${data.email} ✦`,
      };
    } catch (error) {
      console.error("Error sending results email via Resend:", error);
      return {
        sent: false,
        message: "We couldn't send your results email right now.",
      };
    }
  });
