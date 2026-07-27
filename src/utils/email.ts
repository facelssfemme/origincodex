import { createServerFn } from "@tanstack/react-start";
import { Resend } from "resend";

interface EmailInput {
  to: string;
  name: string;
  primaryArchetype: string;
  readingText: string;
  shadowReadingText?: string;
  audioUrl?: string;
}

function buildEmailHtml(input: EmailInput): string {
  const paragraphs = input.readingText
    .split("\n")
    .filter((p) => p.trim())
    .map((p) => `<p style="color: #d1d5db; font-size: 16px; line-height: 1.75; margin: 0 0 16px 0; font-weight: 300;">${p.trim()}</p>`)
    .join("\n");

  const shadowSection = input.shadowReadingText
    ? `
      <tr>
        <td style="padding: 0 0 24px 0;">
          <div style="border-top: 1px solid rgba(139, 92, 246, 0.3); margin-bottom: 24px;"></div>
          <h2 style="color: #c4b5fd; font-size: 18px; font-weight: 500; margin: 0 0 16px 0; letter-spacing: 2px; text-transform: uppercase;">Your Hidden Shadow Origin</h2>
          ${input.shadowReadingText
            .split("\n")
            .filter((p) => p.trim())
            .map((p) => `<p style="color: #d1d5db; font-size: 15px; line-height: 1.75; margin: 0 0 14px 0; font-weight: 300; border-left: 2px solid rgba(139, 92, 246, 0.3); padding-left: 16px;">${p.trim()}</p>`)
            .join("\n")
          }
        </td>
      </tr>
    `
    : "";

  const audioSection = input.audioUrl
    ? `
      <tr>
        <td style="padding: 0 0 24px 0;">
          <div style="background: linear-gradient(135deg, rgba(88, 28, 135, 0.3), rgba(147, 51, 234, 0.1)); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 16px; padding: 24px; text-align: center;">
            <p style="color: #c4b5fd; font-size: 14px; letter-spacing: 1px; margin: 0 0 12px 0;">Hear your reading spoken to you by Syrena ✦</p>
            <a href="${input.audioUrl}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed, #a855f7); color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 12px; font-size: 14px; font-weight: 500;">Listen to Your Reading</a>
          </div>
        </td>
      </tr>
    `
    : "";

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
                  <p style="color: #9ca3af; font-size: 14px; margin: 0;">Prepared personally for ${input.name}</p>
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
              ${shadowSection}
              ${audioSection}
              <!-- Share CTA -->
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

export const sendReadingEmail = createServerFn({ method: "POST" })
  .validator((d: EmailInput) => d)
  .handler(async ({ data }) => {
    const apiKey = process.env.RESEND_API_KEY;
    const inboxEmail = "syrena-the-origin-codex-ebcec24b@ctomail.io";

    // If no API key, return a graceful message
    if (!apiKey) {
      console.log("RESEND_API_KEY not set — email delivery unavailable");
      return {
        sent: false,
        message: "Email delivery will be available soon",
      };
    }

    try {
      const resend = new Resend(apiKey);

      const htmlContent = buildEmailHtml(data);
      const plainText = [
        `Your Starseed Origin Reading`,
        `Prepared personally for ${data.name}`,
        ``,
        data.readingText,
        data.shadowReadingText ? `\n---\n${data.shadowReadingText}` : "",
        data.audioUrl ? `\nListen to your reading: ${data.audioUrl}` : "",
        ``,
        `With cosmic love,`,
        `✦ Syrena`,
      ].join("\n\n");

      const { error } = await resend.emails.send({
        from: `Syrena <${inboxEmail}>`,
        to: [data.to],
        subject: `✨ Your Starseed Origin Reading, ${data.name}`,
        html: htmlContent,
        text: plainText,
      });

      if (error) {
        console.error("Resend email error:", error);
        return {
          sent: false,
          message: "We couldn't send the email right now. Please try again.",
        };
      }

      return {
        sent: true,
        message: `Your reading is on its way to ${data.to} ✦`,
      };
    } catch (error) {
      console.error("Error sending email via Resend:", error);
      return {
        sent: false,
        message: "We couldn't send the email right now. Please try again.",
      };
    }
  });
